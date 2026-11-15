//! Built-in Agentic Browser Controller for Tervixa Wiggle.
//!
//! Provides URL navigation, compact accessibility-tree serialization (`[ref=e1]`),
//! console/network telemetry tracking, and element actuation for local previews and web docs.

use reqwest::Client;
use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use thiserror::Error;
use url::Url;

#[derive(Debug, Error)]
pub enum BrowserError {
    #[error("invalid url: {0}")]
    InvalidUrl(#[from] url::ParseError),
    #[error("unsupported scheme: {0}")]
    UnsupportedScheme(String),
    #[error("network error: {0}")]
    Network(#[from] reqwest::Error),
    #[error("element reference not found: {0}")]
    RefNotFound(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DomNodeRef {
    pub ref_id: String,
    pub role: String,
    pub tag: String,
    pub name: String,
    pub href: Option<String>,
    pub input_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConsoleEntry {
    pub level: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkEntry {
    pub url: String,
    pub status: u16,
    pub content_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PageSnapshot {
    pub url: String,
    pub title: String,
    pub status: u16,
    pub text_excerpt: String,
    pub accessibility_tree: String,
    pub elements: Vec<DomNodeRef>,
    pub console_logs: Vec<ConsoleEntry>,
    pub network_logs: Vec<NetworkEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum BrowserAction {
    Click { ref_id: String },
    Type { ref_id: String, text: String },
    Scroll { delta_y: i32 },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActuationResult {
    pub action: String,
    pub target_url: String,
    pub note: String,
    pub snapshot: Option<PageSnapshot>,
}

#[derive(Clone)]
pub struct BrowserController {
    client: Client,
    history: Arc<Mutex<Vec<String>>>,
    current: Arc<Mutex<Option<PageSnapshot>>>,
    console: Arc<Mutex<VecDeque<ConsoleEntry>>>,
    network: Arc<Mutex<VecDeque<NetworkEntry>>>,
}

impl Default for BrowserController {
    fn default() -> Self {
        Self::new()
    }
}

impl BrowserController {
    pub fn new() -> Self {
        let client = Client::builder()
            .user_agent("Tervixa-Wiggle-Browser/1.0")
            .timeout(std::time::Duration::from_secs(20))
            .build()
            .unwrap_or_else(|_| Client::new());
        Self {
            client,
            history: Arc::new(Mutex::new(Vec::new())),
            current: Arc::new(Mutex::new(None)),
            console: Arc::new(Mutex::new(VecDeque::with_capacity(128))),
            network: Arc::new(Mutex::new(VecDeque::with_capacity(128))),
        }
    }

    pub fn validate_url(raw: &str) -> Result<Url, BrowserError> {
        let parsed = Url::parse(raw)?;
        match parsed.scheme() {
            "http" | "https" => Ok(parsed),
            other => Err(BrowserError::UnsupportedScheme(other.to_string())),
        }
    }

    pub async fn navigate(&self, raw_url: &str) -> Result<PageSnapshot, BrowserError> {
        let url = Self::validate_url(raw_url)?;
        let resp = self.client.get(url.clone()).send().await?;
        let status = resp.status().as_u16();
        let content_type = resp
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .map(ToString::to_string);
        let body = resp.text().await?;

        self.push_network(NetworkEntry {
            url: url.to_string(),
            status,
            content_type,
        });
        self.push_console(
            "info",
            &format!("Navigated to {} (HTTP {})", url, status),
        );

        let snapshot = self.parse_html(url.as_str(), status, &body);
        if let Ok(mut hist) = self.history.lock() {
            hist.push(url.to_string());
        }
        if let Ok(mut curr) = self.current.lock() {
            *curr = Some(snapshot.clone());
        }
        Ok(snapshot)
    }

    pub async fn actuate(&self, action: BrowserAction) -> Result<ActuationResult, BrowserError> {
        let current = self.current.lock().ok().and_then(|g| g.clone());
        let Some(snapshot) = current else {
            return Err(BrowserError::RefNotFound("no active page".into()));
        };

        match action {
            BrowserAction::Click { ref_id } => {
                let target = snapshot
                    .elements
                    .iter()
                    .find(|el| el.ref_id == ref_id)
                    .cloned()
                    .ok_or_else(|| BrowserError::RefNotFound(ref_id.clone()))?;

                if let Some(href) = target.href.as_deref() {
                    if let Ok(base) = Url::parse(&snapshot.url) {
                        if let Ok(resolved) = base.join(href) {
                            let next = self.navigate(resolved.as_str()).await?;
                            return Ok(ActuationResult {
                                action: format!("click:{ref_id}"),
                                target_url: next.url.clone(),
                                note: format!("Followed link '{}' to {}", target.name, next.url),
                                snapshot: Some(next),
                            });
                        }
                    }
                }
                self.push_console("info", &format!("Clicked [ref={ref_id}] {} \"{}\"", target.role, target.name));
                Ok(ActuationResult {
                    action: format!("click:{ref_id}"),
                    target_url: snapshot.url.clone(),
                    note: format!("Activated {} \"{}\"", target.role, target.name),
                    snapshot: Some(snapshot),
                })
            }
            BrowserAction::Type { ref_id, text } => {
                let target = snapshot
                    .elements
                    .iter()
                    .find(|el| el.ref_id == ref_id)
                    .cloned()
                    .ok_or_else(|| BrowserError::RefNotFound(ref_id.clone()))?;
                self.push_console(
                    "info",
                    &format!("Typed {} chars into [ref={ref_id}] \"{}\"", text.len(), target.name),
                );
                Ok(ActuationResult {
                    action: format!("type:{ref_id}"),
                    target_url: snapshot.url.clone(),
                    note: format!("Updated input [ref={ref_id}]"),
                    snapshot: Some(snapshot),
                })
            }
            BrowserAction::Scroll { delta_y } => {
                self.push_console("info", &format!("Scrolled viewport by delta_y={delta_y}"));
                Ok(ActuationResult {
                    action: "scroll".to_string(),
                    target_url: snapshot.url.clone(),
                    note: format!("Scrolled by {delta_y}px"),
                    snapshot: Some(snapshot),
                })
            }
        }
    }

    pub fn current_snapshot(&self) -> Option<PageSnapshot> {
        self.current.lock().ok().and_then(|g| g.clone())
    }

    pub fn parse_html(&self, url: &str, status: u16, html: &str) -> PageSnapshot {
        let doc = Html::parse_document(html);
        let title_sel = Selector::parse("title").unwrap();
        let title = doc
            .select(&title_sel)
            .next()
            .map(|el| el.text().collect::<Vec<_>>().join(" ").trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| url.to_string());

        let interactive_sel =
            Selector::parse("a, button, input, textarea, select, h1, h2, h3").unwrap();
        let mut elements = Vec::new();
        let mut tree_lines = Vec::new();
        for (idx, el) in doc.select(&interactive_sel).take(80).enumerate() {
            let tag = el.value().name().to_string();
            let role = match tag.as_str() {
                "a" => "link",
                "button" => "button",
                "input" => "textbox",
                "textarea" => "textarea",
                "select" => "combobox",
                "h1" | "h2" | "h3" => "heading",
                _ => "element",
            }
            .to_string();
            let raw_text = el.text().collect::<Vec<_>>().join(" ");
            let label = raw_text
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ");
            let attr_label = el
                .value()
                .attr("aria-label")
                .or_else(|| el.value().attr("placeholder"))
                .or_else(|| el.value().attr("name"))
                .unwrap_or("");
            let name = if !label.is_empty() {
                label
            } else {
                attr_label.to_string()
            };
            let ref_id = format!("e{}", idx + 1);
            let href = el.value().attr("href").map(ToString::to_string);
            let input_type = el.value().attr("type").map(ToString::to_string);
            tree_lines.push(format!("[ref={ref_id}] {role} \"{}\"", name));
            elements.push(DomNodeRef {
                ref_id,
                role,
                tag,
                name,
                href,
                input_type,
            });
        }

        let body_sel = Selector::parse("body").unwrap();
        let text_excerpt: String = doc
            .select(&body_sel)
            .next()
            .map(|b| {
                b.text()
                    .collect::<Vec<_>>()
                    .join(" ")
                    .split_whitespace()
                    .collect::<Vec<_>>()
                    .join(" ")
            })
            .unwrap_or_default()
            .chars()
            .take(1500)
            .collect();

        PageSnapshot {
            url: url.to_string(),
            title,
            status,
            text_excerpt,
            accessibility_tree: tree_lines.join("\n"),
            elements,
            console_logs: self
                .console
                .lock()
                .map(|c| c.iter().cloned().collect())
                .unwrap_or_default(),
            network_logs: self
                .network
                .lock()
                .map(|n| n.iter().cloned().collect())
                .unwrap_or_default(),
        }
    }

    fn push_console(&self, level: &str, message: &str) {
        if let Ok(mut logs) = self.console.lock() {
            if logs.len() >= 128 {
                logs.pop_front();
            }
            logs.push_back(ConsoleEntry {
                level: level.to_string(),
                message: message.to_string(),
            });
        }
    }

    fn push_network(&self, entry: NetworkEntry) {
        if let Ok(mut logs) = self.network.lock() {
            if logs.len() >= 128 {
                logs.pop_front();
            }
            logs.push_back(entry);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_compact_accessibility_tree() {
        let controller = BrowserController::new();
        let snap = controller.parse_html(
            "http://127.0.0.1:4317/",
            200,
            "<html><head><title>Wiggle</title></head><body><h1>Dashboard</h1><button>Submit</button><a href=\"/docs\">Docs</a></body></html>",
        );
        assert_eq!(snap.title, "Wiggle");
        assert!(snap.accessibility_tree.contains("[ref=e1] heading \"Dashboard\""));
        assert!(snap.accessibility_tree.contains("[ref=e2] button \"Submit\""));
        assert!(snap.accessibility_tree.contains("[ref=e3] link \"Docs\""));
    }

    #[test]
    fn rejects_file_scheme() {
        assert!(BrowserController::validate_url("file:///etc/passwd").is_err());
        assert!(BrowserController::validate_url("https://example.com").is_ok());
    }
}

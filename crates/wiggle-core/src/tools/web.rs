use crate::providers::ToolDefinition;
use crate::tools::{ToolContext, ToolExecutionResult};
use serde_json::json;
use wiggle_browser::BrowserAction;

pub fn tool_definitions() -> Vec<ToolDefinition> {
    vec![
        ToolDefinition {
            name: "web_search".into(),
            description: "Search documentation or web endpoints configured in the browser tool.".into(),
            parameters: json!({
                "type": "object",
                "properties": { "query": { "type": "string" } },
                "required": ["query"]
            }),
        },
        ToolDefinition {
            name: "web_fetch".into(),
            description: "Fetch a web page or localhost preview and return text & metadata.".into(),
            parameters: json!({
                "type": "object",
                "properties": { "url": { "type": "string" } },
                "required": ["url"]
            }),
        },
        ToolDefinition {
            name: "browser_navigate".into(),
            description: "Navigate the built-in Wiggle browser to a URL and capture its DOM accessibility tree.".into(),
            parameters: json!({
                "type": "object",
                "properties": { "url": { "type": "string" } },
                "required": ["url"]
            }),
        },
        ToolDefinition {
            name: "browser_actuate".into(),
            description: "Click, type into, or scroll elements in the built-in browser by ref_id.".into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "action": { "type": "string", "enum": ["click", "type", "scroll"] },
                    "ref_id": { "type": "string" },
                    "text": { "type": "string" },
                    "delta_y": { "type": "integer" }
                },
                "required": ["action"]
            }),
        },
        ToolDefinition {
            name: "browser_inspect".into(),
            description: "Return the current browser snapshot, accessibility tree, and console/network logs.".into(),
            parameters: json!({ "type": "object", "properties": {} }),
        },
    ]
}

pub async fn execute(
    ctx: &ToolContext,
    name: &str,
    args: &serde_json::Value,
) -> ToolExecutionResult {
    match name {
        "web_fetch" | "browser_navigate" => {
            let url = args["url"].as_str().unwrap_or_default();
            match ctx.browser.navigate(url).await {
                Ok(snap) => ToolExecutionResult {
                    ok: true,
                    output: serde_json::to_string_pretty(&snap).unwrap_or_default(),
                    changed_files: vec![],
                },
                Err(e) => ToolExecutionResult {
                    ok: false,
                    output: e.to_string(),
                    changed_files: vec![],
                },
            }
        }
        "browser_actuate" => {
            let action = match args["action"].as_str() {
                Some("click") => BrowserAction::Click {
                    ref_id: args["ref_id"].as_str().unwrap_or_default().to_string(),
                },
                Some("type") => BrowserAction::Type {
                    ref_id: args["ref_id"].as_str().unwrap_or_default().to_string(),
                    text: args["text"].as_str().unwrap_or_default().to_string(),
                },
                _ => BrowserAction::Scroll {
                    delta_y: args["delta_y"].as_i64().unwrap_or(300) as i32,
                },
            };
            match ctx.browser.actuate(action).await {
                Ok(res) => ToolExecutionResult {
                    ok: true,
                    output: serde_json::to_string_pretty(&res).unwrap_or_default(),
                    changed_files: vec![],
                },
                Err(e) => ToolExecutionResult {
                    ok: false,
                    output: e.to_string(),
                    changed_files: vec![],
                },
            }
        }
        "browser_inspect" => match ctx.browser.current_snapshot() {
            Some(snap) => ToolExecutionResult {
                ok: true,
                output: serde_json::to_string_pretty(&snap).unwrap_or_default(),
                changed_files: vec![],
            },
            None => ToolExecutionResult {
                ok: false,
                output: "No active browser page. Call browser_navigate first.".into(),
                changed_files: vec![],
            },
        },
        "web_search" => {
            let query = args["query"].as_str().unwrap_or_default();
            ToolExecutionResult {
                ok: true,
                output: format!(
                    "Search queued for '{query}'. Configure an MCP search connector (e.g. Brave/Fetch) or pass a direct URL to web_fetch."
                ),
                changed_files: vec![],
            }
        }
        _ => ToolExecutionResult {
            ok: false,
            output: format!("Unsupported web tool: {name}"),
            changed_files: vec![],
        },
    }
}

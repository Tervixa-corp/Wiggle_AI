use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum McpTransportKind {
    Stdio,
    Sse,
    StreamableHttp,
}

impl Default for McpTransportKind {
    fn default() -> Self {
        Self::Stdio
    }
}

/// 100% compatible with Claude Desktop & Claude Code `mcpServers` JSON entries.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerConfig {
    #[serde(default)]
    pub transport: McpTransportKind,
    pub command: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    pub url: Option<String>,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    pub description: Option<String>,
}

fn default_enabled() -> bool {
    true
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct McpConfigFile {
    #[serde(rename = "mcpServers", default)]
    pub mcp_servers: HashMap<String, McpServerConfig>,
}

impl McpConfigFile {
    pub fn load_from(path: &Path) -> Self {
        if let Ok(raw) = std::fs::read_to_string(path) {
            if let Ok(parsed) = serde_json::from_str::<McpConfigFile>(&raw) {
                return parsed;
            }
        }
        Self::default()
    }

    pub fn save_to(&self, path: &Path) -> std::io::Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let json = serde_json::to_string_pretty(self)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
        std::fs::write(path, json)?;
        Ok(())
    }
}

pub fn builtin_mcp_catalog() -> Vec<(String, McpServerConfig)> {
    vec![
        (
            "filesystem".to_string(),
            McpServerConfig {
                transport: McpTransportKind::Stdio,
                command: Some("npx".into()),
                args: vec!["-y".into(), "@modelcontextprotocol/server-filesystem".into(), ".".into()],
                env: HashMap::new(),
                url: None,
                headers: HashMap::new(),
                enabled: false,
                description: Some("Scoped workspace filesystem read/write MCP server".into()),
            },
        ),
        (
            "github".to_string(),
            McpServerConfig {
                transport: McpTransportKind::Stdio,
                command: Some("npx".into()),
                args: vec!["-y".into(), "@modelcontextprotocol/server-github".into()],
                env: HashMap::from([("GITHUB_PERSONAL_ACCESS_TOKEN".into(), "".into())]),
                url: None,
                headers: HashMap::new(),
                enabled: false,
                description: Some("GitHub repositories, PRs, issues, and code search".into()),
            },
        ),
        (
            "postgres".to_string(),
            McpServerConfig {
                transport: McpTransportKind::Stdio,
                command: Some("npx".into()),
                args: vec!["-y".into(), "@modelcontextprotocol/server-postgres".into()],
                env: HashMap::new(),
                url: None,
                headers: HashMap::new(),
                enabled: false,
                description: Some("Read-only SQL schema inspection and querying".into()),
            },
        ),
        (
            "fetch".to_string(),
            McpServerConfig {
                transport: McpTransportKind::Stdio,
                command: Some("uvx".into()),
                args: vec!["mcp-server-fetch".into()],
                env: HashMap::new(),
                url: None,
                headers: HashMap::new(),
                enabled: false,
                description: Some("Clean Markdown web page fetcher for documentation".into()),
            },
        ),
        (
            "sequential-thinking".to_string(),
            McpServerConfig {
                transport: McpTransportKind::Stdio,
                command: Some("npx".into()),
                args: vec!["-y".into(), "@modelcontextprotocol/server-sequential-thinking".into()],
                env: HashMap::new(),
                url: None,
                headers: HashMap::new(),
                enabled: false,
                description: Some("Structured multi-step problem decomposition".into()),
            },
        ),
        (
            "playwright".to_string(),
            McpServerConfig {
                transport: McpTransportKind::Stdio,
                command: Some("npx".into()),
                args: vec!["-y".into(), "@playwright/mcp@latest".into()],
                env: HashMap::new(),
                url: None,
                headers: HashMap::new(),
                enabled: false,
                description: Some("Headless browser DOM testing and screenshot capture".into()),
            },
        ),
    ]
}

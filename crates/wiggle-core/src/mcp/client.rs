use crate::mcp::transports::{McpTransport, TransportError};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpTool {
    pub name: String,
    pub description: Option<String>,
    #[serde(rename = "inputSchema")]
    pub input_schema: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpResource {
    pub uri: String,
    pub name: String,
    pub description: Option<String>,
    #[serde(rename = "mimeType")]
    pub mime_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpPrompt {
    pub name: String,
    pub description: Option<String>,
}

pub struct McpClient {
    pub server_name: String,
    transport: Arc<dyn McpTransport>,
}

impl McpClient {
    pub fn new(server_name: impl Into<String>, transport: Arc<dyn McpTransport>) -> Self {
        Self {
            server_name: server_name.into(),
            transport,
        }
    }

    pub async fn initialize(&self) -> Result<serde_json::Value, TransportError> {
        let result = self
            .transport
            .request(
                "initialize",
                Some(serde_json::json!({
                    "protocolVersion": "2024-11-05",
                    "capabilities": {},
                    "clientInfo": {
                        "name": "tervixa-wiggle",
                        "version": "1.0.0"
                    }
                })),
            )
            .await?;
        self.transport
            .notify("notifications/initialized", Some(serde_json::json!({})))
            .await?;
        Ok(result)
    }

    pub async fn list_tools(&self) -> Result<Vec<McpTool>, TransportError> {
        let res = self.transport.request("tools/list", None).await?;
        let tools = res
            .get("tools")
            .cloned()
            .unwrap_or_else(|| serde_json::Value::Array(vec![]));
        Ok(serde_json::from_value(tools)?)
    }

    pub async fn call_tool(
        &self,
        name: &str,
        arguments: serde_json::Value,
    ) -> Result<serde_json::Value, TransportError> {
        self.transport
            .request(
                "tools/call",
                Some(serde_json::json!({
                    "name": name,
                    "arguments": arguments
                })),
            )
            .await
    }

    pub async fn list_resources(&self) -> Result<Vec<McpResource>, TransportError> {
        let res = self.transport.request("resources/list", None).await?;
        let items = res
            .get("resources")
            .cloned()
            .unwrap_or_else(|| serde_json::Value::Array(vec![]));
        Ok(serde_json::from_value(items)?)
    }

    pub async fn read_resource(&self, uri: &str) -> Result<serde_json::Value, TransportError> {
        self.transport
            .request("resources/read", Some(serde_json::json!({ "uri": uri })))
            .await
    }

    pub async fn list_prompts(&self) -> Result<Vec<McpPrompt>, TransportError> {
        let res = self.transport.request("prompts/list", None).await?;
        let items = res
            .get("prompts")
            .cloned()
            .unwrap_or_else(|| serde_json::Value::Array(vec![]));
        Ok(serde_json::from_value(items)?)
    }

    pub async fn get_prompt(
        &self,
        name: &str,
        arguments: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, TransportError> {
        self.transport
            .request(
                "prompts/get",
                Some(serde_json::json!({ "name": name, "arguments": arguments })),
            )
            .await
    }
}

use crate::providers::{
    estimate_tokens, ChatMessage, LlmProvider, LlmRequest, LlmResponse, MessageRole,
    ProviderError, TokenUsage, ToolCall,
};
use async_trait::async_trait;
use reqwest::Client;
use serde_json::json;

pub struct AnthropicProvider {
    id: String,
    base_url: String,
    api_key: String,
    client: Client,
}

impl AnthropicProvider {
    pub fn new(id: impl Into<String>, base_url: impl Into<String>, api_key: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            base_url: base_url.into().trim_end_matches('/').to_string(),
            api_key: api_key.into(),
            client: Client::new(),
        }
    }

    fn convert_messages(messages: &[ChatMessage]) -> Vec<serde_json::Value> {
        messages
            .iter()
            .filter(|m| m.role != MessageRole::System)
            .map(|m| {
                let role = match m.role {
                    MessageRole::Assistant => "assistant",
                    _ => "user",
                };
                if m.role == MessageRole::Tool {
                    json!({
                        "role": "user",
                        "content": [{
                            "type": "tool_result",
                            "tool_use_id": m.tool_call_id.clone().unwrap_or_default(),
                            "content": m.content
                        }]
                    })
                } else {
                    json!({
                        "role": role,
                        "content": m.content
                    })
                }
            })
            .collect()
    }
}

#[async_trait]
impl LlmProvider for AnthropicProvider {
    fn id(&self) -> &str {
        &self.id
    }

    async fn complete(&self, request: &LlmRequest) -> Result<LlmResponse, ProviderError> {
        let mut body = json!({
            "model": request.model,
            "max_tokens": request.max_tokens.unwrap_or(4096),
            "system": [{
                "type": "text",
                "text": request.system_prompt,
                "cache_control": { "type": "ephemeral" }
            }],
            "messages": Self::convert_messages(&request.messages),
        });

        if !request.tools.is_empty() {
            body["tools"] = json!(request
                .tools
                .iter()
                .map(|t| json!({
                    "name": t.name,
                    "description": t.description,
                    "input_schema": t.parameters
                }))
                .collect::<Vec<_>>());
        }

        if request.extended_thinking {
            body["thinking"] = json!({ "type": "enabled", "budget_tokens": 2048 });
        }

        let resp = self
            .client
            .post(format!("{}/messages", self.base_url))
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json")
            .json(&body)
            .send()
            .await?;

        let status = resp.status();
        let data: serde_json::Value = resp.json().await?;
        if !status.is_success() {
            let message = data["error"]["message"]
                .as_str()
                .unwrap_or("Anthropic request failed")
                .to_string();
            return Err(ProviderError::Api {
                status: status.as_u16(),
                message,
            });
        }

        let mut text_parts = Vec::new();
        let mut thinking_parts = Vec::new();
        let mut tool_calls = Vec::new();

        if let Some(blocks) = data["content"].as_array() {
            for block in blocks {
                match block["type"].as_str() {
                    Some("text") => {
                        if let Some(t) = block["text"].as_str() {
                            text_parts.push(t.to_string());
                        }
                    }
                    Some("thinking") => {
                        if let Some(t) = block["thinking"].as_str() {
                            thinking_parts.push(t.to_string());
                        }
                    }
                    Some("tool_use") => {
                        tool_calls.push(ToolCall {
                            id: block["id"].as_str().unwrap_or_default().to_string(),
                            name: block["name"].as_str().unwrap_or_default().to_string(),
                            arguments: block["input"].clone(),
                        });
                    }
                    _ => {}
                }
            }
        }

        let content = text_parts.join("\n");
        let usage = TokenUsage {
            input_tokens: data["usage"]["input_tokens"]
                .as_u64()
                .unwrap_or_else(|| estimate_tokens(&request.system_prompt)),
            output_tokens: data["usage"]["output_tokens"]
                .as_u64()
                .unwrap_or_else(|| estimate_tokens(&content)),
            cache_read_tokens: data["usage"]["cache_read_input_tokens"].as_u64().unwrap_or(0),
        };

        Ok(LlmResponse {
            content,
            thinking: if thinking_parts.is_empty() {
                None
            } else {
                Some(thinking_parts.join("\n"))
            },
            tool_calls,
            usage,
        })
    }
}

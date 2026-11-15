use crate::providers::{
    estimate_tokens, LlmProvider, LlmRequest, LlmResponse, MessageRole, ProviderError,
    TokenUsage, ToolCall,
};
use async_trait::async_trait;
use reqwest::Client;
use serde_json::json;
use uuid::Uuid;

pub struct GeminiProvider {
    id: String,
    base_url: String,
    api_key: String,
    client: Client,
}

impl GeminiProvider {
    pub fn new(id: impl Into<String>, base_url: impl Into<String>, api_key: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            base_url: base_url.into().trim_end_matches('/').to_string(),
            api_key: api_key.into(),
            client: Client::new(),
        }
    }
}

#[async_trait]
impl LlmProvider for GeminiProvider {
    fn id(&self) -> &str {
        &self.id
    }

    async fn complete(&self, request: &LlmRequest) -> Result<LlmResponse, ProviderError> {
        let contents: Vec<serde_json::Value> = request
            .messages
            .iter()
            .filter(|m| m.role != MessageRole::System)
            .map(|m| {
                let role = match m.role {
                    MessageRole::Assistant => "model",
                    _ => "user",
                };
                json!({
                    "role": role,
                    "parts": [{ "text": m.content }]
                })
            })
            .collect();

        let mut body = json!({
            "systemInstruction": {
                "parts": [{ "text": request.system_prompt }]
            },
            "contents": contents
        });

        if !request.tools.is_empty() {
            body["tools"] = json!([{
                "functionDeclarations": request.tools.iter().map(|t| json!({
                    "name": t.name,
                    "description": t.description,
                    "parameters": t.parameters
                })).collect::<Vec<_>>()
            }]);
        }

        let endpoint = format!(
            "{}/models/{}:generateContent?key={}",
            self.base_url, request.model, self.api_key
        );
        let resp = self.client.post(endpoint).json(&body).send().await?;
        let status = resp.status();
        let data: serde_json::Value = resp.json().await?;
        if !status.is_success() {
            let message = data["error"]["message"]
                .as_str()
                .unwrap_or("Gemini request failed")
                .to_string();
            return Err(ProviderError::Api {
                status: status.as_u16(),
                message,
            });
        }

        let mut text_parts = Vec::new();
        let mut tool_calls = Vec::new();
        if let Some(parts) = data["candidates"][0]["content"]["parts"].as_array() {
            for p in parts {
                if let Some(t) = p["text"].as_str() {
                    text_parts.push(t.to_string());
                }
                if let Some(fc) = p.get("functionCall") {
                    if let Some(name) = fc["name"].as_str() {
                        tool_calls.push(ToolCall {
                            id: Uuid::new_v4().to_string(),
                            name: name.to_string(),
                            arguments: fc["args"].clone(),
                        });
                    }
                }
            }
        }

        let content = text_parts.join("\n");
        let usage = TokenUsage {
            input_tokens: data["usageMetadata"]["promptTokenCount"]
                .as_u64()
                .unwrap_or_else(|| estimate_tokens(&request.system_prompt)),
            output_tokens: data["usageMetadata"]["candidatesTokenCount"]
                .as_u64()
                .unwrap_or_else(|| estimate_tokens(&content)),
            cache_read_tokens: 0,
        };

        Ok(LlmResponse {
            content,
            thinking: None,
            tool_calls,
            usage,
        })
    }
}

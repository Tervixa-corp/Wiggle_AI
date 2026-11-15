use crate::providers::{
    estimate_tokens, LlmProvider, LlmRequest, LlmResponse, MessageRole, ProviderError,
    StreamChunk, TokenUsage, ToolCall,
};
use async_trait::async_trait;
use futures::StreamExt;
use reqwest::Client;
use serde_json::json;
use tokio::sync::mpsc;

pub struct OpenAiCompatProvider {
    id: String,
    base_url: String,
    api_key: String,
    client: Client,
}

impl OpenAiCompatProvider {
    pub fn new(id: impl Into<String>, base_url: impl Into<String>, api_key: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            base_url: base_url.into().trim_end_matches('/').to_string(),
            api_key: api_key.into(),
            client: Client::new(),
        }
    }

    fn build_payload(&self, request: &LlmRequest, stream: bool) -> serde_json::Value {
        let mut msgs = vec![json!({
            "role": "system",
            "content": request.system_prompt
        })];

        for m in &request.messages {
            if m.role == MessageRole::System {
                continue;
            }
            let role = match m.role {
                MessageRole::User => "user",
                MessageRole::Assistant => "assistant",
                MessageRole::Tool => "tool",
                MessageRole::System => "system",
            };
            let mut obj = json!({
                "role": role,
                "content": m.content
            });
            if let Some(tc_id) = &m.tool_call_id {
                obj["tool_call_id"] = json!(tc_id);
            }
            if !m.tool_calls.is_empty() {
                obj["tool_calls"] = json!(m
                    .tool_calls
                    .iter()
                    .map(|tc| json!({
                        "id": tc.id,
                        "type": "function",
                        "function": {
                            "name": tc.name,
                            "arguments": tc.arguments.to_string()
                        }
                    }))
                    .collect::<Vec<_>>());
            }
            msgs.push(obj);
        }

        let mut payload = json!({
            "model": request.model,
            "messages": msgs,
            "stream": stream
        });

        if let Some(temp) = request.temperature {
            payload["temperature"] = json!(temp);
        }
        if let Some(max_tok) = request.max_tokens {
            payload["max_tokens"] = json!(max_tok);
        }
        if !request.tools.is_empty() {
            payload["tools"] = json!(request
                .tools
                .iter()
                .map(|t| json!({
                    "type": "function",
                    "function": {
                        "name": t.name,
                        "description": t.description,
                        "parameters": t.parameters
                    }
                }))
                .collect::<Vec<_>>());
        }
        payload
    }
}

#[async_trait]
impl LlmProvider for OpenAiCompatProvider {
    fn id(&self) -> &str {
        &self.id
    }

    async fn complete(&self, request: &LlmRequest) -> Result<LlmResponse, ProviderError> {
        let payload = self.build_payload(request, false);
        let mut builder = self
            .client
            .post(format!("{}/chat/completions", self.base_url))
            .header("Content-Type", "application/json");
        if !self.api_key.is_empty() {
            builder = builder.bearer_auth(&self.api_key);
        }
        let resp = builder.json(&payload).send().await?;
        let status = resp.status();
        let data: serde_json::Value = resp.json().await?;
        if !status.is_success() {
            let msg = data["error"]["message"]
                .as_str()
                .unwrap_or("OpenAI-compatible request failed")
                .to_string();
            return Err(ProviderError::Api {
                status: status.as_u16(),
                message: msg,
            });
        }

        let choice = &data["choices"][0]["message"];
        let content = choice["content"].as_str().unwrap_or_default().to_string();
        let mut tool_calls = Vec::new();
        if let Some(arr) = choice["tool_calls"].as_array() {
            for tc in arr {
                let raw_args = tc["function"]["arguments"].as_str().unwrap_or("{}");
                let args = serde_json::from_str(raw_args).unwrap_or_else(|_| json!({}));
                tool_calls.push(ToolCall {
                    id: tc["id"].as_str().unwrap_or_default().to_string(),
                    name: tc["function"]["name"].as_str().unwrap_or_default().to_string(),
                    arguments: args,
                });
            }
        }

        let usage = TokenUsage {
            input_tokens: data["usage"]["prompt_tokens"]
                .as_u64()
                .unwrap_or_else(|| estimate_tokens(&request.system_prompt)),
            output_tokens: data["usage"]["completion_tokens"]
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

    async fn stream(
        &self,
        request: &LlmRequest,
        tx: mpsc::Sender<StreamChunk>,
    ) -> Result<LlmResponse, ProviderError> {
        let payload = self.build_payload(request, true);
        let mut builder = self
            .client
            .post(format!("{}/chat/completions", self.base_url))
            .header("Content-Type", "application/json");
        if !self.api_key.is_empty() {
            builder = builder.bearer_auth(&self.api_key);
        }
        let resp = builder.json(&payload).send().await?;
        let status = resp.status();
        if !status.is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(ProviderError::Api {
                status: status.as_u16(),
                message: text,
            });
        }

        let mut content = String::new();
        let mut byte_stream = resp.bytes_stream();
        let mut buffer = String::new();
        while let Some(chunk) = byte_stream.next().await {
            let bytes = chunk?;
            buffer.push_str(&String::from_utf8_lossy(&bytes));
            while let Some(nl) = buffer.find('\n') {
                let line = buffer[..nl].trim().to_string();
                buffer.drain(..=nl);
                if let Some(data_line) = line.strip_prefix("data:") {
                    let payload_str = data_line.trim();
                    if payload_str == "[DONE]" {
                        break;
                    }
                    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(payload_str) {
                        if let Some(delta) = parsed["choices"][0]["delta"]["content"].as_str() {
                            content.push_str(delta);
                            let _ = tx
                                .send(StreamChunk::Delta {
                                    text: delta.to_string(),
                                })
                                .await;
                        }
                    }
                }
            }
        }

        let usage = TokenUsage {
            input_tokens: estimate_tokens(&request.system_prompt),
            output_tokens: estimate_tokens(&content),
            cache_read_tokens: 0,
        };
        let _ = tx
            .send(StreamChunk::Done {
                usage: usage.clone(),
            })
            .await;

        Ok(LlmResponse {
            content,
            thinking: None,
            tool_calls: Vec::new(),
            usage,
        })
    }
}

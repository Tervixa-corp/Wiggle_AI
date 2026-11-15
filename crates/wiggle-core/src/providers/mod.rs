pub mod anthropic;
pub mod gemini;
pub mod openai_compat;

use crate::config::{builtin_provider_presets, ProviderProtocol, WiggleConfig};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::sync::mpsc;

#[derive(Debug, Error)]
pub enum ProviderError {
    #[error("provider not configured: {0}")]
    NotConfigured(String),
    #[error("http error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("api error ({status}): {message}")]
    Api { status: u16, message: String },
    #[error("invalid response: {0}")]
    InvalidResponse(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub parameters: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MessageRole {
    System,
    User,
    Assistant,
    Tool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: MessageRole,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tool_calls: Vec<ToolCall>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TokenUsage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmRequest {
    pub model: String,
    pub system_prompt: String,
    pub messages: Vec<ChatMessage>,
    pub tools: Vec<ToolDefinition>,
    pub temperature: Option<f32>,
    pub max_tokens: Option<u32>,
    pub extended_thinking: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmResponse {
    pub content: String,
    pub thinking: Option<String>,
    pub tool_calls: Vec<ToolCall>,
    pub usage: TokenUsage,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum StreamChunk {
    Delta { text: String },
    Thinking { text: String },
    ToolCall(ToolCall),
    Done { usage: TokenUsage },
}

#[async_trait]
pub trait LlmProvider: Send + Sync {
    fn id(&self) -> &str;
    async fn complete(&self, request: &LlmRequest) -> Result<LlmResponse, ProviderError>;
    async fn stream(
        &self,
        request: &LlmRequest,
        tx: mpsc::Sender<StreamChunk>,
    ) -> Result<LlmResponse, ProviderError> {
        let res = self.complete(request).await?;
        if !res.content.is_empty() {
            let _ = tx.send(StreamChunk::Delta { text: res.content.clone() }).await;
        }
        for tc in &res.tool_calls {
            let _ = tx.send(StreamChunk::ToolCall(tc.clone())).await;
        }
        let _ = tx.send(StreamChunk::Done { usage: res.usage.clone() }).await;
        Ok(res)
    }
}

pub fn estimate_tokens(text: &str) -> u64 {
    ((text.len() as f64) / 4.0).ceil() as u64
}

pub struct ProviderRouter;

impl ProviderRouter {
    pub fn build_provider(
        config: &WiggleConfig,
        provider_override: Option<&str>,
    ) -> Result<Box<dyn LlmProvider>, ProviderError> {
        let provider_id = provider_override.unwrap_or(&config.active_provider);
        let presets = builtin_provider_presets();
        let preset = presets
            .iter()
            .find(|p| p.id == provider_id)
            .cloned()
            .unwrap_or_else(|| presets[1].clone()); // default openai-compat

        let base_url = config
            .base_url
            .clone()
            .filter(|u| !u.trim().is_empty())
            .unwrap_or_else(|| preset.base_url.clone());

        let api_key = config.resolve_api_key(provider_id).unwrap_or_default();
        if api_key.is_empty() && !preset.local {
            return Err(ProviderError::NotConfigured(format!(
                "missing API key for provider '{provider_id}'"
            )));
        }

        match preset.protocol {
            ProviderProtocol::Anthropic => Ok(Box::new(anthropic::AnthropicProvider::new(
                provider_id,
                base_url,
                api_key,
            ))),
            ProviderProtocol::Gemini => Ok(Box::new(gemini::GeminiProvider::new(
                provider_id,
                base_url,
                api_key,
            ))),
            ProviderProtocol::OpenAiCompat => Ok(Box::new(openai_compat::OpenAiCompatProvider::new(
                provider_id,
                base_url,
                api_key,
            ))),
        }
    }
}

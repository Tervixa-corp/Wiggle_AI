use crate::plugins::hooks::{HookEvent, HookRunner};
use crate::providers::{
    ChatMessage, LlmProvider, LlmRequest, MessageRole, ProviderError, TokenUsage,
};
use crate::tools::{execute_tool, ToolContext};
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentEvent {
    TextDelta { text: String },
    ToolStart { tool: String, arguments: serde_json::Value },
    ToolFinish { tool: String, ok: bool, output: String, changed_files: Vec<String> },
    Completed { final_text: String, usage: TokenUsage },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentRunResult {
    pub final_text: String,
    pub changed_files: Vec<String>,
    pub steps_executed: usize,
    pub total_usage: TokenUsage,
}

pub struct AgentRunner;

impl AgentRunner {
    pub async fn run(
        provider: &dyn LlmProvider,
        model: &str,
        system_prompt: &str,
        initial_messages: Vec<ChatMessage>,
        tools: Vec<crate::providers::ToolDefinition>,
        tool_ctx: &ToolContext,
        hooks: &HookRunner,
        max_steps: usize,
        events: Option<mpsc::Sender<AgentEvent>>,
    ) -> Result<AgentRunResult, ProviderError> {
        let mut history = initial_messages;
        let mut changed_files = Vec::new();
        let mut total_usage = TokenUsage::default();
        let mut final_text = String::new();
        let mut steps_executed = 0;

        for step in 0..max_steps.max(1) {
            steps_executed = step + 1;
            let req = LlmRequest {
                model: model.to_string(),
                system_prompt: system_prompt.to_string(),
                messages: history.clone(),
                tools: tools.clone(),
                temperature: Some(0.2),
                max_tokens: Some(4096),
                extended_thinking: false,
            };

            let resp = provider.complete(&req).await?;
            total_usage.input_tokens += resp.usage.input_tokens;
            total_usage.output_tokens += resp.usage.output_tokens;
            total_usage.cache_read_tokens += resp.usage.cache_read_tokens;

            if !resp.content.is_empty() {
                final_text = resp.content.clone();
                if let Some(tx) = &events {
                    let _ = tx
                        .send(AgentEvent::TextDelta {
                            text: resp.content.clone(),
                        })
                        .await;
                }
            }

            if resp.tool_calls.is_empty() {
                break;
            }

            history.push(ChatMessage {
                role: MessageRole::Assistant,
                content: resp.content.clone(),
                tool_call_id: None,
                tool_calls: resp.tool_calls.clone(),
            });

            for tc in &resp.tool_calls {
                if let Some(tx) = &events {
                    let _ = tx
                        .send(AgentEvent::ToolStart {
                            tool: tc.name.clone(),
                            arguments: tc.arguments.clone(),
                        })
                        .await;
                }
                let tool_res = execute_tool(tool_ctx, &tc.name, &tc.arguments).await;
                for f in &tool_res.changed_files {
                    if !changed_files.contains(f) {
                        changed_files.push(f.clone());
                    }
                }
                if let Some(tx) = &events {
                    let _ = tx
                        .send(AgentEvent::ToolFinish {
                            tool: tc.name.clone(),
                            ok: tool_res.ok,
                            output: tool_res.output.clone(),
                            changed_files: tool_res.changed_files.clone(),
                        })
                        .await;
                }
                history.push(ChatMessage {
                    role: MessageRole::Tool,
                    content: tool_res.output,
                    tool_call_id: Some(tc.id.clone()),
                    tool_calls: Vec::new(),
                });
            }
        }

        let _ = hooks
            .run_event(
                HookEvent::Stop,
                "agent",
                &serde_json::json!({ "final_text": final_text, "changed_files": changed_files }),
            )
            .await;

        if let Some(tx) = &events {
            let _ = tx
                .send(AgentEvent::Completed {
                    final_text: final_text.clone(),
                    usage: total_usage.clone(),
                })
                .await;
        }

        Ok(AgentRunResult {
            final_text,
            changed_files,
            steps_executed,
            total_usage,
        })
    }
}

use serde::{Deserialize, Serialize};
use std::process::Stdio;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum HookEvent {
    UserPromptSubmit,
    PreToolUse,
    PostToolUse,
    Notification,
    SubagentStop,
    Stop,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LifecycleHook {
    pub id: String,
    pub event: HookEvent,
    pub matcher: String,
    pub command: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HookDecision {
    pub allow: bool,
    pub modified_input: Option<String>,
    pub message: Option<String>,
}

impl Default for HookDecision {
    fn default() -> Self {
        Self {
            allow: true,
            modified_input: None,
            message: None,
        }
    }
}

#[derive(Debug, Default, Clone)]
pub struct HookRunner {
    pub hooks: Vec<LifecycleHook>,
}

impl HookRunner {
    pub fn new(hooks: Vec<LifecycleHook>) -> Self {
        Self { hooks }
    }

    pub async fn run_event(
        &self,
        event: HookEvent,
        target_name: &str,
        payload_json: &serde_json::Value,
    ) -> HookDecision {
        let mut decision = HookDecision::default();

        for hook in self
            .hooks
            .iter()
            .filter(|h| h.enabled && h.event == event && (h.matcher == "*" || target_name.contains(&h.matcher)))
        {
            let mut cmd = if cfg!(windows) {
                let mut c = Command::new("cmd");
                c.args(["/C", &hook.command]);
                c
            } else {
                let mut c = Command::new("sh");
                c.args(["-c", &hook.command]);
                c
            };
            cmd.stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());

            if let Ok(mut child) = cmd.spawn() {
                if let Some(mut stdin) = child.stdin.take() {
                    let bytes = serde_json::to_vec(payload_json).unwrap_or_default();
                    let _ = stdin.write_all(&bytes).await;
                }
                if let Ok(output) = child.wait_with_output().await {
                    if !output.status.success() {
                        decision.allow = false;
                        decision.message = Some(
                            String::from_utf8_lossy(&output.stderr).trim().to_string(),
                        );
                        return decision;
                    }
                    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
                    if !stdout.is_empty() {
                        if let Ok(parsed) = serde_json::from_str::<HookDecision>(&stdout) {
                            if !parsed.allow {
                                return parsed;
                            }
                            if parsed.modified_input.is_some() {
                                decision.modified_input = parsed.modified_input;
                            }
                            if parsed.message.is_some() {
                                decision.message = parsed.message;
                            }
                        } else {
                            decision.message = Some(stdout);
                        }
                    }
                }
            }
        }
        decision
    }
}

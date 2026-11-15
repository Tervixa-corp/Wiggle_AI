use crate::providers::ToolDefinition;
use crate::tools::{ToolContext, ToolExecutionResult};
use serde_json::json;
use std::time::Duration;
use tokio::process::Command;

pub fn tool_definitions() -> Vec<ToolDefinition> {
    vec![ToolDefinition {
        name: "bash".into(),
        description: "Execute a workspace shell command with timeout and captured output.".into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "command": { "type": "string" },
                "timeout_secs": { "type": "integer" }
            },
            "required": ["command"]
        }),
    }]
}

pub async fn execute(ctx: &ToolContext, args: &serde_json::Value) -> ToolExecutionResult {
    let command = args["command"].as_str().unwrap_or_default().trim();
    if command.is_empty() {
        return ToolExecutionResult {
            ok: false,
            output: "Empty command".into(),
            changed_files: vec![],
        };
    }
    let timeout_secs = args["timeout_secs"].as_u64().unwrap_or(30).clamp(1, 300);

    let mut cmd = if cfg!(windows) {
        let mut c = Command::new("cmd");
        c.args(["/C", command]);
        c
    } else {
        let mut c = Command::new("sh");
        c.args(["-c", command]);
        c
    };
    cmd.current_dir(ctx.permissions.workspace_root());

    match tokio::time::timeout(Duration::from_secs(timeout_secs), cmd.output()).await {
        Ok(Ok(out)) => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            let stderr = String::from_utf8_lossy(&out.stderr);
            let combined = format!("{stdout}{stderr}").chars().take(16_000).collect();
            ToolExecutionResult {
                ok: out.status.success(),
                output: combined,
                changed_files: vec![],
            }
        }
        Ok(Err(e)) => ToolExecutionResult {
            ok: false,
            output: format!("Failed to spawn command: {e}"),
            changed_files: vec![],
        },
        Err(_) => ToolExecutionResult {
            ok: false,
            output: format!("Command timed out after {timeout_secs}s"),
            changed_files: vec![],
        },
    }
}

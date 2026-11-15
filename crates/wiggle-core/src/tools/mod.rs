pub mod bash;
pub mod fs;
pub mod subagent;
pub mod web;

use crate::permissions::{PermissionEffect, PermissionGate};
use crate::plugins::hooks::{HookEvent, HookRunner};
use crate::providers::ToolDefinition;
use crate::undo::SnapshotEngine;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use wiggle_browser::BrowserController;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolExecutionResult {
    pub ok: bool,
    pub output: String,
    pub changed_files: Vec<String>,
}

/// In-memory exclusive file lease manager preventing race conditions during parallel swarm edits.
#[derive(Debug, Default, Clone)]
pub struct FileCoordinator {
    leases: Arc<RwLock<HashMap<String, String>>>,
}

impl FileCoordinator {
    pub async fn acquire(&self, rel_path: &str, agent_id: &str) -> Result<(), String> {
        let mut map = self.leases.write().await;
        if let Some(holder) = map.get(rel_path) {
            if holder != agent_id {
                return Err(format!("file '{rel_path}' is currently leased by agent '{holder}'"));
            }
        }
        map.insert(rel_path.to_string(), agent_id.to_string());
        Ok(())
    }

    pub async fn release(&self, rel_path: &str, agent_id: &str) {
        let mut map = self.leases.write().await;
        if map.get(rel_path).map(|s| s.as_str()) == Some(agent_id) {
            map.remove(rel_path);
        }
    }

    pub async fn active_leases(&self) -> HashMap<String, String> {
        self.leases.read().await.clone()
    }
}

pub struct ToolContext {
    pub agent_id: String,
    pub permissions: PermissionGate,
    pub snapshots: SnapshotEngine,
    pub coordinator: FileCoordinator,
    pub browser: BrowserController,
    pub hooks: HookRunner,
}

pub fn builtin_tool_definitions() -> Vec<ToolDefinition> {
    let mut defs = fs::tool_definitions();
    defs.extend(bash::tool_definitions());
    defs.extend(web::tool_definitions());
    defs.extend(subagent::tool_definitions());
    defs
}

pub async fn execute_tool(
    ctx: &ToolContext,
    name: &str,
    args: &serde_json::Value,
) -> ToolExecutionResult {
    let resource = args
        .get("path")
        .or_else(|| args.get("command"))
        .or_else(|| args.get("url"))
        .and_then(|v| v.as_str())
        .unwrap_or("*");

    let pre = ctx
        .hooks
        .run_event(
            HookEvent::PreToolUse,
            name,
            &serde_json::json!({ "tool": name, "arguments": args }),
        )
        .await;
    if !pre.allow {
        return ToolExecutionResult {
            ok: false,
            output: pre
                .message
                .unwrap_or_else(|| format!("Blocked by PreToolUse hook for {name}")),
            changed_files: vec![],
        };
    }

    match ctx.permissions.evaluate(name, resource) {
        PermissionEffect::Deny => {
            return ToolExecutionResult {
                ok: false,
                output: format!("Permission denied for tool '{name}' on '{resource}'"),
                changed_files: vec![],
            };
        }
        PermissionEffect::Ask => {
            return ToolExecutionResult {
                ok: false,
                output: format!(
                    "Approval required for tool '{name}' on '{resource}'. Switch approval mode or approve in UI."
                ),
                changed_files: vec![],
            };
        }
        PermissionEffect::Allow => {}
    }

    let result = match name {
        "read_file" | "write_file" | "edit_file" | "multi_edit" | "glob" | "grep" | "list_dir" => {
            fs::execute(ctx, name, args).await
        }
        "bash" => bash::execute(ctx, args).await,
        "web_search" | "web_fetch" | "browser_navigate" | "browser_actuate" | "browser_inspect" => {
            web::execute(ctx, name, args).await
        }
        "spawn_subagents" | "task_status" => subagent::execute(name, args),
        other => ToolExecutionResult {
            ok: false,
            output: format!("Unknown tool: {other}"),
            changed_files: vec![],
        },
    };

    let _ = ctx
        .hooks
        .run_event(
            HookEvent::PostToolUse,
            name,
            &serde_json::json!({ "tool": name, "ok": result.ok, "changed_files": result.changed_files }),
        )
        .await;

    result
}

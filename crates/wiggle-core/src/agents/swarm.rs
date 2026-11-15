use crate::agents::definitions::{builtin_agent_profiles, AgentRole};
use crate::agents::runner::AgentRunner;
use crate::config::WiggleConfig;
use crate::permissions::PermissionGate;
use crate::plugins::hooks::{HookEvent, HookRunner};
use crate::providers::{ChatMessage, MessageRole, ProviderRouter};
use crate::tools::{builtin_tool_definitions, FileCoordinator, ToolContext};
use crate::undo::SnapshotEngine;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Semaphore;
use tokio::task::JoinSet;
use wiggle_browser::BrowserController;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SwarmTaskInput {
    pub id: String,
    pub role: AgentRole,
    pub goal: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SwarmTaskOutput {
    pub id: String,
    pub role: String,
    pub ok: bool,
    pub summary: String,
    pub changed_files: Vec<String>,
}

/// Runs specialized agents in parallel on the active workspace without creating extra Git branches
/// or worktrees, using `FileCoordinator` in-memory leases for safe concurrent file edits.
pub struct SwarmOrchestrator {
    workspace_root: PathBuf,
    coordinator: FileCoordinator,
    browser: BrowserController,
}

impl SwarmOrchestrator {
    pub fn new(workspace_root: impl Into<PathBuf>) -> Self {
        Self {
            workspace_root: workspace_root.into(),
            coordinator: FileCoordinator::default(),
            browser: BrowserController::new(),
        }
    }

    pub async fn execute_parallel(
        &self,
        config: &WiggleConfig,
        base_system_prompt: &str,
        tasks: Vec<SwarmTaskInput>,
        hooks: HookRunner,
    ) -> Vec<SwarmTaskOutput> {
        let max_concurrency = config.max_parallel_agents.max(1);
        let semaphore = Arc::new(Semaphore::new(max_concurrency));
        let profiles = builtin_agent_profiles();
        let mut join_set = JoinSet::new();

        for task in tasks {
            let sem = semaphore.clone();
            let cfg = config.clone();
            let sys_base = base_system_prompt.to_string();
            let root = self.workspace_root.clone();
            let coordinator = self.coordinator.clone();
            let browser = self.browser.clone();
            let hooks_clone = hooks.clone();
            let profile = profiles
                .iter()
                .find(|p| p.role == task.role)
                .cloned()
                .unwrap_or_else(|| profiles[1].clone());

            join_set.spawn(async move {
                let _permit = sem.acquire().await;
                let role_name = task.role.as_str().to_string();

                let provider = match ProviderRouter::build_provider(&cfg, None) {
                    Ok(p) => p,
                    Err(e) => {
                        return SwarmTaskOutput {
                            id: task.id,
                            role: role_name,
                            ok: false,
                            summary: format!("Provider unavailable: {e}"),
                            changed_files: vec![],
                        };
                    }
                };

                let model = match &task.role {
                    AgentRole::Architect => cfg.role_models.orchestrator.clone(),
                    AgentRole::Coder => cfg.role_models.coder.clone(),
                    AgentRole::Explorer => cfg.role_models.explorer.clone(),
                    AgentRole::Browser => cfg.role_models.browser.clone(),
                    AgentRole::Reviewer => cfg.role_models.reviewer.clone(),
                    AgentRole::Custom(_) => None,
                }
                .unwrap_or_else(|| cfg.active_model.clone());

                let role_system = format!(
                    "{sys_base}\n\n<agent_role name=\"{}\">\n{}\n</agent_role>",
                    profile.name, profile.system_directive
                );

                let ctx = ToolContext {
                    agent_id: format!("swarm:{}:{}", role_name, task.id),
                    permissions: PermissionGate::new(
                        &root,
                        cfg.approval_mode.clone(),
                        vec![],
                        cfg.shell_allowlist.clone(),
                    ),
                    snapshots: SnapshotEngine::new(&root),
                    coordinator,
                    browser,
                    hooks: hooks_clone.clone(),
                };

                let res = AgentRunner::run(
                    provider.as_ref(),
                    &model,
                    &role_system,
                    vec![ChatMessage {
                        role: MessageRole::User,
                        content: task.goal,
                        tool_call_id: None,
                        tool_calls: vec![],
                    }],
                    builtin_tool_definitions(),
                    &ctx,
                    &hooks_clone,
                    profile.max_steps,
                    None,
                )
                .await;

                let _ = hooks_clone
                    .run_event(
                        HookEvent::SubagentStop,
                        &role_name,
                        &serde_json::json!({ "task_id": task.id }),
                    )
                    .await;

                match res {
                    Ok(run) => SwarmTaskOutput {
                        id: task.id,
                        role: role_name,
                        ok: true,
                        summary: run.final_text,
                        changed_files: run.changed_files,
                    },
                    Err(e) => SwarmTaskOutput {
                        id: task.id,
                        role: role_name,
                        ok: false,
                        summary: e.to_string(),
                        changed_files: vec![],
                    },
                }
            });
        }

        let mut outputs = Vec::new();
        while let Some(joined) = join_set.join_next().await {
            if let Ok(out) = joined {
                outputs.push(out);
            }
        }
        outputs
    }
}

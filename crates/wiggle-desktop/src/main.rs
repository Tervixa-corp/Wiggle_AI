#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Emitter, State};
use walkdir::WalkDir;
use wiggle_browser::{BrowserAction, BrowserController, PageSnapshot};
use wiggle_core::{
    agents::{AgentRole, AgentRunner, SwarmOrchestrator, SwarmTaskInput, SwarmTaskOutput},
    config::{builtin_provider_presets, WiggleConfig},
    identity::IdentityGuard,
    mcp::{builtin_mcp_catalog, McpConfigFile},
    permissions::PermissionGate,
    plugins::hooks::HookRunner,
    prompt_compiler::PromptCompiler,
    providers::{ChatMessage, MessageRole, ProviderRouter},
    skills::{importer, Skill, SkillRegistry},
    tools::{builtin_tool_definitions, FileCoordinator, ToolContext},
    undo::SnapshotEngine,
};
use wiggle_memory::{MemoryCategory, MemoryEntry, MemoryExtractor, MemoryStore};

struct DesktopState {
    workspace: Mutex<PathBuf>,
    browser: BrowserController,
    coordinator: FileCoordinator,
}

#[derive(Serialize)]
struct StatusPayload {
    version: &'static str,
    workspace: String,
    configured: bool,
    provider: String,
    model: String,
    skills_count: usize,
    mcp_count: usize,
    memory_count: usize,
    undo_count: usize,
    redo_count: usize,
}

#[derive(Serialize)]
struct FileNode {
    name: String,
    path: String,
    is_dir: bool,
}

#[tauri::command]
fn get_status(state: State<'_, DesktopState>) -> Result<StatusPayload, String> {
    let ws = state.workspace.lock().map_err(|_| "lock")?.clone();
    let cfg = WiggleConfig::load_merged(&ws);
    let skills = SkillRegistry::load_workspace(&ws);
    let mcp = McpConfigFile::load_from(&ws.join(".wiggle").join("mcp.json"));
    let mem_count = MemoryStore::open(ws.join(".wiggle").join("memory.db"))
        .and_then(|s| s.list_all(500))
        .map(|v| v.len())
        .unwrap_or(0);
    let (undo_count, redo_count) = SnapshotEngine::new(&ws).counts();
    let configured = cfg.resolve_api_key(&cfg.active_provider).is_some()
        || builtin_provider_presets()
            .into_iter()
            .any(|p| p.id == cfg.active_provider && p.local);

    Ok(StatusPayload {
        version: "1.0.0",
        workspace: ws.to_string_lossy().to_string(),
        configured,
        provider: cfg.active_provider,
        model: cfg.active_model,
        skills_count: skills.all().len(),
        mcp_count: mcp.mcp_servers.len(),
        memory_count: mem_count,
        undo_count,
        redo_count,
    })
}

#[tauri::command]
fn list_files(state: State<'_, DesktopState>) -> Result<Vec<FileNode>, String> {
    let ws = state.workspace.lock().map_err(|_| "lock")?.clone();
    let mut nodes = Vec::new();
    for entry in WalkDir::new(&ws)
        .max_depth(4)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            !matches!(name.as_ref(), ".git" | "node_modules" | "target" | ".wiggle")
        })
        .flatten()
    {
        if entry.path() == ws {
            continue;
        }
        if let Ok(rel) = entry.path().strip_prefix(&ws) {
            nodes.push(FileNode {
                name: entry.file_name().to_string_lossy().to_string(),
                path: rel.to_string_lossy().replace('\\', "/"),
                is_dir: entry.file_type().is_dir(),
            });
        }
    }
    Ok(nodes)
}

#[tauri::command]
fn read_workspace_file(state: State<'_, DesktopState>, path: String) -> Result<String, String> {
    let ws = state.workspace.lock().map_err(|_| "lock")?.clone();
    let cfg = WiggleConfig::load_merged(&ws);
    let gate = PermissionGate::new(&ws, cfg.approval_mode, vec![], cfg.shell_allowlist);
    let resolved = gate.resolve_workspace_path(&path).map_err(|e| e.to_string())?;
    std::fs::read_to_string(resolved).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_workspace_file(
    state: State<'_, DesktopState>,
    path: String,
    content: String,
) -> Result<(), String> {
    let ws = state.workspace.lock().map_err(|_| "lock")?.clone();
    let cfg = WiggleConfig::load_merged(&ws);
    let gate = PermissionGate::new(&ws, cfg.approval_mode, vec![], cfg.shell_allowlist);
    let resolved = gate.resolve_workspace_path(&path).map_err(|e| e.to_string())?;
    let before = std::fs::read(&resolved).ok();
    if let Some(parent) = resolved.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&resolved, content.as_bytes()).map_err(|e| e.to_string())?;
    let mut map = BTreeMap::new();
    map.insert(path.clone(), before);
    SnapshotEngine::new(&ws)
        .record_mutation(format!("editor save {path}"), &map)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn undo_snapshot(state: State<'_, DesktopState>) -> Result<String, String> {
    let ws = state.workspace.lock().map_err(|_| "lock")?.clone();
    let rec = SnapshotEngine::new(&ws).undo().map_err(|e| e.to_string())?;
    Ok(format!("Undid '{}' ({} files)", rec.label, rec.files.len()))
}

#[tauri::command]
fn redo_snapshot(state: State<'_, DesktopState>) -> Result<String, String> {
    let ws = state.workspace.lock().map_err(|_| "lock")?.clone();
    let rec = SnapshotEngine::new(&ws).redo().map_err(|e| e.to_string())?;
    Ok(format!("Redid '{}' ({} files)", rec.label, rec.files.len()))
}

#[derive(Deserialize)]
struct ChatInputMessage {
    role: String,
    content: String,
}

#[tauri::command]
async fn run_chat(
    app: tauri::AppHandle,
    state: State<'_, DesktopState>,
    messages: Vec<ChatInputMessage>,
) -> Result<serde_json::Value, String> {
    let ws = state.workspace.lock().map_err(|_| "lock")?.clone();
    let cfg = WiggleConfig::load_merged(&ws);
    let skills = SkillRegistry::load_workspace(&ws);
    let mem = MemoryStore::open(ws.join(".wiggle").join("memory.db")).ok();
    let hooks = HookRunner::default();

    let last_user = messages
        .iter()
        .rev()
        .find(|m| m.role == "user")
        .map(|m| m.content.clone())
        .unwrap_or_default();

    let mut identity = IdentityGuard::for_workspace(ws.to_string_lossy(), None);
    if !cfg.custom_identity_instructions.trim().is_empty() {
        identity.custom_instructions = Some(cfg.custom_identity_instructions.clone());
    }

    let compiled = PromptCompiler::compile(
        &ws,
        &last_user,
        &identity,
        mem.as_ref(),
        &skills,
        &[],
        &hooks,
    )
    .await;

    let provider = ProviderRouter::build_provider(&cfg, None).map_err(|e| e.to_string())?;
    let chat_msgs: Vec<ChatMessage> = messages
        .into_iter()
        .map(|m| ChatMessage {
            role: if m.role == "assistant" {
                MessageRole::Assistant
            } else {
                MessageRole::User
            },
            content: m.content,
            tool_call_id: None,
            tool_calls: vec![],
        })
        .collect();

    let ctx = ToolContext {
        agent_id: "desktop:primary".into(),
        permissions: PermissionGate::new(&ws, cfg.approval_mode.clone(), vec![], cfg.shell_allowlist.clone()),
        snapshots: SnapshotEngine::new(&ws),
        coordinator: state.coordinator.clone(),
        browser: state.browser.clone(),
        hooks: hooks.clone(),
    };

    let (tx, mut rx) = tokio::sync::mpsc::channel(64);
    let app_clone = app.clone();
    tokio::spawn(async move {
        while let Some(ev) = rx.recv().await {
            let _ = app_clone.emit("wiggle://agent-event", ev);
        }
    });

    let res = AgentRunner::run(
        provider.as_ref(),
        &cfg.active_model,
        &compiled.system_prompt,
        chat_msgs,
        builtin_tool_definitions(),
        &ctx,
        &hooks,
        12,
        Some(tx),
    )
    .await
    .map_err(|e| e.to_string())?;

    if cfg.memory_auto_extract {
        if let Some(m) = &mem {
            let _ = MemoryExtractor::record_turn(m, "desktop", &last_user, &res.final_text);
        }
    }

    Ok(serde_json::json!({
        "text": res.final_text,
        "changed_files": res.changed_files,
        "usage": res.total_usage,
        "matched_skills": compiled.matched_skills,
        "injected_memories": compiled.injected_memories
    }))
}

#[tauri::command]
async fn run_swarm(
    state: State<'_, DesktopState>,
    goal: String,
) -> Result<Vec<SwarmTaskOutput>, String> {
    let ws = state.workspace.lock().map_err(|_| "lock")?.clone();
    let cfg = WiggleConfig::load_merged(&ws);
    let identity = IdentityGuard::for_workspace(ws.to_string_lossy(), None);
    let orchestrator = SwarmOrchestrator::new(&ws);
    let tasks = vec![
        SwarmTaskInput { id: "s1".into(), role: AgentRole::Explorer, goal: format!("Explore files relevant to: {goal}") },
        SwarmTaskInput { id: "s2".into(), role: AgentRole::Architect, goal: format!("Plan implementation for: {goal}") },
        SwarmTaskInput { id: "s3".into(), role: AgentRole::Coder, goal: format!("Implement requested changes for: {goal}") },
        SwarmTaskInput { id: "s4".into(), role: AgentRole::Reviewer, goal: format!("Audit security and test coverage for: {goal}") },
    ];
    Ok(orchestrator
        .execute_parallel(&cfg, &identity.build_header(), tasks, HookRunner::default())
        .await)
}

#[tauri::command]
fn list_skills(state: State<'_, DesktopState>) -> Result<Vec<Skill>, String> {
    let ws = state.workspace.lock().map_err(|_| "lock")?.clone();
    Ok(SkillRegistry::load_workspace(&ws).all().to_vec())
}

#[tauri::command]
fn import_skills(state: State<'_, DesktopState>, source: String) -> Result<usize, String> {
    let ws = state.workspace.lock().map_err(|_| "lock")?.clone();
    let target = ws.join(".wiggle").join("skills");
    let src_dir = match source.as_str() {
        "claude" => importer::default_claude_skills_dir().ok_or("no home dir")?,
        "opencode" => importer::default_opencode_skills_dir().ok_or("no home dir")?,
        other => PathBuf::from(other),
    };
    let summary = importer::import_skills_from_dir(&src_dir, &target, &source).map_err(|e| e.to_string())?;
    Ok(summary.imported_count)
}

#[tauri::command]
fn list_mcp_servers(state: State<'_, DesktopState>) -> Result<serde_json::Value, String> {
    let ws = state.workspace.lock().map_err(|_| "lock")?.clone();
    let cfg = McpConfigFile::load_from(&ws.join(".wiggle").join("mcp.json"));
    Ok(serde_json::json!({
        "configured": cfg.mcp_servers,
        "catalog": builtin_mcp_catalog()
    }))
}

#[tauri::command]
fn query_memory(state: State<'_, DesktopState>, query: String) -> Result<Vec<MemoryEntry>, String> {
    let ws = state.workspace.lock().map_err(|_| "lock")?.clone();
    let store = MemoryStore::open(ws.join(".wiggle").join("memory.db")).map_err(|e| e.to_string())?;
    if query.trim().is_empty() {
        store.list_all(100).map_err(|e| e.to_string())
    } else {
        Ok(store
            .query_relevant_context(&query, 25)
            .map_err(|e| e.to_string())?
            .into_iter()
            .map(|h| h.entry)
            .collect())
    }
}

#[tauri::command]
fn add_memory(
    state: State<'_, DesktopState>,
    content: String,
    pinned: bool,
) -> Result<MemoryEntry, String> {
    let ws = state.workspace.lock().map_err(|_| "lock")?.clone();
    let store = MemoryStore::open(ws.join(".wiggle").join("memory.db")).map_err(|e| e.to_string())?;
    store
        .upsert_fact(MemoryCategory::Fact, &content, vec!["manual".into()], None, pinned, 0.9)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_memory(state: State<'_, DesktopState>, id: String) -> Result<bool, String> {
    let ws = state.workspace.lock().map_err(|_| "lock")?.clone();
    let store = MemoryStore::open(ws.join(".wiggle").join("memory.db")).map_err(|e| e.to_string())?;
    store.delete(&id).map_err(|e| e.to_string())
}

#[tauri::command]
async fn browser_navigate(state: State<'_, DesktopState>, url: String) -> Result<PageSnapshot, String> {
    state.browser.navigate(&url).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn browser_actuate(
    state: State<'_, DesktopState>,
    action: BrowserAction,
) -> Result<serde_json::Value, String> {
    let res = state.browser.actuate(action).await.map_err(|e| e.to_string())?;
    Ok(serde_json::to_value(res).map_err(|e| e.to_string())?)
}

#[tauri::command]
fn get_settings(state: State<'_, DesktopState>) -> Result<serde_json::Value, String> {
    let ws = state.workspace.lock().map_err(|_| "lock")?.clone();
    let mut cfg = WiggleConfig::load_merged(&ws);
    cfg.api_keys.clear(); // never leak raw secrets back into webview
    Ok(serde_json::json!({
        "config": cfg,
        "presets": builtin_provider_presets()
    }))
}

#[tauri::command]
fn save_settings(state: State<'_, DesktopState>, config: WiggleConfig) -> Result<(), String> {
    let ws = state.workspace.lock().map_err(|_| "lock")?.clone();
    config
        .save_to(&WiggleConfig::project_path(&ws))
        .map_err(|e| e.to_string())
}

fn main() {
    let initial_ws = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    tauri::Builder::default()
        .manage(DesktopState {
            workspace: Mutex::new(initial_ws),
            browser: BrowserController::new(),
            coordinator: FileCoordinator::default(),
        })
        .invoke_handler(tauri::generate_handler![
            get_status,
            list_files,
            read_workspace_file,
            write_workspace_file,
            undo_snapshot,
            redo_snapshot,
            run_chat,
            run_swarm,
            list_skills,
            import_skills,
            list_mcp_servers,
            query_memory,
            add_memory,
            delete_memory,
            browser_navigate,
            browser_actuate,
            get_settings,
            save_settings,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run the Wiggle desktop shell");
}

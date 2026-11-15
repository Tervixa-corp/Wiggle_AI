use crate::providers::ToolDefinition;
use crate::tools::{ToolContext, ToolExecutionResult};
use globset::Glob;
use regex::Regex;
use serde_json::json;
use std::collections::BTreeMap;
use walkdir::WalkDir;

pub fn tool_definitions() -> Vec<ToolDefinition> {
    vec![
        ToolDefinition {
            name: "read_file".into(),
            description: "Read a text file from the workspace.".into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string" },
                    "offset": { "type": "integer" },
                    "limit": { "type": "integer" }
                },
                "required": ["path"]
            }),
        },
        ToolDefinition {
            name: "write_file".into(),
            description: "Create or overwrite a workspace file with automatic /undo snapshot.".into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string" },
                    "content": { "type": "string" }
                },
                "required": ["path", "content"]
            }),
        },
        ToolDefinition {
            name: "edit_file".into(),
            description: "Replace an exact string match in a workspace file.".into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string" },
                    "old_text": { "type": "string" },
                    "new_text": { "type": "string" }
                },
                "required": ["path", "old_text", "new_text"]
            }),
        },
        ToolDefinition {
            name: "multi_edit".into(),
            description: "Apply multiple exact edits sequentially to a workspace file.".into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string" },
                    "edits": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "old_text": { "type": "string" },
                                "new_text": { "type": "string" }
                            },
                            "required": ["old_text", "new_text"]
                        }
                    }
                },
                "required": ["path", "edits"]
            }),
        },
        ToolDefinition {
            name: "glob".into(),
            description: "Find workspace files matching a glob pattern.".into(),
            parameters: json!({
                "type": "object",
                "properties": { "pattern": { "type": "string" } },
                "required": ["pattern"]
            }),
        },
        ToolDefinition {
            name: "grep".into(),
            description: "Search file contents in the workspace using regex.".into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "pattern": { "type": "string" },
                    "path": { "type": "string" }
                },
                "required": ["pattern"]
            }),
        },
        ToolDefinition {
            name: "list_dir".into(),
            description: "List files and directories inside a workspace folder.".into(),
            parameters: json!({
                "type": "object",
                "properties": { "path": { "type": "string" } }
            }),
        },
    ]
}

pub async fn execute(
    ctx: &ToolContext,
    name: &str,
    args: &serde_json::Value,
) -> ToolExecutionResult {
    match name {
        "read_file" => {
            let rel = args["path"].as_str().unwrap_or_default();
            let resolved = match ctx.permissions.resolve_workspace_path(rel) {
                Ok(p) => p,
                Err(e) => return err(e.to_string()),
            };
            match std::fs::read_to_string(&resolved) {
                Ok(text) => {
                    let offset = args["offset"].as_u64().unwrap_or(1).saturating_sub(1) as usize;
                    let limit = args["limit"].as_u64().unwrap_or(500) as usize;
                    let slice = text
                        .lines()
                        .skip(offset)
                        .take(limit)
                        .collect::<Vec<_>>()
                        .join("\n");
                    ok(slice, vec![])
                }
                Err(e) => err(format!("Failed to read {rel}: {e}")),
            }
        }
        "write_file" => {
            let rel = args["path"].as_str().unwrap_or_default();
            let content = args["content"].as_str().unwrap_or_default();
            let resolved = match ctx.permissions.resolve_workspace_path(rel) {
                Ok(p) => p,
                Err(e) => return err(e.to_string()),
            };
            if let Err(e) = ctx.coordinator.acquire(rel, &ctx.agent_id).await {
                return err(e);
            }
            let before = std::fs::read(&resolved).ok();
            if let Some(parent) = resolved.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let res = std::fs::write(&resolved, content.as_bytes());
            if res.is_ok() {
                let mut map = BTreeMap::new();
                map.insert(rel.to_string(), before);
                let _ = ctx.snapshots.record_mutation(format!("write_file {rel}"), &map);
            }
            ctx.coordinator.release(rel, &ctx.agent_id).await;
            match res {
                Ok(()) => ok(format!("Wrote {} bytes to {rel}", content.len()), vec![rel.to_string()]),
                Err(e) => err(format!("Failed to write {rel}: {e}")),
            }
        }
        "edit_file" => {
            let rel = args["path"].as_str().unwrap_or_default();
            let old_text = args["old_text"].as_str().unwrap_or_default();
            let new_text = args["new_text"].as_str().unwrap_or_default();
            let resolved = match ctx.permissions.resolve_workspace_path(rel) {
                Ok(p) => p,
                Err(e) => return err(e.to_string()),
            };
            if let Err(e) = ctx.coordinator.acquire(rel, &ctx.agent_id).await {
                return err(e);
            }
            let out = match std::fs::read_to_string(&resolved) {
                Ok(current) => {
                    let count = current.matches(old_text).count();
                    if count != 1 {
                        err(format!("edit_file expected 1 match in {rel}, found {count}"))
                    } else {
                        let before = Some(current.as_bytes().to_vec());
                        let updated = current.replacen(old_text, new_text, 1);
                        match std::fs::write(&resolved, updated.as_bytes()) {
                            Ok(()) => {
                                let mut map = BTreeMap::new();
                                map.insert(rel.to_string(), before);
                                let _ = ctx.snapshots.record_mutation(format!("edit_file {rel}"), &map);
                                ok(format!("Updated {rel}"), vec![rel.to_string()])
                            }
                            Err(e) => err(format!("Failed writing {rel}: {e}")),
                        }
                    }
                }
                Err(e) => err(format!("Failed reading {rel}: {e}")),
            };
            ctx.coordinator.release(rel, &ctx.agent_id).await;
            out
        }
        "multi_edit" => {
            let rel = args["path"].as_str().unwrap_or_default();
            let Some(edits) = args["edits"].as_array() else {
                return err("multi_edit requires 'edits' array".into());
            };
            let resolved = match ctx.permissions.resolve_workspace_path(rel) {
                Ok(p) => p,
                Err(e) => return err(e.to_string()),
            };
            if let Err(e) = ctx.coordinator.acquire(rel, &ctx.agent_id).await {
                return err(e);
            }
            let out = match std::fs::read_to_string(&resolved) {
                Ok(mut current) => {
                    let before = Some(current.as_bytes().to_vec());
                    for item in edits {
                        let old_t = item["old_text"].as_str().unwrap_or_default();
                        let new_t = item["new_text"].as_str().unwrap_or_default();
                        if current.matches(old_t).count() != 1 {
                            ctx.coordinator.release(rel, &ctx.agent_id).await;
                            return err(format!("Edit hunk failed uniqueness check in {rel}"));
                        }
                        current = current.replacen(old_t, new_t, 1);
                    }
                    match std::fs::write(&resolved, current.as_bytes()) {
                        Ok(()) => {
                            let mut map = BTreeMap::new();
                            map.insert(rel.to_string(), before);
                            let _ = ctx.snapshots.record_mutation(format!("multi_edit {rel}"), &map);
                            ok(format!("Applied {} edits to {rel}", edits.len()), vec![rel.to_string()])
                        }
                        Err(e) => err(format!("Failed writing {rel}: {e}")),
                    }
                }
                Err(e) => err(format!("Failed reading {rel}: {e}")),
            };
            ctx.coordinator.release(rel, &ctx.agent_id).await;
            out
        }
        "glob" => {
            let pattern = args["pattern"].as_str().unwrap_or("*");
            let matcher = match Glob::new(pattern) {
                Ok(g) => g.compile_matcher(),
                Err(e) => return err(format!("Invalid glob: {e}")),
            };
            let root = ctx.permissions.workspace_root();
            let mut matches = Vec::new();
            for entry in WalkDir::new(root)
                .into_iter()
                .filter_entry(|e| !is_ignored(e.file_name().to_str().unwrap_or("")))
                .flatten()
            {
                if entry.file_type().is_file() {
                    if let Ok(rel) = entry.path().strip_prefix(root) {
                        if matcher.is_match(rel) {
                            matches.push(rel.to_string_lossy().to_string());
                        }
                    }
                }
            }
            matches.sort();
            ok(matches.join("\n"), vec![])
        }
        "grep" => {
            let pattern = args["pattern"].as_str().unwrap_or_default();
            let re = match Regex::new(pattern) {
                Ok(r) => r,
                Err(e) => return err(format!("Invalid regex: {e}")),
            };
            let base_rel = args["path"].as_str().unwrap_or(".");
            let base = match ctx.permissions.resolve_workspace_path(base_rel) {
                Ok(p) => p,
                Err(e) => return err(e.to_string()),
            };
            let root = ctx.permissions.workspace_root();
            let mut hits = Vec::new();
            for entry in WalkDir::new(&base)
                .into_iter()
                .filter_entry(|e| !is_ignored(e.file_name().to_str().unwrap_or("")))
                .flatten()
            {
                if entry.file_type().is_file() {
                    if let Ok(text) = std::fs::read_to_string(entry.path()) {
                        let rel = entry
                            .path()
                            .strip_prefix(root)
                            .unwrap_or(entry.path())
                            .to_string_lossy()
                            .to_string();
                        for (idx, line) in text.lines().enumerate() {
                            if re.is_match(line) {
                                hits.push(format!("{}:{}: {}", rel, idx + 1, line.trim()));
                                if hits.len() >= 100 {
                                    return ok(hits.join("\n"), vec![]);
                                }
                            }
                        }
                    }
                }
            }
            ok(hits.join("\n"), vec![])
        }
        "list_dir" => {
            let rel = args["path"].as_str().unwrap_or(".");
            let resolved = match ctx.permissions.resolve_workspace_path(rel) {
                Ok(p) => p,
                Err(e) => return err(e.to_string()),
            };
            match std::fs::read_dir(&resolved) {
                Ok(entries) => {
                    let mut list = Vec::new();
                    for item in entries.flatten() {
                        let name = item.file_name().to_string_lossy().to_string();
                        if is_ignored(&name) {
                            continue;
                        }
                        let suffix = if item.path().is_dir() { "/" } else { "" };
                        list.push(format!("{name}{suffix}"));
                    }
                    list.sort();
                    ok(list.join("\n"), vec![])
                }
                Err(e) => err(format!("Failed to list {rel}: {e}")),
            }
        }
        _ => err(format!("Unsupported fs tool: {name}")),
    }
}

fn is_ignored(name: &str) -> bool {
    matches!(name, ".git" | "node_modules" | "target" | ".wiggle")
}

fn ok(output: String, changed_files: Vec<String>) -> ToolExecutionResult {
    ToolExecutionResult {
        ok: true,
        output,
        changed_files,
    }
}

fn err(output: String) -> ToolExecutionResult {
    ToolExecutionResult {
        ok: false,
        output,
        changed_files: vec![],
    }
}

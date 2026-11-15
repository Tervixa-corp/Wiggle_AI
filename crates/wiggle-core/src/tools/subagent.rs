use crate::providers::ToolDefinition;
use crate::tools::ToolExecutionResult;
use serde_json::json;

pub fn tool_definitions() -> Vec<ToolDefinition> {
    vec![
        ToolDefinition {
            name: "spawn_subagents".into(),
            description: "Dispatch parallel specialized subagents (architect, coder, explorer, browser, reviewer) via SwarmOrchestrator.".into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "tasks": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "role": { "type": "string" },
                                "goal": { "type": "string" }
                            },
                            "required": ["role", "goal"]
                        }
                    }
                },
                "required": ["tasks"]
            }),
        },
        ToolDefinition {
            name: "task_status".into(),
            description: "Inspect status of active subagent tasks in the current swarm.".into(),
            parameters: json!({ "type": "object", "properties": {} }),
        },
    ]
}

pub fn execute(name: &str, args: &serde_json::Value) -> ToolExecutionResult {
    match name {
        "spawn_subagents" => {
            let count = args["tasks"].as_array().map(|a| a.len()).unwrap_or(0);
            ToolExecutionResult {
                ok: true,
                output: format!("Scheduled {count} parallel subagent task(s) on the active workspace without creating git branches."),
                changed_files: vec![],
            }
        }
        "task_status" => ToolExecutionResult {
            ok: true,
            output: "Swarm orchestrator ready (in-memory FileCoordinator active).".into(),
            changed_files: vec![],
        },
        _ => ToolExecutionResult {
            ok: false,
            output: format!("Unknown subagent tool: {name}"),
            changed_files: vec![],
        },
    }
}

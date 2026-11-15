use crate::identity::IdentityGuard;
use crate::mcp::McpTool;
use crate::plugins::hooks::{HookEvent, HookRunner};
use crate::providers::ToolDefinition;
use crate::skills::SkillRegistry;
use crate::tools::builtin_tool_definitions;
use serde::{Deserialize, Serialize};
use std::path::Path;
use wiggle_memory::MemoryStore;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ExecutionRoute {
    SingleAgent,
    ParallelSwarm,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompiledPrompt {
    pub system_prompt: String,
    pub user_prompt: String,
    pub route: ExecutionRoute,
    pub injected_memories: usize,
    pub matched_skills: Vec<String>,
    pub project_instruction_files: Vec<String>,
    pub tools: Vec<ToolDefinition>,
}

/// 7-Stage Prompt Modification & Context Enrichment Pipeline:
/// 1. Identity & Environment Header
/// 2. Personal Context & Past Chat Memory Injection
/// 3. Project Instructions (WIGGLE.md, CLAUDE.md, AGENTS.md, .cursorrules)
/// 4. Dynamic Skill Attachment (SKILL.md)
/// 5. MCP & Native Tool Binding
/// 6. Lifecycle Hook Transformation (UserPromptSubmit + /slash templates)
/// 7. Task Decomposition & Agent Routing
pub struct PromptCompiler;

impl PromptCompiler {
    pub async fn compile(
        workspace_root: &Path,
        user_prompt: &str,
        identity: &IdentityGuard,
        memory: Option<&MemoryStore>,
        skills: &SkillRegistry,
        mcp_tools: &[McpTool],
        hooks: &HookRunner,
    ) -> CompiledPrompt {
        // Stage 1: Immutable Identity & Environment Header
        let mut system_sections = vec![identity.build_header()];

        // Stage 2: Personal Context & Past Chat Memory Injection
        let mut injected_memories = 0;
        if let Some(mem_store) = memory {
            if let Ok(hits) = mem_store.query_relevant_context(user_prompt, 8) {
                if !hits.is_empty() {
                    injected_memories = hits.len();
                    let lines: Vec<String> = hits
                        .iter()
                        .map(|h| format!("- [{}] {}", h.entry.category.as_str(), h.entry.content))
                        .collect();
                    system_sections.push(format!(
                        "<personal_context>\n{}\n</personal_context>",
                        lines.join("\n")
                    ));
                }
            }
        }

        // Stage 3: Project Instructions
        let mut project_instruction_files = Vec::new();
        for fname in ["WIGGLE.md", "CLAUDE.md", "AGENTS.md", ".cursorrules"] {
            let candidate = workspace_root.join(fname);
            if let Ok(text) = std::fs::read_to_string(&candidate) {
                let trimmed = text.trim();
                if !trimmed.is_empty() {
                    project_instruction_files.push(fname.to_string());
                    system_sections.push(format!(
                        "<project_instructions file=\"{fname}\">\n{trimmed}\n</project_instructions>"
                    ));
                }
            }
        }

        // Stage 4: Dynamic Skill Attachment
        let matched = skills.match_for_prompt(user_prompt, 4);
        let mut matched_skills = Vec::new();
        if !matched.is_empty() {
            let mut skill_blocks = Vec::new();
            for s in matched {
                matched_skills.push(s.name.clone());
                skill_blocks.push(format!(
                    "<skill name=\"{}\">\n{}\n</skill>",
                    s.name, s.body
                ));
            }
            system_sections.push(format!(
                "<active_skills>\n{}\n</active_skills>",
                skill_blocks.join("\n\n")
            ));
        }

        // Stage 5: MCP & Native Tool Binding
        let mut tools = builtin_tool_definitions();
        for mt in mcp_tools {
            tools.push(ToolDefinition {
                name: format!("mcp_{}", mt.name),
                description: mt.description.clone().unwrap_or_else(|| "MCP tool".into()),
                parameters: mt.input_schema.clone(),
            });
        }

        // Stage 6: Lifecycle Hook Transformation & /slash commands
        let mut transformed_prompt = expand_slash_command(user_prompt);
        let hook_decision = hooks
            .run_event(
                HookEvent::UserPromptSubmit,
                "prompt",
                &serde_json::json!({ "prompt": transformed_prompt }),
            )
            .await;
        if let Some(modified) = hook_decision.modified_input {
            transformed_prompt = modified;
        }

        // Stage 7: Task Decomposition & Agent Routing
        let lower = transformed_prompt.to_lowercase();
        let route = if lower.starts_with("/swarm")
            || lower.contains("parallel agents")
            || lower.contains("multi-agent")
        {
            ExecutionRoute::ParallelSwarm
        } else {
            ExecutionRoute::SingleAgent
        };

        CompiledPrompt {
            system_prompt: system_sections.join("\n\n"),
            user_prompt: transformed_prompt,
            route,
            injected_memories,
            matched_skills,
            project_instruction_files,
            tools,
        }
    }
}

fn expand_slash_command(input: &str) -> String {
    let trimmed = input.trim();
    if let Some(rest) = trimmed.strip_prefix("/review") {
        format!(
            "Perform a thorough engineering code review focusing on correctness, security, and tests. {}",
            rest.trim()
        )
    } else if let Some(rest) = trimmed.strip_prefix("/compact") {
        format!("Summarize the key decisions and current state concisely. {}", rest.trim())
    } else {
        trimmed.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn compiles_all_seven_stages() {
        let tmp = std::env::temp_dir().join("wiggle_compiler_test");
        let _ = std::fs::create_dir_all(&tmp);
        std::fs::write(tmp.join("WIGGLE.md"), "Always keep UI flat monochrome.").unwrap();

        let mem = MemoryStore::open_in_memory().unwrap();
        mem.upsert_fact(
            wiggle_memory::MemoryCategory::Preference,
            "User prefers Rust and strict unit tests",
            vec!["rust".into()],
            None,
            true,
            0.9,
        )
        .unwrap();

        let identity = IdentityGuard::for_workspace(tmp.to_string_lossy(), Some("main".into()));
        let skills = SkillRegistry::default();
        let hooks = HookRunner::default();

        let compiled = PromptCompiler::compile(
            &tmp,
            "/swarm build and review Rust module",
            &identity,
            Some(&mem),
            &skills,
            &[],
            &hooks,
        )
        .await;

        assert!(compiled.system_prompt.contains("Tervixa Wiggle"));
        assert!(compiled.system_prompt.contains("<personal_context>"));
        assert!(compiled.system_prompt.contains("<project_instructions file=\"WIGGLE.md\">"));
        assert_eq!(compiled.route, ExecutionRoute::ParallelSwarm);
        assert_eq!(compiled.injected_memories, 1);
        let _ = std::fs::remove_dir_all(&tmp);
    }
}

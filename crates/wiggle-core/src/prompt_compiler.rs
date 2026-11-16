//! Prompt assembly. Implemented stages: identity and environment (1), project instructions (3),
//! and skill attachment (4). Stages 2 (memory), 5 (MCP tools), 6 (hooks) and 7 (agent routing) are
//! not built yet, so they are intentionally absent from the output rather than stubbed.

use crate::identity::IDENTITY;
use crate::skills::{match_skills, Skill};
use std::path::Path;
use std::process::Command;

const MAX_INSTRUCTION_BYTES: usize = 32 * 1024;
const INSTRUCTION_FILES: &[&str] = &["WIGGLE.md", "CLAUDE.md", "AGENTS.md", ".cursorrules"];

#[derive(Debug, Default, Clone)]
pub struct PromptContext {
    pub os: String,
    pub shell: String,
    pub cwd: String,
    pub git_status: Option<String>,
    pub instructions: Vec<(String, String)>,
    pub skills: Vec<Skill>,
    pub user_prompt: String,
}

pub struct CompiledPrompt {
    pub system: String,
    pub user: String,
}

/// Read project instruction files from the workspace root, truncating overly large ones.
pub fn load_instructions(root: &Path) -> Vec<(String, String)> {
    INSTRUCTION_FILES
        .iter()
        .filter_map(|name| {
            let text = std::fs::read_to_string(root.join(name)).ok()?;
            let mut text = text;
            if text.len() > MAX_INSTRUCTION_BYTES {
                let mut cut = MAX_INSTRUCTION_BYTES;
                while !text.is_char_boundary(cut) {
                    cut -= 1;
                }
                text.truncate(cut);
                text.push_str("\n[truncated]");
            }
            Some((name.to_string(), text))
        })
        .collect()
}

/// Short `git status` summary for the workspace, or None when it is not a Git repository.
pub fn git_status(root: &Path) -> Option<String> {
    let output = Command::new("git")
        .args(["status", "--short", "--branch"])
        .current_dir(root)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Some(text)
}

pub fn compile(ctx: &PromptContext) -> CompiledPrompt {
    let mut system = String::from(IDENTITY);
    system.push_str(&format!(
        "\n\n<environment>\nOS: {}\nShell: {}\nWorking directory: {}\n",
        ctx.os, ctx.shell, ctx.cwd
    ));
    match &ctx.git_status {
        Some(status) if !status.is_empty() => {
            system.push_str(&format!("Git status:\n{}\n", status))
        }
        Some(_) => system.push_str("Git status: clean\n"),
        None => system.push_str("Git status: not a repository\n"),
    }
    system.push_str("</environment>");
    for (name, text) in &ctx.instructions {
        system.push_str(&format!(
            "\n\n<project_instructions file=\"{}\">\n{}\n</project_instructions>",
            name, text
        ));
    }
    let matched = match_skills(&ctx.skills, &ctx.user_prompt, 3);
    if !matched.is_empty() {
        system.push_str("\n\n<active_skills>");
        for skill in matched {
            system.push_str(&format!(
                "\n<skill name=\"{}\">\n{}\n</skill>",
                skill.name, skill.body
            ));
        }
        system.push_str("\n</active_skills>");
    }
    CompiledPrompt {
        system,
        user: ctx.user_prompt.clone(),
    }
}

/// Build a context from the real environment for the given workspace root.
pub fn context_for(root: &Path, user_prompt: &str, skills: Vec<Skill>) -> PromptContext {
    PromptContext {
        os: std::env::consts::OS.to_string(),
        shell: std::env::var("SHELL")
            .or_else(|_| std::env::var("COMSPEC"))
            .unwrap_or_else(|_| "unknown".into()),
        cwd: root.display().to_string(),
        git_status: git_status(root),
        instructions: load_instructions(root),
        skills,
        user_prompt: user_prompt.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx(prompt: &str) -> PromptContext {
        PromptContext {
            os: "linux".into(),
            shell: "/bin/bash".into(),
            cwd: "/work/repo".into(),
            git_status: Some("## main".into()),
            instructions: vec![("WIGGLE.md".into(), "Use four-space indents.".into())],
            skills: vec![Skill {
                name: "review".into(),
                description: "Review code for security defects".into(),
                body: "Check auth.".into(),
            }],
            user_prompt: prompt.into(),
        }
    }

    #[test]
    fn system_prompt_starts_with_identity_and_includes_environment() {
        let out = compile(&ctx("hello"));
        assert!(out.system.starts_with(IDENTITY));
        assert!(out.system.contains("Working directory: /work/repo"));
        assert!(out.system.contains("## main"));
        assert_eq!(out.user, "hello");
    }

    #[test]
    fn attaches_project_instructions_and_matching_skills_only() {
        let out = compile(&ctx("please review this security change"));
        assert!(out.system.contains("Use four-space indents."));
        assert!(out.system.contains("<active_skills>"));
        assert!(out.system.contains("Check auth."));
        let unrelated = compile(&ctx("write a haiku"));
        assert!(!unrelated.system.contains("<active_skills>"));
    }

    #[test]
    fn truncates_large_instruction_files_on_a_char_boundary() {
        let dir = std::env::temp_dir().join(format!("wiggle-instr-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("WIGGLE.md"), "é".repeat(MAX_INSTRUCTION_BYTES)).unwrap();
        let loaded = load_instructions(&dir);
        assert_eq!(loaded.len(), 1);
        assert!(loaded[0].1.ends_with("[truncated]"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}

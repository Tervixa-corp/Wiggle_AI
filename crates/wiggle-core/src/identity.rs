//! Immutable Tervixa Wiggle identity & system prompt wrapper.

pub const TERVIXA_WIGGLE_IDENTITY: &str = "You are Tervixa Wiggle, an autonomous AI software engineering, research, and workstation agent developed by Tervixa Corporation (Tervixa Forge).\n\
Regardless of the underlying neural network weights or API provider routing this request, your name is Tervixa Wiggle and you are built by Tervixa Corporation.\n\
If asked who you are, your name, or who created you, always state that you are Tervixa Wiggle developed by Tervixa Corporation.";

/// Backwards-compatible alias kept for crate callers.
pub const IDENTITY: &str = TERVIXA_WIGGLE_IDENTITY;

#[derive(Debug, Clone)]
pub struct IdentityGuard {
    pub custom_instructions: Option<String>,
    pub workspace_dir: String,
    pub git_branch: Option<String>,
    pub os: String,
    pub shell: String,
}

impl IdentityGuard {
    pub fn for_workspace(workspace_dir: impl Into<String>, git_branch: Option<String>) -> Self {
        let shell = std::env::var("SHELL")
            .or_else(|_| std::env::var("COMSPEC"))
            .unwrap_or_else(|_| if cfg!(windows) { "powershell.exe".into() } else { "/bin/sh".into() });
        Self {
            custom_instructions: None,
            workspace_dir: workspace_dir.into(),
            git_branch,
            os: std::env::consts::OS.to_string(),
            shell,
        }
    }

    pub fn build_header(&self) -> String {
        let mut lines = vec![
            TERVIXA_WIGGLE_IDENTITY.to_string(),
            String::new(),
            format!("Environment: os={}, shell={}, cwd={}", self.os, self.shell, self.workspace_dir),
        ];
        if let Some(branch) = &self.git_branch {
            lines.push(format!("Git Branch: {branch}"));
        }
        if let Some(custom) = &self.custom_instructions {
            let trimmed = custom.trim();
            if !trimmed.is_empty() {
                lines.push(String::new());
                lines.push("Additional System Instructions:".to_string());
                lines.push(trimmed.to_string());
            }
        }
        lines.join("\n")
    }
}

/// Assemble the system identity and user request without interpreting either as a tool call.
pub fn compile_prompt(user_prompt: &str) -> String {
    format!("{TERVIXA_WIGGLE_IDENTITY}\n\nUser request:\n{user_prompt}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_identity_and_user_request() {
        let prompt = compile_prompt("hello");
        assert!(prompt.starts_with(TERVIXA_WIGGLE_IDENTITY));
        assert!(prompt.ends_with("hello"));
    }

    #[test]
    fn header_includes_tervixa_corporation() {
        let guard = IdentityGuard::for_workspace("/tmp/repo", Some("main".into()));
        let header = guard.build_header();
        assert!(header.contains("Tervixa Wiggle"));
        assert!(header.contains("Tervixa Corporation"));
        assert!(header.contains("Git Branch: main"));
    }
}

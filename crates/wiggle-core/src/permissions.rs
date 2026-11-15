use crate::config::ApprovalMode;
use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum PermissionError {
    #[error("path escapes workspace root: {0}")]
    PathEscape(String),
    #[error("permission denied for tool '{tool}': {reason}")]
    Denied { tool: String, reason: String },
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PermissionEffect {
    Allow,
    Ask,
    Deny,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionRule {
    pub tool_pattern: String,
    pub resource_pattern: String,
    pub effect: PermissionEffect,
}

#[derive(Debug, Clone)]
pub struct PermissionGate {
    workspace_root: PathBuf,
    mode: ApprovalMode,
    rules: Vec<PermissionRule>,
    shell_allowlist: Vec<String>,
}

impl PermissionGate {
    pub fn new(
        workspace_root: impl AsRef<Path>,
        mode: ApprovalMode,
        rules: Vec<PermissionRule>,
        shell_allowlist: Vec<String>,
    ) -> Self {
        let canonical = std::fs::canonicalize(workspace_root.as_ref())
            .unwrap_or_else(|_| workspace_root.as_ref().to_path_buf());
        Self {
            workspace_root: canonical,
            mode,
            rules,
            shell_allowlist,
        }
    }

    pub fn workspace_root(&self) -> &Path {
        &self.workspace_root
    }

    /// Resolve a workspace-relative or absolute path and verify it stays strictly within `workspace_root`
    /// even across symlinks or non-existent target files.
    pub fn resolve_workspace_path(&self, raw: &str) -> Result<PathBuf, PermissionError> {
        let candidate = Path::new(raw);
        let joined = if candidate.is_absolute() {
            candidate.to_path_buf()
        } else {
            self.workspace_root.join(candidate)
        };

        // Reject parent traversal before canonicalizing non-existent paths.
        let mut normalized = PathBuf::new();
        for comp in joined.components() {
            match comp {
                Component::ParentDir => {
                    if !normalized.pop() {
                        return Err(PermissionError::PathEscape(raw.to_string()));
                    }
                }
                Component::CurDir => {}
                other => normalized.push(other.as_os_str()),
            }
        }

        if normalized.exists() {
            let canon = std::fs::canonicalize(&normalized)?;
            if !canon.starts_with(&self.workspace_root) {
                return Err(PermissionError::PathEscape(raw.to_string()));
            }
            return Ok(canon);
        }

        // For new files, canonicalize the deepest existing ancestor to prevent symlink escapes.
        let mut ancestor = normalized.clone();
        while !ancestor.exists() {
            if !ancestor.pop() {
                return Err(PermissionError::PathEscape(raw.to_string()));
            }
        }
        let canon_ancestor = std::fs::canonicalize(&ancestor)?;
        if !canon_ancestor.starts_with(&self.workspace_root) {
            return Err(PermissionError::PathEscape(raw.to_string()));
        }
        let suffix = normalized
            .strip_prefix(&ancestor)
            .map_err(|_| PermissionError::PathEscape(raw.to_string()))?;
        Ok(canon_ancestor.join(suffix))
    }

    pub fn evaluate(&self, tool: &str, resource: &str) -> PermissionEffect {
        for rule in &self.rules {
            if wildcard_match(&rule.tool_pattern, tool)
                && wildcard_match(&rule.resource_pattern, resource)
            {
                return rule.effect;
            }
        }

        if tool == "bash" || tool == "shell" {
            let trimmed = resource.trim();
            if trimmed.contains("rm -rf /") || trimmed.contains(":(){") {
                return PermissionEffect::Deny;
            }
            if matches!(self.mode, ApprovalMode::FullAuto) {
                return PermissionEffect::Allow;
            }
            if self
                .shell_allowlist
                .iter()
                .any(|prefix| trimmed == prefix || trimmed.starts_with(&format!("{prefix} ")))
            {
                return PermissionEffect::Allow;
            }
            return PermissionEffect::Ask;
        }

        let is_read_only = matches!(
            tool,
            "read_file" | "glob" | "grep" | "list_dir" | "web_search" | "web_fetch" | "browser_inspect"
        );
        if is_read_only {
            return PermissionEffect::Allow;
        }

        match self.mode {
            ApprovalMode::FullAuto => PermissionEffect::Allow,
            ApprovalMode::AutoEdit => {
                if matches!(tool, "write_file" | "edit_file" | "multi_edit") {
                    PermissionEffect::Allow
                } else {
                    PermissionEffect::Ask
                }
            }
            ApprovalMode::Suggest => PermissionEffect::Ask,
        }
    }
}

fn wildcard_match(pattern: &str, text: &str) -> bool {
    if pattern == "*" {
        return true;
    }
    if let Some(prefix) = pattern.strip_suffix('*') {
        return text.starts_with(prefix);
    }
    pattern == text
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_path_escape() {
        let tmp = std::env::temp_dir().join("wiggle_perm_test");
        let _ = std::fs::create_dir_all(&tmp);
        let gate = PermissionGate::new(&tmp, ApprovalMode::Suggest, vec![], vec![]);
        assert!(gate.resolve_workspace_path("../../etc/passwd").is_err());
        assert!(gate.resolve_workspace_path("inside/new.txt").is_ok());
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn enforces_approval_modes() {
        let gate = PermissionGate::new(".", ApprovalMode::AutoEdit, vec![], vec!["cargo test".into()]);
        assert_eq!(gate.evaluate("read_file", "Cargo.toml"), PermissionEffect::Allow);
        assert_eq!(gate.evaluate("edit_file", "src/lib.rs"), PermissionEffect::Allow);
        assert_eq!(gate.evaluate("bash", "cargo test --workspace"), PermissionEffect::Allow);
        assert_eq!(gate.evaluate("bash", "curl https://evil.example"), PermissionEffect::Ask);
    }
}

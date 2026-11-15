use std::path::{Path, PathBuf};
use walkdir::WalkDir;

#[derive(Debug, Clone)]
pub struct ImportSummary {
    pub source_label: String,
    pub imported_count: usize,
    pub imported_names: Vec<String>,
}

/// Imports SKILL.md packages from Claude Code (~/.claude/skills), OpenCode (~/.config/opencode/skills),
/// or a local cloned repository directory into ~/.wiggle/skills/.
pub fn import_skills_from_dir(source_dir: &Path, target_dir: &Path, label: &str) -> std::io::Result<ImportSummary> {
    std::fs::create_dir_all(target_dir)?;
    let mut imported_names = Vec::new();
    if !source_dir.exists() {
        return Ok(ImportSummary {
            source_label: label.to_string(),
            imported_count: 0,
            imported_names,
        });
    }

    for entry in WalkDir::new(source_dir).max_depth(3).into_iter().flatten() {
        if entry.file_type().is_file() && entry.file_name() == "SKILL.md" {
            let skill_folder = entry
                .path()
                .parent()
                .and_then(|p| p.file_name())
                .and_then(|n| n.to_str())
                .unwrap_or("imported-skill");
            let dest_folder = target_dir.join(skill_folder);
            std::fs::create_dir_all(&dest_folder)?;
            std::fs::copy(entry.path(), dest_folder.join("SKILL.md"))?;
            imported_names.push(skill_folder.to_string());
        }
    }

    Ok(ImportSummary {
        source_label: label.to_string(),
        imported_count: imported_names.len(),
        imported_names,
    })
}

pub fn default_claude_skills_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".claude").join("skills"))
}

pub fn default_opencode_skills_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".config").join("opencode").join("skills"))
}

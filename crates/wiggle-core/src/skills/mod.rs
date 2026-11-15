pub mod importer;

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Skill {
    pub id: String,
    pub name: String,
    pub description: String,
    pub body: String,
    pub source: String,
    pub path: PathBuf,
    pub enabled: bool,
}

#[derive(Debug, Default, Clone)]
pub struct SkillRegistry {
    skills: Vec<Skill>,
}

impl SkillRegistry {
    pub fn load_workspace(workspace_root: &Path) -> Self {
        let mut registry = Self::default();
        let bundled = workspace_root.join("bundled-skills");
        let project = workspace_root.join(".wiggle").join("skills");
        let global = dirs::home_dir().map(|h| h.join(".wiggle").join("skills"));

        registry.scan_dir(&bundled, "bundled");
        registry.scan_dir(&project, "project");
        if let Some(g) = global {
            registry.scan_dir(&g, "global");
        }
        registry
    }

    pub fn scan_dir(&mut self, dir: &Path, source: &str) {
        if !dir.exists() {
            return;
        }
        for entry in WalkDir::new(dir).max_depth(3).into_iter().flatten() {
            if entry.file_type().is_file() && entry.file_name() == "SKILL.md" {
                if let Ok(raw) = std::fs::read_to_string(entry.path()) {
                    if let Some(skill) = parse_skill_markdown(entry.path(), &raw, source) {
                        if let Some(existing) = self.skills.iter_mut().find(|s| s.name == skill.name) {
                            *existing = skill;
                        } else {
                            self.skills.push(skill);
                        }
                    }
                }
            }
        }
    }

    pub fn all(&self) -> &[Skill] {
        &self.skills
    }

    pub fn set_enabled(&mut self, name: &str, enabled: bool) -> bool {
        if let Some(skill) = self.skills.iter_mut().find(|s| s.name == name || s.id == name) {
            skill.enabled = enabled;
            return true;
        }
        false
    }

    /// Match enabled skills relevant to the user prompt by keyword & explicit `$skill` / `/skill` mention.
    pub fn match_for_prompt(&self, prompt: &str, max_skills: usize) -> Vec<&Skill> {
        let lower = prompt.to_lowercase();
        let tokens: Vec<&str> = lower
            .split(|c: char| !c.is_alphanumeric() && c != '-' && c != '_')
            .filter(|t| t.len() >= 3)
            .collect();

        let mut scored: Vec<(usize, &Skill)> = self
            .skills
            .iter()
            .filter(|s| s.enabled)
            .filter_map(|skill| {
                let name_lower = skill.name.to_lowercase();
                let desc_lower = skill.description.to_lowercase();
                let mut score = 0usize;
                if lower.contains(&format!("${name_lower}")) || lower.contains(&format!("/{name_lower}")) || lower.contains(&name_lower) {
                    score += 10;
                }
                for tok in &tokens {
                    if desc_lower.contains(tok) {
                        score += 2;
                    }
                    if name_lower.contains(tok) {
                        score += 3;
                    }
                }
                if score > 0 {
                    Some((score, skill))
                } else {
                    None
                }
            })
            .collect();

        scored.sort_by(|a, b| b.0.cmp(&a.0));
        scored.into_iter().take(max_skills).map(|(_, s)| s).collect()
    }
}

pub fn parse_skill_markdown(path: &Path, raw: &str, source: &str) -> Option<Skill> {
    let trimmed = raw.trim_start();
    let (frontmatter, body) = if let Some(rest) = trimmed.strip_prefix("---") {
        if let Some(end_idx) = rest.find("\n---") {
            let fm = &rest[..end_idx];
            let md = rest[end_idx + 4..].trim_start();
            (fm, md)
        } else {
            ("", raw)
        }
    } else {
        ("", raw)
    };

    let mut name = path
        .parent()
        .and_then(|p| p.file_name())
        .and_then(|n| n.to_str())
        .unwrap_or("unnamed-skill")
        .to_string();
    let mut description = String::new();

    for line in frontmatter.lines() {
        let line = line.trim();
        if let Some(val) = line.strip_prefix("name:") {
            let clean = val.trim().trim_matches('"').trim_matches('\'');
            if !clean.is_empty() {
                name = clean.to_string();
            }
        } else if let Some(val) = line.strip_prefix("description:") {
            description = val.trim().trim_matches('"').trim_matches('\'').to_string();
        }
    }

    if body.trim().is_empty() && description.is_empty() {
        return None;
    }

    Some(Skill {
        id: format!("{source}:{name}"),
        name,
        description,
        body: body.trim().to_string(),
        source: source.to_string(),
        path: path.to_path_buf(),
        enabled: true,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_skill_frontmatter_and_matches_prompt() {
        let raw = "---\nname: security-audit\ndescription: Audit code for path traversal and injection vulnerabilities\n---\n# Security Audit\nCheck inputs.";
        let skill = parse_skill_markdown(Path::new("bundled-skills/security-audit/SKILL.md"), raw, "bundled").unwrap();
        assert_eq!(skill.name, "security-audit");
        assert!(skill.description.contains("path traversal"));

        let mut reg = SkillRegistry::default();
        reg.skills.push(skill);
        let matches = reg.match_for_prompt("Please audit for path traversal bugs", 3);
        assert_eq!(matches.len(), 1);
    }
}

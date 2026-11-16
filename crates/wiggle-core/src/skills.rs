//! SKILL.md loader and keyword matcher. Skills are instructions, never permission grants.

use std::collections::HashSet;
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Skill {
    pub name: String,
    pub description: String,
    pub body: String,
}

/// Parse a SKILL.md file: YAML-style frontmatter with `name` and `description`, then a Markdown body.
pub fn parse_skill(text: &str) -> Option<Skill> {
    let rest = text.strip_prefix("---")?;
    let end = rest.find("\n---")?;
    let (front, body) = (&rest[..end], &rest[end + 4..]);
    let mut name = None;
    let mut description = None;
    for line in front.lines() {
        if let Some((key, value)) = line.split_once(':') {
            let value = value
                .trim()
                .trim_matches('"')
                .trim_matches('\'')
                .to_string();
            match key.trim() {
                "name" => name = Some(value),
                "description" => description = Some(value),
                _ => {}
            }
        }
    }
    let name = name.filter(|n| !n.is_empty())?;
    Some(Skill {
        name,
        description: description.unwrap_or_default(),
        body: body.trim().to_string(),
    })
}

/// Load every `<dir>/<skill>/SKILL.md`. Missing directories yield no skills; unreadable files are skipped.
pub fn load_skills(dir: &Path) -> Vec<Skill> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut skills: Vec<Skill> = entries
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_dir())
        .filter_map(|e| fs::read_to_string(e.path().join("SKILL.md")).ok())
        .filter_map(|text| parse_skill(&text))
        .collect();
    skills.sort_by(|a, b| a.name.cmp(&b.name));
    skills
}

const STOPWORDS: &[&str] = &[
    "the", "and", "for", "with", "this", "that", "from", "into", "a", "an", "to", "of", "in", "on",
    "is", "it", "my", "your", "our", "be", "or", "by", "as", "at",
];

fn tokens(text: &str) -> HashSet<String> {
    text.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| t.len() > 2 && !STOPWORDS.contains(t))
        .map(str::to_string)
        .collect()
}

/// Return up to `limit` skills whose name or description shares at least one keyword with the prompt.
pub fn match_skills<'a>(skills: &'a [Skill], prompt: &str, limit: usize) -> Vec<&'a Skill> {
    let prompt_tokens = tokens(prompt);
    let mut scored: Vec<(usize, &Skill)> = skills
        .iter()
        .map(|s| {
            let skill_tokens = tokens(&format!("{} {}", s.name, s.description));
            (prompt_tokens.intersection(&skill_tokens).count(), s)
        })
        .filter(|(score, _)| *score > 0)
        .collect();
    scored.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.name.cmp(&b.1.name)));
    scored.into_iter().take(limit).map(|(_, s)| s).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "---\nname: review\ndescription: Review a change for correctness, security and missing tests.\n---\n\n# Review\n\nBody text.\n";

    #[test]
    fn parses_frontmatter_and_body() {
        let skill = parse_skill(SAMPLE).unwrap();
        assert_eq!(skill.name, "review");
        assert!(skill.description.starts_with("Review a change"));
        assert_eq!(skill.body, "# Review\n\nBody text.");
    }

    #[test]
    fn rejects_files_without_a_name() {
        assert!(parse_skill("no frontmatter").is_none());
        assert!(parse_skill("---\ndescription: x\n---\nbody").is_none());
    }

    #[test]
    fn matches_on_shared_keywords_only() {
        let skills = vec![parse_skill(SAMPLE).unwrap()];
        assert_eq!(
            match_skills(&skills, "please review my security change", 3).len(),
            1
        );
        assert!(match_skills(&skills, "write a poem about cats", 3).is_empty());
    }

    #[test]
    fn loads_skills_from_a_directory() {
        let dir = std::env::temp_dir().join(format!("wiggle-skills-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("review")).unwrap();
        fs::write(dir.join("review/SKILL.md"), SAMPLE).unwrap();
        assert_eq!(load_skills(&dir).len(), 1);
        assert!(load_skills(&dir.join("missing")).is_empty());
        let _ = fs::remove_dir_all(&dir);
    }
}

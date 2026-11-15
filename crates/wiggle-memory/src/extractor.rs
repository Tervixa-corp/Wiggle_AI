use crate::store::{MemoryCategory, MemoryStore, StoreError};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractedFact {
    pub category: MemoryCategory,
    pub content: String,
    pub tags: Vec<String>,
    pub importance: f32,
}

/// Extracts durable user preferences, stack details, and project conventions from conversation turns.
pub struct MemoryExtractor;

impl MemoryExtractor {
    pub fn extract_from_turn(user_prompt: &str, assistant_reply: &str) -> Vec<ExtractedFact> {
        let mut facts = Vec::new();
        let combined = format!("{user_prompt}\n{assistant_reply}");

        for line in user_prompt.lines() {
            let trimmed = line.trim();
            if trimmed.len() < 12 || trimmed.len() > 260 {
                continue;
            }
            let lower = trimmed.to_lowercase();
            if lower.contains("i prefer")
                || lower.contains("always use")
                || lower.contains("never use")
                || lower.contains("my favorite")
            {
                facts.push(ExtractedFact {
                    category: MemoryCategory::Preference,
                    content: trimmed.to_string(),
                    tags: vec!["preference".to_string()],
                    importance: 0.85,
                });
            } else if lower.contains("my stack")
                || lower.contains("we use rust")
                || lower.contains("using typescript")
                || lower.contains("using tauri")
            {
                facts.push(ExtractedFact {
                    category: MemoryCategory::Stack,
                    content: trimmed.to_string(),
                    tags: vec!["stack".to_string()],
                    importance: 0.80,
                });
            } else if lower.contains("my machine")
                || lower.contains("linux")
                || lower.contains("windows")
                || lower.contains("macos")
            {
                if lower.contains("i run") || lower.contains("i am on") || lower.contains("my machine") {
                    facts.push(ExtractedFact {
                        category: MemoryCategory::Hardware,
                        content: trimmed.to_string(),
                        tags: vec!["environment".to_string()],
                        importance: 0.72,
                    });
                }
            }
        }

        if combined.len() > 80 && facts.is_empty() && user_prompt.split_whitespace().count() >= 6 {
            let summary: String = user_prompt.chars().take(180).collect();
            facts.push(ExtractedFact {
                category: MemoryCategory::SessionSummary,
                content: format!("Discussed task: {}", summary.trim()),
                tags: vec!["session".to_string()],
                importance: 0.55,
            });
        }

        facts
    }

    pub fn record_turn(
        store: &MemoryStore,
        session_id: &str,
        user_prompt: &str,
        assistant_reply: &str,
    ) -> Result<usize, StoreError> {
        let extracted = Self::extract_from_turn(user_prompt, assistant_reply);
        let mut count = 0;
        for fact in extracted {
            store.upsert_fact(
                fact.category,
                &fact.content,
                fact.tags,
                Some(session_id),
                false,
                fact.importance,
            )?;
            count += 1;
        }
        Ok(count)
    }
}

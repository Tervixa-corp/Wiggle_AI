use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::Path;
use std::sync::{Arc, Mutex};
use thiserror::Error;
use uuid::Uuid;

const EMBEDDING_DIM: usize = 64;

#[derive(Debug, Error)]
pub enum StoreError {
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("serialization error: {0}")]
    Serde(#[from] serde_json::Error),
    #[error("lock poisoned")]
    Lock,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MemoryCategory {
    Preference,
    Stack,
    Hardware,
    Project,
    Workflow,
    SessionSummary,
    Fact,
}

impl MemoryCategory {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Preference => "preference",
            Self::Stack => "stack",
            Self::Hardware => "hardware",
            Self::Project => "project",
            Self::Workflow => "workflow",
            Self::SessionSummary => "session_summary",
            Self::Fact => "fact",
        }
    }

    pub fn from_str_lossy(value: &str) -> Self {
        match value {
            "preference" => Self::Preference,
            "stack" => Self::Stack,
            "hardware" => Self::Hardware,
            "project" => Self::Project,
            "workflow" => Self::Workflow,
            "session_summary" => Self::SessionSummary,
            _ => Self::Fact,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryEntry {
    pub id: String,
    pub category: MemoryCategory,
    pub content: String,
    pub source_session: Option<String>,
    pub tags: Vec<String>,
    pub pinned: bool,
    pub importance: f32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryQueryHit {
    pub entry: MemoryEntry,
    pub score: f32,
}

#[derive(Clone)]
pub struct MemoryStore {
    conn: Arc<Mutex<Connection>>,
}

impl MemoryStore {
    pub fn open(db_path: impl AsRef<Path>) -> Result<Self, StoreError> {
        if let Some(parent) = db_path.as_ref().parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(db_path)?;
        let store = Self {
            conn: Arc::new(Mutex::new(conn)),
        };
        store.init_schema()?;
        Ok(store)
    }

    pub fn open_in_memory() -> Result<Self, StoreError> {
        let conn = Connection::open_in_memory()?;
        let store = Self {
            conn: Arc::new(Mutex::new(conn)),
        };
        store.init_schema()?;
        Ok(store)
    }

    fn init_schema(&self) -> Result<(), StoreError> {
        let conn = self.conn.lock().map_err(|_| StoreError::Lock)?;
        conn.execute_batch(
            r#"
            PRAGMA journal_mode = WAL;
            CREATE TABLE IF NOT EXISTS memories (
                id TEXT PRIMARY KEY,
                category TEXT NOT NULL,
                content TEXT NOT NULL,
                content_hash TEXT NOT NULL UNIQUE,
                source_session TEXT,
                tags_json TEXT NOT NULL,
                embedding_json TEXT NOT NULL,
                pinned INTEGER NOT NULL DEFAULT 0,
                importance REAL NOT NULL DEFAULT 0.7,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
                id UNINDEXED,
                content,
                tags,
                tokenize='porter unicode61'
            );
            "#,
        )?;
        Ok(())
    }

    pub fn upsert_fact(
        &self,
        category: MemoryCategory,
        content: &str,
        tags: Vec<String>,
        source_session: Option<&str>,
        pinned: bool,
        importance: f32,
    ) -> Result<MemoryEntry, StoreError> {
        let normalized = content.trim();
        let hash = content_hash(normalized);
        let now = Utc::now();
        let embedding = compute_embedding(normalized);
        let embedding_json = serde_json::to_string(&embedding)?;
        let tags_json = serde_json::to_string(&tags)?;
        let tags_flat = tags.join(" ");

        let conn = self.conn.lock().map_err(|_| StoreError::Lock)?;
        let existing_id: Option<String> = conn
            .query_row(
                "SELECT id FROM memories WHERE content_hash = ?1",
                params![hash],
                |row| row.get(0),
            )
            .optional()?;

        let id = existing_id.unwrap_or_else(|| Uuid::new_v4().to_string());
        let now_str = now.to_rfc3339();

        conn.execute(
            r#"
            INSERT INTO memories (id, category, content, content_hash, source_session, tags_json, embedding_json, pinned, importance, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)
            ON CONFLICT(content_hash) DO UPDATE SET
                category = excluded.category,
                tags_json = excluded.tags_json,
                pinned = MAX(memories.pinned, excluded.pinned),
                importance = MAX(memories.importance, excluded.importance),
                updated_at = excluded.updated_at
            "#,
            params![
                id,
                category.as_str(),
                normalized,
                hash,
                source_session,
                tags_json,
                embedding_json,
                if pinned { 1 } else { 0 },
                importance,
                now_str
            ],
        )?;

        conn.execute("DELETE FROM memories_fts WHERE id = ?1", params![id])?;
        conn.execute(
            "INSERT INTO memories_fts (id, content, tags) VALUES (?1, ?2, ?3)",
            params![id, normalized, tags_flat],
        )?;

        Ok(MemoryEntry {
            id,
            category,
            content: normalized.to_string(),
            source_session: source_session.map(ToString::to_string),
            tags,
            pinned,
            importance,
            created_at: now,
            updated_at: now,
        })
    }

    pub fn list_all(&self, limit: usize) -> Result<Vec<MemoryEntry>, StoreError> {
        let conn = self.conn.lock().map_err(|_| StoreError::Lock)?;
        let mut stmt = conn.prepare(
            "SELECT id, category, content, source_session, tags_json, pinned, importance, created_at, updated_at
             FROM memories ORDER BY pinned DESC, updated_at DESC LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit as i64], |row| {
            let cat: String = row.get(1)?;
            let tags_json: String = row.get(4)?;
            let created: String = row.get(7)?;
            let updated: String = row.get(8)?;
            let pinned_int: i64 = row.get(5)?;
            Ok((
                row.get::<_, String>(0)?,
                cat,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
                tags_json,
                pinned_int != 0,
                row.get::<_, f32>(6)?,
                created,
                updated,
            ))
        })?;

        let mut out = Vec::new();
        for row in rows {
            let (id, cat, content, source_session, tags_json, pinned, importance, created, updated) =
                row?;
            let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
            let created_at = DateTime::parse_from_rfc3339(&created)
                .map(|d| d.with_timezone(&Utc))
                .unwrap_or_else(|_| Utc::now());
            let updated_at = DateTime::parse_from_rfc3339(&updated)
                .map(|d| d.with_timezone(&Utc))
                .unwrap_or_else(|_| Utc::now());
            out.push(MemoryEntry {
                id,
                category: MemoryCategory::from_str_lossy(&cat),
                content,
                source_session,
                tags,
                pinned,
                importance,
                created_at,
                updated_at,
            });
        }
        Ok(out)
    }

    pub fn query_relevant_context(
        &self,
        query: &str,
        limit: usize,
    ) -> Result<Vec<MemoryQueryHit>, StoreError> {
        let query_vec = compute_embedding(query);
        let fts_ids = self.fts_candidates(query, limit * 4)?;
        let conn = self.conn.lock().map_err(|_| StoreError::Lock)?;
        let mut stmt = conn.prepare(
            "SELECT id, category, content, source_session, tags_json, embedding_json, pinned, importance, created_at, updated_at
             FROM memories ORDER BY pinned DESC, updated_at DESC LIMIT 250",
        )?;

        let mut hits = Vec::new();
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, i64>(6)? != 0,
                row.get::<_, f32>(7)?,
                row.get::<_, String>(8)?,
                row.get::<_, String>(9)?,
            ))
        })?;

        for row in rows {
            let (id, cat, content, source_session, tags_json, emb_json, pinned, importance, created, updated) =
                row?;
            let emb: Vec<f32> = serde_json::from_str(&emb_json).unwrap_or_default();
            let cos = cosine_similarity(&query_vec, &emb);
            let fts_boost = if fts_ids.contains(&id) { 0.35 } else { 0.0 };
            let pin_boost = if pinned { 0.30 } else { 0.0 };
            let score = (cos * 0.6 + fts_boost + pin_boost + importance * 0.15).clamp(0.0, 2.0);
            if score > 0.08 || pinned {
                hits.push(MemoryQueryHit {
                    entry: MemoryEntry {
                        id,
                        category: MemoryCategory::from_str_lossy(&cat),
                        content,
                        source_session,
                        tags: serde_json::from_str(&tags_json).unwrap_or_default(),
                        pinned,
                        importance,
                        created_at: DateTime::parse_from_rfc3339(&created)
                            .map(|d| d.with_timezone(&Utc))
                            .unwrap_or_else(|_| Utc::now()),
                        updated_at: DateTime::parse_from_rfc3339(&updated)
                            .map(|d| d.with_timezone(&Utc))
                            .unwrap_or_else(|_| Utc::now()),
                    },
                    score,
                });
            }
        }

        hits.sort_by(|a, b| b.score.total_cmp(&a.score));
        hits.truncate(limit);
        Ok(hits)
    }

    fn fts_candidates(&self, query: &str, limit: usize) -> Result<Vec<String>, StoreError> {
        let tokens: Vec<String> = query
            .split(|c: char| !c.is_alphanumeric())
            .filter(|t| t.len() >= 2)
            .take(8)
            .map(|t| format!("\"{}\"", t.to_lowercase()))
            .collect();
        if tokens.is_empty() {
            return Ok(Vec::new());
        }
        let fts_query = tokens.join(" OR ");
        let conn = self.conn.lock().map_err(|_| StoreError::Lock)?;
        let mut stmt = conn.prepare(
            "SELECT id FROM memories_fts WHERE memories_fts MATCH ?1 ORDER BY rank LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![fts_query, limit as i64], |r| r.get(0))?;
        let mut ids = Vec::new();
        for id in rows.flatten() {
            ids.push(id);
        }
        Ok(ids)
    }

    pub fn delete(&self, id: &str) -> Result<bool, StoreError> {
        let conn = self.conn.lock().map_err(|_| StoreError::Lock)?;
        let affected = conn.execute("DELETE FROM memories WHERE id = ?1", params![id])?;
        conn.execute("DELETE FROM memories_fts WHERE id = ?1", params![id])?;
        Ok(affected > 0)
    }

    pub fn set_pinned(&self, id: &str, pinned: bool) -> Result<bool, StoreError> {
        let conn = self.conn.lock().map_err(|_| StoreError::Lock)?;
        let affected = conn.execute(
            "UPDATE memories SET pinned = ?2, updated_at = ?3 WHERE id = ?1",
            params![id, if pinned { 1 } else { 0 }, Utc::now().to_rfc3339()],
        )?;
        Ok(affected > 0)
    }
}

fn content_hash(input: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(input.to_lowercase().as_bytes());
    format!("{:x}", hasher.finalize())
}

pub fn compute_embedding(text: &str) -> Vec<f32> {
    let mut vec = vec![0.0_f32; EMBEDDING_DIM];
    let lower = text.to_lowercase();
    for token in lower.split(|c: char| !c.is_alphanumeric()).filter(|t| !t.is_empty()) {
        let mut hasher = Sha256::new();
        hasher.update(token.as_bytes());
        let digest = hasher.finalize();
        let idx = (digest[0] as usize) % EMBEDDING_DIM;
        let sign = if digest[1] & 1 == 0 { 1.0 } else { -1.0 };
        vec[idx] += sign;

        if token.len() >= 3 {
            for win in token.as_bytes().windows(3) {
                let mut h = Sha256::new();
                h.update(win);
                let d = h.finalize();
                vec[(d[0] as usize) % EMBEDDING_DIM] += 0.5;
            }
        }
    }
    let norm = vec.iter().map(|v| v * v).sum::<f32>().sqrt();
    if norm > 0.0 {
        for v in &mut vec {
            *v /= norm;
        }
    }
    vec
}

fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    a.iter().zip(b.iter()).map(|(x, y)| x * y).sum::<f32>().clamp(0.0, 1.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stores_and_queries_personal_memory() {
        let store = MemoryStore::open_in_memory().unwrap();
        store
            .upsert_fact(
                MemoryCategory::Preference,
                "User prefers strict flat monochrome UI with zero gradients",
                vec!["ui".into(), "css".into()],
                Some("sess-1"),
                true,
                0.9,
            )
            .unwrap();
        store
            .upsert_fact(
                MemoryCategory::Stack,
                "Primary stack is Rust, Tauri v2, and React 19 TypeScript",
                vec!["rust".into(), "tauri".into()],
                Some("sess-1"),
                false,
                0.8,
            )
            .unwrap();

        let hits = store.query_relevant_context("Tauri Rust UI", 5).unwrap();
        assert_eq!(hits.len(), 2);
        assert!(hits.iter().any(|h| h.entry.content.contains("Rust, Tauri v2")));
    }
}

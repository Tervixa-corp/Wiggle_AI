use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Error)]
pub enum UndoError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("serde error: {0}")]
    Serde(#[from] serde_json::Error),
    #[error("nothing to undo")]
    NothingToUndo,
    #[error("nothing to redo")]
    NothingToRedo,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileSnapshotEntry {
    pub rel_path: String,
    pub before_hash: Option<String>,
    pub after_hash: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnapshotRecord {
    pub id: String,
    pub label: String,
    pub created_at: DateTime<Utc>,
    pub files: Vec<FileSnapshotEntry>,
}

/// Content-addressable snapshot engine stored in `.wiggle/snapshots/` for instant /undo & /redo.
#[derive(Debug, Clone)]
pub struct SnapshotEngine {
    workspace_root: PathBuf,
    snapshot_dir: PathBuf,
    objects_dir: PathBuf,
}

impl SnapshotEngine {
    pub fn new(workspace_root: impl AsRef<Path>) -> Self {
        let root = workspace_root.as_ref().to_path_buf();
        let snapshot_dir = root.join(".wiggle").join("snapshots");
        let objects_dir = snapshot_dir.join("objects");
        Self {
            workspace_root: root,
            snapshot_dir,
            objects_dir,
        }
    }

    fn ensure_dirs(&self) -> Result<(), UndoError> {
        std::fs::create_dir_all(&self.objects_dir)?;
        Ok(())
    }

    fn store_blob(&self, bytes: &[u8]) -> Result<String, UndoError> {
        self.ensure_dirs()?;
        let mut hasher = Sha256::new();
        hasher.update(bytes);
        let hash = format!("{:x}", hasher.finalize());
        let obj_path = self.objects_dir.join(&hash);
        if !obj_path.exists() {
            std::fs::write(obj_path, bytes)?;
        }
        Ok(hash)
    }

    fn load_blob(&self, hash: &str) -> Result<Vec<u8>, UndoError> {
        Ok(std::fs::read(self.objects_dir.join(hash))?)
    }

    fn index_path(&self) -> PathBuf {
        self.snapshot_dir.join("history.json")
    }

    fn load_history(&self) -> Result<SnapshotHistory, UndoError> {
        let path = self.index_path();
        if !path.exists() {
            return Ok(SnapshotHistory::default());
        }
        let raw = std::fs::read_to_string(path)?;
        Ok(serde_json::from_str(&raw)?)
    }

    fn save_history(&self, history: &SnapshotHistory) -> Result<(), UndoError> {
        self.ensure_dirs()?;
        std::fs::write(self.index_path(), serde_json::to_string_pretty(history)?)?;
        Ok(())
    }

    /// Capture before/after hashes for a batch of relative paths and push onto undo stack.
    pub fn record_mutation(
        &self,
        label: impl Into<String>,
        before_states: &BTreeMap<String, Option<Vec<u8>>>,
    ) -> Result<SnapshotRecord, UndoError> {
        let mut entries = Vec::new();
        for (rel, before_bytes) in before_states {
            let before_hash = match before_bytes {
                Some(b) => Some(self.store_blob(b)?),
                None => None,
            };
            let abs = self.workspace_root.join(rel);
            let after_hash = if abs.exists() {
                Some(self.store_blob(&std::fs::read(&abs)?)?)
            } else {
                None
            };
            entries.push(FileSnapshotEntry {
                rel_path: rel.clone(),
                before_hash,
                after_hash,
            });
        }

        let record = SnapshotRecord {
            id: Uuid::new_v4().to_string(),
            label: label.into(),
            created_at: Utc::now(),
            files: entries,
        };

        let mut history = self.load_history()?;
        history.undo_stack.push(record.clone());
        history.redo_stack.clear();
        self.save_history(&history)?;
        Ok(record)
    }

    pub fn undo(&self) -> Result<SnapshotRecord, UndoError> {
        let mut history = self.load_history()?;
        let record = history.undo_stack.pop().ok_or(UndoError::NothingToUndo)?;
        for entry in &record.files {
            let target = self.workspace_root.join(&entry.rel_path);
            match &entry.before_hash {
                Some(h) => {
                    if let Some(parent) = target.parent() {
                        std::fs::create_dir_all(parent)?;
                    }
                    std::fs::write(target, self.load_blob(h)?)?;
                }
                None => {
                    if target.exists() {
                        std::fs::remove_file(target)?;
                    }
                }
            }
        }
        history.redo_stack.push(record.clone());
        self.save_history(&history)?;
        Ok(record)
    }

    pub fn redo(&self) -> Result<SnapshotRecord, UndoError> {
        let mut history = self.load_history()?;
        let record = history.redo_stack.pop().ok_or(UndoError::NothingToRedo)?;
        for entry in &record.files {
            let target = self.workspace_root.join(&entry.rel_path);
            match &entry.after_hash {
                Some(h) => {
                    if let Some(parent) = target.parent() {
                        std::fs::create_dir_all(parent)?;
                    }
                    std::fs::write(target, self.load_blob(h)?)?;
                }
                None => {
                    if target.exists() {
                        std::fs::remove_file(target)?;
                    }
                }
            }
        }
        history.undo_stack.push(record.clone());
        self.save_history(&history)?;
        Ok(record)
    }

    pub fn counts(&self) -> (usize, usize) {
        let h = self.load_history().unwrap_or_default();
        (h.undo_stack.len(), h.redo_stack.len())
    }
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct SnapshotHistory {
    undo_stack: Vec<SnapshotRecord>,
    redo_stack: Vec<SnapshotRecord>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn undo_and_redo_restore_exact_content() {
        let tmp = std::env::temp_dir().join(format!("wiggle_undo_{}", Uuid::new_v4()));
        std::fs::create_dir_all(&tmp).unwrap();
        let file = tmp.join("demo.txt");
        std::fs::write(&file, b"v1").unwrap();

        let engine = SnapshotEngine::new(&tmp);
        let mut before = BTreeMap::new();
        before.insert("demo.txt".into(), Some(b"v1".to_vec()));
        std::fs::write(&file, b"v2").unwrap();
        engine.record_mutation("edit demo", &before).unwrap();

        engine.undo().unwrap();
        assert_eq!(std::fs::read(&file).unwrap(), b"v1");

        engine.redo().unwrap();
        assert_eq!(std::fs::read(&file).unwrap(), b"v2");
        let _ = std::fs::remove_dir_all(&tmp);
    }
}

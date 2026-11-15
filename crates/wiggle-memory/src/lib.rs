//! Personal Memory Engine for Tervixa Wiggle.
//!
//! Combines SQLite + FTS5 lexical indexing with deterministic hashed n-gram vector cosine
//! similarity so personal facts, preferences, and session summaries can be stored and retrieved
//! locally with zero external dependencies.

pub mod extractor;
pub mod store;

pub use extractor::{ExtractedFact, MemoryExtractor};
pub use store::{MemoryCategory, MemoryEntry, MemoryQueryHit, MemoryStore, StoreError};

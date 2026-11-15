---
name: rust-engineer
description: Write idiomatic, safe Rust across async Tokio runtimes, serde models, and Tauri v2 IPC commands.
---

# Rust Engineering Standards

1. Avoid `unwrap()` in production paths; propagate typed errors with `thiserror` or `anyhow`.
2. Keep async locks minimal (`RwLock` / `Mutex` dropped before `.await` where possible).
3. Include unit tests inside `#[cfg(test)] mod tests` for core invariants.

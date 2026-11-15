# Tervixa Wiggle

An early foundation for a cross-platform coding assistant from Tervixa Corporation. This repository currently contains a React workbench preview and a small shared Rust identity library and CLI, **not a production agent**.

## Run the preview

Requires Node.js 20 or newer.

```sh
npm ci
npm run dev
```

The interface supports local, in-memory sessions, a composer, navigation and a persisted dark/light theme. Submitting a message displays a local notice; it does not contact a model. Sessions disappear on reload. No keys or private data are collected.

## Rust foundation

With a Rust toolchain installed:

```sh
cargo test --workspace
cargo run -p wiggle-cli -- --help
cargo run -p wiggle-cli -- identity
```

## Current limitations

No desktop shell, providers, streaming, tools, workspace access, permissions, MCP, memory, skills loading, browser automation, agent orchestration, terminal, release installers or undo/redo are implemented. Settings other than appearance are informational. Do not use the preview for sensitive information or expect autonomous execution. The included skill is an example, not loaded by the application.

## Reference study

The initial structure was informed by inspection of OpenCode's separation of server, desktop, TUI and session UI packages, Codex's separate Rust app-server, protocol and patch crates, and Anthropic's SKILL.md conventions. This is an independent implementation, not a copy or a compatibility claim.

Licensed under the MIT License.

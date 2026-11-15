# Tervixa Wiggle (v1.0.0)

Open-source AI software engineering workbench, desktop shell, and CLI developed by **Tervixa Corporation** (`tervixa.in`).

## Architecture

- **`crates/wiggle-core`**: Rust core engine — Immutable Identity Harness (`identity.rs`), 7-Stage Prompt Compiler (`prompt_compiler.rs`), multi-provider BYOK router (`anthropic`, `openai_compat`, `gemini`), parallel `SwarmOrchestrator` with in-memory `FileCoordinator` file leases, JSON-RPC 2.0 MCP client (`stdio`, `sse`, `streamable_http`), `SKILL.md` registry & importer, plugin lifecycle hooks, workspace-scoped tools, three-tier permission gate, and content-addressable `/undo` + `/redo` snapshots.
- **`crates/wiggle-memory`**: SQLite + FTS5 + hashed n-gram vector cosine personal memory store & per-turn fact extractor.
- **`crates/wiggle-browser`**: URL validation, DOM `[ref=e1]` accessibility tree serializer, console/network log tracking, and element actuation.
- **`crates/wiggle-cli`**: `wiggle` CLI and minimal monochrome Ratatui TUI.
- **`crates/wiggle-desktop` + `apps/desktop-ui`**: Tauri v2 + React 19 flat monochrome workbench featuring multi-tab code & diff editor, file explorer, parallel agent swarm view, built-in browser inspector, workspace terminal, command palette (`Ctrl+K` / `Ctrl+P`), and 10-section Settings Control Center (`Ctrl+,`).
- **`server/`**: Loopback-only local gateway (`127.0.0.1`) serving the React workbench, 7-stage prompt compiler, multi-provider chat routing, workspace file/diff/undo APIs, skills, memory, MCP config, terminal, and browser inspection.

## Run locally (Node gateway + Web Workbench)

```sh
npm ci
npm run build
export WIGGLE_MODEL="gpt-4.1"          # or claude-sonnet-4-5, qwen2.5-coder:14b, etc.
export WIGGLE_API_KEY="your-api-key"   # optional for local Ollama / LM Studio
# Optional: WIGGLE_PROVIDER=anthropic | openai | gemini | ollama | openrouter ...
# Optional: WIGGLE_BASE_URL=http://127.0.0.1:11434/v1
npm start
```

## Build Rust CLI & Tauri Desktop Installers

Requires Rust (`stable`), Node 22+, and platform Tauri prerequisites:

```sh
cargo test -p wiggle-core -p wiggle-memory -p wiggle-browser -p wiggle-cli
bash scripts/package-releases.sh auto
```

## Verify in this repository

```sh
npm test
npm run build
```

Licensed under the MIT License.

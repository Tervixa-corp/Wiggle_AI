# Tervixa Wiggle

An early foundation for a cross-platform coding assistant from Tervixa Corporation. It includes a React workbench and a local, OpenAI-compatible chat gateway. **It is not yet an autonomous coding agent.** A preliminary Tauri desktop shell is included but has not been built or tested here.

## Run the local chat

Requires Node.js 20 or newer. Build the UI, set the provider configuration in your terminal, and start the loopback-only server:

```sh
npm ci
npm run build
export WIGGLE_MODEL="your-model-name"
export WIGGLE_API_KEY="your-provider-key"
# Optional; defaults to https://api.openai.com/v1
export WIGGLE_BASE_URL="https://api.openai.com/v1"
npm start
```

On Windows PowerShell use `$env:WIGGLE_MODEL = "your-model-name"` (and similarly for the other variables). Open the local URL printed by the server. For Ollama's OpenAI-compatible API, use `WIGGLE_BASE_URL=http://127.0.0.1:11434/v1`, set `WIGGLE_MODEL` to a locally installed model, and leave the key unset if your provider does not require one. Compatibility and model names depend on the provider.

The gateway binds only to `127.0.0.1`, rejects cross-origin browser requests and non-loopback Host headers, and keeps the configured API key out of the browser and status response. It sends the conversation and identity instruction to the configured provider. Only use a provider you trust; chat content leaves your machine when using a remote provider. Sessions are in memory and disappear on reload. Do not expose this development server to the public internet.

`npm run dev` starts a UI-only Vite preview; it does not connect to the local chat server. The standalone `preview/wiggle-ui.html` is also an earlier UI-only snapshot.

## Read-only workspace access (optional)

Set `WIGGLE_WORKSPACE` to a project directory to let the local UI browse and read files in that directory. The browsing endpoints are read-only; edits are described below. There are no delete or shell endpoints. Requests are limited to paths inside the workspace; absolute paths, `..` segments, and symlinks that resolve outside the root are rejected. Files that commonly contain credentials (`.env*`, private keys, `.npmrc`, `.netrc`, `.git/`) are never returned, and `node_modules`, `target`, `dist` and `.wiggle` are not listed. Binary files and files over 256 KB are refused. The endpoints are `GET /api/workspace/list?path=` and `GET /api/workspace/file?path=`.

```sh
export WIGGLE_WORKSPACE="/path/to/your/project"
npm start
```

The model is not yet given access to these files.

## Approval-gated edits, diff review, undo and redo

With `WIGGLE_WORKSPACE` set, open a file in the workbench and choose **Edit**. **Review changes** creates a proposal and shows a line diff with one toggle per change. Nothing is written until you choose **Apply**, which writes only the accepted changes. **Reject all** leaves the file unchanged.

- Writes are atomic (temporary file, then rename). Before writing, the server checks that the file still matches the version you proposed, so external changes are never overwritten. Undo and redo check the same way.
- **Undo** and **Redo** (buttons, or Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z outside text fields) step through applied edits.
- Edits are limited to UTF-8 text files up to 128 KB. Excluded paths (secrets, `.git`, `node_modules`, `target`, `dist`, `.wiggle`), symlinks that leave the workspace, and binary files are refused.
- Undo history and pending proposals are held in memory and are lost when the server restarts. They are not yet written to `.wiggle/snapshots/`.
- Only you can apply edits. The agent can propose edits (`propose_edit`), but nothing is written until you approve it, unless you select the `auto-edit` mode, which applies each edit immediately and keeps it undoable.

Endpoints (all same-origin, loopback only): `GET /api/edits`, `POST /api/edits` (`{path, content}`), `POST /api/edits/:id/approve` (`{hunks}`), `POST /api/edits/:id/reject`, `POST /api/edits/undo`, `POST /api/edits/redo`.

## Rust core and CLI

`crates/wiggle-core` (no external dependencies) provides the identity header, a prompt compiler, a `SKILL.md` loader with keyword matching, project instruction loading (`WIGGLE.md`, `CLAUDE.md`, `AGENTS.md`, `.cursorrules`), a workspace path validator, and an Allow / Ask / Deny tool policy. The compiler implements the identity, environment, project-instruction and skill stages. Memory, MCP tools, lifecycle hooks and agent routing are not implemented, and the compiler does not include them.

```sh
cargo run -p wiggle-cli -- identity
cargo run -p wiggle-cli -- skills --dir bundled-skills
cargo run -p wiggle-cli -- prompt "review my security change" --dir .
```

Rust tests: `cargo test -p wiggle-core -p wiggle-cli`. CI also runs `cargo fmt --check` and clippy with warnings denied for these crates.

## Desktop preview installers

The manually triggered **Build preview installers** GitHub Actions workflow attempts to build platform-specific Tauri UI-only installers and CLI binaries and uploads them as workflow artifacts with checksums. This workflow has not yet been verified. The desktop shell does **not** include or connect to the local Node chat gateway; it is a UI preview only. These builds are unsigned, and platform security warnings may appear. No installer binaries are included in the repository.

## Test

```sh
npm test
npm run build
cargo test --workspace  # requires Rust
```

## Current limitations

Agent tools (Phase A): `POST /api/agent` runs a tool loop with `list_dir`, `read_file`, `search_text` (read-only, inside the workspace, secrets excluded) and `propose_edit`. The loop is capped at 8 steps. Shell, network and other tools are not enabled. The agent UI (tool steps, pending proposals, mode switch) is not built yet (Phase B).

Not implemented yet: the agent UI, parallel agents, MCP, memory, provider routing beyond one OpenAI-compatible endpoint, the built-in browser, the integrated terminal, Monaco, the full settings panel, plugin hooks, persistent undo history, and signed installers. The desktop shell does not yet connect to the Node gateway or the Rust core. The `wiggle-desktop`, `wiggle-memory` and `wiggle-browser` crates are not part of this build. The Rust workspace also includes `wiggle-desktop`, which needs crates.io access to resolve its Tauri dependencies.

## Reference study

See [docs/reference-study.md](docs/reference-study.md) for the sources inspected and the resulting boundaries. This is an independent implementation, not a copy or a compatibility claim.

Licensed under the MIT License.

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

Set `WIGGLE_WORKSPACE` to a project directory to let the local UI browse and read files in that directory. It is read-only: there are no write, edit, delete or shell endpoints. Requests are limited to paths inside the workspace; absolute paths, `..` segments, and symlinks that resolve outside the root are rejected. Files that commonly contain credentials (`.env*`, private keys, `.npmrc`, `.netrc`, `.git/`) are never returned, and `node_modules`, `target`, `dist` and `.wiggle` are not listed. Binary files and files over 256 KB are refused. The endpoints are `GET /api/workspace/list?path=` and `GET /api/workspace/file?path=`.

```sh
export WIGGLE_WORKSPACE="/path/to/your/project"
npm start
```

This is a foundation for later permission-gated editing; the model is not yet given access to these files.

## Desktop preview installers

The manually triggered **Build preview installers** GitHub Actions workflow attempts to build platform-specific Tauri UI-only installers and CLI binaries and uploads them as workflow artifacts with checksums. This workflow has not yet been verified. The desktop shell does **not** include or connect to the local Node chat gateway; it is a UI preview only. These builds are unsigned, and platform security warnings may appear. No installer binaries are included in the repository.

## Test

```sh
npm test
npm run build
cargo test --workspace  # requires Rust
```

## Current limitations

Chat is non-streaming and uses only the OpenAI-compatible chat completions protocol. There is no persistence, integrated desktop backend, model tool execution, file editing, permissions prompts, MCP, memory, skill loading, browser automation, agent orchestration, terminal, release installers or undo/redo. The Rust workspace contains only a minimal identity library and CLI; the chat gateway is currently Node.js. Settings other than appearance are informational. The bundled skill is an example and is not loaded by the application.

## Reference study

See [docs/reference-study.md](docs/reference-study.md) for the sources inspected and the resulting boundaries. This is an independent implementation, not a copy or a compatibility claim.

Licensed under the MIT License.

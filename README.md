# Tervixa Wiggle

A local-first coding agent workbench from Tervixa Corporation. It runs a small
agent server on your machine, calls the model provider **you** configure with
**your own key**, and lets that model read, edit and run things inside a single
workspace directory — behind a permission gate it cannot bypass.

The interface is a flat, monochrome workbench: chat with inline tool execution,
a file tree, a diff review pane, a command log, and a status bar. No gradients,
no accent colours, no marketing chrome.

This is version 0.2.0. It is a working agent, not a finished product; the
[scope](#what-is-not-implemented) section below is deliberately blunt.

## What it actually does

- **Agent loop.** A bounded ReAct cycle: the model asks for a tool, Wiggle asks
  you (when policy requires it), runs the tool inside the workspace, feeds the
  result back, and repeats until it answers or hits the step budget.
- **Seven tools.** `list_dir`, `read_file`, `glob`, `grep`, `write_file`,
  `edit_file`, `run_command`. Tool output is truncated, binary files are
  refused, and `edit_file` fails rather than editing the wrong occurrence.
- **Permission gate.** Read-only tools are allowed; writes and commands follow
  the active preset (`readonly`, `standard`, `full`). Anything needing approval
  pauses mid-stream and asks in the UI. Destructive commands are screened even
  when commands are enabled.
- **Workspace sandbox.** Every path is workspace-relative. Traversal, absolute
  paths and symlinks that point outside the root are rejected — including a
  symlinked parent of a file that does not exist yet.
- **Undo and redo.** Each turn records before/after content of every file it
  touched, in content-addressed snapshots under `.wiggle/`. One click restores
  the previous state.
- **Prompt compiler.** Seven stages: immutable identity and environment,
  personal memory, project instructions (`WIGGLE.md`, `CLAUDE.md`, `AGENTS.md`,
  `.cursorrules`), matched `SKILL.md` skills, enabled tools, mode rules, routing.
- **Providers.** OpenAI-compatible chat completions (OpenAI, OpenRouter, Groq,
  DeepSeek, Together, Fireworks, Cerebras, Ollama, LM Studio, vLLM and friends)
  and the native Anthropic Messages API. Both stream and both support tool calls.
- **Personal memory.** Facts you store are retrieved by lexical overlap and
  injected into matching prompts.

## Quick start

Requires **Node.js 22 or newer**.

```sh
npm ci
npm run build

export WIGGLE_API_KEY="your-key"          # PowerShell: $env:WIGGLE_API_KEY = "..."
export WIGGLE_MODEL="your-model"
export WIGGLE_WORKSPACE="$PWD"            # the directory the agent may touch

npm start                                  # http://127.0.0.1:4317
```

Open the printed URL. Without `WIGGLE_MODEL` the workbench still runs — you can
browse files, read the loaded skills, and manage memory — but sending a task is
disabled rather than silently failing.

For a local model through Ollama's OpenAI-compatible API:

```sh
export WIGGLE_BASE_URL="http://127.0.0.1:11434/v1"
export WIGGLE_MODEL="qwen2.5-coder"        # any model you have pulled
export WIGGLE_API_KEY=""                    # optional for local servers
```

`npm run dev` starts Vite with hot reload and proxies `/api` to
`http://127.0.0.1:4317` (override with `WIGGLE_ORIGIN`).

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `WIGGLE_API_KEY` | *(empty)* | Provider key. Stored server-side only; never sent to the browser. |
| `WIGGLE_MODEL` | *(empty)* | Model name. Chat is disabled while this is unset. |
| `WIGGLE_BASE_URL` | provider default | Must be HTTPS, or plain HTTP on loopback. Credentials, query strings and fragments are rejected. |
| `WIGGLE_API` | `openai` | `openai` (OpenAI-compatible) or `anthropic` (native Messages API). |
| `WIGGLE_WORKSPACE` | current directory | The only directory the agent may read or write. |
| `WIGGLE_PERMISSIONS` | `standard` | `readonly`, `standard` (ask before writes and commands) or `full`. |
| `WIGGLE_MAX_STEPS` | `8` | Model↔tool round trips per message, 1–30. |
| `WIGGLE_PORT` | `4317` | HTTP port. |
| `WIGGLE_HOST` | `127.0.0.1` | Bind address. Keep it loopback unless you have a reason. |
| `WIGGLE_ALLOWED_HOSTS` | *(empty)* | Extra `Host` values accepted, comma separated. A leading dot matches a suffix (`.example.com`). Needed only behind a proxy. |

Wiggle adds a signed-in identity to every request, so the model answers as
Tervixa Wiggle regardless of which provider is bound. That text is compiled in,
not configurable.

## Undo, diffs and terminals

Every file the agent writes is snapshotted per turn. The right-hand panel shows
live telemetry, the command log with exit status, and an embedded browser you
can point at a local dev server. Tool results that change files carry the
before/after content, so **Review diff** shows exactly what changed in a
red/green review pane before you undo it.

## Testing

```sh
npm test            # unit + integration, real sockets, fake upstream provider
npm run test:render # renders the real components headlessly (catches blank screens)
npm run build       # type check + production bundle
npm run verify      # all three
```

The suite covers the security boundaries directly: traversal and symlink escape,
host and origin rejection, permission denial and timeout, credential redaction
from upstream errors, step-budget exhaustion, and undo/redo invariants.

## Security model

- Binds to loopback by default and rejects cross-origin and foreign-`Host`
  requests (DNS-rebinding defence). Widening the allowlist is an explicit opt-in.
- The API key never leaves the server. Error text from a provider is redacted of
  the configured key before it can reach the browser.
- The agent cannot escape the workspace root, and cannot act without a decision
  from the gate. Denials are final for that call and are reported to the model.
- `run_command` runs with a minimal environment and a timeout, and is screened
  for destructive patterns independently of your approval.
- Your prompt and the files the agent reads are sent to whichever provider you
  configure. Do not use a remote provider for code you cannot share.

## What is not implemented

Stated plainly, because a roadmap is not a feature:

- **No MCP.** No stdio, SSE or Streamable HTTP client; no `mcpServers` config is read.
- **No parallel agents.** One agent per session. No swarm, no file leases, no subagents.
- **No agentic browser.** The browser pane is yours to drive; the agent cannot
  read or click inside it.
- **No plugins or lifecycle hooks.** No `PreToolUse`/`PostToolUse`/`Stop` hooks.
- **No embedding memory.** Retrieval is keyword overlap, not vectors; facts are
  added manually, not extracted from conversations.
- **No Monaco.** The editor and diff viewer are lightweight, read-only renderers.
- **No git integration.** Wiggle never commits or pushes.
- **Rust and Tauri are not the running product.** `crates/wiggle-core` holds the
  shared identity constant and `crates/wiggle-cli` a small CLI; the desktop shell
  is a Tauri scaffold that is not wired to the agent server. The working agent is
  the Node server in `server/`. This is a real inconsistency with the target
  architecture and is called out rather than hidden.
- **Installers are not published.** `.github/workflows/release.yml` attempts a
  cross-platform Tauri build and is unverified; no binaries are committed.

Sessions live in memory and are lost when the page reloads.

## Repository layout

```
server/            agent core: workspace, tools, permissions, snapshots,
                   providers, prompt compiler, memory, skills, HTTP + SSE
apps/desktop-ui/   React 19 + TypeScript workbench (Vite)
crates/            Rust identity/CLI/desktop scaffold (not the running agent)
bundled-skills/    SKILL.md starter library, loaded at startup
test/              unit, integration, and headless render tests
docs/              architecture notes and reference study
scripts/           release collection and the render smoke test
```

See [docs/architecture.md](docs/architecture.md) for the request lifecycle and
event protocol, and [docs/reference-study.md](docs/reference-study.md) for the
sources studied and the boundaries of that study.

## License

MIT. See [LICENSE](LICENSE).

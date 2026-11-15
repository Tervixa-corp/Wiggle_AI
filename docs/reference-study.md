# Reference study and implementation boundaries

The implementation studied shallow clones of OpenCode (`anomalyco/opencode`),
Codex (`openai/codex`), and Anthropic's `skills` repository. The clones were
temporary, lived outside the repository, and no reference code was copied.

- OpenCode separates server routes, session execution, providers, permissions,
  MCP, plugins, filesystem, PTY and frontends. That suggested a shared service
  boundary rather than one agent implementation per interface — Wiggle follows
  this with a single HTTP agent server serving one UI.
- Codex separates the app-server protocol from agent logic, execution policy and
  patch application. That reinforces keeping model communication separate from
  approval and execution, which is the `providers.mjs` / `permissions.mjs` /
  `tools.mjs` split.
- Anthropic's skill examples use a `SKILL.md` with YAML frontmatter and task
  instructions. Skills are instructional content, not a substitute for
  executable permission checks. Wiggle's skills can change what the model tries;
  they cannot change what the gate allows.

Cursor, Google Antigravity and the proprietary parts of Claude Code were not
cloned or reverse-engineered. No parity with them is claimed. Their public
descriptions informed layout and the long-term roadmap only.

## What the study actually produced

| Reference mechanic | Status in this repository |
| --- | --- |
| Client/server split with one agent core | Implemented (`server/` + `apps/desktop-ui/`) |
| Streaming chat with tool calls | Implemented (SSE, two providers) |
| Granular permission gates | Implemented (presets, ask/allow/deny, command screening) |
| Workspace-confined filesystem tools | Implemented with traversal and symlink tests |
| Snapshot undo/redo | Implemented (content-addressed, per turn) |
| `SKILL.md` loading and matching | Implemented (lexical matching, not semantic) |
| Project instruction injection (`WIGGLE.md`, `CLAUDE.md`, `AGENTS.md`) | Implemented |
| Personal memory across sessions | Partial: manual facts, lexical retrieval, no extraction |
| MCP tools/resources/prompts | Not implemented |
| Plugin lifecycle hooks | Not implemented |
| Parallel agents / swarm orchestration | Not implemented |
| Agentic browser (DOM actuation, a11y tree) | Not implemented |
| Monaco editor | Not implemented (lightweight read-only renderer) |
| Native Tauri shell wired to the core | Not implemented (scaffold only) |
| Cross-platform installers | Workflow exists, unverified, no binaries committed |

## Deliberate departures

- The agent core is the Node server, not `wiggle-core`. The Rust crates hold the
  shared identity constant and a small CLI. This is stated in the README rather
  than presented as a completed port.
- No MCP, plugin or browser-automation surface is exposed at all, because a
  disabled toggle implies an implementation that does not exist.
- Destructive shell patterns are denied before the approval prompt, so a user
  tapping "Allow" cannot accidentally authorise them.

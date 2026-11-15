# Reference study and implementation boundaries

The first implementation studied shallow clones of OpenCode (`anomalyco/opencode`), Codex (`openai/codex`), and Anthropic's `skills` repository. The clones were temporary and no reference code was copied.

- OpenCode separates server routes, session execution, providers, permissions, MCP, plugins, filesystem, PTY, and frontends. This suggests a shared service boundary rather than separate agent implementations for each interface.
- Codex separates app-server protocol and transports, agent/core logic, execution policy, patch application, MCP and the TUI. This reinforces keeping model communication separate from approval and tool execution.
- Anthropic's skill examples use a `SKILL.md` with YAML frontmatter and task instructions. Skills are instructional content, not a substitute for executable permission checks.

Cursor, Google Antigravity, and Claude's proprietary application implementations were not cloned or reverse-engineered. No parity with them is claimed. Public product descriptions motivated the workbench layout and longer-term roadmap only.

## Implemented slice

A Node.js local server serves the existing React UI and exposes a small chat endpoint. It reads provider settings from the server environment, injects the assistant identity, validates roles and conversation size, and makes a single non-streaming OpenAI-compatible request. A UI-only static build remains usable without a backend.

## Next boundaries

Before autonomous edits, implement a shared engine and explicit approval model, scoped filesystem operations, robust cancellation and streaming, audit logs and tests for path traversal and symlink escapes. MCP servers, plugins, shell processes and browser automation must be treated as untrusted; they are not enabled in this slice. Migration of the temporary Node gateway to the Rust core remains outstanding.

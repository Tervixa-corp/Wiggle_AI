# Architecture

One process serves both the workbench and the agent API. There is no separate
worker, no database, and no background daemon: state lives in the workspace and
in `.wiggle/`.

```
browser (React workbench)
   │  POST /api/chat  ───────────────►  server/app.mjs
   │  ◄── SSE event stream ──────────   └── agent.mjs (ReAct loop)
   │                                        ├── prompt.mjs  (7-stage compiler)
   │                                        ├── providers/  (OpenAI-compat, Anthropic)
   │                                        ├── permissions.mjs (gate)
   │                                        ├── tools.mjs   (7 tools)
   │                                        ├── snapshots.mjs (undo/redo)
   │                                        └── memory.mjs / skills.mjs
   │  POST /api/approvals/:id ───────►  resolves the paused tool call
```

## A single turn

1. **Validate.** The client sends the conversation. `system` roles are rejected;
   the last message must be from the user. The client cannot inject a system
   prompt.
2. **Compile.** `compilePrompt` assembles seven stages and returns the system
   string plus a report of which stages applied. The identity stage is a
   constant in the source.
3. **Call the model.** The provider adapter streams text deltas and tool calls.
   Deltas are forwarded to the browser as they arrive.
4. **Gate each tool call.** `PermissionGate.request` resolves the policy for that
   tool: `allow`, `ask`, or `deny`. `ask` emits an `approval_request` event and
   awaits `POST /api/approvals/:id`, defaulting to deny on timeout or disconnect.
   Denied calls are reported to the model as text it must not retry.
5. **Execute inside the sandbox.** `Workspace.resolve` confines every path;
   mutating tools record before/after content with the turn recorder.
6. **Loop.** Tool results are appended and the model is called again, up to
   `WIGGLE_MAX_STEPS`.
7. **Commit.** The recorder writes a content-addressed snapshot, so `/undo`
   can restore the turn atomically. An interrupted turn still commits whatever
   landed.

## Event protocol

Server-sent events, one JSON object per `data:` frame. Comment frames (`: ping`)
are sent every 15 seconds to keep idle connections open.

| Event | Meaning |
| --- | --- |
| `compile` | The seven stages and whether each applied. |
| `step` | Step number of the loop. |
| `text` | A streamed text delta. |
| `tool_call` | The model requested a tool, with parsed input. |
| `approval_request` | A tool is paused awaiting the user's decision. |
| `tool_result` | Output, success flag, duration, and any file mutation. |
| `notice` | Non-fatal information, such as hitting the step budget. |
| `done` | Final step count, usage, touched files, snapshot id. |
| `error` | Terminal failure with a redacted message. |
| `end` | Stream complete. |

## Storage

| Path | Contents |
| --- | --- |
| `.wiggle/snapshots/*.json` | Per-turn manifest of touched files. |
| `.wiggle/blobs/<sha256>` | File contents, deduplicated by hash. |
| `.wiggle/state.json` | Undo and redo stacks. |
| `.wiggle/memory.json` | Personal facts. |
| `.wiggle/skills/` | Workspace-scoped skills. |

All of it is plain files, readable and deletable without the app. Add `.wiggle/`
to `.gitignore`; this repository already does.

## Trust boundaries

- **Browser → server.** Loopback `Host` by default; `Origin`, when present, must
  match. Both checks are skipped only for hosts you explicitly allowlist.
- **Server → provider.** The key is added server-side. Response bodies that
  reach the client are redacted of the key.
- **Model → filesystem.** Nothing reaches disk without passing the gate and
  `Workspace.resolve`. File content returned to the model is data, and the
  prompt says so, but the gate — not the prompt — is the enforcement point.
- **Tool output → model.** Truncated and clamped, because it is the easiest
  channel for injected instructions.

## Why Node rather than the Rust crates

The Rust workspace in `crates/` is a scaffold. The running agent is the Node
server, which is where the tests, the sandbox and the permission model live.
Porting it to `wiggle-core` is the intended direction; until that work exists,
saying otherwise would misrepresent the codebase.

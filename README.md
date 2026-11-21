# Tervixa Wiggle (v1.0.0)

Local-first AI software engineering workbench developed by **Tervixa Corporation** (`tervixa.in`).

One loopback Node gateway serves the React workbench **and** the whole agent runtime: provider streaming,
permissioned workspace tools, snapshots, skills, plugins, MCP connectors, terminal and browser inspection.
There is no cloud component and no account system. Model traffic goes directly from your machine to the
provider you configure with your own key.

## Install on Windows

Both installers are self-contained: they ship the Node runtime, the gateway, the built workbench, the
catalogs and the bundled skills, so the target machine needs neither Node nor a terminal.

| File in `releases/` | Installs | Needs admin |
|---|---|---|
| `Tervixa-Wiggle-1.0.0-Setup.exe` | Per-user under `%LOCALAPPDATA%\Programs\Tervixa Wiggle`. Own native window (C# + WebView2). | No |
| `Tervixa Wiggle_1.0.0_x64_en-US.msi` | Machine-wide MSI built by the Tauri bundler. | Yes |

They are **alternatives**, not companions — install one. Both start the bundled gateway as a hidden child
process and show the workbench in a native window; closing the window stops the gateway. Nothing opens in
your browser and no server is left running.

Rebuild them with:

```sh
powershell -ExecutionPolicy Bypass -File scripts/build-installer.ps1   # Setup.exe (needs NSIS + csc)
powershell -ExecutionPolicy Bypass -File scripts/build-msi.ps1         # MSI (needs Rust + WiX)
```

The MSI build needs `windres` and `gcc` from the **same** MinGW installation. On a
`x86_64-pc-windows-gnu` host a mixed PATH fails with `cannot execute 'cc1'`, so
`scripts/build-msi.ps1` prepends `C:\Users\Remya\w64devkit\bin` (`-W64Devkit` to override).
The first run also downloads the WiX toolset.

The MSI payload is staged from the same `packaging/stage` tree as the EXE, so both installers ship
identical runtime files.

## Run it

Requirements: Node 20+ (tested on Node 26), npm.

```sh
npm install
npm run build
npm start
```

Open <http://127.0.0.1:4317>. Then open **Settings → Models**, pick a provider, paste its API key,
click **Save key**, choose a model and press **Test connection**. Keys are written to
`~/.wiggle/settings.json` with owner-only permissions and are never returned to the browser.

Environment overrides: `WIGGLE_PORT` (default `4317`), `WIGGLE_WORKSPACE` (default: repository root),
`WIGGLE_CONFIG_DIR` (default: `~/.wiggle`).

### Tests

```sh
npm test     # 22 integration tests against a real loopback gateway and a mock provider
npm run build
```

The suite covers SSE streaming, prompt compilation, identity injection, secret redaction, cross-origin
rejection, path traversal, undo/redo, the terminal screen, browser extraction, skills, memory, the approval
gate, the swarm planner, the Anthropic protocol, runtime skill installation and MCP registration, and the
provider/plugin/connector catalogs.

## What works

**Providers.** The catalog contains **329 providers / 10,086 models**. Four wire protocols cover them:
OpenAI Chat Completions (`chat`), OpenAI Responses (`responses`), Anthropic Messages (`anthropic`) and
Google Gemini (`gemini`). Providers without a public route can be configured with a custom protocol and
base URL. Endpoints must be HTTPS, or plain HTTP on loopback. Keys in environment variables remain a
fallback for headless runs.

**Chat.** `POST /api/chat` streams Server-Sent Events: compilation stages, steps, text deltas, tool calls,
tool results, approval requests, notices, the final summary and errors. The agent loop is bounded
(8 steps by default, 6 tool calls per step). Turns can be stopped, and every turn commits a snapshot so
its file changes are undoable. Modes: `agent`, `plan` (read-only), `ask` (no tools), plus the swarm planner.

**Prompt compiler.** Seven explicit stages: immutable identity, environment, personal memory, project
instructions (`WIGGLE.md`, `CLAUDE.md`, `AGENTS.md`, `.cursorrules`), matched `SKILL.md` skills, the tools
enabled by policy, and mode rules. The identity stage always answers as *Tervixa Wiggle, developed by
Tervixa Corporation*.

**Permissions.** Policy is deny-by-default. `suggest` auto-allows reads and asks for writes and commands;
`auto_edit` auto-allows edits and asks for commands; `full_auto` allows everything except the destructive
command screen. A denial is final for that call. The terminal refuses root deletion, privilege escalation,
disk formatting, host power control, download-piped-to-shell, fork bombs and world-writable root paths.

**Workspace.** File tree, multi-tab editor with dirty tracking and diff review, save, and transactional
undo/redo snapshots under `.wiggle/`. Path traversal outside the workspace is rejected. Clean editor tabs
re-read from disk after agent turns, terminal commands and undo/redo.

**Extensions.**
- **Plugins:** 316 entries from the official Claude plugin marketplace, installed per file from GitHub
  (jsDelivr listing + raw downloads) and uninstalled cleanly. Installed plugins can contribute skills,
  commands and agents; their commands appear in the `/` menu.
- **Connectors:** 126 catalog entries. **49** have a public remote MCP endpoint and can be added, toggled,
  inspected and removed. **77** are vendor-hosted OAuth products with no public MCP URL, so the UI explains
  that and links to their documentation instead of pretending to install them.
- **Skills:** Markdown instructions only, never executable. Bundled skills, workspace skills under
  `.wiggle/skills/`, and skills shipped by installed plugins. Each can be enabled or disabled.
- **Workstation:** git worktrees (list, create on its own branch, remove), pull-request comparison,
  a WSL/remote probe, and a local usage ledger for tokens and sessions.

**Other panes.** Memory facts (pinned or not, lexically retrieved), readable browser extraction over
HTTP(S), terminal, and a command palette. Settings has 21 sections in three groups: Preferences
(General, Appearance, Notifications, Usage, Privacy, Import & export), This computer (System, Browser,
Editor, Terminal, Worktrees, Pull requests, WSL & remote) and Customize (Models, Agents, Permissions,
Plugins, Skills, Memory, Shortcuts, About). Appearance covers light/dark chrome and syntax themes, fonts,
density and contrast.

## Architecture

```
apps/desktop-ui/   React 19 + Vite workbench (flat monochrome, 4–6px radii)
server/            Loopback gateway: HTTP API, SSE chat, agent loop, providers, tools
catalog/           providers.json (329), extensions.json (316), connectors.json (126)
bundled-skills/    SKILL.md files shipped with the app
test/              Integration tests (node:test)
crates/            Standalone Rust engine, memory, browser, CLI and Tauri shell
```

The UI talks to the gateway over loopback HTTP and SSE. It does not use Tauri `invoke` commands, so the
same build runs in a browser, in the Tauri window, or against a gateway on another loopback port.

### Desktop window

The Tauri v2 shell starts the gateway from bundled resources with the shipped Node runtime, waits for it
to answer on `127.0.0.1:4317`, loads that origin in a native window, and stops the gateway when the app
exits:

```sh
npm run desktop        # needs Rust stable + platform Tauri prerequisites
```

`npm run desktop:build` produces the MSI, but the crate's resources must be staged first:
`scripts/build-installer.ps1` builds the payload and `scripts/stage-tauri.mjs` copies it into
`crates/wiggle-desktop/resources` (git-ignored). The Rust crates also build as a separate engine and CLI
and are not used by the web runtime.

## Known limits (explicit)

- Hosted-only connectors (Gmail, Slack, Microsoft 365, …) cannot be installed directly: they expose no
  public MCP endpoint. Their catalog cards link to official documentation.
- MCP OAuth authorization is not implemented. Remote servers work with a token or no auth; stdio servers
  are stored but not spawned or inspected.
- Connector tools are not yet exposed to the model. Connectors can be added, enabled and inspected, but the
  agent cannot call their tools.
- The browser pane extracts readable text and console notes. It does not render the page or expose a DOM
  accessibility tree.
- The swarm view plans 3–5 roles with the model. Each card dispatches a focused chat turn; there is no
  parallel executor or file-lease coordinator in the runtime.
- Real streaming and tool calls require a provider key. Without one the API returns a clear
  `not_configured` error.
- Verified on Windows. macOS and Linux are not yet tested.

## Security

Loopback bind only; DNS-rebinding and cross-origin browser requests are rejected. Credentials never leave
`settings.json` (masked in the API). Upstream error bodies are redacted before display. Tools are guarded
by the permission gate and the workspace boundary; the terminal is screened independently of approvals.
Snapshots make file changes reversible.

## License

MIT. Developed by Tervixa Corporation.

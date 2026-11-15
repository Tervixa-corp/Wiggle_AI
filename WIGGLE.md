# Wiggle project guidance

This file is both the project's own contribution rules and a live example of the
`<project_instructions>` stage that the prompt compiler injects.

## Design

Keep the workbench flat and monochrome. No gradients, no glow shadows, no accent
hues, radius no larger than 4px on controls (6px on modals). Every pane is
separated by a 1px hairline.

## Agent safety invariants

These are non-negotiable and each one must keep a test:

1. Every path is resolved against the workspace root; traversal and symlink
   escapes are rejected, including through a symlinked parent directory.
2. No tool with a side effect runs without passing `PermissionGate`. A denied
   call is final and is reported to the model.
3. Credentials never reach the browser. Provider error bodies are redacted
   before they are forwarded.
4. Requests are loopback-only unless a host allowlist is configured explicitly.
5. Tool output is untrusted data and is truncated before it re-enters the model.

## Documentation honesty

Do not describe behaviour the code does not have. When something is a scaffold,
say so in the README's "What is not implemented" section rather than listing it
as a feature.

## Verification

- JavaScript changes: `npm test`, `npm run test:render`, `npm run build`.
- Rust and Tauri changes additionally need a Rust toolchain and platform
  prerequisites; note in the change description if you could not run them.
- New agent behaviour needs a test that fails without the change, including the
  denial and error paths.

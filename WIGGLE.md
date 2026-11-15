# Wiggle project guidance

Keep the workbench flat and monochrome. Never add gradients or decorative glow.

The local gateway is loopback-only. Do not expose credentials to the browser, trust arbitrary provider URLs from requests, or enable filesystem and shell tools without explicit permissions and security tests. Be explicit in the UI and documentation about functionality that is not implemented.

Run `npm test` and `npm run build` for JavaScript changes. Rust and Tauri changes additionally require a Rust toolchain and platform prerequisites.

# Tervixa Wiggle

Wiggle is a monochrome workbench for discussing code, reviewing a text file you attach, and using a model you choose. The hosted preview is static. The local gateway enables live model requests and MCP inspection.

## Run locally

Requires Node.js 22 or newer. From the repository root:

```sh
npm ci
npm run build
npm start
```

Open `http://127.0.0.1:4317`, then choose **Settings → Providers**. Select a provider and model, enter your API key if needed, and click **Test and connect**. This makes a short request to the model (which may incur costs); Wiggle switches the active connection only after it gets a valid reply. A key entered here stays in server memory and is cleared on restart or when you restore the startup default. It is not saved in browser storage. Only one model is active across the local workbench at a time.

The catalog includes Models.dev providers from the pinned OpenCode snapshot plus local presets. Direct routes support OpenAI-style Chat Completions and Responses, Anthropic Messages, and Gemini GenerateContent. The catalog is not an entitlement or a verification that every vendor route currently works. Providers with subscription sign-in, cloud-signed requests, additional headers, or unsupported protocols may require manual setup. OpenAI API billing, for example, is separate from ChatGPT subscription login.

### Configure a startup default or custom gateway

Set these variables in your terminal before `npm start` (PowerShell: `$env:WIGGLE_MODEL = "..."`). Do not add secrets to this repository or enter them into the hosted preview.

| Variable | Purpose |
| --- | --- |
| `WIGGLE_MODEL` | Exact model ID on the provider or local service. |
| `WIGGLE_API_KEY` | API key for the configured endpoint, if required. |
| `WIGGLE_PROTOCOL` | `chat` (default), `responses`, `anthropic`, or `gemini`. |
| `WIGGLE_BASE_URL` | Optional API base URL, not a full operation path. HTTPS is required except on loopback. |
| `WIGGLE_PORT` | Local server port (defaults to `4317`). |

For a local Ollama instance, use `WIGGLE_BASE_URL=http://127.0.0.1:11434/v1`, `WIGGLE_PROTOCOL=chat`, and a model you have already installed. To use an OpenAI-style gateway for providers without built-in authentication, set its base URL, model ID, and key. Keep Wiggle on loopback. Do not expose this server or proxy its API publicly. The gateway sends your conversation, optional instructions, and the current attachment/skill to the provider you select.

### Plugins, connectors, and skills

- **Connectors:** **Add** saves an entry to your library. Supported entries can then be tested against a configured endpoint. A successful test lists tool, resource, and prompt names; it does not run tools or read resources. Use the vendor's documented authorization flow to obtain the correct credentials and set the displayed `WIGGLE_MCP_*_TOKEN` variable locally. Wiggle does not implement interactive OAuth or token refresh. Connector scope and protocol availability depend on the vendor and token.
- **MCP Registry:** Search the live public registry using the local gateway. Results are metadata, not verified or auto-installable software. You can bookmark listings in **My library**.
- **Custom MCP:** For an endpoint you trust, set `WIGGLE_MCP_SERVERS` to a JSON array and restart the gateway. Streamable HTTP (`http`) and legacy SSE (`sse`) can be inspected. Example (no credentials shown):

  ```sh
  export WIGGLE_MCP_SERVERS='[{"id":"team-docs","name":"Team docs","url":"https://your-mcp.example/mcp","transport":"http","tokenEnv":"WIGGLE_MCP_TEAM_DOCS_TOKEN"}]'
  ```

  Omit `tokenEnv` for a server that does not require a token. Browser users cannot supply arbitrary server URLs to the test endpoint. Do not point connectors at untrusted endpoints. Local stdio packages are not launched by Wiggle.
- **Claude marketplace:** Public manifest entries can be bookmarked. Each bookmarked entry shows the vendor's Claude Code installation command. Wiggle does not install or execute third-party Claude bundles. ChatGPT apps remain installed and authorized inside ChatGPT; use the directory link to find them.
- **Skills:** Install Wiggle's review starter or import a trusted `SKILL.md` (up to 16 KB, with a `name` in YAML frontmatter). A skill is Markdown text, not executable code. Review the instructions and select a skill in the composer when you want to send it. Anthropic skill listings link to the upstream content and license; Wiggle does not bundle or auto-import them.

### Sessions and preview

Chat history is stored unencrypted in this browser by default. Disable storage or clear chats in **Settings → Privacy & history**. File and skill contents sent with a turn are not copied into the saved transcript or automatically re-sent, though the model's reply may quote them. Skills you import and settings you choose are saved separately in browser storage. Only attach non-secret text files you intend to share with the selected model.

`npm run dev` starts the UI-only Vite preview. The same limitations apply to static deployment builds and the Tauri preview shell: they have no local gateway, provider authentication, or MCP testing. `preview/wiggle-ui.html` is an older standalone snapshot. Desktop installers and Rust CLI changes were not part of this work. Wiggle does not run autonomous agents, shell commands, browser automation, Git actions, or MCP tool calls.

## Testing and source updates

```sh
npm test
npm run build
```

Integration tests exercise the model request shapes and MCP discovery using fixtures. They do not verify provider accounts or send paid requests. See [the reference study](docs/reference-study.md) for the upstream sources, catalog refresh, and implementation gaps.

Licensed under the MIT License. Upstream catalog names and descriptions retain their upstream provenance; see the reference study.

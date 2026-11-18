# Wiggle integration research

## Project and design references

- The attached master prompt describes a larger Rust/Tauri IDE and CLI. The first Drive folder contains a related source backup; its README describes a later workspace/edit experiment that is not in the checked-out branch. This implementation builds on the current branch rather than importing or replacing it with that backup.
- The second Drive folder contains the provider-list and coding-app screenshot archives. The relevant patterns are searchable provider/model lists, grouped settings navigation, separate discover/library experiences, and opt-in add controls. Some provider screenshots show a gateway directory rather than OpenCode's model catalog. They are visual references, not the source of service URLs or permissions. No private screenshots are included in the repository.
- Reviewed shallow upstream checkouts for [OpenCode](https://github.com/anomalyco/opencode), [Codex](https://github.com/openai/codex), [Claude marketplace](https://github.com/anthropics/claude-plugins-official) and [Anthropic Skills](https://github.com/anthropics/skills). OpenCode's provider integration separates metadata from authentication and protocol adapters. Codex's server separates transport, config and approvals; [its configuration docs](https://developers.openai.com/codex/config-basic) and [Antigravity's settings docs](https://antigravity.google/docs/settings/) distinguish approval settings from appearance. Wiggle surfaces only controls that have an effect. It does not copy these applications' runtime code or claim parity.

## Providers

[OpenCode's providers docs](https://docs.opencode.ai/docs/providers/) explain the combined AI SDK / Models.dev approach, credential setup, and provider-specific flows. `catalog/providers.json` uses the checked-in Models.dev snapshot in OpenCode with the upstream revision recorded in the file. The catalog has 233 providers and local presets in this revision. Text-in/text-out chat models that are not marked deprecated are listed. Each model maps to its own adapter and base URL if a standard candidate exists; a provider can have both direct and manual routes. Routes without a static endpoint, suitable credential shape, or a supported protocol are listed but not offered for direct connection. Azure-specific auth, AWS signing, Vertex service credentials, Copilot/subscription OAuth, and multi-header custom deployments should get separate adapters only after their vendor flows are verified. A separately configured compatible gateway can cover some of them today.

The four adapter families use these reference protocols: [Chat Completions](https://platform.openai.com/docs/api-reference/chat), [Responses](https://platform.openai.com/docs/api-reference/responses), [Anthropic Messages](https://platform.claude.com/docs/en/api/messages), and [Gemini GenerateContent](https://ai.google.dev/api/generate-content). The connection probe checks the real route with the exact model selected. Generic compatible routes are candidates, not individually certified integrations.

## Extension ecosystem

| Source | Official path | What Wiggle implements |
| --- | --- | --- |
| Claude Code | [Discover plugins](https://code.claude.com/docs/en/discover-plugins) and [public marketplace manifest](https://github.com/anthropics/claude-plugins-official). The public GitHub manifest is not a mirror of the signed-in product directory. | Metadata snapshot, search, saved entries and a vendor installation command. No execution of hooks or packages. |
| Skills | [Anthropic Skills](https://github.com/anthropics/skills) and [Agent Skills format](https://agentskills.io/specification). Check each skill's license before importing it. | Public source listings, user-imported Markdown and a Wiggle starter. No script execution or auto-matching. |
| ChatGPT / Codex | [OpenAI Apps SDK](https://developers.openai.com/apps-sdk), [ChatGPT directory](https://chatgpt.com/apps), and [custom MCP setup](https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt). Access varies by account and workspace. | Directory link and independently configured vendor MCP endpoints. No supported cross-host API to mirror and install the entire account-specific catalog was identified in the docs reviewed. |
| MCP | [Official Registry API](https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/api/official-registry-api.md), vendor endpoint documentation, and the [official TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk). | Live registry search from the local gateway. Independent bookmarks, environment-configured Streamable HTTP or SSE, and a bounded first-page tool/resource/prompt inventory. No interactive OAuth, stdio, content reads or tool execution. |

These catalogs are intentionally not interchangeable: listing an entry does not grant credentials, install packages, execute code, or authorize a third-party service. The browser does not get API keys back from the gateway, and outbound authenticated requests do not follow redirects. The local gateway is single-user, bound to loopback, and rejects browser requests from other origins.

## Refreshing checked-in metadata

Use reviewed clones at pinned revisions in a temporary directory:

```sh
node scripts/sync-catalogs.mjs /tmp/ref-study/opencode /tmp/ref-study/claude-plugins-official /tmp/ref-study/skills
npm test
npm run build
```

Upstream revisions are included in the generated metadata. Review the provider hosts, route changes and any newly added auth requirements before accepting a refresh. The generator does not install plugins or require vendor credentials. The catalogs contain names and descriptions, not upstream extension code. Do not commit screenshot archives or reference clones.

---
name: mcp-builder
description: Design and configure Model Context Protocol (MCP) servers over stdio, SSE, or Streamable HTTP.
---

# MCP Integration Builder

1. Implement JSON-RPC 2.0 `tools/list`, `tools/call`, `resources/list`, `resources/read`, `prompts/list`, and `prompts/get`.
2. Validate JSON schemas strictly for every tool parameter.
3. Never expose credentials in client responses or logs; bind local transports strictly to loopback when HTTP-based.

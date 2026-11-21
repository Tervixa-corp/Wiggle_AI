// MCP tool calling for the agent loop.
//
// Settings -> Plugins stores remote MCP servers. Before a turn the runtime
// opens the enabled ones, lists their tools and exposes each as
// mcp__<server>__<tool>, so the model can call them like native tools. Every
// connection is per-turn and closed when the turn ends; a server that fails to
// answer is skipped instead of failing the whole turn.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';

import { transportFor, resolveToken } from './connectors.mjs';

export const MCP_PREFIX = 'mcp__';
const CONNECT_TIMEOUT_MS = 8_000;
const CALL_TIMEOUT_MS = 60_000;
const MAX_SERVERS = 12;
const MAX_TOOLS_PER_SERVER = 60;
const MAX_SCHEMA_CHARS = 8_000;
const MAX_RESULT_CHARS = 20_000;

/** Provider tool names allow only [a-zA-Z0-9_-], max 64 characters. */
export function mcpToolName(serverId, tool) {
  const safe = (value) => String(value ?? '').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  return `${MCP_PREFIX}${safe(serverId)}__${safe(tool)}`.slice(0, 64);
}

function sanitizeSchema(schema) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return { type: 'object', properties: {} };
  }
  const clone = { ...schema };
  delete clone.$schema;
  delete clone.$id;
  delete clone.definitions;
  if (clone.type !== 'object') {
    return { type: 'object', properties: {}, ...(clone.type ? {} : {}) };
  }
  if (!clone.properties || typeof clone.properties !== 'object') clone.properties = {};
  if (JSON.stringify(clone).length > MAX_SCHEMA_CHARS) {
    return { type: 'object', properties: {}, additionalProperties: true };
  }
  return clone;
}

function contentToText(result) {
  if (!result || typeof result !== 'object') return String(result ?? '');
  const parts = Array.isArray(result.content) ? result.content : [];
  const text = parts
    .map((part) => {
      if (part?.type === 'text') return String(part.text ?? '');
      if (part?.type === 'image') return '[image content]';
      if (part?.type === 'resource') return String(part.resource?.text ?? part.resource?.uri ?? '[resource]');
      return `[${String(part?.type ?? 'content')}]`;
    })
    .join('\n')
    .trim();
  const fallback = text || (result.structuredContent ? JSON.stringify(result.structuredContent) : '');
  return (fallback || '(no text output)').slice(0, MAX_RESULT_CHARS);
}

/**
 * @param {Array<{id:string,name:string,url:string,transport?:string,token?:string,tokenEnv?:string}>} servers
 * @returns {Promise<{tools:Array, call:Function, close:Function, servers:Array, failures:Array}>}
 */
export async function openMcpServers(servers = [], { fetchImpl = fetch, timeoutMs = CONNECT_TIMEOUT_MS } = {}) {
  const enabled = servers.filter((server) => server && server.url && server.enabled !== false).slice(0, MAX_SERVERS);
  const clients = [];
  const byTool = new Map();
  const tools = [];
  const failures = [];
  const summaries = [];

  await Promise.all(
    enabled.map(async (server) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const client = new Client({ name: 'tervixa-wiggle', version: '1.0.0' });
      try {
        const transport = transportFor(
          { ...server, url: server.url },
          resolveToken(server),
          fetchImpl,
          controller.signal,
        );
        await client.connect(transport, { timeout: timeoutMs, signal: controller.signal });
        const caps = client.getServerCapabilities() ?? {};
        const listed = caps.tools
          ? await client.listTools(undefined, { timeout: timeoutMs, signal: controller.signal })
          : { tools: [] };
        const exposed = [];
        for (const tool of (listed?.tools ?? []).slice(0, MAX_TOOLS_PER_SERVER)) {
          const name = mcpToolName(server.id, tool.name);
          if (byTool.has(name)) continue;
          const definition = {
            name,
            description: String(tool.description ?? `${tool.name} on ${server.name}`).slice(0, 800),
            parameters: sanitizeSchema(tool.inputSchema),
          };
          tools.push(definition);
          byTool.set(name, { client, server, tool: tool.name });
          exposed.push(tool.name);
        }
        clients.push(client);
        summaries.push({ id: server.id, name: server.name, tools: exposed });
      } catch (error) {
        failures.push({ id: server.id, name: server.name, error: String(error?.message ?? error).slice(0, 200) });
        await client.close().catch(() => {});
      } finally {
        clearTimeout(timer);
      }
    }),
  );

  return {
    tools,
    servers: summaries,
    failures,
    async call(name, args, signal) {
      const entry = byTool.get(name);
      if (!entry) throw new Error(`Unknown MCP tool: ${name}`);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
      const abort = () => controller.abort();
      signal?.addEventListener('abort', abort, { once: true });
      try {
        const result = await entry.client.callTool(
          { name: entry.tool, arguments: args && typeof args === 'object' ? args : {} },
          undefined,
          { timeout: CALL_TIMEOUT_MS, signal: controller.signal },
        );
        if (result?.isError) return { ok: false, output: contentToText(result) };
        return { ok: true, output: contentToText(result) };
      } catch (error) {
        return { ok: false, output: `MCP call failed: ${String(error?.message ?? error).slice(0, 400)}` };
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
      }
    },
    async close() {
      await Promise.all(clients.map((client) => client.close().catch(() => {})));
    },
  };
}

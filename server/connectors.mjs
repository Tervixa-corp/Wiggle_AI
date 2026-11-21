// MCP connectors.
//
// A connector is a remote Model Context Protocol server. The catalog lists
// endpoints that really exist; the settings store keeps the ones the user has
// added, including tokens. Nothing here talks to a server unless the user
// explicitly tests or uses it.

import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

export const CONNECTORS = JSON.parse(
  readFileSync(new URL('../catalog/connectors.json', import.meta.url), 'utf8'),
);

const BY_ID = new Map(CONNECTORS.map((connector) => [connector.id, connector]));

export function listConnectors() {
  return CONNECTORS;
}

export function findConnector(id) {
  return BY_ID.get(id) ?? null;
}

export function validateMcpUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('The MCP endpoint must be an absolute URL.');
  }
  if (url.username || url.password) throw new Error('The endpoint must not contain credentials.');
  if (/[{}<>]/.test(raw)) throw new Error('The endpoint must not contain placeholders.');
  if (url.search || url.hash) throw new Error('The endpoint must not contain query parameters or a fragment.');
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('Use HTTPS for remote MCP servers, or HTTP on localhost.');
  }
  return url.href.replace(/\/+$/, '');
}

/** Build the transport for one settings entry. */
export function transportFor(config, token, fetchImpl, signal) {
  const remote = new URL(config.url);
  // Legacy SSE may advertise a separate POST address. Never send credentials
  // off-origin and never follow redirects.
  const scopedFetch = (value, options = {}) => {
    const destination = new URL(typeof value === 'string' || value instanceof URL ? value : value.url);
    if (destination.origin !== remote.origin) throw new Error('Unexpected connector origin');
    return fetchImpl(value, {
      ...options,
      redirect: 'error',
      signal: options.signal ? AbortSignal.any([options.signal, signal]) : signal,
    });
  };
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  if (config.transport === 'sse') {
    return new SSEClientTransport(remote, {
      fetch: scopedFetch,
      requestInit: { headers },
      eventSourceInit: {
        fetch: (value, options) =>
          scopedFetch(value, {
            ...options,
            headers: { ...Object.fromEntries(new Headers(options?.headers)), ...headers },
          }),
      },
    });
  }
  return new StreamableHTTPClientTransport(remote, { fetch: scopedFetch, requestInit: { headers } });
}

export async function inspectConnector(config, token, fetchImpl = fetch) {
  if (!config?.url) throw new Error('This connector has no URL. Start it locally or paste an endpoint.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  const client = new Client({ name: 'tervixa-wiggle', version: '1.0.0' });
  try {
    const transport = transportFor(config, token, fetchImpl, controller.signal);
    await client.connect(transport, { timeout: 15_000, signal: controller.signal });
    const caps = client.getServerCapabilities() ?? {};
    const [tools, resources, prompts] = await Promise.all([
      caps.tools ? client.listTools(undefined, { timeout: 15_000, signal: controller.signal }) : null,
      caps.resources ? client.listResources(undefined, { timeout: 15_000, signal: controller.signal }) : null,
      caps.prompts ? client.listPrompts(undefined, { timeout: 15_000, signal: controller.signal }) : null,
    ]);
    const names = (page, key) => ({
      names: (page?.[key] ?? []).slice(0, 200).map((entry) => String(entry.name).slice(0, 150)),
      partial: Boolean(page?.nextCursor || page?.[key]?.length > 200),
    });
    return {
      ok: true,
      server: client.getServerVersion() ?? null,
      capabilities: Object.keys(caps),
      tools: names(tools, 'tools'),
      resources: names(resources, 'resources'),
      prompts: names(prompts, 'prompts'),
    };
  } finally {
    clearTimeout(timer);
    await client.close().catch(() => {});
  }
}

export async function searchRegistry(query, cursor, fetchImpl = fetch) {
  const url = new URL('https://registry.modelcontextprotocol.io/v0.1/servers');
  url.searchParams.set('version', 'latest');
  url.searchParams.set('limit', '20');
  if (query) url.searchParams.set('search', query);
  if (cursor) url.searchParams.set('cursor', cursor);
  const upstream = await fetchImpl(url, {
    redirect: 'error',
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(12_000),
  });
  if (!upstream.ok) throw new Error('Registry request failed');
  const data = await upstream.json();
  if (!Array.isArray(data?.servers)) throw new Error('Registry response invalid');
  const clip = (value, n) => (typeof value === 'string' ? value.slice(0, n) : '');
  return {
    entries: data.servers.slice(0, 20).flatMap(({ server } = {}) => {
      if (typeof server?.name !== 'string' || !/^[-\w.]+\/[-\w.]+$/.test(server.name) || server.name.length > 180) return [];
      const link = [server.websiteUrl, server.repository?.url].find((x) => typeof x === 'string' && /^https:\/\/[^\s]+$/.test(x) && x.length <= 500) ?? '';
      return [{
        id: server.name,
        name: clip(server.title, 120) || server.name,
        description: clip(server.description, 500),
        docs: link,
        transports: [...new Set([
          ...(server.remotes ?? []).map((r) => r.type),
          ...(server.packages ?? []).map((p) => p.transport?.type),
        ].filter((t) => ['streamable-http', 'sse', 'stdio'].includes(t)))],
        remoteUrl: (server.remotes ?? []).map((r) => r.url).find((u) => typeof u === 'string' && /^https:\/\//.test(u)) ?? '',
      }];
    }),
    nextCursor: typeof data.metadata?.nextCursor === 'string' ? data.metadata.nextCursor.slice(0, 1000) : '',
  };
}

/**
 * Environment variable keys are a fallback for headless runs; stored tokens win.
 * A connector is usable when it has an endpoint and, if the vendor requires
 * auth, some token is available.
 */
export function resolveToken(server, env = process.env) {
  if (server.token) return server.token;
  if (server.tokenEnv && env[server.tokenEnv]) return env[server.tokenEnv];
  return '';
}

export function publicConnector(server, catalogEntry = null) {
  return {
    ...server,
    token: server.token ? '[stored]' : '',
    hasToken: Boolean(server.token || (server.tokenEnv && process.env[server.tokenEnv])),
    catalog: catalogEntry,
  };
}

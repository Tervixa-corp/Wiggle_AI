import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { endpoint } from "./providers.mjs";
const builtIn = JSON.parse(
  readFileSync(new URL("../catalog/connectors.json", import.meta.url), "utf8"),
);

export function connectorConfig(env = process.env) {
  const custom = JSON.parse(env.WIGGLE_MCP_SERVERS || "[]");
  if (!Array.isArray(custom) || custom.length > 50)
    throw new Error(
      "WIGGLE_MCP_SERVERS must be an array of at most 50 servers",
    );
  const configs = new Map(
    builtIn
      .filter((c) => c.url)
      .map((c) => [c.id, { ...c, transport: "http" }]),
  );
  for (const c of custom) {
    if (
      !c ||
      typeof c.id !== "string" ||
      !/^[\w-]{1,48}$/.test(c.id) ||
      builtIn.some((b) => b.id === c.id) ||
      configs.has(c.id) ||
      typeof c.name !== "string" ||
      !c.name.trim() ||
      c.name.length > 100 ||
      typeof c.url !== "string" ||
      !["http", "sse"].includes(c.transport) ||
      (c.tokenEnv &&
        (typeof c.tokenEnv !== "string" ||
          !/^WIGGLE_MCP_[A-Z0-9_]+_TOKEN$/.test(c.tokenEnv)))
    )
      throw new Error("Invalid or duplicate WIGGLE_MCP_SERVERS entry");
    endpoint(c.url);
    configs.set(c.id, {
      id: c.id,
      name: c.name,
      url: c.url,
      transport: c.transport,
      tokenEnv: c.tokenEnv,
    });
  }
  return configs;
}
export async function inspectConnector(config, token, fetchImpl = fetch) {
  const controller = AbortSignal.timeout(12_000);
  const remote = new URL(config.url);
  // Legacy SSE may advertise a separate POST address. Never send credentials off origin or follow redirects.
  const scopedFetch = (value, options = {}) => {
    const destination = new URL(
      typeof value === "string" || value instanceof URL ? value : value.url,
    );
    if (destination.origin !== remote.origin)
      throw new Error("Unexpected connector origin");
    return fetchImpl(value, {
      ...options,
      redirect: "error",
      signal: options.signal
        ? AbortSignal.any([options.signal, controller])
        : controller,
    });
  };
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const transport =
    config.transport === "sse"
      ? new SSEClientTransport(remote, {
          fetch: scopedFetch,
          requestInit: { headers },
          eventSourceInit: {
            fetch: (value, options) =>
              scopedFetch(value, {
                ...options,
                headers: {
                  ...Object.fromEntries(new Headers(options?.headers)),
                  ...headers,
                },
              }),
          },
        })
      : new StreamableHTTPClientTransport(remote, {
          fetch: scopedFetch,
          requestInit: { headers },
        });
  const client = new Client({ name: "tervixa-wiggle", version: "0.1.0" });
  try {
    const options = { timeout: 12_000, signal: controller };
    await client.connect(transport, options);
    const caps = client.getServerCapabilities();
    const [tools, resources, prompts] = await Promise.all([
      caps?.tools && client.listTools(undefined, options),
      caps?.resources && client.listResources(undefined, options),
      caps?.prompts && client.listPrompts(undefined, options),
    ]);
    const names = (page, key) => ({
      names: (page?.[key] ?? []).slice(0, 100).map((x) => x.name.slice(0, 150)),
      partial: Boolean(page?.nextCursor || page?.[key]?.length > 100),
    });
    return {
      tools: names(tools, "tools"),
      resources: names(resources, "resources"),
      prompts: names(prompts, "prompts"),
    };
  } finally {
    await client.close().catch(() => {});
  }
}

export async function searchRegistry(query, cursor, fetchImpl = fetch) {
  const url = new URL("https://registry.modelcontextprotocol.io/v0.1/servers");
  url.searchParams.set("version", "latest");
  url.searchParams.set("limit", "20");
  if (query) url.searchParams.set("search", query);
  if (cursor) url.searchParams.set("cursor", cursor);
  const upstream = await fetchImpl(url, {
    redirect: "error",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!upstream.ok) throw new Error("Registry request failed");
  const data = await upstream.json();
  if (!Array.isArray(data?.servers))
    throw new Error("Registry response invalid");
  return {
    entries: data.servers.slice(0, 20).flatMap(({ server } = {}) => {
      if (
        typeof server?.name !== "string" ||
        !/^[-\w.]+\/[-\w.]+$/.test(server.name) ||
        server.name.length > 180
      )
        return [];
      const clip = (value, n) =>
        typeof value === "string" ? value.slice(0, n) : "";
      const link =
        [server.websiteUrl, server.repository?.url].find(
          (x) =>
            typeof x === "string" &&
            /^https:\/\/[^\s]+$/.test(x) &&
            x.length <= 500,
        ) ?? "";
      return [
        {
          id: server.name,
          name: clip(server.title, 120) || server.name,
          description: clip(server.description, 500),
          docs: link,
          transports: [
            ...new Set(
              [
                ...(server.remotes ?? []).map((r) => r.type),
                ...(server.packages ?? []).map((p) => p.transport?.type),
              ].filter((t) => ["streamable-http", "sse", "stdio"].includes(t)),
            ),
          ],
        },
      ];
    }),
    nextCursor:
      typeof data.metadata?.nextCursor === "string"
        ? data.metadata.nextCursor.slice(0, 1000)
        : "",
  };
}

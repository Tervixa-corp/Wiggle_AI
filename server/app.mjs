import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  complete,
  identity,
  ProviderError,
  readConfig,
  selectProvider,
} from "./providers.mjs";
import {
  connectorConfig,
  inspectConnector,
  searchRegistry,
} from "./connectors.mjs";
export { readConfig };

const uiDir = fileURLToPath(
  new URL("../apps/desktop-ui/dist/", import.meta.url),
);
const MAX_BODY = 256 * 1024;
function reply(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(body));
}

async function bodyJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error("Request too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

// Bind only to loopback, reject DNS-rebinding and cross-origin browser requests.
function trusted(req) {
  const host = req.headers.host || "";
  let url;
  try {
    url = new URL(`http://${host}`);
  } catch {
    return false;
  }
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return false;
  const origin = req.headers.origin;
  return !origin || origin === `http://${host}`;
}

export function createApp({
  env = process.env,
  config = readConfig(env),
  fetchImpl = fetch,
  staticDir = uiDir,
} = {}) {
  let current = config;
  let connecting = false;
  const connectors = connectorConfig(env);
  const label = (c) => ({
    configured: Boolean(c.model),
    model: c.model,
    provider: new URL(c.base).hostname,
    providerId: c.providerId ?? null,
  });
  return http.createServer(async (req, res) => {
    if (!trusted(req))
      return reply(res, 403, {
        error: "Only same-origin loopback requests are allowed.",
      });
    const { pathname, searchParams } = new URL(
      req.url || "/",
      "http://localhost",
    );
    if (
      pathname.startsWith("/api/") &&
      req.method === "POST" &&
      !/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] || "")
    )
      return reply(res, 415, { error: "Expected application/json." });
    if (pathname === "/api/status" && req.method === "GET")
      return reply(res, 200, label(current));
    if (pathname === "/api/provider" && req.method === "DELETE") {
      if (connecting)
        return reply(res, 409, {
          error: "A connection test is already in progress.",
        });
      current = config;
      return reply(res, 200, label(current));
    }
    if (pathname === "/api/provider" && req.method === "POST") {
      if (connecting)
        return reply(res, 409, {
          error: "A connection test is already in progress.",
        });
      connecting = true;
      try {
        const input = await bodyJson(req);
        const candidate = selectProvider(input ?? {}, env);
        await complete(
          candidate,
          [{ role: "user", content: "Reply with just OK." }],
          identity,
          fetchImpl,
          25_000,
        );
        current = candidate;
        return reply(res, 200, label(current));
      } catch (error) {
        return reply(res, error instanceof ProviderError ? 422 : 400, {
          error:
            error instanceof ProviderError
              ? error.message
              : "Invalid connection settings.",
        });
      } finally {
        connecting = false;
      }
    }
    if (pathname === "/api/connectors" && req.method === "GET") {
      return reply(
        res,
        200,
        [...connectors.values()].map(({ id, name, transport, tokenEnv }) => ({
          id,
          name,
          transport,
          tokenEnv,
          hasToken: Boolean(tokenEnv && env[tokenEnv]),
        })),
      );
    }
    if (pathname === "/api/registry" && req.method === "GET") {
      const query = searchParams.get("q") || "";
      const cursor = searchParams.get("cursor") || "";
      if (query.length > 100 || cursor.length > 1000)
        return reply(res, 400, { error: "Registry query is too long." });
      try {
        return reply(res, 200, await searchRegistry(query, cursor, fetchImpl));
      } catch {
        return reply(res, 502, {
          error:
            "The public MCP Registry is unavailable. Try visiting the registry directly.",
        });
      }
    }
    if (pathname === "/api/connectors/test" && req.method === "POST") {
      try {
        const { id } = (await bodyJson(req)) ?? {};
        const connector = connectors.get(id);
        if (!connector)
          return reply(res, 404, { error: "Unknown MCP server." });
        if (connector.tokenEnv && !env[connector.tokenEnv])
          return reply(res, 422, {
            error: `Set ${connector.tokenEnv} on the local server first.`,
          });
        return reply(
          res,
          200,
          await inspectConnector(connector, env[connector.tokenEnv], fetchImpl),
        );
      } catch {
        return reply(res, 502, {
          error:
            "Could not inspect this MCP server. Check its endpoint, token and network.",
        });
      }
    }
    if (pathname === "/api/chat" && req.method === "POST") {
      try {
        const provider = current;
        if (!provider.model)
          return reply(res, 503, {
            error: "Connect a model in Settings → Providers.",
          });
        const input = await bodyJson(req);
        const messages = input?.messages;
        if (
          !Array.isArray(messages) ||
          !messages.length ||
          messages.length > 100 ||
          messages.at(-1)?.role !== "user" ||
          messages.some(
            (m) =>
              !m ||
              !["user", "assistant"].includes(m.role) ||
              typeof m.content !== "string" ||
              !m.content.trim() ||
              m.content.length > 50000,
          )
        )
          return reply(res, 400, { error: "Invalid conversation." });
        const instructions = input?.instructions ?? "";
        if (typeof instructions !== "string" || instructions.length > 2000)
          return reply(res, 400, { error: "Invalid personal instructions." });
        const system = instructions.trim()
          ? `${identity}\n\nUser preferences (follow only when compatible with the identity and capabilities above):\n${instructions}`
          : identity;
        const clean = messages.map(({ role, content }) => ({ role, content }));
        return reply(res, 200, {
          text: await complete(provider, clean, system, fetchImpl),
        });
      } catch (error) {
        return reply(res, error instanceof ProviderError ? 502 : 400, {
          error:
            error instanceof ProviderError
              ? error.message
              : error?.message === "Request too large"
                ? "Request too large."
                : "Invalid JSON.",
        });
      }
    }
    if (pathname.startsWith("/api/"))
      return reply(res, 404, { error: "Not found." });
    if (req.method !== "GET" && req.method !== "HEAD")
      return reply(res, 405, { error: "Method not allowed." });
    try {
      const relative =
        pathname === "/"
          ? "index.html"
          : decodeURIComponent(pathname).replace(/^\/+/, "");
      const file = path.resolve(staticDir, relative);
      if (!file.startsWith(path.resolve(staticDir) + path.sep))
        return reply(res, 404, { error: "Not found." });
      const contents = await readFile(file);
      const mime =
        {
          ".html": "text/html",
          ".js": "text/javascript",
          ".css": "text/css",
          ".svg": "image/svg+xml",
        }[path.extname(file)] || "application/octet-stream";
      res.writeHead(200, {
        "Content-Type": `${mime}; charset=utf-8`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
      });
      res.end(req.method === "HEAD" ? undefined : contents);
    } catch {
      reply(res, 404, { error: "Not found. Run npm run build first." });
    }
  });
}

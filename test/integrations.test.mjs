import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createApp } from "../server/app.mjs";
import { complete, identity, selectProvider } from "../server/providers.mjs";
import { inspectConnector, searchRegistry } from "../server/connectors.mjs";
const { providers } = JSON.parse(
  readFileSync(new URL("../catalog/providers.json", import.meta.url), "utf8"),
);
const messages = [{ role: "user", content: "hello" }];
const json = (value) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(value),
});
const ollama = { providerId: "ollama-local", model: "local-fixture" };

function withServer(options, fn) {
  const app = createApp(options);
  return new Promise((resolve, reject) =>
    app.listen(0, "127.0.0.1", async () => {
      try {
        resolve(await fn(`http://127.0.0.1:${app.address().port}`));
      } catch (e) {
        reject(e);
      } finally {
        app.close();
      }
    }),
  );
}
test("model catalog has unique IDs, usable model routes and honest manual-setup entries", () => {
  assert.ok(providers.length >= 200);
  assert.equal(new Set(providers.map((p) => p.id)).size, providers.length);
  for (const p of providers) {
    assert.equal(
      new Set(p.models.map((m) => m[0])).size,
      p.models.length,
      p.id,
    );
    for (const [id, , index] of p.models)
      assert.ok(index === -1 || p.routes[index], `${p.id}/${id}`);
  }
  assert.ok(
    providers.some((p) => p.id === "amazon-bedrock" && !p.routes.length),
  );
  assert.throws(() =>
    selectProvider(
      { providerId: "amazon-bedrock", model: "anything", apiKey: "secret" },
      {},
    ),
  );
  assert.throws(() =>
    selectProvider({ ...ollama, apiKey: "with\nlinebreak" }, {}),
  );
});
for (const [protocol, suffix, response, verify] of [
  [
    "chat",
    "/chat/completions",
    { choices: [{ message: { content: "OK" } }] },
    (p, h) => {
      assert.equal(h.Authorization, "Bearer pretend");
      assert.equal(p.messages[0].content, identity);
    },
  ],
  [
    "responses",
    "/responses",
    {
      output: [
        { type: "message", content: [{ type: "output_text", text: "OK" }] },
      ],
    },
    (p, h) => {
      assert.equal(h.Authorization, "Bearer pretend");
      assert.equal(p.instructions, identity);
      assert.equal(p.store, false);
    },
  ],
  [
    "anthropic",
    "/messages",
    { content: [{ type: "text", text: "OK" }] },
    (p, h) => {
      assert.equal(h["x-api-key"], "pretend");
      assert.equal(p.system, identity);
      assert.deepEqual(p.messages, messages);
    },
  ],
  [
    "gemini",
    "/models/test-model:generateContent",
    {
      candidates: [
        {
          content: {
            parts: [{ text: "hidden", thought: true }, { text: "OK" }],
          },
        },
      ],
    },
    (p, h) => {
      assert.equal(h["x-goog-api-key"], "pretend");
      assert.equal(p.systemInstruction.parts[0].text, identity);
      assert.equal(p.contents[0].parts[0].text, "hello");
    },
  ],
])
  test(`${protocol} adapter formats the request and decodes just its reply text`, async () => {
    const base = "https://example.com/v1";
    const result = await complete(
      { base, model: "test-model", protocol, apiKey: "pretend" },
      messages,
      identity,
      async (url, request) => {
        assert.equal(url, base + suffix);
        assert.equal(request.redirect, "error");
        verify(JSON.parse(request.body), request.headers);
        return Response.json(response);
      },
    );
    assert.equal(result, "OK");
  });
test("connect verifies a preset, ignores browser-supplied endpoints, routes chat and restores the default", () => {
  const requested = [];
  const fetchImpl = async (url, options) => {
    requested.push({ url, options });
    return Response.json({ choices: [{ message: { content: "OK" } }] });
  };
  return withServer({ env: {}, fetchImpl }, async (origin) => {
    const wrongOrigin = {
      ...json(ollama),
      headers: { ...json(ollama).headers, Origin: "https://example.com" },
    };
    assert.equal(
      (await fetch(`${origin}/api/provider`, wrongOrigin)).status,
      403,
    );
    const add = await fetch(
      `${origin}/api/provider`,
      json({
        ...ollama,
        base: "https://ignore.invalid",
        apiKey: "never-publish",
      }),
    );
    assert.equal(add.status, 200);
    assert.doesNotMatch(await add.text(), /never-publish/);
    assert.equal(
      requested[0].url,
      "http://127.0.0.1:11434/v1/chat/completions",
    );
    assert.equal(
      requested[0].options.headers.Authorization,
      "Bearer never-publish",
    );
    const sent = await fetch(
      `${origin}/api/chat`,
      json({ messages, instructions: "Be concise." }),
    );
    assert.deepEqual(await sent.json(), { text: "OK" });
    assert.match(
      JSON.parse(requested[1].options.body).messages[0].content,
      /Be concise/,
    );
    assert.equal(
      (
        await (
          await fetch(`${origin}/api/provider`, { method: "DELETE" })
        ).json()
      ).configured,
      false,
    );
  });
});
test("failed connection preserves previous config and sanitizes provider errors", () =>
  withServer(
    {
      env: { WIGGLE_MODEL: "existing" },
      fetchImpl: async () =>
        new Response("private diagnostic", { status: 401 }),
    },
    async (origin) => {
      const result = await fetch(`${origin}/api/provider`, json(ollama));
      assert.equal(result.status, 422);
      assert.doesNotMatch(await result.text(), /private diagnostic/);
      assert.equal(
        (await (await fetch(`${origin}/api/status`)).json()).model,
        "existing",
      );
    },
  ));
test("MCP inspection negotiates capabilities and lists names without invoking tools", async () => {
  const methods = [];
  const result = await inspectConnector(
    { url: "https://mcp.example.test/mcp", transport: "http" },
    "local-only-token",
    async (_, request) => {
      assert.equal(request.redirect, "error");
      assert.equal(
        new Headers(request.headers).get("authorization"),
        "Bearer local-only-token",
      );
      const req = JSON.parse(request.body);
      methods.push(req.method);
      const outputs = {
        initialize: {
          protocolVersion: "2025-11-25",
          capabilities: { tools: {}, resources: {}, prompts: {} },
          serverInfo: { name: "fixture", version: "1.0.0" },
        },
        "tools/list": {
          tools: [{ name: "read_fixture", inputSchema: { type: "object" } }],
          nextCursor: "more",
        },
        "resources/list": {
          resources: [{ name: "Guide", uri: "fixture://guide" }],
        },
        "prompts/list": { prompts: [{ name: "Review" }] },
      };
      if (req.id === undefined) return new Response(null, { status: 202 });
      assert.ok(outputs[req.method], req.method);
      return Response.json({
        jsonrpc: "2.0",
        id: req.id,
        result: outputs[req.method],
      });
    },
  );
  assert.ok(methods.includes("notifications/initialized"));
  assert.deepEqual(result, {
    tools: { names: ["read_fixture"], partial: true },
    resources: { names: ["Guide"], partial: false },
    prompts: { names: ["Review"], partial: false },
  });
});
test("connector requests cannot override deployment config or expose token material", () =>
  withServer(
    {
      env: { WIGGLE_MCP_GITHUB_TOKEN: "test-credential" },
      fetchImpl: async () => {
        throw Error("network should not be used");
      },
    },
    async (origin) => {
      const config = await (await fetch(`${origin}/api/connectors`)).text();
      assert.match(config, /"hasToken":true/);
      assert.doesNotMatch(config, /test-credential/);
      assert.equal(
        (
          await fetch(
            `${origin}/api/connectors/test`,
            json({ id: "made-up", url: "https://example.com" }),
          )
        ).status,
        404,
      );
      assert.equal(
        (await fetch(`${origin}/api/connectors/test`, json({ id: "notion" })))
          .status,
        422,
      );
    },
  ));
test("registry pins the upstream host, encodes user input and strips executable configuration", async () => {
  const response = await searchRegistry(
    "x&version=other",
    "page1",
    async (url, request) => {
      assert.equal(url.origin, "https://registry.modelcontextprotocol.io");
      assert.equal(url.searchParams.get("search"), "x&version=other");
      assert.equal(url.searchParams.get("version"), "latest");
      assert.equal(url.searchParams.get("cursor"), "page1");
      assert.equal(request.redirect, "error");
      return Response.json({
        servers: [
          {
            server: {
              name: "io.example/fixture",
              title: "Fixture",
              description: "Example",
              websiteUrl: "javascript:ignored",
              packages: [
                { command: "never execute", transport: { type: "stdio" } },
              ],
              remotes: [
                {
                  url: "https://not-published-by-wiggle.test/",
                  type: "streamable-http",
                },
              ],
            },
          },
        ],
        metadata: { nextCursor: "page2" },
      });
    },
  );
  assert.deepEqual(response, {
    entries: [
      {
        id: "io.example/fixture",
        name: "Fixture",
        description: "Example",
        docs: "",
        transports: ["streamable-http", "stdio"],
      },
    ],
    nextCursor: "page2",
  });
});

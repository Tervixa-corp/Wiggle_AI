#!/usr/bin/env node
// Sync catalog/providers.json from the Models.dev registry.
//
// Models.dev is the catalog OpenCode and the AI SDK read, so this keeps
// Wiggle's BYOK list at OpenCode scale: every provider id, its env vars, its
// documentation link and the models it currently serves.
//
// Routes are derived from the provider's own SDK package, not guessed:
//
//   @ai-sdk/anthropic             -> anthropic  (/v1/messages, x-api-key)
//   @ai-sdk/google                -> gemini     (generativelanguage ?key=)
//   @ai-sdk/openai (id: openai)   -> responses, then chat
//   @ai-sdk/openai (anyone else)  -> chat       (they implement Chat Completions)
//   @ai-sdk/openai-compatible     -> chat
//   anything else                 -> chat, unless the package needs its own
//                                    signing/URL scheme, in which case the
//                                    provider ships with no route and the UI
//                                    asks for a protocol and base URL.
//
// Providers that need provider-specific auth or URL templates are listed in
// REQUIRES_SDK: Amazon Bedrock (SigV4), Google Vertex (GCP OAuth + project
// path), Azure OpenAI (api-key header + deployment path), Perplexity's own
// endpoint, SAP AI Core, GitLab Duo, QVAC, IBM watsonx and Cloudflare's
// gateway provider. Labelling any of them "OpenAI Chat Completions" would
// produce calls that cannot work. Cohere stays on its documented
// OpenAI-compatibility base URL.
//
//   node scripts/build-providers.mjs                     # fetch models.dev
//   node scripts/build-providers.mjs --source api.json   # use a local copy

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const CATALOG = fileURLToPath(new URL('../catalog/providers.json', import.meta.url));
const SOURCE = 'https://models.dev/api.json';

const args = process.argv.slice(2);
const sourceIndex = args.indexOf('--source');
const local = sourceIndex >= 0 ? args[sourceIndex + 1] : null;

const raw = local
  ? await readFile(local, 'utf8')
  : await (async () => {
      const response = await fetch(SOURCE, { signal: AbortSignal.timeout(60_000) });
      if (!response.ok) throw new Error(`models.dev returned HTTP ${response.status}`);
      return response.text();
    })();

const registry = JSON.parse(raw);
const current = JSON.parse(await readFile(CATALOG, 'utf8'));

/* Packages that speak a protocol the gateway does not implement. They keep
 * their catalog entry and model list, but no route: Settings → Models then
 * shows "set a protocol and base URL" instead of a connection that fails. */
const REQUIRES_SDK = new Map([
  ['@ai-sdk/amazon-bedrock', 'Amazon Bedrock needs AWS SigV4 credentials.'],
  ['@ai-sdk/google-vertex', 'Vertex AI needs a Google Cloud project and OAuth token.'],
  ['@ai-sdk/google-vertex/anthropic', 'Vertex AI needs a Google Cloud project and OAuth token.'],
  ['@ai-sdk/azure', 'Azure OpenAI needs an api-key header and a deployment path.'],
  ['@jerome-benoit/sap-ai-provider-v2', 'SAP AI Core needs its own OAuth client credentials.'],
  ['gitlab-ai-provider', 'GitLab Duo uses the GitLab OAuth token.'],
  ['@qvac/ai-sdk-provider', 'QVAC uses its own local runtime protocol.'],
  ['watsonx-ai-provider', 'watsonx needs an IBM IAM token and a project id.'],
  ['ai-gateway-provider', 'Cloudflare AI Gateway needs an account id in the URL.'],
]);

const trimBase = (value) => String(value ?? '').trim().replace(/\/+$/, '');
const isLoopback = (value) => /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/i.test(trimBase(value));
const isTemplate = (value) => /[{}<>]|\bYOUR_|\bACCOUNT_ID\b/i.test(String(value ?? ''));

/** Protocols this endpoint really speaks, from the package the provider ships. */
function protocolsFor(provider, id, base) {
  if (!base || isTemplate(base)) return [];
  const npm = String(provider.npm ?? '');
  if (REQUIRES_SDK.has(npm)) return [];
  if (npm === '@ai-sdk/anthropic') return ['anthropic'];
  if (npm === '@ai-sdk/google') return ['gemini'];
  if (npm === '@ai-sdk/openai' && id === 'openai') return ['responses', 'chat'];
  return ['chat'];
}

function routesFor(provider, id, base) {
  const protocols = protocolsFor(provider, id, base);
  return protocols.map((protocol) =>
    isLoopback(base) ? { protocol, base, keyOptional: true } : { protocol, base },
  );
}

const previous = new Map((current.providers ?? []).map((provider) => [provider.id, provider]));
const providers = [];
let routed = 0;
let manual = 0;
let models = 0;

for (const [id, provider] of Object.entries(registry)) {
  const known = previous.get(id);
  // Models.dev omits `api` for a handful of first-party providers (OpenAI,
  // Anthropic, Google, Cohere); fall back to the curated base so their route
  // is not silently dropped.
  const base = trimBase(provider.api) || trimBase(known?.routes?.[0]?.base);
  const routes = routesFor(provider, id, base);
  if (routes.length) routed += 1;
  else manual += 1;

  const entries = Object.entries(provider.models ?? {});
  models += entries.length;

  providers.push({
    id,
    name: String(provider.name ?? known?.name ?? id),
    doc: String(provider.doc ?? known?.doc ?? ''),
    env: Array.isArray(provider.env)
      ? provider.env.filter((name) => typeof name === 'string')
      : (known?.env ?? []),
    routes,
    // Route index per model; -1 means "no catalog route, configure manually".
    models: entries.map(([modelId, model]) => [modelId, String(model?.name || modelId), routes.length ? 0 : -1]),
  });
}

// Keep locally curated entries Models.dev does not publish (Ollama, LM Studio,
// llama.cpp, vLLM) - they are the zero-cost local providers the spec requires.
for (const [id, known] of previous) {
  if (providers.some((provider) => provider.id === id)) continue;
  providers.push(known);
}

providers.sort((a, b) => a.name.localeCompare(b.name));

await writeFile(
  CATALOG,
  `${JSON.stringify({ revision: current.revision ?? '', syncedAt: new Date().toISOString(), providers }, null, 0)}\n`,
  'utf8',
);

console.log(
  `Wrote ${providers.length} providers (${routed} with a live route, ${manual} manual) and ${models} Models.dev models.`,
);

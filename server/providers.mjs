import { readFileSync } from "node:fs";
const { providers } = JSON.parse(
  readFileSync(new URL("../catalog/providers.json", import.meta.url), "utf8"),
);
const registry = new Map(providers.map((p) => [p.id, p]));
const protocols = ["chat", "responses", "anthropic", "gemini"];

export const identity =
  "You are Tervixa Wiggle, an AI software engineering assistant developed by Tervixa Corporation. Be honest about your capabilities. You have no access to tools or the user’s files unless they are included in the conversation.";
export function endpoint(base) {
  const url = new URL(base);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash)
    throw new Error(
      "Endpoints must not contain credentials, query parameters or fragments.",
    );
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))
    throw new Error("Use HTTPS or a loopback HTTP endpoint.");
  return url.href.replace(/\/+$/, "");
}
export function readConfig(env = process.env) {
  const protocol = env.WIGGLE_PROTOCOL || "chat";
  if (!protocols.includes(protocol)) throw new Error("Invalid WIGGLE_PROTOCOL");
  const defaults = {
    chat: "https://api.openai.com/v1",
    responses: "https://api.openai.com/v1",
    anthropic: "https://api.anthropic.com/v1",
    gemini: "https://generativelanguage.googleapis.com/v1beta",
  };
  return {
    base: endpoint(env.WIGGLE_BASE_URL || defaults[protocol]),
    protocol,
    model: env.WIGGLE_MODEL || "",
    apiKey: env.WIGGLE_API_KEY || "",
  };
}
export class ProviderError extends Error {}
export function selectProvider(
  { providerId, model, apiKey } = {},
  env = process.env,
) {
  const p = registry.get(providerId);
  if (
    !p ||
    typeof model !== "string" ||
    !model.trim() ||
    model !== model.trim() ||
    model.length > 256 ||
    /[\u0000-\u001f\u007f]/.test(model)
  )
    throw new ProviderError("Choose a provider and a valid model.");
  if (
    apiKey !== undefined &&
    (typeof apiKey !== "string" ||
      apiKey.length > 4096 ||
      /[^\x20-\x7e]/.test(apiKey))
  )
    throw new ProviderError("Invalid API key.");
  const route = p.models.length
    ? p.routes[p.models.find((m) => m[0] === model)?.[2]]
    : p.routes[0];
  if (!route)
    throw new ProviderError(
      "This model has no direct Wiggle adapter. Use a supported gateway configured on the local server.",
    );
  const secret =
    apiKey?.trim() || p.env.map((name) => env[name]).find(Boolean) || "";
  if (!secret && !route.keyOptional)
    throw new ProviderError("An API key is required for this route.");
  return {
    ...route,
    base: endpoint(route.base),
    model,
    providerId,
    apiKey: secret,
  };
}
const string = (text) => (typeof text === "string" ? text : "");
export async function complete(
  config,
  messages,
  instruction,
  fetchImpl = fetch,
  timeout = 120000,
) {
  const {
    base,
    model,
    apiKey,
    protocol = "chat",
    tokenField = "max_tokens",
  } = config;
  const headers = { "Content-Type": "application/json" };
  let url, payload, extract;
  if (protocol === "anthropic") {
    url = `${base}/messages`;
    if (apiKey) headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
    payload = {
      model,
      system: instruction,
      messages,
      max_tokens: 4096,
      stream: false,
    };
    extract = (data) =>
      data?.content
        ?.filter((p) => p.type === "text")
        .map((p) => string(p.text))
        .join("\n");
  } else if (protocol === "gemini") {
    // Gemini model resource names are identifiers, not URL paths supplied by the client.
    const id = model.replace(/^models\//, "");
    if (!/^[\w.-]+$/.test(id))
      throw new ProviderError("Invalid Gemini model identifier.");
    url = `${base}/models/${encodeURIComponent(id)}:generateContent`;
    if (apiKey) headers["x-goog-api-key"] = apiKey;
    payload = {
      systemInstruction: { parts: [{ text: instruction }] },
      contents: messages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      })),
      generationConfig: { maxOutputTokens: 4096 },
    };
    extract = (data) =>
      data?.candidates?.[0]?.content?.parts
        ?.filter((p) => !p.thought)
        .map((p) => string(p.text))
        .join("\n");
  } else if (protocol === "responses") {
    url = `${base}/responses`;
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    payload = {
      model,
      instructions: instruction,
      input: messages,
      max_output_tokens: 4096,
      store: false,
      stream: false,
    };
    extract = (data) =>
      data?.output
        ?.filter((p) => p.type === "message")
        .flatMap((p) => p.content ?? [])
        .filter((p) => p.type === "output_text")
        .map((p) => string(p.text))
        .join("\n");
  } else {
    url = `${base}/chat/completions`;
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    payload = {
      model,
      messages: [{ role: "system", content: instruction }, ...messages],
      [tokenField]: 4096,
      stream: false,
    };
    extract = (data) => data?.choices?.[0]?.message?.content;
  }
  try {
    const upstream = await fetchImpl(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeout),
      redirect: "error",
    });
    if (!upstream.ok) {
      await upstream.body?.cancel();
      throw new ProviderError(
        `Provider request failed (HTTP ${upstream.status}). Check your model, endpoint and credentials.`,
      );
    }
    const text = extract(await upstream.json());
    if (typeof text !== "string" || !text.trim())
      throw new ProviderError(
        "Provider returned an empty or unsupported response.",
      );
    return text;
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError(
      "Could not complete the provider request. Check the endpoint and network.",
    );
  }
}

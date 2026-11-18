// Inputs are checkouts (not downloaded at runtime); run from the repository root.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
const [openCode, marketplace, skills] = process.argv.slice(2);
if (!skills)
  throw new Error(
    "Usage: node scripts/sync-catalogs.mjs <opencode> <claude-plugins-official> <skills>",
  );
const sha = (dir) =>
  execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
const read = (dir, file) => readFileSync(join(dir, file), "utf8");
const sort = (a, b) => a.name.localeCompare(b.name, "en");
// No protocol guessing for vendor-specific auth or custom runtime headers.
const special = new Set([
  "github-copilot",
  "github-copilot-enterprise",
  "gitlab",
  "modal",
  "sap-ai-core",
  "amazon-bedrock",
  "google-vertex",
  "google-vertex-anthropic",
  "azure",
  "azure-cognitive-services",
  "snowflake-cortex",
  "databricks",
  "cloudflare-ai-gateway",
  "cloudflare-workers-ai",
  "neon",
  "infomaniak",
]);
const protocols = {
  "chat-completions": "chat",
  responses: "responses",
  messages: "anthropic",
  "generate-content": "gemini",
};
const local = (id, name, base, doc) => ({
  id,
  name,
  doc,
  env: [],
  routes: [{ protocol: "chat", base, keyOptional: true }],
  models: [],
});
const providers = Object.values(
  JSON.parse(read(openCode, "packages/core/src/models-dev/snapshot.txt")),
)
  .map((p) => {
    const routes = [];
    const models = Object.values(p.models)
      .filter(
        (m) =>
          m.type === "chat" &&
          m.status !== "deprecated" &&
          m.modalities.input.includes("text") &&
          m.modalities.output.includes("text"),
      )
      .sort(sort)
      .map((m) => {
        const eligible =
          !special.has(p.id) && (p.env.length === 1 || p.id === "google");
        const pair =
          eligible &&
          Object.entries(m.api).find(
            ([type, a]) =>
              protocols[type] &&
              /^https:\/\/[^\s${}?#]+$/.test(a.base_url ?? "") &&
              a.sdk?.aisdk,
          );
        if (!pair) return [m.id, m.name, -1];
        const [type, a] = pair;
        const route = {
          protocol: protocols[type],
          base: a.base_url.replace(/\/+$/, ""),
          ...(a.compatibility?.max_tokens_field === "max_completion_tokens"
            ? { tokenField: "max_completion_tokens" }
            : {}),
        };
        const existing = routes.findIndex(
          (r) => JSON.stringify(r) === JSON.stringify(route),
        );
        return [
          m.id,
          m.name,
          existing >= 0 ? existing : routes.push(route) - 1,
        ];
      });
    return {
      id: p.id,
      name: p.name,
      doc: p.doc || "",
      env: p.env,
      routes,
      models,
    };
  })
  .filter((p) => p.id !== "lmstudio");
providers.push(
  local(
    "lmstudio",
    "LM Studio",
    "http://127.0.0.1:1234/v1",
    "https://lmstudio.ai/docs/developer/openai-compat",
  ),
  local(
    "ollama-local",
    "Ollama (local)",
    "http://127.0.0.1:11434/v1",
    "https://docs.ollama.com/openai",
  ),
  local(
    "llamacpp",
    "llama.cpp (local)",
    "http://127.0.0.1:8080/v1",
    "https://github.com/ggml-org/llama.cpp/tree/master/tools/server",
  ),
  local(
    "vllm-local",
    "vLLM (local)",
    "http://127.0.0.1:8000/v1",
    "https://docs.vllm.ai/en/latest/serving/openai_compatible_server.html",
  ),
);
const plugins = JSON.parse(read(marketplace, ".claude-plugin/marketplace.json"))
  .plugins.map((p) => ({
    id: p.name,
    name: p.name,
    description: p.description ?? "",
    category: p.category ?? "general",
  }))
  .sort(sort);
const skillEntries = readdirSync(join(skills, "skills"), {
  withFileTypes: true,
})
  .filter((e) => e.isDirectory())
  .map((e) => {
    const front =
      read(skills, `skills/${e.name}/SKILL.md`).split("---")[1] ?? "";
    const match = front.match(
      /^description:[ \t]*([^\n]*)(\n(?:[ \t]+[^\n]*\n?)*)/m,
    );
    const rawDescription = match?.[1]?.trim() ?? "";
    const description = /^[>|][-+]?$/g.test(rawDescription)
      ? match[2].trim().replace(/\s+/g, " ")
      : rawDescription.replace(/^("|')|("|')$/g, "");
    return {
      id: e.name,
      name: e.name,
      description:
        description ||
        "View the skill instructions and license in the source repository.",
    };
  })
  .sort(sort);
for (const [file, value] of Object.entries({
  providers: { revision: sha(openCode), providers: providers.sort(sort) },
  extensions: {
    marketplaceRevision: sha(marketplace),
    skillsRevision: sha(skills),
    plugins,
    skills: skillEntries,
  },
})) {
  writeFileSync(`catalog/${file}.json`, JSON.stringify(value, null, 0) + "\n");
}

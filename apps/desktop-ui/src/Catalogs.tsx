import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowLeft,
  Check,
  ExternalLink,
  Plug,
  Plus,
  Search,
  X,
} from "lucide-react";
import providerData from "../../../catalog/providers.json";
import extensionData from "../../../catalog/extensions.json";
import connectorData from "../../../catalog/connectors.json";
import {
  api,
  load,
  post,
  starter,
  store,
  type Connection,
  type Skill,
} from "./state";

type Provider = {
  id: string;
  name: string;
  doc: string;
  env: string[];
  routes: { protocol: string; base: string; keyOptional?: boolean }[];
  models: [string, string, number][];
};
const providers = providerData.providers as Provider[];
const featured = [
  "anthropic",
  "openai",
  "google",
  "openrouter",
  "opencode",
  "opencode-go",
  "deepseek",
  "ollama-local",
  "lmstudio",
];
const protocols: Record<string, string> = {
  chat: "Chat Completions",
  responses: "OpenAI Responses",
  anthropic: "Anthropic Messages",
  gemini: "Gemini GenerateContent",
};
const includes = (query: string, ...values: string[]) =>
  values.join(" ").toLowerCase().includes(query.trim().toLowerCase());
export function SearchField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="catalog-search">
      <Search size={15} />
      <input
        type="search"
        aria-label={label}
        placeholder={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
function Link({ href, children }: { href: string; children: ReactNode }) {
  if (!/^https:\/\//.test(href)) return null;
  return (
    <a className="resource-link" href={href} target="_blank" rel="noreferrer">
      {children}
      <ExternalLink size={12} />
    </a>
  );
}
function ListFooter({
  count,
  limit,
  more,
}: {
  count: number;
  limit: number;
  more: () => void;
}) {
  return (
    <div className="list-footer">
      {count ? `Showing ${Math.min(count, limit)} of ${count}` : "No matches."}
      {count > limit && (
        <button className="action" onClick={more}>
          Show more
        </button>
      )}
    </div>
  );
}
export function Providers({
  connection,
  onConnect,
}: {
  connection: Connection | null;
  onConnect: (data: Connection) => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "direct" | "setup">("all");
  const [limit, setLimit] = useState(30);
  const [selected, setSelected] = useState<Provider | null>(null);
  const [model, setModel] = useState("");
  const [modelQuery, setModelQuery] = useState("");
  const [apiKey, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const p = selected;
  const listed = providers
    .filter(
      (p) =>
        includes(query, p.id, p.name) &&
        (filter === "all" ||
          Boolean(p.routes.length) === (filter === "direct")),
    )
    .sort(
      (a, b) =>
        (featured.indexOf(a.id) + 1 || 100) -
        (featured.indexOf(b.id) + 1 || 100),
    );
  const models =
    p?.models.filter(
      (m) => includes(modelQuery, m[0], m[1]) || m[0] === model,
    ) ?? [];
  const route = p?.models.length
    ? p.routes[p.models.find((m) => m[0] === model)?.[2] ?? -1]
    : p?.routes[0];
  function open(provider: Provider) {
    setSelected(provider);
    setModel(connection?.providerId === provider.id ? connection.model : "");
    setModelQuery("");
    setKey("");
    setNotice("");
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!p || busy) return;
    setBusy(true);
    setNotice("");
    try {
      onConnect(
        await api<Connection>(
          "provider",
          post({ providerId: p.id, model: model.trim(), apiKey }),
        ),
      );
      setKey("");
      setSelected(null);
      setNotice("Model connected. New requests use this model.");
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function reset() {
    setBusy(true);
    setNotice("");
    try {
      onConnect(await api<Connection>("provider", { method: "DELETE" }));
      setNotice("Restored the local server default.");
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (p)
    return (
      <div className="config-stack">
        <button
          className="text-action"
          disabled={busy}
          onClick={() => {
            setSelected(null);
            setKey("");
            setNotice("");
          }}
        >
          <ArrowLeft size={14} /> All providers
        </button>
        <div className="detail-heading">
          <h3>{p.name}</h3>
          <Link href={p.doc}>Provider docs</Link>
        </div>
        {!p.routes.length ? (
          <div className="settings-note">
            This provider is listed for discovery. Wiggle does not implement its
            authentication or chat protocol directly. If the provider supports a
            compatible endpoint, configure it on the local server with
            WIGGLE_BASE_URL, WIGGLE_PROTOCOL and WIGGLE_MODEL.
          </div>
        ) : (
          <form className="config-stack" onSubmit={submit}>
            {p.models.length > 0 && (
              <SearchField
                label="Filter models"
                value={modelQuery}
                onChange={setModelQuery}
              />
            )}
            <label className="field">
              <span>Model</span>
              {p.models.length ? (
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  required
                >
                  <option value="">Select a model</option>
                  {models.map(([id, name, r]) => (
                    <option value={id} key={id}>
                      {name} · {id}
                      {r < 0 ? " (setup required)" : ""}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="Exact model ID on your server"
                  maxLength={256}
                  required
                />
              )}
            </label>
            {route ? (
              <>
                <div className="settings-note">
                  <Plug size={15} />
                  <div>
                    <strong>{protocols[route.protocol]}</strong>
                    <small className="break">{route.base}</small>
                  </div>
                </div>
                <label className="field">
                  <span>API key {route.keyOptional ? "(optional)" : ""}</span>
                  <input
                    type="password"
                    autoComplete="off"
                    value={apiKey}
                    onChange={(e) => setKey(e.target.value)}
                    maxLength={4096}
                    placeholder={
                      p.env.length
                        ? `Uses ${p.env[0]} if left blank`
                        : "Optional local key"
                    }
                    disabled={busy || !connection}
                  />
                </label>
                <small>
                  Keys entered here are held only in local gateway memory. The
                  test sends a short prompt to this endpoint and may incur
                  provider charges.
                </small>
                <button
                  className="action primary"
                  disabled={!connection || busy || !model.trim()}
                >
                  {busy ? "Testing connection…" : "Test and connect"}
                </button>
              </>
            ) : (
              model && (
                <div className="settings-note">
                  This model requires provider-specific setup. Choose another
                  model or configure a compatible gateway.
                </div>
              )
            )}
          </form>
        )}
        {!connection && (
          <div className="settings-note">
            Catalog preview only. Run <code>npm run build</code> and{" "}
            <code>npm start</code> locally to connect.
          </div>
        )}
        {notice && (
          <div className="settings-note" role="status">
            {notice}
          </div>
        )}
      </div>
    );
  return (
    <div className="config-stack">
      <p>
        Browse the OpenCode / Models.dev snapshot, connect with your own key, or
        run a local model. A listed model is not necessarily enabled on your
        provider account.
      </p>
      <div className="connection-card">
        <span className={connection?.configured ? "status-dot" : "idle-dot"} />
        <div>
          <strong>
            {connection?.configured ? connection.model : "No active model"}
          </strong>
          <small>
            {connection?.configured
              ? connection.provider
              : connection
                ? "Local gateway is ready"
                : "Static preview · local gateway required"}
          </small>
        </div>
        {connection?.providerId && (
          <button disabled={busy} className="action" onClick={reset}>
            Restore default
          </button>
        )}
      </div>
      {notice && (
        <div className="settings-note" role="status">
          {notice}
        </div>
      )}
      <SearchField
        label="Search providers"
        value={query}
        onChange={(q) => {
          setQuery(q);
          setLimit(30);
        }}
      />
      <div className="filter-tabs" aria-label="Provider filters">
        {(["all", "direct", "setup"] as const).map((x) => (
          <button
            key={x}
            aria-pressed={filter === x}
            onClick={() => {
              setFilter(x);
              setLimit(30);
            }}
          >
            {
              {
                all: "All providers",
                direct: "Direct connection",
                setup: "Manual setup",
              }[x]
            }
          </button>
        ))}
      </div>
      <div className="catalog-list">
        {listed.slice(0, limit).map((p) => (
          <div className="catalog-row" key={p.id}>
            <span className="catalog-icon">
              {p.name.slice(0, 2).toUpperCase()}
            </span>
            <div className="catalog-copy">
              <strong>{p.name}</strong>
              <small>
                {p.models.length ? `${p.models.length} text models · ` : ""}
                {p.routes.length ? "Direct adapter" : "Manual setup"}
              </small>
            </div>
            <button
              className="action"
              aria-label={`${p.routes.length ? "Configure" : "View"} ${p.name}`}
              onClick={() => open(p)}
            >
              {connection?.providerId === p.id ? (
                <Check size={14} />
              ) : p.routes.length ? (
                <Plus size={14} />
              ) : null}
              {p.routes.length ? "Configure" : "Details"}
            </button>
          </div>
        ))}
      </div>
      <ListFooter
        count={listed.length}
        limit={limit}
        more={() => setLimit((x) => x + 30)}
      />
    </div>
  );
}

type Connector = {
  id: string;
  name: string;
  description?: string;
  docs?: string;
  url?: string;
  tokenEnv?: string;
  transport?: string;
  hasToken?: boolean;
};
type RegistryEntry = {
  id: string;
  name: string;
  description: string;
  docs: string;
  transports: string[];
};
function Registry({
  available,
  bookmarks,
  onToggle,
}: {
  available: boolean;
  bookmarks: RegistryEntry[];
  onToggle: (item: RegistryEntry) => void;
}) {
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [result, setResult] = useState<RegistryEntry[]>([]);
  const [cursor, setCursor] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function search(append = false) {
    if (busy) return;
    setBusy(true);
    setError("");
    const q = append ? submitted : query.trim();
    if (!append) {
      setResult([]);
      setCursor("");
      setDone(false);
      setSubmitted(q);
    }
    try {
      const params = new URLSearchParams({ q, ...(append ? { cursor } : {}) });
      const page = await api<{ entries: RegistryEntry[]; nextCursor: string }>(
        `registry?${params}`,
      );
      setResult((previous) => [
        ...new Map(
          [...(append ? previous : []), ...page.entries].map((row) => [
            row.id,
            row,
          ]),
        ).values(),
      ]);
      setCursor(page.nextCursor);
      setDone(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="config-stack">
      <div className="settings-note directories">
        <span>
          Search published MCP servers. Adding a listing bookmarks it; it does
          not run a package or connect to the publisher. Add trusted remote
          endpoints to your local gateway configuration to test them.
        </span>
        <Link href="https://registry.modelcontextprotocol.io/">
          Official registry
        </Link>
      </div>
      {available ? (
        <>
          <form
            className="registry-search"
            onSubmit={(e) => {
              e.preventDefault();
              void search();
            }}
          >
            <SearchField
              label="Search public MCP servers"
              value={query}
              onChange={(value) => setQuery(value.slice(0, 100))}
            />
            <button className="action" disabled={busy}>
              {busy ? "Searching…" : "Search"}
            </button>
          </form>
          {error && (
            <div className="settings-note" role="alert">
              {error}
            </div>
          )}
          <div className="catalog-list">
            {result.map((row) => {
              const added = bookmarks.some((x) => x.id === row.id);
              return (
                <article className="extension-entry" key={row.id}>
                  <div className="catalog-row">
                    <span className="catalog-icon">
                      <Plug size={14} />
                    </span>
                    <div className="catalog-copy">
                      <strong>{row.name}</strong>
                      <small>
                        {row.id}
                        {row.transports.length > 0
                          ? ` · ${row.transports.join(", ")}`
                          : ""}
                      </small>
                    </div>
                    <button
                      type="button"
                      className="action"
                      onClick={() => onToggle(row)}
                    >
                      {added ? <X size={14} /> : <Plus size={14} />}{" "}
                      {added ? "Remove" : "Add"}
                    </button>
                  </div>
                  <p>{row.description}</p>
                  <Link href={row.docs}>Publisher site</Link>
                </article>
              );
            })}
          </div>
          {done && !result.length && <small>No matching servers.</small>}
          {cursor && (
            <button
              className="action"
              disabled={busy}
              onClick={() => void search(true)}
            >
              Load more
            </button>
          )}
        </>
      ) : (
        <div className="settings-note">
          Start the local gateway for live registry search.
        </div>
      )}
    </div>
  );
}
type Inspection = Record<
  "tools" | "resources" | "prompts",
  { names: string[]; partial: boolean }
>;
const categories = [
  "Connectors",
  "MCP Registry",
  "Claude marketplace",
  "Skills",
  "My library",
] as const;
export function Plugins({
  available,
  skills,
  setSkills,
  initialTab = "Connectors",
}: {
  available: boolean;
  skills: Skill[];
  setSkills: (skills: Skill[]) => void;
  initialTab?: (typeof categories)[number];
}) {
  const [tab, setTab] = useState<(typeof categories)[number]>(initialTab);
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(24);
  const [saved, setSaved] = useState<string[]>(() =>
    load("wiggle-library-v1", []),
  );
  const [bookmarks, setBookmarks] = useState<RegistryEntry[]>(() =>
    load("wiggle-mcp-bookmarks-v1", []),
  );
  const [remote, setRemote] = useState<Connector[]>([]);
  const [inspections, setInspections] = useState<Record<string, Inspection>>(
    {},
  );
  const [testing, setTesting] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [importError, setImportError] = useState("");
  useEffect(() => {
    if (available)
      api<Connector[]>("connectors")
        .then(setRemote)
        .catch(() => setRemote([]));
  }, [available]);
  function toggle(key: string) {
    const next = saved.includes(key)
      ? saved.filter((x) => x !== key)
      : [...saved, key];
    setSaved(next);
    store("wiggle-library-v1", next);
  }
  function toggleBookmark(entry: RegistryEntry) {
    const next = bookmarks.some((x) => x.id === entry.id)
      ? bookmarks.filter((x) => x.id !== entry.id)
      : [...bookmarks, entry];
    setBookmarks(next);
    store("wiggle-mcp-bookmarks-v1", next);
  }
  async function inspect(id: string) {
    setTesting(id);
    setErrors((e) => ({ ...e, [id]: "" }));
    setInspections(({ [id]: _, ...rest }) => rest);
    try {
      const result = await api<Inspection>("connectors/test", post({ id }));
      setInspections((x) => ({ ...x, [id]: result }));
    } catch (e) {
      setErrors((x) => ({ ...x, [id]: (e as Error).message }));
    } finally {
      setTesting("");
    }
  }
  async function importSkill(file: File | undefined) {
    if (!file) return;
    setImportError("");
    try {
      if (!/\.md$/i.test(file.name) || file.size > 16000)
        throw new Error("Choose a Markdown SKILL.md file under 16 KB.");
      const source = (await file.text()).replace(/\r\n/g, "\n");
      const match = source.match(/^---\n([\s\S]*?)\n---\s*\n([\s\S]+)$/);
      const field = match?.[1]
        .match(/^name:[ \t]*(.+)$/m)?.[1]
        ?.trim()
        .replace(/^['"]|['"]$/g, "");
      if (!match || !field || !/^[\w -]{1,64}$/.test(field) || !match[2].trim())
        throw new Error(
          "A skill needs a name in YAML frontmatter and a Markdown body.",
        );
      if (skills.length >= 40)
        throw new Error(
          "Remove a skill before importing another (40 maximum).",
        );
      if (skills.some((x) => x.name.toLowerCase() === field.toLowerCase()))
        throw new Error("A skill with that name already exists.");
      setSkills([
        ...skills,
        { id: crypto.randomUUID(), name: field, text: match[2].trim() },
      ]);
    } catch (e) {
      setImportError((e as Error).message);
    }
  }
  const connectors: Connector[] = [
    ...connectorData,
    ...remote.filter((c) => !connectorData.some((b) => b.id === c.id)),
  ];
  type Entry = {
    key: string;
    name: string;
    desc: string;
    type: string;
    link?: string;
    connector?: Connector;
    skill?: Skill;
    command?: string;
    registry?: RegistryEntry;
  };
  const sources: Entry[] = [
    ...connectors.map((c) => ({
      key: `mcp:${c.id}`,
      name: c.name,
      desc: c.description || "Configured on your local gateway.",
      type: c.url || c.transport ? "MCP connector" : "External directory",
      link: c.docs,
      connector: c,
    })),
    ...extensionData.plugins.map((p) => ({
      key: `claude:${p.id}`,
      name: p.name,
      desc: p.description,
      type: `Claude Code · ${p.category}`,
      link: "https://github.com/anthropics/claude-plugins-official",
      command: `/plugin install ${p.id}@claude-plugins-official`,
    })),
    ...extensionData.skills.map((s) => ({
      key: `skill:${s.id}`,
      name: s.name,
      desc: s.description,
      type: "Anthropic Skills · source",
      link: `https://github.com/anthropics/skills/tree/${extensionData.skillsRevision}/skills/${s.id}`,
    })),
  ];
  const local: Entry[] = [
    starter,
    ...skills.filter((s) => s.id !== starter.id),
  ].map((s) => ({
    key: `local:${s.id}`,
    name: s.name,
    desc:
      s.id === starter.id
        ? "Guidance for change review; does not run commands."
        : "Imported Markdown instructions. Choose it in the composer to use it for a request.",
    type: "Wiggle skill",
    skill: s,
  }));
  const items = (
    tab === "My library"
      ? [
          ...local.filter((e) => skills.some((s) => s.id === e.skill?.id)),
          ...sources.filter((e) => saved.includes(e.key)),
          ...bookmarks.map(
            (registry) =>
              ({
                key: `registry:${registry.id}`,
                name: registry.name,
                type: "MCP Registry · bookmark",
                desc: registry.description,
                link: registry.docs,
                registry,
              }) as Entry,
          ),
        ]
      : tab === "Skills"
        ? [...local, ...sources.filter((e) => e.key.startsWith("skill:"))]
        : sources.filter((e) =>
            e.key.startsWith(tab === "Connectors" ? "mcp:" : "claude:"),
          )
  ).filter((e) => includes(query, e.name, e.desc, e.type));
  return (
    <div className="config-stack">
      <p>
        Connectors, marketplace packages, and reusable instructions in one
        place. Nothing is added automatically.
      </p>
      <div className="filter-tabs" aria-label="Plugin sections">
        {categories.map((c) => (
          <button
            key={c}
            aria-pressed={tab === c}
            onClick={() => {
              setTab(c);
              setQuery("");
              setLimit(24);
            }}
          >
            {c}
          </button>
        ))}
      </div>
      {tab === "Connectors" && (
        <div className="settings-note directories">
          <span>
            Browse additional listings. ChatGPT apps are installed and
            authorized in ChatGPT, not Wiggle.
          </span>
          <Link href="https://chatgpt.com/apps">ChatGPT directory</Link>
          <Link href="https://registry.modelcontextprotocol.io/">
            MCP Registry
          </Link>
        </div>
      )}
      {tab === "Claude marketplace" && (
        <div className="settings-note">
          Snapshot of Anthropic’s public marketplace manifest. Add bookmarks
          here, or install with the displayed command in Claude Code. Wiggle
          does not run Claude Code plugin scripts or hooks.
          <Link href="https://claude.com/plugins">Claude directory</Link>
        </div>
      )}
      {tab === "Skills" && (
        <>
          <label className="action file-action">
            <Plus size={14} /> Import SKILL.md
            <input
              type="file"
              accept=".md,text/markdown"
              onChange={(e) => {
                void importSkill(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
          <small>
            Import trusted, licensed Markdown instructions only. Imported skills
            do not run code or read files.
          </small>
          {importError && <span role="alert">{importError}</span>}
        </>
      )}
      {tab === "MCP Registry" ? (
        <Registry
          available={available}
          bookmarks={bookmarks}
          onToggle={toggleBookmark}
        />
      ) : (
        <>
          <SearchField
            label={`Search ${tab === "My library" ? "library" : tab.toLowerCase()}`}
            value={query}
            onChange={(q) => {
              setQuery(q);
              setLimit(24);
            }}
          />
          <div className="catalog-list">
            {items.slice(0, limit).map((e) => {
              const installed = e.registry
                ? true
                : e.skill
                  ? skills.some((s) => s.id === e.skill?.id)
                  : saved.includes(e.key);
              const id = e.connector?.id ?? "";
              const config = remote.find((r) => r.id === id);
              return (
                <article key={e.key} className="extension-entry">
                  <div className="catalog-row">
                    <span className="catalog-icon">
                      {e.connector ? (
                        <Plug size={14} />
                      ) : (
                        e.name.slice(0, 2).toUpperCase()
                      )}
                    </span>
                    <div className="catalog-copy">
                      <strong>{e.name}</strong>
                      <small>{e.type}</small>
                    </div>
                    <button
                      className="action"
                      aria-label={`${installed ? "Remove" : "Add"} ${e.name}`}
                      onClick={() => {
                        const s = e.skill;
                        if (e.registry) toggleBookmark(e.registry);
                        else if (s)
                          setSkills(
                            installed
                              ? skills.filter((x) => x.id !== s.id)
                              : [...skills, s],
                          );
                        else toggle(e.key);
                      }}
                    >
                      {installed ? <X size={14} /> : <Plus size={14} />}{" "}
                      {installed ? "Remove" : e.skill ? "Install" : "Add"}
                    </button>
                  </div>
                  <p>{e.desc}</p>
                  {e.link && <Link href={e.link}>Official source</Link>}
                  {installed && e.command && (
                    <div className="extension-detail">
                      <small>Install in Claude Code</small>
                      <code>{e.command}</code>
                    </div>
                  )}
                  {installed &&
                    e.connector &&
                    (e.connector.url || e.connector.transport) && (
                      <div className="extension-detail">
                        <small>
                          {e.connector.url || "Locally configured endpoint"} ·{" "}
                          {config?.transport === "sse"
                            ? "SSE"
                            : "Streamable HTTP"}
                        </small>
                        {(config?.tokenEnv || e.connector.tokenEnv) && (
                          <small>
                            {config?.hasToken
                              ? "Server token configured"
                              : `Set ${config?.tokenEnv || e.connector.tokenEnv} locally before testing.`}
                          </small>
                        )}
                        <button
                          className="action"
                          disabled={
                            !available ||
                            !config ||
                            Boolean(testing) ||
                            Boolean(config.tokenEnv && !config.hasToken)
                          }
                          onClick={() => inspect(id)}
                        >
                          {testing === id ? "Testing…" : "Test and inspect"}
                        </button>
                        {!available && (
                          <small>
                            Start the local gateway to test this connection.
                          </small>
                        )}
                        {errors[id] && <small role="alert">{errors[id]}</small>}
                        {inspections[id] && (
                          <div className="inspection" role="status">
                            {Object.entries(inspections[id]).map(
                              ([key, value]) => (
                                <div key={key}>
                                  <strong>
                                    {key} ({value.names.length}
                                    {value.partial ? "+" : ""})
                                  </strong>
                                  <small>
                                    {value.names.join(", ") ||
                                      "None advertised"}
                                  </small>
                                </div>
                              ),
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  {installed && e.skill && (
                    <details className="extension-detail">
                      <summary>Read instructions</summary>
                      <pre>{e.skill.text}</pre>
                    </details>
                  )}
                </article>
              );
            })}
          </div>
          <ListFooter
            count={items.length}
            limit={limit}
            more={() => setLimit((x) => x + 24)}
          />
        </>
      )}
    </div>
  );
}

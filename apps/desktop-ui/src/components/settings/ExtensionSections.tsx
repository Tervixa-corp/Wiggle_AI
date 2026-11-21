import React, { useMemo, useState } from 'react';
import {
  Check,
  Download,
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import type { ConnectorCatalogEntry, ConnectorServer, PluginEntry } from '../../store/useWiggleStore';
import { Group, Intro, Note, Row, SelectField, TextField, Toggle, useSave, type SectionProps } from './primitives';

const fmtBytes = (bytes: number) => {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/* -------------------------------------------------------------------------- */
/* Plugins & connectors                                                        */
/* -------------------------------------------------------------------------- */

const PluginCard: React.FC<{ entry: PluginEntry; store: SectionProps['store']; notify: SectionProps['notify'] }> = ({
  entry,
  store,
  notify,
}) => {
  const [open, setOpen] = useState(false);
  const installing = store.installingPlugins.includes(entry.id);
  const install = entry.install;

  return (
    <div className={`catalog-card ${entry.installed ? 'catalog-card-installed' : ''}`}>
      <div className="catalog-card-head">
        <div className="catalog-card-title">
          <strong>{entry.name}</strong>
          <span className="catalog-row-sub">
            {entry.author || 'unknown author'} · {entry.category}
          </span>
        </div>
        <div className="catalog-card-actions">
          {entry.installed ? (
            <>
              <span className="wb-badge">
                <Check size={10} /> installed
              </span>
              <button
                className="btn-flat btn-compact"
                onClick={() =>
                  void store
                    .uninstallPlugin(entry.id)
                    .then(() => notify(`${entry.name} removed.`, true))
                    .catch((error) => notify(error.message, false))
                }
              >
                Remove
              </button>
            </>
          ) : (
            <button
              className="btn-flat btn-compact"
              disabled={installing}
              onClick={() =>
                void store
                  .installPlugin(entry.id)
                  .then(() => notify(`${entry.name} installed.`, true))
                  .catch((error) => notify(error.message, false))
              }
              title={`Install ${entry.name}`}
            >
              {installing ? <Loader2 size={11} className="spin" /> : <Plus size={11} />}
              {installing ? 'Installing…' : 'Add'}
            </button>
          )}
          <button className="icon-btn" onClick={() => setOpen((value) => !value)} aria-label="Toggle details">
            {open ? <X size={12} /> : <SlidersHorizontal size={12} />}
          </button>
        </div>
      </div>
      <p className="catalog-card-desc">{entry.description || 'No description in the marketplace.'}</p>
      <div className="catalog-card-meta mono">
        {(entry.source.source === 'git-subdir' ? entry.source.path : entry.source.url) || entry.source.source}
        {install?.bytes ? ` · ${fmtBytes(install.bytes)} · ${install.files} files` : ''}
        {install?.version ? ` · v${install.version}` : ''}
      </div>
      {open && (
        <div className="catalog-card-detail">
          {install?.skills?.length ? (
            <div>
              <span className="field-label">Skills</span>
              <div className="chip-row">
                {install.skills.map((skill) => (
                  <span className="wb-badge" key={skill}>
                    {skill}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          {install?.commands?.length ? (
            <div>
              <span className="field-label">Commands & agents</span>
              <div className="chip-row">
                {install.commands.map((command) => (
                  <span className="wb-badge" key={`${command.kind}-${command.id}`}>
                    {command.kind === 'agent' ? 'agent' : '/'}
                    {command.id}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          {entry.keywords.length > 0 && (
            <div className="chip-row">
              {entry.keywords.map((keyword) => (
                <span className="wb-badge" key={keyword}>
                  {keyword}
                </span>
              ))}
            </div>
          )}
          <div className="inline-row">
            {entry.homepage && (
              <a className="btn-flat btn-compact" href={entry.homepage} target="_blank" rel="noreferrer">
                <ExternalLink size={11} /> Homepage
              </a>
            )}
            {entry.source.url && (
              <a className="btn-flat btn-compact" href={entry.source.url.replace(/\.git$/, '')} target="_blank" rel="noreferrer">
                <ExternalLink size={11} /> Source
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const ConnectorCard: React.FC<{
  entry: ConnectorCatalogEntry;
  store: SectionProps['store'];
  notify: SectionProps['notify'];
}> = ({ entry, store, notify }) => {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const busy = store.busyConnectors.includes(entry.id);
  const installed = entry.installed;

  const connectHosted = async () => {
    if (!endpoint.trim()) {
      notify('Paste the MCP endpoint this vendor exposes.', false);
      return;
    }
    try {
      await store.addCustomConnector({ name: entry.name, url: endpoint.trim(), transport: 'http', token: token.trim() });
      notify(`${entry.name} connected through its MCP endpoint.`, true);
      setOpen(false);
      setEndpoint('');
      setToken('');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not connect that app.', false);
    }
  };

  return (
    <div className="catalog-card">
      <div className="catalog-card-head">
        <div className="catalog-card-title">
          <strong>{entry.name}</strong>
          <span className="catalog-row-sub">{entry.vendor}</span>
        </div>
        <div className="catalog-card-actions">
          <span className={`kind-badge ${entry.kind === 'mcp' ? 'kind-mcp' : 'kind-hosted'}`}>
            {entry.kind === 'mcp' ? 'MCP' : 'app'}
          </span>
          {installed ? (
            <span className="wb-badge">
              <Check size={10} /> connected
            </span>
          ) : (
            <button
              className="btn-flat btn-compact"
              disabled={busy}
              title={`Connect ${entry.name}`}
              onClick={() => {
                if (entry.kind === 'hosted') {
                  setOpen((value) => !value);
                  return;
                }
                if (entry.auth === 'token' || entry.auth === 'oauth') {
                  setOpen((value) => !value);
                  return;
                }
                void store
                  .addConnector(entry.id)
                  .then(() => notify(`${entry.name} added.`, true))
                  .catch((error) => notify(error.message, false));
              }}
            >
              {busy ? <Loader2 size={11} className="spin" /> : <Plus size={11} />} Add
            </button>
          )}
        </div>
      </div>
      <p className="catalog-card-desc">{entry.description}</p>
      <div className="catalog-card-meta mono">
        {entry.kind === 'mcp' ? (
          <>
            {entry.transport ?? 'http'} · {entry.url}
          </>
        ) : (
          <>Vendor-hosted — connect through the vendor's MCP endpoint</>
        )}
      </div>

      {open && !installed && (
        <div className="catalog-card-form">
          {entry.kind === 'hosted' && (
            <input
              className="input-flat mono"
              aria-label={`${entry.name} MCP endpoint`}
              placeholder="https://vendor.example.com/mcp"
              value={endpoint}
              onChange={(event) => setEndpoint(event.target.value)}
            />
          )}
          <input
            type="password"
            className="input-flat mono"
            aria-label={`${entry.name} access token`}
            placeholder={entry.auth === 'oauth' ? 'OAuth access token (optional for public servers)' : 'Access token (optional)'}
            value={token}
            onChange={(event) => setToken(event.target.value)}
          />
          <button
            className="btn-primary btn-compact"
            disabled={busy}
            onClick={() => {
              if (entry.kind === 'hosted') {
                void connectHosted();
                return;
              }
              void store
                .addConnector(entry.id, token.trim())
                .then(() => {
                  setOpen(false);
                  setToken('');
                  notify(`${entry.name} added.`, true);
                })
                .catch((error) => notify(error.message, false));
            }}
          >
            {busy ? <Loader2 size={11} className="spin" /> : <Plus size={11} />} Save connection
          </button>
          <button className="btn-flat btn-compact" onClick={() => setOpen(false)}>
            Cancel
          </button>
          <span className="field-hint">
            {entry.kind === 'hosted'
              ? 'This app runs inside its own vendor. Paste the MCP endpoint and token from the vendor if they publish one; '
              : 'Leave the token blank for public endpoints. '}
            OAuth browser sign-in is not automated.
            {entry.docs && (
              <>
                {' '}
                <a href={entry.docs} target="_blank" rel="noreferrer">
                  Vendor docs
                </a>
              </>
            )}
          </span>
        </div>
      )}
    </div>
  );
};

type PluginsTab = 'plugins' | 'apps' | 'installed' | 'custom' | 'registry';

export const PluginsSection: React.FC<SectionProps> = ({ store, notify }) => {
  const [tab, setTab] = useState<PluginsTab>('plugins');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [custom, setCustom] = useState({ name: '', url: '', transport: 'http', token: '' });
  const [registryQuery, setRegistryQuery] = useState('');
  const [registry, setRegistry] = useState<Array<Record<string, any>>>([]);
  const [registryBusy, setRegistryBusy] = useState(false);
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; text: string }>>({});

  const needle = query.trim().toLowerCase();

  const plugins = useMemo(
    () =>
      store.plugins.items
        .filter((entry) => category === 'all' || entry.category === category)
        .filter((entry) => !needle || `${entry.id} ${entry.name} ${entry.description} ${entry.author}`.toLowerCase().includes(needle)),
    [store.plugins.items, category, needle],
  );

  const connectors = useMemo(
    () =>
      store.connectors.items
        .filter((entry) => !needle || `${entry.id} ${entry.name} ${entry.vendor} ${entry.description}`.toLowerCase().includes(needle))
        .sort((a, b) => Number(b.kind === 'mcp') - Number(a.kind === 'mcp') || a.name.localeCompare(b.name)),
    [store.connectors.items, needle],
  );

  const runRegistry = async () => {
    setRegistryBusy(true);
    try {
      const data = await store.searchConnectorRegistry(registryQuery);
      setRegistry(data.entries || []);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Registry search failed.', false);
    } finally {
      setRegistryBusy(false);
    }
  };

  const testServer = async (server: ConnectorServer) => {
    setTestResults((previous) => ({ ...previous, [server.id]: { ok: true, text: 'Connecting…' } }));
    try {
      const result = await store.testConnectorResult(server.id);
      const toolCount = result.tools?.names?.length ?? 0;
      setTestResults((previous) => ({
        ...previous,
        [server.id]: {
          ok: true,
          text: `${toolCount} tools${result.server?.name ? ` · ${result.server.name}` : ''}`,
        },
      }));
    } catch (error) {
      setTestResults((previous) => ({
        ...previous,
        [server.id]: { ok: false, text: error instanceof Error ? error.message : 'Connection failed.' },
      }));
    }
  };

  return (
    <>
      <Intro>
        Plugins add skills, commands, agents and MCP servers. Apps connect through MCP endpoints. {store.pluginCatalogTotal}{' '}
        marketplace plugins and {store.connectors.items.length} apps are catalogued here; adding one fetches only that
        plugin's files and never executes install scripts.
      </Intro>

      <div className="segmented" style={{ marginBottom: 12 }}>
        {(
          [
            ['plugins', `Marketplace (${store.pluginCatalogTotal})`],
            ['apps', `Apps (${store.connectors.items.length})`],
            ['installed', `Installed (${(store.settings?.installedPlugins.length ?? 0) + store.connectorServers.length})`],
            ['custom', 'Custom MCP'],
            ['registry', 'MCP registry'],
          ] as Array<[PluginsTab, string]>
        ).map(([value, label]) => (
          <button
            key={value}
            className={`segmented-btn ${tab === value ? 'active' : ''}`}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab !== 'custom' && tab !== 'registry' && (
        <div className="inline-row" style={{ marginBottom: 10 }}>
          <div className="catalog-search catalog-search-inline">
            <Search size={12} />
            <input
              className="input-flat"
              placeholder={tab === 'apps' ? 'Search apps and MCP servers…' : `Search ${store.pluginCatalogTotal} plugins…`}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          {tab === 'plugins' && (
            <select className="select-flat" aria-label="Plugin category" value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="all">All categories</option>
              {store.pluginCategories.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
          )}
          <button
            className="icon-btn"
            title="Refresh catalog"
            onClick={() => void (tab === 'apps' ? store.refreshConnectors() : store.refreshPlugins())}
          >
            <RefreshCw size={12} />
          </button>
        </div>
      )}

      {tab === 'plugins' && (
        <div className="catalog-cards">
          {plugins.map((entry) => (
            <PluginCard key={entry.id} entry={entry} store={store} notify={notify} />
          ))}
          {store.plugins.loading && <div className="catalog-empty">Loading the marketplace…</div>}
          {!store.plugins.loading && plugins.length === 0 && <div className="catalog-empty">No plugin matches the filters.</div>}
        </div>
      )}

      {tab === 'apps' && (
        <div className="catalog-cards">
          {connectors.map((entry) => (
            <ConnectorCard key={entry.id} entry={entry} store={store} notify={notify} />
          ))}
          {store.connectors.loading && <div className="catalog-empty">Loading apps…</div>}
          {!store.connectors.loading && connectors.length === 0 && <div className="catalog-empty">No app matches “{query}”.</div>}
        </div>
      )}

      {tab === 'installed' && (
        <div className="catalog-cards">
          {(store.settings?.installedPlugins ?? []).map((id) => {
            const meta = store.settings?.pluginMeta?.[id];
            return (
              <div className="catalog-card catalog-card-installed" key={`plugin-${id}`}>
                <div className="catalog-card-head">
                  <div className="catalog-card-title">
                    <strong>{meta?.name || id}</strong>
                    <span className="catalog-row-sub">plugin · {meta?.author || 'unknown author'}</span>
                  </div>
                  <div className="catalog-card-actions">
                    <button
                      className="btn-flat btn-compact"
                      onClick={() =>
                        void store
                          .uninstallPlugin(id)
                          .then(() => notify(`${meta?.name || id} removed.`, true))
                          .catch((error) => notify(error.message, false))
                      }
                    >
                      Remove
                    </button>
                  </div>
                </div>
                <p className="catalog-card-desc">{meta?.description || 'Installed plugin.'}</p>
                <div className="catalog-card-meta mono">
                  {meta?.skills?.length ?? 0} skills · {meta?.commands?.length ?? 0} commands · {fmtBytes(meta?.bytes ?? 0)}
                </div>
              </div>
            );
          })}

          {store.connectorServers.map((server) => {
            const result = testResults[server.id];
            const busy = store.busyConnectors.includes(server.id);
            return (
              <div className="catalog-card" key={`connector-${server.id}`}>
                <div className="catalog-card-head">
                  <div className="catalog-card-title">
                    <strong>{server.name}</strong>
                    <span className="catalog-row-sub mono">
                      {server.transport} · {server.source}
                    </span>
                  </div>
                  <div className="catalog-card-actions">
                    <Toggle
                      checked={server.enabled}
                      disabled={busy}
                      label={`Enable ${server.name}`}
                      onChange={(next) => void store.toggleConnector(server.id, next)}
                    />
                    <button className="btn-flat btn-compact" disabled={busy} onClick={() => void testServer(server)}>
                      {busy ? <Loader2 size={11} className="spin" /> : <RefreshCw size={11} />} Test
                    </button>
                    <button className="icon-btn" title="Remove connector" onClick={() => void store.removeConnector(server.id)}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
                <div className="catalog-card-meta mono">
                  {server.url || (server.command ? `${server.command} ${(server.args ?? []).join(' ')}` : 'no endpoint')}
                </div>
                {result && <div className={`test-result ${result.ok ? 'ok' : 'error'}`}>{result.text}</div>}
              </div>
            );
          })}

          {(store.settings?.installedPlugins.length ?? 0) === 0 && store.connectorServers.length === 0 && (
            <div className="catalog-empty">Nothing installed yet. Add a plugin from Marketplace or an app from Apps.</div>
          )}
        </div>
      )}

      {tab === 'custom' && (
        <div className="settings-form">
          <Note>
            Add any Streamable HTTP or legacy SSE MCP server. HTTP is allowed only on localhost; everything else must be
            HTTPS. stdio servers are stored but not spawned.
          </Note>
          <div className="field-grid">
            <label className="field-group">
              <span className="field-label">Name</span>
              <input
                className="input-flat"
                value={custom.name}
                onChange={(event) => setCustom({ ...custom, name: event.target.value })}
                placeholder="My MCP server"
              />
            </label>
            <label className="field-group">
              <span className="field-label">Transport</span>
              <select
                className="select-flat"
                value={custom.transport}
                onChange={(event) => setCustom({ ...custom, transport: event.target.value })}
              >
                <option value="http">Streamable HTTP</option>
                <option value="sse">Legacy SSE</option>
              </select>
            </label>
          </div>
          <label className="field-group">
            <span className="field-label">Endpoint URL</span>
            <input
              className="input-flat mono"
              value={custom.url}
              onChange={(event) => setCustom({ ...custom, url: event.target.value })}
              placeholder="https://example.com/mcp"
            />
          </label>
          <label className="field-group">
            <span className="field-label">Bearer token (optional)</span>
            <input
              type="password"
              className="input-flat mono"
              value={custom.token}
              onChange={(event) => setCustom({ ...custom, token: event.target.value })}
              placeholder="Paste a token, or leave blank"
            />
          </label>
          <div className="detail-actions">
            <button
              className="btn-primary"
              disabled={!custom.name.trim() || !custom.url.trim()}
              onClick={() =>
                void store
                  .addCustomConnector(custom)
                  .then(() => {
                    setCustom({ name: '', url: '', transport: 'http', token: '' });
                    setTab('installed');
                    notify('Custom server added. Test it from Installed.', true);
                  })
                  .catch((error) => notify(error.message, false))
              }
            >
              <Plus size={12} /> Add server
            </button>
          </div>
        </div>
      )}

      {tab === 'registry' && (
        <>
          <Note>
            Search the public MCP registry. Only servers that publish a remote HTTPS endpoint can be added directly;
            local stdio packages need an endpoint you host yourself.
          </Note>
          <div className="inline-row" style={{ marginBottom: 10 }}>
            <div className="catalog-search catalog-search-inline">
              <Search size={12} />
              <input
                className="input-flat"
                placeholder="Search the MCP registry…"
                value={registryQuery}
                onChange={(event) => setRegistryQuery(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && void runRegistry()}
              />
            </div>
            <button className="btn-flat" disabled={registryBusy} onClick={() => void runRegistry()}>
              {registryBusy ? <Loader2 size={12} className="spin" /> : <Search size={12} />} Search
            </button>
          </div>
          <div className="catalog-cards">
            {registry.map((entry) => (
              <div className="catalog-card" key={entry.id}>
                <div className="catalog-card-head">
                  <div className="catalog-card-title">
                    <strong>{entry.name}</strong>
                    <span className="catalog-row-sub mono">{entry.id}</span>
                  </div>
                  <div className="catalog-card-actions">
                    {entry.remoteUrl ? (
                      <button
                        className="btn-flat btn-compact"
                        onClick={() => {
                          void store
                            .addCustomConnector({ name: entry.name || entry.id, url: entry.remoteUrl, transport: 'http' })
                            .then(() => {
                              notify(`${entry.name || entry.id} added.`, true);
                              setTab('installed');
                            })
                            .catch((error) => notify(error.message, false));
                        }}
                      >
                        <Plus size={11} /> Add
                      </button>
                    ) : entry.docs ? (
                      <a className="btn-flat btn-compact" href={entry.docs} target="_blank" rel="noreferrer">
                        <ExternalLink size={11} /> Docs
                      </a>
                    ) : null}
                  </div>
                </div>
                <p className="catalog-card-desc">{entry.description || 'No description.'}</p>
                <div className="catalog-card-meta mono">
                  {(entry.transports ?? []).join(', ') || 'unknown transport'}
                  {entry.remoteUrl ? ` · ${entry.remoteUrl}` : ' · no remote endpoint'}
                </div>
              </div>
            ))}
            {registry.length === 0 && <div className="catalog-empty">Search to list registry servers.</div>}
          </div>
        </>
      )}
    </>
  );
};

/* -------------------------------------------------------------------------- */
/* Skills                                                                      */
/* -------------------------------------------------------------------------- */

export const SkillsSection: React.FC<SectionProps> = ({ store, notify }) => {
  const [name, setName] = useState('');
  const [markdown, setMarkdown] = useState('');
  const [query, setQuery] = useState('');

  const grouped = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const groups = new Map<string, typeof store.skills>();
    for (const skill of store.skills) {
      if (needle && !`${skill.name} ${skill.description}`.toLowerCase().includes(needle)) continue;
      const key = skill.source || 'workspace';
      groups.set(key, [...(groups.get(key) ?? []), skill]);
    }
    return [...groups.entries()];
  }, [store.skills, query]);

  return (
    <>
      <Intro>
        Skills are Markdown instructions loaded only when a task matches. They never execute code. Bundled skills ship
        with the app; plugins contribute more when installed.
      </Intro>

      <div className="inline-row" style={{ marginBottom: 10 }}>
        <div className="catalog-search catalog-search-inline">
          <Search size={12} />
          <input
            className="input-flat"
            placeholder={`Search ${store.skills.length} skills…`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <button
          className="icon-btn"
          title="Reload skills"
          onClick={() => void store.refreshSkills().then(() => notify('Skills reloaded.', true))}
        >
          <RefreshCw size={12} />
        </button>
      </div>

      <div className="catalog-cards">
        {grouped.map(([source, list]) => (
          <div className="settings-group" key={source}>
            <div className="settings-group-title">
              {source} <span className="wb-badge">{list.length}</span>
            </div>
            {list.map((skill) => (
              <div className="list-row" key={skill.id}>
                <div className="list-row-main">
                  <strong className="mono">{skill.name}</strong>
                  <span className="list-row-sub">{skill.description || 'No description.'}</span>
                </div>
                <div className="list-row-actions">
                  <Toggle
                    checked={skill.enabled}
                    label={`Enable ${skill.name}`}
                    onChange={(next) =>
                      void store
                        .toggleSkill(skill.name, next)
                        .then(() => notify(`${skill.name} ${next ? 'enabled' : 'disabled'}.`, true))
                        .catch((error) => notify(error.message, false))
                    }
                  />
                  {source !== 'bundled' && (
                    <button
                      className="icon-btn"
                      title={`Delete ${skill.name}`}
                      onClick={() =>
                        void store
                          .removeSkill(skill.name)
                          .then(() => notify(`${skill.name} removed.`, true))
                          .catch((error) => notify(error.message, false))
                      }
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ))}
        {store.skills.length === 0 && <div className="catalog-empty">No skills loaded.</div>}
        {store.skills.length > 0 && grouped.length === 0 && <div className="catalog-empty">No skill matches “{query}”.</div>}
      </div>

      <Group title="Install a SKILL.md">
        <Row title="Name" description="Lowercase identifier; becomes the directory name.">
          <input className="input-flat mono" aria-label="Skill name" placeholder="my-skill" value={name} onChange={(event) => setName(event.target.value)} />
        </Row>
        <div className="field-group">
          <span className="field-label">SKILL.md</span>
          <textarea
            className="input-flat mono"
            rows={6}
            placeholder={'---\nname: my-skill\ndescription: When to use it\n---\n# Instructions'}
            value={markdown}
            onChange={(event) => setMarkdown(event.target.value)}
          />
        </div>
        <div className="detail-actions">
          <button
            className="btn-primary"
            disabled={!name.trim() || markdown.trim().length < 20}
            onClick={() =>
              void store
                .installSkill(name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-'), markdown)
                .then(() => {
                  setName('');
                  setMarkdown('');
                  notify('Skill installed.', true);
                })
                .catch((error) => notify(error.message, false))
            }
          >
            <Plus size={12} /> Install skill
          </button>
        </div>
      </Group>
    </>
  );
};

/* -------------------------------------------------------------------------- */
/* Memory                                                                      */
/* -------------------------------------------------------------------------- */

export const MemorySection: React.FC<SectionProps> = ({ store, notify }) => {
  const [text, setText] = useState('');
  const [pinned, setPinned] = useState(true);
  const [query, setQuery] = useState('');
  const save = useSave(store, notify);

  const entries = store.memories.filter((memory) =>
    query.trim() ? memory.content.toLowerCase().includes(query.trim().toLowerCase()) : true,
  );

  return (
    <>
      <Intro>
        Durable facts are stored on this machine and injected only when they match the current task. Everything here can
        be deleted.
      </Intro>

      <div className="inline-row" style={{ marginBottom: 12 }}>
        <input
          className="input-flat"
          style={{ flex: 1 }}
          aria-label="New memory"
          placeholder="A durable preference or project fact…"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && text.trim()) {
              void store.addMemory(text, pinned).then(() => {
                setText('');
                notify('Memory saved.', true);
              });
            }
          }}
        />
        <label className="checkbox-row">
          <input type="checkbox" checked={pinned} onChange={(event) => setPinned(event.target.checked)} />
          <span>Pin</span>
        </label>
        <button
          className="btn-primary"
          disabled={!text.trim()}
          onClick={() =>
            void store
              .addMemory(text, pinned)
              .then(() => {
                setText('');
                notify('Memory saved.', true);
              })
              .catch((error) => notify(error.message, false))
          }
        >
          Add
        </button>
      </div>

      <div className="inline-row" style={{ marginBottom: 10 }}>
        <div className="catalog-search catalog-search-inline">
          <Search size={12} />
          <input
            className="input-flat"
            placeholder={`Search ${store.memories.length} memories…`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <label className="checkbox-row">
          <Toggle
            label="Learn facts automatically"
            checked={store.settings?.memoryAutoExtract !== false}
            onChange={(next) => void save({ memoryAutoExtract: next })}
          />
          <span>Learn automatically</span>
        </label>
      </div>

      <div className="catalog-cards">
        {entries.map((memory) => (
          <div className="list-row" key={memory.id}>
            <div className="list-row-main">
              <span className="list-row-sub">{new Date(memory.updatedAt).toLocaleString()}</span>
              <span>{memory.content}</span>
            </div>
            <div className="list-row-actions">
              {memory.pinned && <span className="wb-badge">pinned</span>}
              <button className="icon-btn" onClick={() => void store.removeMemory(memory.id)} title="Delete memory">
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        ))}
        {store.memories.length === 0 && <div className="catalog-empty">No memories yet.</div>}
        {store.memories.length > 0 && entries.length === 0 && <div className="catalog-empty">No memory matches “{query}”.</div>}
      </div>
    </>
  );
};

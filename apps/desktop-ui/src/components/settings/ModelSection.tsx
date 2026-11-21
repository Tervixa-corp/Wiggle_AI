import React, { useEffect, useMemo, useState } from 'react';
import { Check, ExternalLink, KeyRound, Loader2, Plus, RefreshCw, Search, Trash2, X } from 'lucide-react';
import type { ProviderModel } from '../../store/useWiggleStore';
import { Group, Intro, Note, Row, SelectField, TextField, useSave, type SectionProps } from './primitives';

interface CustomDraft {
  id: string;
  name: string;
  protocol: 'chat' | 'responses' | 'anthropic' | 'gemini';
  baseUrl: string;
  model: string;
  apiKey: string;
}

const EMPTY_DRAFT: CustomDraft = {
  id: '',
  name: '',
  protocol: 'chat',
  baseUrl: '',
  model: '',
  apiKey: '',
};

export const ModelSection: React.FC<SectionProps> = ({ store, notify }) => {
  const save = useSave(store, notify);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(store.settings?.providerId || '');
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [modelQuery, setModelQuery] = useState('');
  const [loadingModels, setLoadingModels] = useState(false);
  const [protocol, setProtocol] = useState(store.settings?.protocol || '');
  const [baseUrl, setBaseUrl] = useState(store.settings?.baseUrl || '');
  const [model, setModel] = useState(store.settings?.model || '');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [draft, setDraft] = useState<CustomDraft>(EMPTY_DRAFT);

  const configuredProvider = store.settings?.providerId || '';
  const selected = store.providers.items.find((entry) => entry.id === selectedId) || null;

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return store.providers.items;
    return store.providers.items.filter((entry) => `${entry.id} ${entry.name} ${entry.doc}`.toLowerCase().includes(needle));
  }, [store.providers.items, query]);

  const filteredModels = useMemo(() => {
    const needle = modelQuery.trim().toLowerCase();
    if (!needle) return models.slice(0, 200);
    return models.filter((entry) => `${entry.id} ${entry.name}`.toLowerCase().includes(needle)).slice(0, 300);
  }, [models, modelQuery]);

  useEffect(() => {
    if (!selected) return;
    setProtocol(selected.id === configuredProvider ? store.settings?.protocol || '' : '');
    setBaseUrl(
      selected.id === configuredProvider
        ? store.settings?.baseUrl || selected.routes[0]?.base || ''
        : selected.routes[0]?.base || '',
    );
    setModel(selected.id === configuredProvider ? store.settings?.model || '' : '');
    setTestResult(null);
    setModelQuery('');
    setLoadingModels(true);
    store
      .loadProviderModels(selected.id)
      .then((list) => setModels(list))
      .catch(() => setModels([]))
      .finally(() => setLoadingModels(false));
    // Keyed to the provider id only: reloading must not reset the draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const saveConnection = async (extra: { apiKey?: string; clearApiKey?: boolean } = {}) => {
    if (!selected) return;
    setBusy(true);
    try {
      await save({
        providerId: selected.id,
        model: model.trim(),
        protocol: protocol as '' | 'chat' | 'responses' | 'anthropic' | 'gemini',
        baseUrl: baseUrl.trim(),
        ...extra,
      });
      setApiKey('');
      notify(`${selected.name} saved.`, true);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not save the provider.', false);
    } finally {
      setBusy(false);
    }
  };

  /** Store a key on its own so it can be saved before a model is picked. */
  const saveKey = async () => {
    if (!selected || !apiKey.trim()) return;
    setBusy(true);
    try {
      // The API files the key under patch.providerId, which defaults to the
      // active provider; name the selected one so a key can be stored before
      // any model (or provider) has been chosen.
      await save({ providerId: selected.id, apiKey: apiKey.trim() });
      setApiKey('');
      notify(`${selected.name} API key saved.`, true);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not save the key.', false);
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    if (!selected) return;
    setBusy(true);
    setTestResult(null);
    try {
      const result = await store.testProvider({
        providerId: selected.id,
        model: model.trim(),
        protocol,
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim() || undefined,
      });
      setTestResult({ ok: true, text: `${result.latencyMs} ms · ${String(result.text ?? '').slice(0, 80) || 'connected'}` });
    } catch (error) {
      setTestResult({ ok: false, text: error instanceof Error ? error.message : 'Connection failed.' });
    } finally {
      setBusy(false);
    }
  };

  const addCustom = async () => {
    const id = draft.id.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').slice(0, 60);
    if (!id || !draft.baseUrl.trim() || !draft.model.trim()) {
      notify('A slug, a base URL and a model id are required.', false);
      return;
    }
    setBusy(true);
    try {
      await save({
        providerId: id,
        protocol: draft.protocol,
        baseUrl: draft.baseUrl.trim(),
        model: draft.model.trim(),
        ...(draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}),
      });
      setSelectedId(id);
      setDraft(EMPTY_DRAFT);
      setCustomOpen(false);
      await store.refreshProviders();
      notify('Custom provider saved and selected.', true);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not add the provider.', false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Intro>
        Bring your own key. The catalog carries {store.providers.items.length} providers speaking four protocols:
        OpenAI Chat Completions, OpenAI Responses, Anthropic Messages and Google Gemini. Keys stay on this machine and
        are never returned to the interface.
      </Intro>

      <div className="inline-row" style={{ marginBottom: 10 }}>
        <div className="catalog-search catalog-search-inline">
          <Search size={12} />
          <input
            className="input-flat"
            placeholder={`Search ${store.providers.items.length} providers…`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <button className="btn-flat" onClick={() => setCustomOpen((value) => !value)}>
          <Plus size={12} /> Custom provider
        </button>
        <button className="icon-btn" title="Refresh providers" onClick={() => void store.refreshProviders()}>
          <RefreshCw size={12} />
        </button>
      </div>

      {customOpen && (
        <div className="settings-form" style={{ marginBottom: 14 }}>
          <Group title="Add a compatible provider">
            <Row title="Slug" description="A short identifier used in settings.json and key storage.">
              <TextField
                label="Provider slug"
                mono
                value={draft.id}
                placeholder="my-gateway"
                onCommit={(next) => setDraft({ ...draft, id: next })}
              />
            </Row>
            <Row title="Base URL" description="HTTPS, or HTTP only on loopback.">
              <TextField
                label="Base URL"
                mono
                value={draft.baseUrl}
                placeholder="https://gateway.example.com/v1"
                onCommit={(next) => setDraft({ ...draft, baseUrl: next })}
              />
            </Row>
            <Row title="Protocol" description="How requests are framed for this endpoint.">
              <SelectField
                label="Protocol"
                value={draft.protocol}
                onChange={(next) => setDraft({ ...draft, protocol: next as CustomDraft['protocol'] })}
                options={[
                  { value: 'chat', label: 'OpenAI Chat Completions' },
                  { value: 'responses', label: 'OpenAI Responses' },
                  { value: 'anthropic', label: 'Anthropic Messages' },
                  { value: 'gemini', label: 'Google Gemini' },
                ]}
              />
            </Row>
            <Row title="Model id" description="The exact model string the endpoint expects.">
              <TextField
                label="Model id"
                mono
                value={draft.model}
                placeholder="vendor/model-name"
                onCommit={(next) => setDraft({ ...draft, model: next })}
              />
            </Row>
            <Row title="API key" description="Optional for local endpoints.">
              <TextField
                label="API key"
                type="password"
                mono
                value={draft.apiKey}
                placeholder="Paste the key"
                onCommit={(next) => setDraft({ ...draft, apiKey: next })}
              />
            </Row>
          </Group>
          <div className="detail-actions">
            <button className="btn-primary" disabled={busy} onClick={() => void addCustom()}>
              {busy ? <Loader2 size={12} className="spin" /> : <Check size={12} />} Add provider
            </button>
            <button className="btn-flat" onClick={() => setCustomOpen(false)}>
              <X size={12} /> Cancel
            </button>
          </div>
        </div>
      )}

      <div className="providers-layout" style={{ minHeight: 420 }}>
        <div className="catalog-list">
          <div className="catalog-scroll">
            {filtered.map((provider) => (
              <button
                key={provider.id}
                className={`catalog-row ${provider.id === selectedId ? 'active' : ''}`}
                onClick={() => setSelectedId(provider.id)}
              >
                <span className="catalog-row-main">
                  <span className="truncate">{provider.name}</span>
                  <span className="catalog-row-sub mono">
                    {provider.id === 'custom' ? 'custom' : `${provider.modelCount} models`}
                    {provider.routes[0] ? ` · ${provider.routes[0].protocol}` : ' · manual endpoint'}
                  </span>
                </span>
                {store.settings?.keyStatus?.[provider.id] && <span className="dot dot-ok" title="Key stored" />}
                {provider.id === configuredProvider && <span className="catalog-active">active</span>}
              </button>
            ))}
            {store.providers.loading && <div className="catalog-empty">Loading providers…</div>}
            {!store.providers.loading && filtered.length === 0 && (
              <div className="catalog-empty">No provider matches “{query}”. Add it as a custom provider.</div>
            )}
          </div>
          <div className="catalog-foot">
            <span>{store.providers.items.length} providers · keys stay server-side</span>
          </div>
        </div>

        <div className="catalog-detail">
          {!selected ? (
            <div className="detail-empty">Select a provider to configure its connection.</div>
          ) : (
            <>
              <div className="detail-head">
                <div>
                  <h3>{selected.name}</h3>
                  <div className="detail-sub mono">{selected.id}</div>
                </div>
                <div className="detail-head-actions">
                  {selected.doc && (
                    <a className="btn-flat btn-compact" href={selected.doc} target="_blank" rel="noreferrer">
                      <ExternalLink size={12} /> Docs
                    </a>
                  )}
                  {store.settings?.keyStatus?.[selected.id] && (
                    <span className="wb-badge">
                      <Check size={10} /> key stored
                    </span>
                  )}
                </div>
              </div>

              {selected.routes.length === 0 && (
                <Note>
                  This provider has no public route in the catalog. Set a protocol and base URL (a local gateway or
                  proxy) to use it.
                </Note>
              )}

              <Group title="Connection">
                <Row title="Protocol" description="Auto uses the catalog route for the selected model.">
                  <SelectField
                    label="Protocol"
                    value={protocol}
                    onChange={setProtocol}
                    options={[
                      { value: '', label: 'Auto from provider route' },
                      { value: 'chat', label: 'OpenAI Chat Completions' },
                      { value: 'responses', label: 'OpenAI Responses' },
                      { value: 'anthropic', label: 'Anthropic Messages' },
                      { value: 'gemini', label: 'Google Gemini' },
                    ]}
                  />
                </Row>
                <Row title="Base URL" description="HTTPS, or HTTP on loopback.">
                  <TextField
                    label="Base URL"
                    mono
                    value={baseUrl}
                    placeholder={selected.routes[0]?.base || 'https://…'}
                    onCommit={(next) => setBaseUrl(next)}
                  />
                </Row>
                <Row title="Model" description={loadingModels ? 'Reading the catalog…' : `${models.length} models in the catalog`}>
                  <input
                    className="input-flat mono"
                    aria-label="Model id"
                    value={model}
                    onChange={(event) => setModel(event.target.value)}
                    placeholder="Exact model id"
                  />
                </Row>
              </Group>

              <div className="model-list" style={{ maxHeight: 180 }}>
                <div className="catalog-search catalog-search-inline" style={{ marginBottom: 6 }}>
                  <Search size={11} />
                  <input
                    className="input-flat"
                    aria-label="Filter models"
                    value={modelQuery}
                    onChange={(event) => setModelQuery(event.target.value)}
                    placeholder="Filter models…"
                  />
                </div>
                {filteredModels.map((entry) => (
                  <button
                    key={entry.id}
                    className={`model-row ${entry.id === model ? 'active' : ''}`}
                    onClick={() => setModel(entry.id)}
                  >
                    <span className="mono truncate">{entry.id}</span>
                    <span className="model-name truncate">{entry.name !== entry.id ? entry.name : ''}</span>
                  </button>
                ))}
                {!loadingModels && filteredModels.length === 0 && (
                  <div className="catalog-empty">No model matches. Type the exact id above.</div>
                )}
              </div>

              <Group title="Credentials">
                <Row
                  title="API key"
                  description={
                    store.settings?.keyStatus?.[selected.id]
                      ? 'A key is stored. Type a new one to replace it.'
                      : 'Paste the key issued by this provider.'
                  }
                >
                  <div className="inline-row" style={{ width: '100%' }}>
                    <input
                      type="password"
                      className="input-flat mono"
                      aria-label="API key"
                      value={apiKey}
                      onChange={(event) => setApiKey(event.target.value)}
                      placeholder={store.settings?.keyStatus?.[selected.id] ? 'Stored — type to replace' : 'Paste the provider key'}
                    />
                    <button
                      className="btn-flat btn-compact"
                      disabled={!apiKey.trim() || busy}
                      title="Save this key without choosing a model"
                      onClick={() => void saveKey()}
                    >
                      <KeyRound size={12} /> Save key
                    </button>
                    {store.settings?.keyStatus?.[selected.id] && (
                      <button
                        className="icon-btn"
                        title="Remove stored key"
                        disabled={busy}
                        onClick={() => void saveConnection({ clearApiKey: true })}
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                </Row>
                {selected.env.length > 0 && (
                  <Note>
                    Headless fallback: set {selected.env.map((name) => <code key={name}>{name}</code>)} in the environment.
                  </Note>
                )}
              </Group>

              <div className="detail-actions">
                <button
                  className="btn-primary"
                  disabled={busy || !model.trim()}
                  onClick={() => void saveConnection(apiKey.trim() ? { apiKey } : {})}
                >
                  {busy ? <Loader2 size={12} className="spin" /> : <Check size={12} />} Save connection
                </button>
                <button className="btn-flat" disabled={busy || !model.trim()} onClick={() => void test()}>
                  Test connection
                </button>
                {testResult && <span className={`test-result ${testResult.ok ? 'ok' : 'error'}`}>{testResult.text}</span>}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
};

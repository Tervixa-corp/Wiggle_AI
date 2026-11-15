import React, { useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import type { MemoryItem, ProviderPreset, SkillItem, StatusInfo, WiggleSettings } from '../store/useWiggleStore';

export const SETTINGS_SECTIONS = [
  'Identity & System Prompt',
  'Models & BYOK Providers',
  'Agents & Parallel Swarm',
  'MCP Connectors',
  'Skills & Plugins',
  'Personal Memory Vault',
  'Permissions & Sandbox',
  'Built-in Browser',
  'Git & GitHub Integration',
  'Appearance & Keybindings',
];

interface Props {
  open: boolean;
  section: string;
  onSelectSection: (s: string) => void;
  onClose: () => void;
  settings: WiggleSettings | null;
  presets: ProviderPreset[];
  skills: SkillItem[];
  memories: MemoryItem[];
  mcpServers: Record<string, any>;
  mcpCatalog: any[];
  status: StatusInfo | null;
  onSaveSettings: (patch: Partial<WiggleSettings> & { apiKey?: string }) => Promise<void>;
  onRefreshMetadata: () => Promise<void>;
}

export const SettingsModal: React.FC<Props> = ({
  open,
  section,
  onSelectSection,
  onClose,
  settings,
  presets,
  skills,
  memories,
  mcpServers,
  mcpCatalog,
  status,
  onSaveSettings,
  onRefreshMetadata,
}) => {
  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const [newMemoryText, setNewMemoryText] = useState('');
  const [newSkillName, setNewSkillName] = useState('');
  const [newSkillMd, setNewSkillMd] = useState('');
  const [mcpJsonDraft, setMcpJsonDraft] = useState('');

  if (!open) return null;

  const s = settings || {
    activeProvider: 'openai',
    activeModel: '',
    baseUrl: 'https://api.openai.com/v1',
    approvalMode: 'suggest',
    maxParallelAgents: 4,
    customIdentityInstructions: '',
    theme: 'dark',
    memoryAutoExtract: true,
    browserHeadless: true,
    disabledSkills: [],
    shellAllowlist: [],
    roleModels: {},
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-panel" role="dialog" aria-modal="true" aria-label="Settings">
        <div className="modal-header">
          <strong style={{ fontSize: 13 }}>Settings Control Center</strong>
          <button className="icon-btn" onClick={onClose} aria-label="Close settings">
            <X size={15} />
          </button>
        </div>

        <div className="modal-content">
          <nav className="settings-sidebar">
            {SETTINGS_SECTIONS.map((item) => (
              <button
                key={item}
                className={`settings-nav-btn ${section === item ? 'active' : ''}`}
                onClick={() => onSelectSection(item)}
              >
                {item}
              </button>
            ))}
          </nav>

          <div className="settings-body">
            <h2>{section}</h2>

            {section === 'Identity & System Prompt' && (
              <>
                <p className="settings-desc">
                  Immutable Tervixa Wiggle system identity is always prepended first. Add custom workstation rules below.
                </p>
                <div className="field-group">
                  <label className="field-label">Custom Persona / System Instructions</label>
                  <textarea
                    className="input-flat mono"
                    style={{ width: '100%', height: 120, padding: 10 }}
                    value={s.customIdentityInstructions}
                    onChange={(e) => onSaveSettings({ customIdentityInstructions: e.target.value })}
                    placeholder="E.g., Prefer minimal diffs and always include unit tests..."
                  />
                </div>
              </>
            )}

            {section === 'Models & BYOK Providers' && (
              <>
                <p className="settings-desc">
                  Connect 200+ BYOK models via Models.dev, OpenRouter, Anthropic, OpenAI, Gemini, DeepSeek, or local Ollama/LM Studio/vLLM. Keys remain server-side.
                </p>
                <div className="field-group">
                  <label className="field-label">Active Provider Preset ({presets.length} built-in)</label>
                  <select
                    className="select-flat"
                    style={{ width: '100%', height: 32 }}
                    value={s.activeProvider}
                    onChange={(e) => {
                      const preset = presets.find((p) => p.id === e.target.value);
                      onSaveSettings({
                        activeProvider: e.target.value,
                        baseUrl: preset?.baseUrl || s.baseUrl,
                        activeModel: preset?.defaultModel || s.activeModel,
                      });
                    }}
                  >
                    {presets.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.protocol})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field-group">
                  <label className="field-label">Model ID</label>
                  <input
                    className="input-flat mono"
                    style={{ width: '100%' }}
                    value={s.activeModel}
                    onChange={(e) => onSaveSettings({ activeModel: e.target.value })}
                    placeholder="gpt-4.1, claude-sonnet-4-5, qwen2.5-coder:14b..."
                  />
                </div>
                <div className="field-group">
                  <label className="field-label">Base URL</label>
                  <input
                    className="input-flat mono"
                    style={{ width: '100%' }}
                    value={s.baseUrl}
                    onChange={(e) => onSaveSettings({ baseUrl: e.target.value })}
                  />
                </div>
                <div className="field-group">
                  <label className="field-label">Runtime API Key (stored in server memory only)</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      type="password"
                      className="input-flat mono"
                      style={{ flex: 1 }}
                      value={apiKeyDraft}
                      onChange={(e) => setApiKeyDraft(e.target.value)}
                      placeholder="sk-..."
                    />
                    <button
                      className="btn-primary"
                      onClick={async () => {
                        await onSaveSettings({ apiKey: apiKeyDraft, activeProvider: s.activeProvider });
                        setApiKeyDraft('');
                      }}
                    >
                      Save Key
                    </button>
                  </div>
                </div>
                <div className="field-group">
                  <label className="field-label">Per-Role Model Routing</label>
                  {['orchestrator', 'coder', 'explorer', 'browser', 'reviewer'].map((role) => (
                    <div key={role} style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
                      <span className="mono" style={{ width: 110, fontSize: 11.5 }}>{role}</span>
                      <input
                        className="input-flat mono"
                        style={{ flex: 1 }}
                        value={s.roleModels?.[role] || ''}
                        onChange={(e) =>
                          onSaveSettings({ roleModels: { ...(s.roleModels || {}), [role]: e.target.value } })
                        }
                        placeholder="Inherit active model"
                      />
                    </div>
                  ))}
                </div>
              </>
            )}

            {section === 'Agents & Parallel Swarm' && (
              <>
                <p className="settings-desc">
                  Configure SwarmOrchestrator concurrency and FileCoordinator in-memory leases.
                </p>
                <div className="field-group">
                  <label className="field-label">Max Parallel Subagents</label>
                  <input
                    type="number"
                    min={1}
                    max={12}
                    className="input-flat"
                    value={s.maxParallelAgents}
                    onChange={(e) => onSaveSettings({ maxParallelAgents: Number(e.target.value) || 4 })}
                  />
                </div>
              </>
            )}

            {section === 'MCP Connectors' && (
              <>
                <p className="settings-desc">
                  1-click MCP catalog and Claude Desktop compatible mcpServers JSON importer (stdio / SSE / Streamable HTTP).
                </p>
                <div className="field-group">
                  <label className="field-label">1-Click Catalog</label>
                  {mcpCatalog.map((c) => {
                    const enabled = mcpServers[c.id]?.enabled;
                    return (
                      <div key={c.id} className="kv-row" style={{ padding: '6px 0' }}>
                        <div>
                          <strong className="mono">{c.id}</strong>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.description}</div>
                        </div>
                        <button
                          className="btn-flat"
                          onClick={async () => {
                            await fetch('/api/mcp', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                name: c.id,
                                server: { transport: c.transport, command: c.command, args: c.args, enabled: !enabled },
                              }),
                            });
                            onRefreshMetadata();
                          }}
                        >
                          {enabled ? 'Disable' : 'Enable'}
                        </button>
                      </div>
                    );
                  })}
                </div>
                <div className="field-group">
                  <label className="field-label">Import mcpServers JSON</label>
                  <textarea
                    className="input-flat mono"
                    style={{ width: '100%', height: 80, padding: 8 }}
                    placeholder='{"mcpServers":{"custom":{"command":"npx","args":["-y","..."]}}}'
                    value={mcpJsonDraft}
                    onChange={(e) => setMcpJsonDraft(e.target.value)}
                  />
                  <button
                    className="btn-flat"
                    style={{ marginTop: 6 }}
                    onClick={async () => {
                      try {
                        const parsed = JSON.parse(mcpJsonDraft);
                        await fetch('/api/mcp', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify(parsed),
                        });
                        setMcpJsonDraft('');
                        onRefreshMetadata();
                      } catch {
                        // ignore invalid JSON
                      }
                    }}
                  >
                    Import JSON
                  </button>
                </div>
              </>
            )}

            {section === 'Skills & Plugins' && (
              <>
                <p className="settings-desc">
                  Manage bundled and project SKILL.md packages matched dynamically in Stage 4 of the PromptCompiler.
                </p>
                {skills.map((sk) => (
                  <div key={sk.id} className="kv-row" style={{ padding: '7px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                    <div>
                      <strong className="mono">{sk.name}</strong> <span className="wb-badge">{sk.source}</span>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{sk.description}</div>
                    </div>
                    <button
                      className="btn-flat"
                      onClick={async () => {
                        await fetch('/api/skills/toggle', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ name: sk.name, enabled: !sk.enabled }),
                        });
                        onRefreshMetadata();
                      }}
                    >
                      {sk.enabled ? 'Enabled' : 'Disabled'}
                    </button>
                  </div>
                ))}
                <div className="field-group" style={{ marginTop: 14 }}>
                  <label className="field-label">Add / Import SKILL.md</label>
                  <input
                    className="input-flat mono"
                    style={{ width: '100%', marginBottom: 6 }}
                    placeholder="skill-name"
                    value={newSkillName}
                    onChange={(e) => setNewSkillName(e.target.value)}
                  />
                  <textarea
                    className="input-flat mono"
                    style={{ width: '100%', height: 70, padding: 8 }}
                    placeholder="---\nname: my-skill\ndescription: ...\n---\n# Instructions"
                    value={newSkillMd}
                    onChange={(e) => setNewSkillMd(e.target.value)}
                  />
                  <button
                    className="btn-flat"
                    style={{ marginTop: 6 }}
                    onClick={async () => {
                      await fetch('/api/skills/import', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name: newSkillName, markdown: newSkillMd }),
                      });
                      setNewSkillName('');
                      setNewSkillMd('');
                      onRefreshMetadata();
                    }}
                  >
                    <Plus size={12} /> Install Skill
                  </button>
                </div>
              </>
            )}

            {section === 'Personal Memory Vault' && (
              <>
                <p className="settings-desc">
                  Durable user facts, stack preferences, and past session summaries injected into Stage 2 of every prompt.
                </p>
                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                  <input
                    className="input-flat"
                    style={{ flex: 1 }}
                    placeholder="Add a durable preference or project fact..."
                    value={newMemoryText}
                    onChange={(e) => setNewMemoryText(e.target.value)}
                  />
                  <button
                    className="btn-primary"
                    onClick={async () => {
                      if (!newMemoryText.trim()) return;
                      await fetch('/api/memory', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ content: newMemoryText, category: 'preference', pinned: true }),
                      });
                      setNewMemoryText('');
                      onRefreshMetadata();
                    }}
                  >
                    Pin Fact
                  </button>
                </div>
                {memories.map((m) => (
                  <div key={m.id} className="kv-row" style={{ padding: '7px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                    <div>
                      <span className="wb-badge" style={{ marginRight: 6 }}>{m.category}</span>
                      <span>{m.content}</span>
                    </div>
                    <button
                      className="icon-btn"
                      onClick={async () => {
                        await fetch(`/api/memory?id=${encodeURIComponent(m.id)}`, { method: 'DELETE' });
                        onRefreshMetadata();
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </>
            )}

            {section === 'Permissions & Sandbox' && (
              <>
                <p className="settings-desc">
                  Codex-inspired three-tier execution policy and workspace path traversal enforcement.
                </p>
                <div className="field-group">
                  <label className="field-label">Approval Mode</label>
                  <select
                    className="select-flat"
                    style={{ width: '100%', height: 32 }}
                    value={s.approvalMode}
                    onChange={(e) => onSaveSettings({ approvalMode: e.target.value as any })}
                  >
                    <option value="suggest">Suggest (Read-only auto; prompt for edits & shell)</option>
                    <option value="auto_edit">Auto-Edit (Allow workspace edits; gate shell)</option>
                    <option value="full_auto">Full-Auto (Allow workspace tools & terminal)</option>
                  </select>
                </div>
                <div className="field-group">
                  <label className="field-label">Shell Command Allowlist (comma-separated prefixes)</label>
                  <input
                    className="input-flat mono"
                    style={{ width: '100%' }}
                    value={(s.shellAllowlist || []).join(', ')}
                    onChange={(e) =>
                      onSaveSettings({
                        shellAllowlist: e.target.value.split(',').map((x) => x.trim()).filter(Boolean),
                      })
                    }
                  />
                </div>
              </>
            )}

            {section === 'Built-in Browser' && (
              <>
                <p className="settings-desc">
                  Controls embedded browser preview and headless DOM accessibility tree inspection.
                </p>
                <div className="kv-row">
                  <span>Headless DOM extraction</span>
                  <button
                    className="btn-flat"
                    onClick={() => onSaveSettings({ browserHeadless: !s.browserHeadless })}
                  >
                    {s.browserHeadless ? 'Enabled' : 'Disabled'}
                  </button>
                </div>
              </>
            )}

            {section === 'Git & GitHub Integration' && (
              <>
                <p className="settings-desc">
                  Active repository status. Parallel agents work in-place on the active branch via FileCoordinator.
                </p>
                <div className="kv-row">
                  <span>Workspace</span>
                  <strong className="mono">{status?.workspaceName || 'local'}</strong>
                </div>
                <div className="kv-row">
                  <span>Active Branch</span>
                  <strong className="mono">{status?.gitBranch || 'unknown'}</strong>
                </div>
              </>
            )}

            {section === 'Appearance & Keybindings' && (
              <>
                <p className="settings-desc">
                  Strictly flat industrial monochrome theme with zero gradients or glows.
                </p>
                <div className="field-group">
                  <label className="field-label">Color Theme</label>
                  <select
                    className="select-flat"
                    style={{ width: 220, height: 32 }}
                    value={s.theme}
                    onChange={(e) => onSaveSettings({ theme: e.target.value as 'dark' | 'light' })}
                  >
                    <option value="dark">Carbon Dark (#0A0A0A)</option>
                    <option value="light">Crisp Light (#FFFFFF)</option>
                  </select>
                </div>
                <div className="kv-row">
                  <span>Command Palette / Quick Open</span>
                  <kbd className="wb-badge">Ctrl / Cmd + K or P</kbd>
                </div>
                <div className="kv-row">
                  <span>Open Settings</span>
                  <kbd className="wb-badge">Ctrl / Cmd + ,</kbd>
                </div>
                <div className="kv-row">
                  <span>Save Active File</span>
                  <kbd className="wb-badge">Ctrl / Cmd + S</kbd>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

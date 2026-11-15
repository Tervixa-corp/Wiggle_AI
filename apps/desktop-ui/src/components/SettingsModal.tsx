import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { useWiggle } from '../store/useWiggleStore';

const SECTIONS = [
  { id: 'identity', label: 'Identity & system prompt' },
  { id: 'models', label: 'Models & providers' },
  { id: 'agents', label: 'Agents & concurrency' },
  { id: 'mcp', label: 'MCP connectors' },
  { id: 'skills', label: 'Skills & plugins' },
  { id: 'memory', label: 'Personal memory' },
  { id: 'permissions', label: 'Permissions & sandbox' },
  { id: 'browser', label: 'Built-in browser' },
  { id: 'git', label: 'Git & GitHub' },
  { id: 'appearance', label: 'Appearance & keys' },
] as const;

type SectionId = (typeof SECTIONS)[number]['id'];

function NotYet({ children }: { children: ReactNode }) {
  return <p className="note">{children}</p>;
}

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const { status, offline, skills, facts, addFact, removeFact, light, setLight, session } = useWiggle();
  const [section, setSection] = useState<SectionId>('identity');
  const [draft, setDraft] = useState('');

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const rules = status?.rules ?? {};

  return (
    <div className="backdrop" role="dialog" aria-modal="true" aria-label="Settings" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal">
        <div className="modal-head">
          <h2>Settings</h2>
          <span className="spacer" />
          {offline && <span className="tag">server offline</span>}
          <button className="icon-button" onClick={onClose} aria-label="Close settings"><X size={14} /></button>
        </div>

        <div className="modal-body">
          <nav className="settings-nav" aria-label="Settings sections">
            {SECTIONS.map((entry) => (
              <button key={entry.id} className={section === entry.id ? 'active' : ''} onClick={() => setSection(entry.id)}>
                {entry.label}
              </button>
            ))}
          </nav>

          <div className="settings-content">
            {section === 'identity' && (
              <>
                <h3>Identity & system prompt</h3>
                <p className="lede">
                  Wiggle prepends a fixed identity to every request, then seven further context stages. The
                  identity is compiled into the binary, not read from configuration.
                </p>
                <div className="row" style={{ border: '1px solid var(--border-subtle)', borderRadius: 3 }}>
                  <span className="val" style={{ whiteSpace: 'pre-wrap', fontFamily: 'var(--font-mono)', lineHeight: 1.6 }}>
                    You are Tervixa Wiggle, an autonomous software engineering agent developed by Tervixa
                    Corporation (Tervixa Forge).
                  </span>
                </div>
                <div className="setting">
                  <div className="label">
                    <strong>Project instructions</strong>
                    <small>WIGGLE.md, CLAUDE.md, AGENTS.md and .cursorrules in the workspace root are injected each turn.</small>
                  </div>
                  <div className="control"><span className="pill">WIGGLE.md</span></div>
                </div>
                <NotYet>Editing the persona rules from the UI is not implemented; the identity text is intentionally immutable.</NotYet>
              </>
            )}

            {section === 'models' && (
              <>
                <h3>Models & providers</h3>
                <p className="lede">Provider settings come from the server environment and are never sent to the browser.</p>
                <div className="mono-list" style={{ border: '1px solid var(--border-subtle)', borderRadius: 3 }}>
                  <div className="row"><span className="key">model</span><span className="val">{status?.model || '—'}</span></div>
                  <div className="row"><span className="key">api</span><span className="val">{status?.api || '—'}</span></div>
                  <div className="row"><span className="key">host</span><span className="val">{status?.provider || '—'}</span></div>
                  <div className="row"><span className="key">key</span><span className="val">{status ? 'stored on server' : '—'}</span></div>
                </div>
                <NotYet>
                  Supported adapters: OpenAI-compatible chat completions (OpenAI, OpenRouter, Groq, DeepSeek,
                  Together, Fireworks, Cerebras, Ollama, LM Studio, vLLM and compatible gateways) and the
                  native Anthropic Messages API. A per-role model picker is not implemented; configure one
                  model with WIGGLE_MODEL.
                </NotYet>
              </>
            )}

            {section === 'agents' && (
              <>
                <h3>Agents & concurrency</h3>
                <p className="lede">One agent runs per session. Parallel execution is not implemented.</p>
                <div className="setting">
                  <div className="label"><strong>Step budget</strong><small>Maximum model↔tool round trips per message.</small></div>
                  <div className="control"><span className="pill on">{status?.maxSteps ?? '—'}</span></div>
                </div>
                <div className="setting">
                  <div className="label"><strong>Tool calls in this session</strong><small>Counted across every assistant turn.</small></div>
                  <div className="control"><span className="pill">{session.messages.reduce((total, message) => total + message.tools.length, 0)}</span></div>
                </div>
                <NotYet>Set WIGGLE_MAX_STEPS to change the budget. Swarm orchestration and file leases are specified but not built.</NotYet>
              </>
            )}

            {section === 'mcp' && (
              <>
                <h3>MCP connectors</h3>
                <p className="lede">No MCP servers are connected in this build.</p>
                <NotYet>
                  The Model Context Protocol host — stdio, SSE and Streamable HTTP transports with tools,
                  resources and prompts — is not implemented. No mcpServers configuration is read, so
                  nothing is silently connected.
                </NotYet>
              </>
            )}

            {section === 'skills' && (
              <>
                <h3>Skills & plugins</h3>
                <p className="lede">SKILL.md folders are loaded from bundled-skills/, .wiggle/skills/ and ~/.wiggle/skills/. Matching skills are injected into the prompt.</p>
                <div className="mono-list" style={{ border: '1px solid var(--border-subtle)', borderRadius: 3 }}>
                  {skills.length === 0 && <div className="row"><span className="val">No skills loaded.</span></div>}
                  {skills.map((skill) => (
                    <div className="row" key={skill.name}>
                      <span className="val">{skill.name}</span>
                      <span className="spacer" />
                      <span className="key">{skill.source}</span>
                    </div>
                  ))}
                </div>
                <NotYet>Lifecycle hooks (PreToolUse, PostToolUse, Stop) and the Claude/OpenCode skill importer are not implemented.</NotYet>
              </>
            )}

            {section === 'memory' && (
              <>
                <h3>Personal memory</h3>
                <p className="lede">Facts you add here are retrieved by keyword overlap and injected into every prompt that matches them.</p>
                <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                  <input
                    className="field"
                    placeholder="e.g. Prefers pnpm and strict TypeScript"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && draft.trim()) {
                        void addFact(draft.trim());
                        setDraft('');
                      }
                    }}
                  />
                  <button
                    className="button primary"
                    disabled={!draft.trim()}
                    onClick={() => {
                      void addFact(draft.trim());
                      setDraft('');
                    }}
                  >
                    <Plus size={12} /> Add
                  </button>
                </div>
                {facts.length === 0 ? (
                  <p className="empty-copy" style={{ fontSize: 11.5 }}>No facts stored yet.</p>
                ) : (
                  facts.map((fact) => (
                    <div className="fact" key={fact.id}>
                      <span className="text">{fact.text}</span>
                      {fact.pinned && <span className="pin">pinned</span>}
                      <button className="icon-button" onClick={() => void removeFact(fact.id)} aria-label="Delete fact"><Trash2 size={12} /></button>
                    </div>
                  ))
                )}
                <NotYet>Automatic fact extraction from conversations and embedding-based retrieval are not implemented.</NotYet>
              </>
            )}

            {section === 'permissions' && (
              <>
                <h3>Permissions & sandbox</h3>
                <p className="lede">
                  Preset <strong>{status?.permissions ?? '—'}</strong>. Every tool call passes through this gate; denials are final for that call.
                </p>
                <div className="mono-list" style={{ border: '1px solid var(--border-subtle)', borderRadius: 3 }}>
                  {Object.entries(rules).sort(([a], [b]) => a.localeCompare(b)).map(([tool, rule]) => (
                    <div className="row" key={tool}>
                      <span className="val">{tool}</span>
                      <span className="spacer" />
                      <span className={`pill ${rule === 'allow' ? 'on' : ''}`}>{rule}</span>
                    </div>
                  ))}
                </div>
                <NotYet>
                  Set WIGGLE_PERMISSIONS to readonly, standard or full. Paths are confined to the workspace
                  root and symlinked directories cannot escape it. Undo covers file writes and edits made
                  through tools; files changed by shell commands are not snapshotted.
                </NotYet>
              </>
            )}

            {section === 'browser' && (
              <>
                <h3>Built-in browser</h3>
                <p className="lede">The browser pane renders a URL for you to inspect. It is not agent-controllable.</p>
                <NotYet>
                  Accessibility-tree extraction, DOM actuation, console streaming and screenshot capture are
                  not implemented. No automation engine is bundled, so the agent cannot click or read pages.
                </NotYet>
              </>
            )}

            {section === 'git' && (
              <>
                <h3>Git & GitHub</h3>
                <div className="mono-list" style={{ border: '1px solid var(--border-subtle)', borderRadius: 3 }}>
                  <div className="row"><span className="key">workspace</span><span className="val">{status?.workspace.root || '—'}</span></div>
                  <div className="row"><span className="key">branch</span><span className="val">{status?.branch || 'not a repository'}</span></div>
                </div>
                <NotYet>
                  Wiggle never commits or pushes. Auto-commit, remote configuration and PR creation are not
                  implemented; commits stay a deliberate human action.
                </NotYet>
              </>
            )}

            {section === 'appearance' && (
              <>
                <h3>Appearance & keybindings</h3>
                <div className="setting">
                  <div className="label"><strong>Theme</strong><small>Flat carbon dark, or crisp light. No gradients in either.</small></div>
                  <div className="control">
                    <button className={`button ${light ? '' : 'primary'}`} onClick={() => setLight(false)}>Dark</button>
                    <button className={`button ${light ? 'primary' : ''}`} onClick={() => setLight(true)}>Light</button>
                  </div>
                </div>
                <div className="setting">
                  <div className="label"><strong>Keyboard</strong><small>Global shortcuts available in the workbench.</small></div>
                  <div className="control">
                    <span className="pill-list">
                      <span className="pill">Ctrl+K focus</span>
                      <span className="pill">Ctrl+B sidebar</span>
                      <span className="pill">Ctrl+J panel</span>
                      <span className="pill">Ctrl+, settings</span>
                      <span className="pill">Esc close</span>
                    </span>
                  </div>
                </div>
                <NotYet>Font size, custom keybindings and a command palette are not implemented.</NotYet>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

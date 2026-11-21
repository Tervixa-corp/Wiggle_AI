import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUp,
  AtSign,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  Loader2,
  Pencil,
  Plug,
  Search,
  ShieldAlert,
  Slash,
  Sparkles,
  Square,
  Terminal,
  X,
} from 'lucide-react';
import type { ChatMessage, FileNode, ToolRun, WiggleStore } from '../store/useWiggleStore';

interface Props {
  store: WiggleStore;
}

const BUILTIN_COMMANDS = [
  { command: '/undo', description: 'Roll the workspace back one snapshot' },
  { command: '/redo', description: 'Re-apply the last undone snapshot' },
  { command: '/clear', description: 'Clear this session' },
  { command: '/swarm', description: 'Plan the prompt as a multi-role swarm' },
];

function flattenPaths(nodes: FileNode[]): string[] {
  const out: string[] = [];
  for (const node of nodes) {
    if (node.isDir && node.children) out.push(...flattenPaths(node.children));
    else if (!node.isDir) out.push(node.path);
  }
  return out;
}

/** Minimal fenced-code renderer; everything else stays pre-wrapped text. */
const MessageText: React.FC<{ text: string }> = ({ text }) => {
  const parts = text.split(/(```[\s\S]*?```)/g);
  return (
    <div className="msg-text">
      {parts.map((part, index) => {
        if (part.startsWith('```') && part.endsWith('```')) {
          const body = part.slice(3, -3);
          const newline = body.indexOf('\n');
          const language = newline > 0 ? body.slice(0, newline).trim() : '';
          const code = newline > 0 ? body.slice(newline + 1) : body;
          return (
            <div className="code-block" key={index}>
              {language && <span className="code-lang">{language}</span>}
              <pre>{code.replace(/\n$/, '')}</pre>
            </div>
          );
        }
        return (
          <span key={index} className="msg-text-plain">
            {part}
          </span>
        );
      })}
    </div>
  );
};

/* ------------------------------------------------------------------------- */
/* Tool presentation                                                         */
/* ------------------------------------------------------------------------- */

type DiffLine = { kind: 'same' | 'add' | 'del'; text: string };

/** LCS diff, bounded so one enormous file cannot stall the renderer. */
function diffLines(before: string, after: string): DiffLine[] | null {
  const a = before.split('\n');
  const b = after.split('\n');
  if (a.length > 600 || b.length > 600) return null;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const table: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i] });
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      out.push({ kind: 'del', text: a[i] });
      i += 1;
    } else {
      out.push({ kind: 'add', text: b[j] });
      j += 1;
    }
  }
  while (i < a.length) out.push({ kind: 'del', text: a[i++] });
  while (j < b.length) out.push({ kind: 'add', text: b[j++] });
  return out;
}

const TOOL_ICON: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  read_file: FileText,
  write_file: Pencil,
  edit_file: Pencil,
  list_dir: Folder,
  glob: Search,
  grep: Search,
  run_command: Terminal,
  add_skill: Sparkles,
  add_mcp_server: Plug,
};

const clip = (value: unknown, limit = 72): string => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
};

/** One line that says what the call did, in the shape of the tool. */
function toolSummary(tool: ToolRun): string {
  const input = tool.input ?? {};
  switch (tool.name) {
    case 'run_command':
      return clip(input.command, 80) || 'command';
    case 'read_file':
    case 'write_file':
    case 'edit_file':
      return clip(input.path, 80) || 'file';
    case 'list_dir':
      return clip(input.path || '.', 60);
    case 'glob':
      return clip(input.pattern, 60);
    case 'grep':
      return `/${clip(input.pattern, 60)}/`;
    case 'add_skill':
      return clip(input.name || input.source_url || 'skill', 60);
    case 'add_mcp_server':
      return clip(input.name || input.url, 60);
    default:
      if (tool.name.startsWith('mcp__')) return tool.name.replace(/^mcp__/, '').replace(/__/g, ' · ');
      return '';
  }
}

const DiffBlock: React.FC<{ before: string; after: string; path?: string }> = ({ before, after, path }) => {
  const lines = useMemo(() => diffLines(before, after), [before, after]);
  if (!lines) {
    return <pre className="tool-pre">{`… ${before.split('\n').length} → ${after.split('\n').length} lines (diff hidden)`}</pre>;
  }
  const added = lines.filter((line) => line.kind === 'add').length;
  const removed = lines.filter((line) => line.kind === 'del').length;
  return (
    <div className="diff-block">
      <div className="diff-head mono">
        {path && <span className="diff-path">{path}</span>}
        <span className="diff-counts">
          <span className="diff-plus">+{added}</span> <span className="diff-minus">−{removed}</span>
        </span>
      </div>
      <pre className="diff-pre">
        {lines.map((line, index) => (
          <div className={`diff-line diff-${line.kind}`} key={index}>
            <span className="diff-gutter">{line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' '}</span>
            <span className="diff-text">{line.text || ' '}</span>
          </div>
        ))}
      </pre>
    </div>
  );
};

const ToolCard: React.FC<{ tool: ToolRun; defaultOpen?: boolean }> = ({ tool, defaultOpen = false }) => {
  const failed = tool.status === 'error' || tool.status === 'denied';
  const [open, setOpen] = useState(defaultOpen || failed);
  const Icon = TOOL_ICON[tool.name] ?? (tool.name.startsWith('mcp__') ? Plug : Terminal);
  const before = typeof tool.meta?.before === 'string' ? tool.meta.before : null;
  const after = typeof tool.meta?.after === 'string' ? tool.meta.after : null;
  const isEdit = tool.name === 'write_file' || tool.name === 'edit_file';
  const isCommand = tool.name === 'run_command';
  const summary = toolSummary(tool);

  return (
    <div className={`tool-card tool-${tool.status}`}>
      <button className="tool-card-head" onClick={() => setOpen((value) => !value)}>
        <span className="tool-card-title">
          {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          <Icon size={12} className="tool-icon" />
          <span className="tool-name">{tool.name}</span>
          {summary && <span className="tool-summary mono">{summary}</span>}
        </span>
        <span className="tool-card-meta">
          {tool.status === 'running' ? (
            <Loader2 size={11} className="spin" />
          ) : (
            <span className={`tool-status tool-status-${tool.status}`}>
              {tool.status === 'ok' ? <Check size={10} /> : <X size={10} />}
              {typeof tool.durationMs === 'number' ? `${tool.durationMs} ms` : tool.status}
            </span>
          )}
        </span>
      </button>
      {open && (
        <div className="tool-card-body">
          {isEdit && before !== null && after !== null ? (
            <DiffBlock before={before} after={after} path={typeof tool.input.path === 'string' ? tool.input.path : ''} />
          ) : isEdit && typeof tool.input.content === 'string' ? (
            <pre className="tool-pre">{clip(tool.input.content, 4000)}</pre>
          ) : null}

          {isCommand ? (
            <div className="terminal-block">
              <div className="terminal-cmd mono">
                <span className="terminal-prompt">$</span> {String(tool.input.command ?? '')}
              </div>
              {tool.output !== undefined && <pre className="terminal-out mono">{tool.output.replace(/^exit \d+\n?/, '') || '(no output)'}</pre>}
            </div>
          ) : null}

          {!isEdit && !isCommand && Object.keys(tool.input ?? {}).length > 0 && (
            <>
              <div className="tool-section-label">INPUT</div>
              <pre className="tool-pre">{JSON.stringify(tool.input, null, 2)}</pre>
            </>
          )}

          {!isCommand && !isEdit && tool.output !== undefined && tool.output !== '' && (
            <>
              <div className="tool-section-label">{failed ? 'ERROR' : 'RESULT'}</div>
              <pre className="tool-pre">{tool.output}</pre>
            </>
          )}
        </div>
      )}
    </div>
  );
};

/** Collapsible reasoning, open while it streams and closed once answered. */
const ThinkingBlock: React.FC<{ text: string; streaming: boolean }> = ({ text, streaming }) => {
  const [open, setOpen] = useState(streaming);
  const was = useRef(streaming);
  useEffect(() => {
    if (streaming && !was.current) setOpen(true);
    if (!streaming && was.current) setOpen(false);
    was.current = streaming;
  }, [streaming]);
  return (
    <div className={`thinking-block${open ? ' is-open' : ''}`}>
      <button className="thinking-head" onClick={() => setOpen((value) => !value)}>
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <Brain size={12} className="thinking-icon" />
        <span>Thinking</span>
        {streaming && <Loader2 size={11} className="spin" />}
      </button>
      {open && <div className="thinking-body">{text}</div>}
    </div>
  );
};

const MessageBlock: React.FC<{ message: ChatMessage; verboseTools: boolean; showChangedFiles: boolean }> = ({
  message,
  verboseTools,
  showChangedFiles,
}) => {
  const meta = message.meta;
  return (
    <div className={`msg-block msg-${message.role}`}>
      <div className="msg-meta">
        <span className="msg-role-tag">
          {message.role === 'user' ? 'YOU' : message.role === 'assistant' ? 'WIGGLE' : 'SYSTEM'}
        </span>
        {message.role === 'assistant' && meta?.provider && (
          <span className="msg-meta-item mono">
            {meta.provider} · {meta.model}
          </span>
        )}
        {message.role === 'assistant' && meta?.step ? (
          <span className="msg-meta-item mono">
            step {meta.step}
            {meta.maxSteps ? `/${meta.maxSteps}` : ''}
          </span>
        ) : null}
        {message.role === 'assistant' && message.streaming && (
          <span className="msg-meta-item">
            <Loader2 size={10} className="spin" /> streaming
          </span>
        )}
      </div>

      {message.thinking ? (
        <ThinkingBlock text={message.thinking} streaming={Boolean(message.streaming) && !message.text} />
      ) : null}

      {message.text ? <MessageText text={message.text} /> : message.streaming ? (
        <div className="msg-text msg-placeholder">
          <Loader2 size={12} className="spin" /> Working…
        </div>
      ) : null}

      {(message.tools?.length ?? 0) > 0 && (
        <div className="tool-stack">
          {message.tools?.map((tool) => (
            <ToolCard key={tool.id} tool={tool} defaultOpen={verboseTools} />
          ))}
        </div>
      )}

      {meta?.notices?.map((notice, index) => (
        <div className="msg-notice" key={index}>
          {notice}
        </div>
      ))}

      {showChangedFiles && message.role === 'assistant' && (message.tools?.length ?? 0) === 0 && meta?.touched && meta.touched.length > 0 && (
        <div className="msg-notice">Touched: {meta.touched.join(', ')}</div>
      )}
    </div>
  );
};

export const ChatWorkbench: React.FC<Props> = ({ store }) => {
  const { activeSession, status, agentMode, setAgentMode, attachments } = store;
  const pending = store.pendingSessionIds.includes(activeSession.id);
  const [input, setInput] = useState('');
  const [showAtMenu, setShowAtMenu] = useState(false);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [atFilter, setAtFilter] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const filePaths = useMemo(() => flattenPaths(store.tree).slice(0, 400), [store.tree]);
  const filteredFiles = useMemo(() => {
    const query = atFilter.toLowerCase();
    return filePaths.filter((path) => !query || path.toLowerCase().includes(query)).slice(0, 30);
  }, [filePaths, atFilter]);

  const slashCommands = useMemo(() => {
    const builtins = BUILTIN_COMMANDS.map((entry) => ({
      command: entry.command,
      description: entry.description,
      plugin: 'core',
    }));
    const plugin = store.pluginCommands.map((entry) => ({
      command: entry.command,
      description: `${entry.description || 'Plugin command'} · ${entry.plugin}`,
      plugin: entry.plugin,
    }));
    const query = input.startsWith('/') ? input.toLowerCase() : '';
    return [...builtins, ...plugin]
      .filter((entry) => !query || entry.command.toLowerCase().startsWith(query))
      .slice(0, 40);
  }, [store.pluginCommands, input]);

  const lastLength = activeSession.messages.reduce(
    (total, message) => total + message.text.length + (message.tools?.length ?? 0),
    0,
  );

  const previousSession = useRef(activeSession.id);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const switched = previousSession.current !== activeSession.id;
    previousSession.current = activeSession.id;

    // An empty session shows the welcome panel; pinning it to the bottom would
    // hide the heading, so leave it at the top.
    if (activeSession.messages.length === 0) {
      node.scrollTop = 0;
      return;
    }

    const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
    if (switched || distanceFromBottom < 240) node.scrollTop = node.scrollHeight;
  }, [activeSession.id, lastLength, activeSession.messages.length]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, [activeSession.id, store.centerView, store.activeFilePath]);

  const submit = async () => {
    const value = input.trim();
    if (!value || pending) return;
    setInput('');
    setShowAtMenu(false);
    setShowSlashMenu(false);
    if (agentMode === 'swarm' && !value.startsWith('/')) {
      await store.runSwarm(value);
      return;
    }
    await store.sendMessage(value);
  };

  const contextBadge = status?.ready
    ? `${status.provider}: ${status.model}`
    : status?.configured
      ? `${status.provider}: ${status.model} — key missing`
      : 'No model configured';

  return (
    <>
      <div className="chat-scroll" ref={scrollRef}>
        {activeSession.messages.length === 0 ? (
          <div className="empty-state">
            <div className="empty-eyebrow">
              <span className={`dot ${status?.ready ? 'dot-ok' : 'dot-warn'}`} />
              <span className="mono">TERVIXA WIGGLE v{status?.version || '1.0.0'}</span>
              <span className="empty-sep" />
              <span className="mono">{status?.workspaceName || 'workspace'}</span>
            </div>
            <h1>What are we building?</h1>
            <p className="empty-lede">
              A local coding agent with a seven-stage prompt compiler, your own provider keys, project memory,
              reusable skills, MCP connectors, plugin commands and transactional undo. Nothing leaves this machine
              except the model request you configure.
            </p>

            {!status?.ready && (
              <button
                className="empty-warning"
                onClick={() => {
                  store.setSettingsSection('Providers');
                  store.setSettingsOpen(true);
                }}
              >
                <ShieldAlert size={14} />
                <span>
                  {status?.configured
                    ? 'The selected provider has no API key. Add one to start a turn.'
                    : 'Choose a provider and model to start. Settings → Models.'}
                </span>
              </button>
            )}

            <div className="quick-prompts">
              <button
                className="quick-prompt-card"
                onClick={() => setInput('Explain the architecture of this workspace and name the key modules.')}
              >
                <strong>Explore the architecture</strong>
                <span>Trace the real modules and entry points</span>
              </button>
              <button
                className="quick-prompt-card"
                onClick={() => setInput('Review the current uncommitted changes for correctness and security issues.')}
              >
                <strong>Review pending changes</strong>
                <span>Correctness, security and edge cases</span>
              </button>
              <button
                className="quick-prompt-card"
                onClick={() => setInput('Run the test suite, then fix the first failure you find.')}
              >
                <strong>Test and fix</strong>
                <span>Run commands with approval, then patch</span>
              </button>
              <button
                className="quick-prompt-card"
                onClick={() => setInput('Who are you and who developed you?')}
              >
                <strong>Verify identity</strong>
                <span>Confirm the Tervixa identity guard</span>
              </button>
            </div>

            <div className="empty-stats">
              <span><strong>{status?.skillsCount ?? 0}</strong> skills</span>
              <span><strong>{status?.pluginsCount ?? 0}</strong> plugins</span>
              <span><strong>{status?.mcpCount ?? 0}</strong> connectors</span>
              <span><strong>{status?.memoryCount ?? 0}</strong> memories</span>
            </div>
          </div>
        ) : (
          <div className="chat-container">
            {activeSession.messages.map((message) => (
              <MessageBlock
                key={message.id}
                message={message}
                verboseTools={store.settings?.defaultTranscriptView === 'verbose'}
                showChangedFiles={store.settings?.showChangedFiles !== false}
              />
            ))}
          </div>
        )}
      </div>

      <div className="composer-dock">
        <div className="composer-inner">
          {store.approval && (
            <div className="approval-bar" role="alert">
              <div className="approval-copy">
                <span className="approval-title">
                  <ShieldAlert size={13} /> Approval needed · <span className="mono">{store.approval.tool}</span>
                </span>
                <pre className="approval-input">{JSON.stringify(store.approval.input, null, 2)}</pre>
              </div>
              <div className="approval-actions">
                <button
                  className="btn-flat"
                  onClick={() => store.resolveApproval(store.approval!.id, 'deny')}
                >
                  Deny
                </button>
                <button
                  className="btn-primary"
                  onClick={() => store.resolveApproval(store.approval!.id, 'allow')}
                >
                  <Check size={13} /> Allow once
                </button>
              </div>
            </div>
          )}

          {attachments.length > 0 && (
            <div className="context-strip">
              {attachments.map((attachment) => (
                <span className="context-pill" key={attachment.id}>
                  <span className="truncate">
                    @{attachment.type}:{attachment.label}
                  </span>
                  <button
                    aria-label={`Remove ${attachment.label}`}
                    onClick={() => store.setAttachments((previous) => previous.filter((entry) => entry.id !== attachment.id))}
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
            </div>
          )}

          {showAtMenu && (
            <div className="popover-menu">
              <input
                className="input-flat popover-filter"
                autoFocus
                placeholder="Filter workspace files…"
                value={atFilter}
                onChange={(event) => setAtFilter(event.target.value)}
              />
              {filteredFiles.map((path) => (
                <button
                  key={path}
                  className="popover-item"
                  onClick={() => {
                    store.setAttachments((previous) => [
                      ...previous,
                      { id: crypto.randomUUID(), type: 'file', label: path, path },
                    ]);
                    setShowAtMenu(false);
                    setAtFilter('');
                  }}
                >
                  <span className="mono truncate">{path}</span>
                </button>
              ))}
              {filteredFiles.length === 0 && <div className="popover-empty">No matching workspace files.</div>}
            </div>
          )}

          {showSlashMenu && (
            <div className="popover-menu">
              {slashCommands.map((item) => (
                <button
                  key={`${item.plugin}-${item.command}`}
                  className="popover-item"
                  onClick={() => {
                    setInput(item.command);
                    setShowSlashMenu(false);
                    textareaRef.current?.focus();
                  }}
                >
                  <span className="mono">{item.command}</span>
                  <span className="popover-desc">{item.description}</span>
                </button>
              ))}
              {slashCommands.length === 0 && (
                <div className="popover-empty">No command matches. Plugin commands appear here after install.</div>
              )}
            </div>
          )}

          <div className="composer-box">
            <textarea
              ref={textareaRef}
              rows={3}
              spellCheck={store.settings?.spellcheck !== false}
              placeholder="Describe the task, or press / for commands and @ to attach a file…"
              value={input}
              onChange={(event) => {
                const value = event.target.value;
                setInput(value);
                setShowSlashMenu(value.startsWith('/') && !value.includes(' '));
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void submit();
                }
                if (event.key === 'Escape') {
                  setShowAtMenu(false);
                  setShowSlashMenu(false);
                }
              }}
            />
            <div className="composer-toolbar">
              <div className="composer-controls">
                <select
                  className="select-flat"
                  value={agentMode}
                  onChange={(event) => setAgentMode(event.target.value as WiggleStore['agentMode'])}
                  aria-label="Agent mode"
                >
                  <option value="agent">Agent</option>
                  <option value="plan">Plan</option>
                  <option value="ask">Ask</option>
                  <option value="swarm">Swarm</option>
                </select>
                <button
                  className="btn-flat btn-compact"
                  onClick={() => {
                    setShowAtMenu((value) => !value);
                    setShowSlashMenu(false);
                  }}
                >
                  <AtSign size={12} />
                  <span>Context</span>
                </button>
                <button
                  className="btn-flat btn-compact"
                  onClick={() => {
                    setShowSlashMenu((value) => !value);
                    setShowAtMenu(false);
                  }}
                >
                  <Slash size={12} />
                  <span>Commands</span>
                </button>
                <span className={`model-chip ${status?.ready ? '' : 'model-chip-warn'}`} title={contextBadge}>
                  {contextBadge}
                </span>
              </div>
              {pending ? (
                <button className="btn-primary btn-stop" onClick={() => void store.stopChat()} aria-label="Stop">
                  <Square size={12} />
                  <span>Stop</span>
                </button>
              ) : (
                <button
                  className="btn-primary btn-send"
                  disabled={!input.trim()}
                  onClick={() => void submit()}
                  aria-label="Send"
                >
                  <ArrowUp size={14} />
                </button>
              )}
            </div>
          </div>
          <div className="composer-foot">
            <span>
              {agentMode === 'plan'
                ? 'Plan mode: read-only tools.'
                : agentMode === 'ask'
                  ? 'Ask mode: no tools.'
                  : agentMode === 'swarm'
                    ? 'Swarm mode: the prompt becomes a parallel plan.'
                    : `Agent mode: writes and commands ask per policy (${store.settings?.approvalMode ?? 'suggest'}).`}
            </span>
            <span>Tervixa Wiggle developed by Tervixa Corporation.</span>
          </div>
        </div>
      </div>
    </>
  );
};

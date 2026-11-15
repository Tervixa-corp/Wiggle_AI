import React, { useMemo, useState } from 'react';
import { ArrowUp, AtSign, ChevronDown, ChevronRight, Slash, X } from 'lucide-react';
import type { ContextAttachment, FileNode, Session, SkillItem, StatusInfo } from '../store/useWiggleStore';

interface Props {
  session: Session;
  status: StatusInfo | null;
  pending: boolean;
  agentMode: 'agent' | 'plan' | 'ask' | 'swarm';
  onChangeMode: (mode: 'agent' | 'plan' | 'ask' | 'swarm') => void;
  attachments: ContextAttachment[];
  onRemoveAttachment: (id: string) => void;
  onAddAttachment: (att: ContextAttachment) => void;
  tree: FileNode[];
  skills: SkillItem[];
  onSend: (text: string) => Promise<void>;
}

const SLASH_COMMANDS = [
  { cmd: '/swarm ', desc: 'Dispatch parallel specialized agents' },
  { cmd: '/review ', desc: 'Run security & correctness code review' },
  { cmd: '/undo', desc: 'Roll back last workspace snapshot' },
  { cmd: '/redo', desc: 'Re-apply last undone snapshot' },
  { cmd: '/compact', desc: 'Summarize conversation concisely' },
  { cmd: '/clear', desc: 'Clear current session messages' },
];

function flattenPaths(nodes: FileNode[]): string[] {
  const out: string[] = [];
  for (const n of nodes) {
    if (n.isDir && n.children) out.push(...flattenPaths(n.children));
    else if (!n.isDir) out.push(n.path);
  }
  return out;
}

export const ChatWorkbench: React.FC<Props> = ({
  session,
  status,
  pending,
  agentMode,
  onChangeMode,
  attachments,
  onRemoveAttachment,
  onAddAttachment,
  tree,
  skills,
  onSend,
}) => {
  const [input, setInput] = useState('');
  const [showAtMenu, setShowAtMenu] = useState(false);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [expandedTools, setExpandedTools] = useState<Record<string, boolean>>({});
  const filePaths = useMemo(() => flattenPaths(tree).slice(0, 20), [tree]);

  const submit = async () => {
    const val = input.trim();
    if (!val || pending) return;
    setInput('');
    setShowAtMenu(false);
    setShowSlashMenu(false);
    await onSend(agentMode === 'swarm' && !val.startsWith('/') ? `/swarm ${val}` : val);
  };

  return (
    <>
      <div className="chat-scroll">
        {session.messages.length === 0 ? (
          <div className="empty-state">
            <div className="title-pill" style={{ marginBottom: 14 }}>
              <span className={`dot ${status?.configured ? 'dot-ok' : 'dot-warn'}`} />
              <span>TERVIXA WIGGLE v{status?.version || '1.0.0'}</span>
            </div>
            <h1>What are we building?</h1>
            <p>
              7-stage prompt compiler, personal memory, SKILL.md library, MCP connectors, and transactional /undo snapshots — strictly flat monochrome.
            </p>
            <div className="quick-prompts">
              <button
                className="quick-prompt-card"
                onClick={() => setInput('Analyze the architecture of this repository and list key modules.')}
              >
                <strong>Explore architecture</strong>
                <span>Trace crates, UI workbench, and gateway routes</span>
              </button>
              <button
                className="quick-prompt-card"
                onClick={() => setInput('/review Inspect recent changes for security and edge cases.')}
              >
                <strong>Security & code review</strong>
                <span>Run /review with bundled review + security-audit skills</span>
              </button>
              <button
                className="quick-prompt-card"
                onClick={() => setInput('/swarm Plan and audit multi-agent changes across workspace')}
              >
                <strong>Parallel agent swarm</strong>
                <span>Coordinate Architect, Explorer, Coder, and Reviewer</span>
              </button>
              <button
                className="quick-prompt-card"
                onClick={() => setInput('Who are you and who developed you?')}
              >
                <strong>Verify identity guard</strong>
                <span>Confirm Tervixa Wiggle immutable identity wrapper</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="chat-container">
            {session.messages.map((m) => (
              <div className="msg-block" key={m.id}>
                <div className="msg-meta">
                  <span className="msg-role-tag">
                    {m.role === 'user' ? 'YOU' : m.role === 'assistant' ? 'WIGGLE' : 'SYSTEM'}
                  </span>
                  {m.meta?.matchedSkills && m.meta.matchedSkills.length > 0 && (
                    <span className="wb-badge">Skills: {m.meta.matchedSkills.join(', ')}</span>
                  )}
                  {typeof m.meta?.injectedMemories === 'number' && m.meta.injectedMemories > 0 && (
                    <span className="wb-badge">Memory: {m.meta.injectedMemories}</span>
                  )}
                </div>
                <div className="msg-text">{m.text}</div>
                {m.tools?.map((t, idx) => {
                  const key = `${m.id}-${idx}`;
                  const open = Boolean(expandedTools[key]);
                  return (
                    <div className="tool-card" key={key}>
                      <button
                        className="tool-card-head"
                        style={{ width: '100%' }}
                        onClick={() => setExpandedTools((p) => ({ ...p, [key]: !open }))}
                      >
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                          <span className={`dot ${t.ok ? 'dot-ok' : 'dot-err'}`} />
                          <span>{t.name}</span>
                        </span>
                        <span>{t.ok ? 'ok' : 'error'}</span>
                      </button>
                      {open && <div className="tool-card-body">{t.output}</div>}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="composer-dock">
        <div className="composer-inner">
          {attachments.length > 0 && (
            <div className="context-strip">
              {attachments.map((att) => (
                <span className="context-pill" key={att.id}>
                  <span>@{att.type}:{att.label}</span>
                  <button onClick={() => onRemoveAttachment(att.id)} aria-label="Remove context">
                    <X size={11} />
                  </button>
                </span>
              ))}
            </div>
          )}

          {showAtMenu && (
            <div className="popover-menu">
              {filePaths.map((p) => (
                <button
                  key={p}
                  className="popover-item"
                  onClick={() => {
                    onAddAttachment({ id: crypto.randomUUID(), type: 'file', label: p, path: p });
                    setShowAtMenu(false);
                  }}
                >
                  <span className="mono truncate">@file:{p}</span>
                </button>
              ))}
              {filePaths.length === 0 && (
                <div style={{ padding: 10, color: 'var(--text-muted)', fontSize: 11.5 }}>
                  No workspace files indexed yet.
                </div>
              )}
            </div>
          )}

          {showSlashMenu && (
            <div className="popover-menu">
              {SLASH_COMMANDS.map((item) => (
                <button
                  key={item.cmd}
                  className="popover-item"
                  onClick={() => {
                    setInput(item.cmd);
                    setShowSlashMenu(false);
                  }}
                >
                  <span className="mono">{item.cmd.trim()}</span>
                  <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{item.desc}</span>
                </button>
              ))}
            </div>
          )}

          <div className="composer-box">
            <textarea
              placeholder="Type a command or task... (@ to attach context, / for slash commands)"
              value={input}
              onChange={(e) => {
                const v = e.target.value;
                setInput(v);
                setShowSlashMenu(v.startsWith('/'));
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
            />
            <div className="composer-toolbar">
              <div className="composer-controls">
                <select
                  className="select-flat"
                  value={agentMode}
                  onChange={(e) => onChangeMode(e.target.value as any)}
                  aria-label="Agent mode"
                >
                  <option value="agent">Mode: Agent</option>
                  <option value="swarm">Mode: Swarm</option>
                  <option value="plan">Mode: Plan</option>
                  <option value="ask">Mode: Ask</option>
                </select>
                <button
                  className="btn-flat"
                  style={{ height: 26, fontSize: 11.5 }}
                  onClick={() => {
                    setShowAtMenu((v) => !v);
                    setShowSlashMenu(false);
                  }}
                >
                  <AtSign size={12} />
                  <span>Context</span>
                </button>
                <button
                  className="btn-flat"
                  style={{ height: 26, fontSize: 11.5 }}
                  onClick={() => {
                    setShowSlashMenu((v) => !v);
                    setShowAtMenu(false);
                  }}
                >
                  <Slash size={12} />
                  <span>Slash</span>
                </button>
                <span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {status?.configured ? `${status.providerId}: ${status.model}` : 'No model configured'} · {skills.filter((s) => s.enabled).length} skills
                </span>
              </div>
              <button className="btn-primary" disabled={!input.trim() || pending} onClick={submit} aria-label="Send">
                <ArrowUp size={14} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

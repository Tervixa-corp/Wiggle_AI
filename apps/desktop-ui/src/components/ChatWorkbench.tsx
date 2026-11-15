import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowUp, ChevronDown, ChevronRight, CircleStop, ShieldQuestion, Terminal, Wrench } from 'lucide-react';
import { useWiggle } from '../store/useWiggleStore';
import type { Message, ToolRun } from '../store/useWiggleStore';

const STATUS_LABEL: Record<ToolRun['status'], string> = {
  running: 'running',
  awaiting_approval: 'needs approval',
  ok: 'done',
  error: 'failed',
  denied: 'denied',
};

function dotClass(status: ToolRun['status']) {
  if (status === 'ok') return 'status-dot ok';
  if (status === 'error') return 'status-dot err';
  if (status === 'denied') return 'status-dot err';
  if (status === 'awaiting_approval') return 'status-dot warn';
  return 'status-dot idle pulse';
}

/** One-line summary of the tool input, so rows stay scannable. */
function summarise(tool: ToolRun): string {
  const input = tool.input as Record<string, unknown>;
  if (typeof input.path === 'string') return input.path;
  if (typeof input.command === 'string') return input.command;
  if (typeof input.pattern === 'string') return input.pattern;
  if (typeof input.query === 'string') return String(input.query);
  return '';
}

function ToolBlock({ tool }: { tool: ToolRun }) {
  const [open, setOpen] = useState(false);
  const { approve, openDiff } = useWiggle();
  const detail = summarise(tool);

  return (
    <div className="tool">
      <button className="tool-head" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className={dotClass(tool.status)} />
        <Wrench size={12} />
        <span className="tool-name">{tool.name}</span>
        {detail && <span className="tool-detail">{detail}</span>}
        <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: 10 }}>
          {STATUS_LABEL[tool.status]}
          {tool.durationMs ? ` · ${tool.durationMs}ms` : ''}
        </span>
      </button>

      {tool.status === 'awaiting_approval' && tool.approvalId && (
        <div className="tool-body">
          <div className="approval-title">
            <ShieldQuestion size={13} />
            <strong>Approve this action?</strong>
          </div>
          <p className="approval-copy">
            <code>{tool.name}</code> wants to modify the workspace. Nothing runs until you decide.
          </p>
          <pre>{JSON.stringify(tool.input, null, 2)}</pre>
          <div className="approval-actions">
            <button className="button primary" onClick={() => void approve(tool.approvalId!, 'allow')}>
              Allow once
            </button>
            <button className="button" onClick={() => void approve(tool.approvalId!, 'deny')}>
              Deny
            </button>
          </div>
        </div>
      )}

      {open && (
        <div className="tool-body">
          <pre className="tool-output">{JSON.stringify(tool.input, null, 2)}</pre>
          {tool.output && <pre className="tool-output" style={{ marginTop: 7 }}>{tool.output}</pre>}
          {tool.mutation && (
            <div className="tool-actions">
              <button className="button ghost" onClick={() => openDiff(tool.mutation!)}>
                Review diff
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MessageRow({ message }: { message: Message }) {
  if (message.role === 'notice') {
    return (
      <div className="notice">
        <Terminal size={12} />
        {message.text}
      </div>
    );
  }

  return (
    <div className={`message ${message.role}`}>
      <div className="avatar" aria-hidden>{message.role === 'user' ? 'Y' : 'w.'}</div>
      <div className="message-body">
        <div className="message-head">
          <strong>{message.role === 'user' ? 'You' : 'Tervixa Wiggle'}</strong>
          {message.streaming && <span className="status-dot idle pulse" />}
          {typeof message.steps === 'number' && message.steps > 1 && <span>step {message.steps}</span>}
        </div>
        {message.text && <p className="message-text">{message.text}{message.streaming && <span className="caret" />}</p>}
        {message.tools.map((tool) => <ToolBlock key={tool.id} tool={tool} />)}
      </div>
    </div>
  );
}

export function ChatWorkbench() {
  const { session, send, stop, status, offline, error, dismissError, busy } = useWiggle();
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const running = session.running;

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [session.messages]);

  useEffect(() => {
    const focus = () => textareaRef.current?.focus();
    window.addEventListener('wiggle:focus-composer', focus);
    return () => window.removeEventListener('wiggle:focus-composer', focus);
  }, []);

  const submit = () => {
    const text = input.trim();
    if (!text || running) return;
    setInput('');
    void send(text);
  };

  const disabled = offline || !status?.configured;

  return (
    <div className="pane">
      <div className="chat-scroll" ref={scrollRef}>
        {session.messages.length === 0 ? (
          <div className="empty-state">
            <h1 className="empty-title">What are we working on?</h1>
            <p className="empty-copy">
              Wiggle reads, edits and runs things inside your workspace — one file at a time, with your
              approval for anything that changes state.
            </p>
            <div className="empty-meta">
              <span className="tag">{status ? status.workspace.name : 'no workspace'}</span>
              <span className="tag">{status ? `${status.permissions} tools` : 'tools unavailable'}</span>
              <span className="tag">{status?.model || 'no model'}</span>
            </div>
            {disabled && (
              <div className="note">
                {offline
                  ? 'The local agent server is not reachable. Start it with npm start, then reload.'
                  : 'No model is connected. Set WIGGLE_MODEL and WIGGLE_API_KEY, restart the server, then reload.'}
              </div>
            )}
          </div>
        ) : (
          <div className="chat-inner">
            {session.messages.map((message) => <MessageRow key={message.id} message={message} />)}
          </div>
        )}
      </div>

      <div className="composer-wrap">
        <div className="composer-inner">
          {error && (
            <div className="error-bar">
              <AlertTriangle size={13} />
              <span>{error}</span>
              <span className="spacer" />
              <button className="icon-button" onClick={dismissError} aria-label="Dismiss">×</button>
            </div>
          )}
          <div className="composer">
            <textarea
              ref={textareaRef}
              aria-label="Message"
              placeholder={disabled ? 'Connect a model to start a task…' : 'Describe a task. Enter to send, Shift+Enter for a new line.'}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  submit();
                }
              }}
            />
            <div className="composer-foot">
              <span className="mode"><Wrench size={12} /> Agent</span>
              <span className="model">{status?.model || 'no model'}</span>
              <span className="spacer" />
              <span>{status ? `${status.permissions}` : ''}</span>
              {running ? (
                <button className="send stop" onClick={stop} aria-label="Stop"><CircleStop size={14} /></button>
              ) : (
                <button className="send" onClick={submit} disabled={!input.trim() || disabled} aria-label="Send">
                  <ArrowUp size={14} />
                </button>
              )}
            </div>
          </div>
          <div className="composer-hint">
            <span><kbd>Enter</kbd> send · <kbd>Shift</kbd>+<kbd>Enter</kbd> newline · <kbd>Ctrl</kbd>+<kbd>K</kbd> focus</span>
            <span>{busy ? 'working…' : 'review every change'}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

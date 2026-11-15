import React, { useState } from 'react';
import { Paperclip, Play, Trash2 } from 'lucide-react';

interface Props {
  log: string;
  onRunCommand: (cmd: string) => Promise<void>;
  onClear: () => void;
  onAttachTerminal: (output: string) => void;
}

export const TerminalPane: React.FC<Props> = ({
  log,
  onRunCommand,
  onClear,
  onAttachTerminal,
}) => {
  const [cmd, setCmd] = useState('');
  const [running, setRunning] = useState(false);

  const submit = async () => {
    const trimmed = cmd.trim();
    if (!trimmed || running) return;
    setRunning(true);
    setCmd('');
    await onRunCommand(trimmed);
    setRunning(false);
  };

  return (
    <div className="aux-body">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 10px',
          borderBottom: '1px solid var(--border-subtle)',
          fontSize: 11.5,
        }}
      >
        <span style={{ color: 'var(--text-secondary)' }}>Workspace Shell</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            className="btn-flat"
            style={{ height: 22, padding: '0 7px', fontSize: 11 }}
            onClick={() => onAttachTerminal(log.slice(-2500))}
            title="Attach terminal output to chat (@terminal)"
          >
            <Paperclip size={11} />
            <span>@terminal</span>
          </button>
          <button className="icon-btn" title="Clear terminal" onClick={onClear}>
            <Trash2 size={13} />
          </button>
        </div>
      </div>
      <pre className="terminal-output" style={{ margin: 0 }}>
        {log}
      </pre>
      <div className="terminal-input-row">
        <span className="mono" style={{ color: 'var(--text-muted)' }}>
          $
        </span>
        <input
          className="input-flat mono"
          style={{ flex: 1 }}
          placeholder="git status, npm test, ls..."
          value={cmd}
          onChange={(e) => setCmd(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        <button className="btn-primary" style={{ height: 28 }} disabled={running || !cmd.trim()} onClick={submit}>
          <Play size={12} />
        </button>
      </div>
    </div>
  );
};

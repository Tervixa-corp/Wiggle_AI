import React from 'react';
import { GitBranch } from 'lucide-react';
import type { StatusInfo } from '../store/useWiggleStore';

interface Props {
  status: StatusInfo | null;
  pendingCount: number;
  tokenEstimate: number;
}

export const StatusBar: React.FC<Props> = ({ status, pendingCount, tokenEstimate }) => (
  <footer className="wg-status" aria-label="Status bar">
    <div className="wg-status-group">
      <span className="wg-status-item">
        <span
          className={`wg-dot ${pendingCount > 0 ? 'is-live' : status?.ready ? 'is-ok' : 'is-warn'}`}
          aria-hidden
        />
        <span>{pendingCount > 0 ? `Running · ${pendingCount}` : status?.ready ? 'Ready' : 'No provider'}</span>
      </span>
      <span className="wg-status-sep" />
      <span className="wg-status-item">
        <GitBranch size={10} aria-hidden />
        <span>{status?.gitBranch || 'local'}</span>
      </span>
      <span className="wg-status-sep" />
      <span className="wg-status-item is-strong mono">
        {status?.configured ? `${status.provider} · ${status.model}` : 'no model configured'}
      </span>
    </div>

    <div className="wg-status-group">
      <span className="wg-status-item">{status?.skillsCount ?? 0} skills</span>
      <span className="wg-status-sep" />
      <span className="wg-status-item">{status?.pluginsCount ?? 0} plugins</span>
      <span className="wg-status-sep" />
      <span className="wg-status-item">{status?.mcpCount ?? 0} MCP</span>
      <span className="wg-status-sep" />
      <span className="wg-status-item">{status?.memoryCount ?? 0} memories</span>
      <span className="wg-status-sep" />
      <span className="wg-status-item">~{tokenEstimate} tokens</span>
      <span className="wg-status-sep" />
      <span className="wg-status-item">undo {status?.undoCount ?? 0}</span>
    </div>
  </footer>
);

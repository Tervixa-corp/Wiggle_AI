import React from 'react';
import { GitBranch } from 'lucide-react';
import type { StatusInfo } from '../store/useWiggleStore';

interface Props {
  status: StatusInfo | null;
  pendingCount: number;
  tokenEstimate: number;
}

export const StatusBar: React.FC<Props> = ({ status, pendingCount, tokenEstimate }) => {
  return (
    <footer className="statusbar">
      <div className="statusbar-group">
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <GitBranch size={11} />
          <span>{status?.gitBranch || 'local'}</span>
        </span>
        <span className="statusbar-sep" />
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span className={`dot ${pendingCount > 0 ? 'dot-warn' : 'dot-ok'}`} />
          <span>{pendingCount > 0 ? `Agents: Running (${pendingCount})` : 'Agents: Idle'}</span>
        </span>
        <span className="statusbar-sep" />
        <span>MCP: {status?.mcpCount ?? 0} Ready</span>
        <span className="statusbar-sep" />
        <span>Skills: {status?.skillsCount ?? 0}</span>
        <span className="statusbar-sep" />
        <span>Memory: {status?.memoryCount ?? 0}</span>
      </div>
      <div className="statusbar-group">
        <span>Tokens: {tokenEstimate}</span>
        <span className="statusbar-sep" />
        <span>Undo: {status?.undoCount ?? 0}</span>
        <span className="statusbar-sep" />
        <span>UTF-8</span>
      </div>
    </footer>
  );
};

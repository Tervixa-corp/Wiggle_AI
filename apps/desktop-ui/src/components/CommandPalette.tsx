import React, { useMemo, useState } from 'react';
import { Command, FileCode2, X } from 'lucide-react';
import type { FileNode } from '../store/useWiggleStore';

interface Props {
  open: boolean;
  onClose: () => void;
  tree: FileNode[];
  onOpenFile: (path: string) => void;
  onAction: (action: string) => void;
}

function flattenFiles(nodes: FileNode[]): string[] {
  const out: string[] = [];
  for (const n of nodes) {
    if (n.isDir && n.children) out.push(...flattenFiles(n.children));
    else if (!n.isDir) out.push(n.path);
  }
  return out;
}

export const CommandPalette: React.FC<Props> = ({ open, onClose, tree, onOpenFile, onAction }) => {
  const [query, setQuery] = useState('');
  const files = useMemo(() => flattenFiles(tree), [tree]);

  if (!open) return null;

  const commands = [
    { id: 'new-session', label: 'New Chat Session' },
    { id: 'swarm', label: 'Open Agent Swarm Orchestrator' },
    { id: 'undo', label: 'Transactional /undo Snapshot' },
    { id: 'redo', label: 'Transactional /redo Snapshot' },
    { id: 'settings', label: 'Open Settings (Ctrl+,)' },
    { id: 'theme', label: 'Toggle Carbon Dark / Crisp Light Theme' },
  ];

  const q = query.trim().toLowerCase();
  const matchedCommands = commands.filter((c) => !q || c.label.toLowerCase().includes(q));
  const matchedFiles = files.filter((f) => !q || f.toLowerCase().includes(q)).slice(0, 12);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="cmd-palette" role="dialog" aria-modal="true" aria-label="Command Palette">
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
            <Command size={14} />
            <input
              autoFocus
              className="input-flat"
              style={{ flex: 1, border: 0, background: 'transparent' }}
              placeholder="Jump to file or run command..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') onClose();
                if (e.key === 'Enter') {
                  if (matchedFiles[0]) {
                    onOpenFile(matchedFiles[0]);
                    onClose();
                  } else if (matchedCommands[0]) {
                    onAction(matchedCommands[0].id);
                    onClose();
                  }
                }
              }}
            />
          </div>
          <button className="icon-btn" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <div style={{ maxHeight: 340, overflowY: 'auto' }}>
          {matchedCommands.map((cmd) => (
            <button
              key={cmd.id}
              className="popover-item"
              onClick={() => {
                onAction(cmd.id);
                onClose();
              }}
            >
              <span>{cmd.label}</span>
              <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>command</span>
            </button>
          ))}
          {matchedFiles.map((filePath) => (
            <button
              key={filePath}
              className="popover-item"
              onClick={() => {
                onOpenFile(filePath);
                onClose();
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <FileCode2 size={13} />
                <span className="mono">{filePath}</span>
              </span>
              <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>file</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

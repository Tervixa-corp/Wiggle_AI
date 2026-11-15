import React, { useState } from 'react';
import { ChevronDown, ChevronRight, FileCode2, Folder, MessageSquare, Plus, Search } from 'lucide-react';
import type { FileNode, Session } from '../store/useWiggleStore';

interface Props {
  sessions: Session[];
  activeSessionId: string;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  tree: FileNode[];
  activeFilePath: string | null;
  onOpenFile: (path: string) => void;
  onOpenCmdPalette: () => void;
}

const TreeNodeRow: React.FC<{
  node: FileNode;
  depth: number;
  activeFilePath: string | null;
  onOpenFile: (path: string) => void;
}> = ({ node, depth, activeFilePath, onOpenFile }) => {
  const [expanded, setExpanded] = useState(depth === 0);

  if (node.isDir) {
    return (
      <div>
        <button
          className="tree-row"
          style={{ paddingLeft: `${8 + depth * 12}px` }}
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <Folder size={13} />
          <span className="truncate">{node.name}</span>
        </button>
        {expanded &&
          node.children?.map((child) => (
            <TreeNodeRow
              key={child.path}
              node={child}
              depth={depth + 1}
              activeFilePath={activeFilePath}
              onOpenFile={onOpenFile}
            />
          ))}
      </div>
    );
  }

  return (
    <button
      className={`tree-row ${activeFilePath === node.path ? 'active' : ''}`}
      style={{ paddingLeft: `${20 + depth * 12}px` }}
      onClick={() => onOpenFile(node.path)}
    >
      <FileCode2 size={13} />
      <span className="truncate">{node.name}</span>
    </button>
  );
};

export const Sidebar: React.FC<Props> = ({
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
  tree,
  activeFilePath,
  onOpenFile,
  onOpenCmdPalette,
}) => {
  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <button className="btn-flat" style={{ flex: 1 }} onClick={onNewSession}>
          <Plus size={13} />
          <span>New session</span>
        </button>
        <button className="icon-btn" title="Quick Open (Ctrl+P)" onClick={onOpenCmdPalette}>
          <Search size={14} />
        </button>
      </div>

      <div className="sidebar-section-label">
        <span>SESSIONS</span>
        <span>{sessions.length}</span>
      </div>
      <div style={{ padding: '0 6px', maxHeight: '170px', overflowY: 'auto' }}>
        {sessions.map((s) => (
          <button
            key={s.id}
            className={`session-item ${s.id === activeSessionId ? 'active' : ''}`}
            onClick={() => onSelectSession(s.id)}
          >
            <MessageSquare size={12} />
            <span className="truncate">{s.name}</span>
          </button>
        ))}
      </div>

      <div className="sidebar-section-label">
        <span>FILES (EXPLORER)</span>
        <span>{tree.length}</span>
      </div>
      <div className="sidebar-scroll">
        {tree.length === 0 ? (
          <div style={{ padding: '12px 10px', fontSize: 11.5, color: 'var(--text-muted)' }}>
            Start local server (`npm start`) to browse workspace files.
          </div>
        ) : (
          tree.map((node) => (
            <TreeNodeRow
              key={node.path}
              node={node}
              depth={0}
              activeFilePath={activeFilePath}
              onOpenFile={onOpenFile}
            />
          ))
        )}
      </div>
    </aside>
  );
};

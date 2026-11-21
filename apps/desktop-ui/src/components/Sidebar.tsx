import React, { useMemo, useState } from 'react';
import {
  ChevronDown,
  FileCode2,
  Folder,
  FolderTree,
  MessageSquare,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import type { FileNode, Session } from '../store/useWiggleStore';

interface Props {
  sessions: Session[];
  activeSessionId: string;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onDeleteSession: (id: string) => void;
  tree: FileNode[];
  activeFilePath: string | null;
  onOpenFile: (path: string) => void;
}

interface FlatFile {
  path: string;
  name: string;
}

function flatten(nodes: FileNode[], out: FlatFile[] = []): FlatFile[] {
  for (const node of nodes) {
    if (node.isDir && node.children) flatten(node.children, out);
    else if (!node.isDir) out.push({ path: node.path, name: node.name });
  }
  return out;
}

const TreeNode: React.FC<{
  node: FileNode;
  depth: number;
  activeFilePath: string | null;
  onOpenFile: (path: string) => void;
}> = ({ node, depth, activeFilePath, onOpenFile }) => {
  const [open, setOpen] = useState(depth === 0);
  const indent = 6 + depth * 12;

  if (node.isDir) {
    return (
      <div>
        <button
          className="wg-tree-row"
          style={{ paddingLeft: `${indent}px` }}
          onClick={() => setOpen((value) => !value)}
          title={node.path}
        >
          <ChevronDown
            size={12}
            className={`wg-tree-caret ${open ? 'is-open' : ''}`}
            aria-hidden
          />
          <Folder size={12} className="wg-item-icon" aria-hidden />
          <span className="wg-tree-name">{node.name}</span>
          {typeof node.children?.length === 'number' && (
            <span className="wg-item-meta">{node.children.length}</span>
          )}
        </button>
        {open &&
          node.children?.map((child) => (
            <TreeNode
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
      className={`wg-tree-row ${activeFilePath === node.path ? 'is-active' : ''}`}
      style={{ paddingLeft: `${indent + 18}px` }}
      onClick={() => onOpenFile(node.path)}
      title={node.path}
    >
      <FileCode2 size={12} className="wg-item-icon" aria-hidden />
      <span className="wg-tree-name">{node.name}</span>
    </button>
  );
};

export const Sidebar: React.FC<Props> = ({
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  tree,
  activeFilePath,
  onOpenFile,
}) => {
  const [query, setQuery] = useState('');
  const [sessionsOpen, setSessionsOpen] = useState(true);
  const [filesOpen, setFilesOpen] = useState(true);

  const files = useMemo(() => flatten(tree), [tree]);
  const needle = query.trim().toLowerCase();

  const filteredSessions = useMemo(() => {
    if (!needle) return sessions;
    return sessions.filter((session) => session.name.toLowerCase().includes(needle));
  }, [sessions, needle]);

  const filteredFiles = useMemo(() => {
    if (!needle) return [];
    return files.filter((file) => file.path.toLowerCase().includes(needle)).slice(0, 40);
  }, [files, needle]);

  return (
    <aside className="wg-sidebar" aria-label="Session explorer">
      <div className="wg-sidebar-head">
        <span className="wg-sidebar-title">Workbench</span>
        <button
          className="wg-sidebar-action"
          title="New session"
          aria-label="New session"
          onClick={onNewSession}
        >
          <Plus size={14} />
        </button>
      </div>

      <div className="wg-search-wrap">
        <Search size={12} className="wg-search-icon" aria-hidden />
        <input
          className="wg-search"
          placeholder="Search sessions and files"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search sessions and files"
        />
      </div>

      <div className="wg-sidebar-scroll">
        {needle ? (
          <>
            <div className="wg-group">
              <div className="wg-group-head" style={{ cursor: 'default' }}>
                <span>Matches</span>
                <span className="wg-group-count">{filteredSessions.length + filteredFiles.length}</span>
              </div>
              {filteredSessions.map((session) => (
                <button
                  key={session.id}
                  className={`wg-item ${session.id === activeSessionId ? 'is-active' : ''}`}
                  onClick={() => onSelectSession(session.id)}
                  title={session.name}
                >
                  <MessageSquare size={12} className="wg-item-icon" aria-hidden />
                  <span className="wg-item-label">{session.name}</span>
                </button>
              ))}
              {filteredFiles.map((file) => (
                <button
                  key={file.path}
                  className="wg-item"
                  onClick={() => onOpenFile(file.path)}
                  title={file.path}
                >
                  <FileCode2 size={12} className="wg-item-icon" aria-hidden />
                  <span className="wg-item-label mono">{file.path}</span>
                </button>
              ))}
              {filteredSessions.length + filteredFiles.length === 0 && (
                <div className="wg-empty">Nothing matches “{query.trim()}”.</div>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="wg-group">
              <button
                className="wg-group-head"
                onClick={() => setSessionsOpen((value) => !value)}
                aria-expanded={sessionsOpen}
              >
                <ChevronDown
                  size={11}
                  className={`wg-group-caret ${sessionsOpen ? '' : 'is-collapsed'}`}
                  aria-hidden
                />
                <span>Sessions</span>
                <span className="wg-group-count">{sessions.length}</span>
              </button>

              {sessionsOpen &&
                sessions.map((session) => (
                  <div
                    key={session.id}
                    className={`wg-item ${session.id === activeSessionId ? 'is-active' : ''}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelectSession(session.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onSelectSession(session.id);
                      }
                    }}
                    title={session.name}
                  >
                    <MessageSquare size={12} className="wg-item-icon" aria-hidden />
                    <span className="wg-item-label">{session.name}</span>
                    <span className="wg-item-meta">{session.messages.length}</span>
                    {sessions.length > 1 && (
                      <button
                        className="wg-item-kill"
                        title="Delete session"
                        aria-label={`Delete ${session.name}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          onDeleteSession(session.id);
                        }}
                      >
                        <Trash2 size={11} />
                      </button>
                    )}
                  </div>
                ))}
            </div>

            <div className="wg-group">
              <button
                className="wg-group-head"
                onClick={() => setFilesOpen((value) => !value)}
                aria-expanded={filesOpen}
              >
                <ChevronDown
                  size={11}
                  className={`wg-group-caret ${filesOpen ? '' : 'is-collapsed'}`}
                  aria-hidden
                />
                <span>Explorer</span>
                <span className="wg-group-count">{files.length}</span>
              </button>

              {filesOpen &&
                (tree.length === 0 ? (
                  <div className="wg-empty">
                    <FolderTree size={14} style={{ marginBottom: 6, opacity: 0.7 }} />
                    <div>No files yet. Add files to this workspace folder to see them here.</div>
                  </div>
                ) : (
                  tree.map((node) => (
                    <TreeNode
                      key={node.path}
                      node={node}
                      depth={0}
                      activeFilePath={activeFilePath}
                      onOpenFile={onOpenFile}
                    />
                  ))
                ))}
            </div>
          </>
        )}
      </div>
    </aside>
  );
};

import { useMemo } from 'react';
import { File, FileCode2, Folder, FolderOpen, MessageSquare, Plus, RefreshCw } from 'lucide-react';
import { useWiggle } from '../store/useWiggleStore';

const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.rs', '.json', '.md', '.css', '.html', '.toml', '.yml', '.yaml', '.sh', '.py']);

/** Render the flat path list returned by the server as an indented tree. */
export function Sidebar() {
  const { sessions, activeId, selectSession, newChat, tree, openFile, tabs, activeTab, refresh, offline, status } = useWiggle();

  const rows = useMemo(() => tree.slice(0, 800), [tree]);
  const openPaths = useMemo(() => new Set(tabs.map((tab) => tab.path)), [tabs]);

  return (
    <aside className="sidebar" aria-label="Workspace">
      <div className="sidebar-section">
        <div className="section-label">
          <span>Sessions</span>
          <button className="icon-button" onClick={newChat} aria-label="New session"><Plus size={13} /></button>
        </div>
        <div className="session-list">
          {sessions.map((session) => (
            <button
              key={session.id}
              className={`session ${session.id === activeId ? 'active' : ''}`}
              onClick={() => selectSession(session.id)}
              title={session.name}
            >
              <MessageSquare size={12} />
              <span className="session-name">{session.name}</span>
              {session.running && <span className="session-dot" aria-label="running" />}
            </button>
          ))}
        </div>
      </div>

      <div className="sidebar-section grow">
        <div className="section-label">
          <span>Files</span>
          <button className="icon-button" onClick={() => void refresh()} aria-label="Reload files"><RefreshCw size={12} /></button>
        </div>
        <div className="file-list">
          {rows.length === 0 && (
            <div style={{ padding: '4px 8px', color: 'var(--text-muted)', fontSize: 11 }}>
              {offline ? 'Server unreachable.' : 'No files in this workspace.'}
            </div>
          )}
          {rows.map((entry) => {
            const depth = Math.max(entry.depth - 1, 0);
            const name = entry.path.split('/').pop() ?? entry.path;
            const isCode = entry.type === 'file' && CODE_EXTENSIONS.has(name.slice(name.lastIndexOf('.')));
            const isOpen = openPaths.has(entry.path);
            return (
              <button
                key={`${entry.type}:${entry.path}`}
                className={`tree-row ${isOpen && activeTab === entry.path ? 'active' : ''}`}
                style={{ paddingLeft: 6 + depth * 11 }}
                onClick={() => {
                  if (entry.type === 'file') void openFile(entry.path);
                }}
                disabled={entry.type === 'dir'}
                title={entry.path}
              >
                {entry.type === 'dir' ? (
                  entry.depth === 1 ? <FolderOpen size={12} /> : <Folder size={12} />
                ) : isCode ? (
                  <FileCode2 size={12} />
                ) : (
                  <File size={12} />
                )}
                <span className="name">{name}</span>
                {entry.type === 'dir' && <span className="muted">/</span>}
              </button>
            );
          })}
        </div>
      </div>

      <div className="sidebar-foot">
        <span className={offline ? 'status-dot err' : 'status-dot ok'} />
        <span>{offline ? 'offline' : status?.workspace.name ?? 'workspace'}</span>
        <span className="spacer" />
        <span>{status ? `${tree.filter((entry) => entry.type === 'file').length} files` : ''}</span>
      </div>
    </aside>
  );
}

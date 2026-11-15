import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, File, Folder } from 'lucide-react';

export type Entry = { name: string; path: string; type: 'dir' | 'file' | 'symlink' | 'other' };
type Listing = { path: string; entries: Entry[]; truncated?: boolean };

// Lazily loads one directory at a time from the read-only workspace API.
async function loadDir(path: string): Promise<Listing> {
  const response = await fetch(`/api/workspace/list?path=${encodeURIComponent(path)}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Could not list folder (HTTP ${response.status}).`);
  return data as Listing;
}

function DirNode({ entry, depth, onOpenFile, activeFile, refreshKey }: {
  entry: Entry; depth: number; onOpenFile: (path: string) => void; activeFile: string | null; refreshKey: number;
}) {
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<Entry[] | null>(null);
  const [error, setError] = useState('');

  // Reload an opened folder when the workspace is refreshed.
  useEffect(() => {
    if (!open) return;
    loadDir(entry.path).then(l => { setChildren(l.entries); setError(''); }).catch(e => setError(e.message));
  }, [open, entry.path, refreshKey]);

  return (
    <div>
      <button className="tree-row" style={{ paddingLeft: 8 + depth * 12 }} onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? <ChevronDown size={12}/> : <ChevronRight size={12}/>}
        <Folder size={13}/><span>{entry.name}</span>
      </button>
      {open && error && <div className="tree-error" style={{ paddingLeft: 26 + depth * 12 }}>{error}</div>}
      {open && children && <TreeList entries={children} depth={depth + 1} onOpenFile={onOpenFile} activeFile={activeFile} refreshKey={refreshKey}/>}
    </div>
  );
}

function TreeList({ entries, depth, onOpenFile, activeFile, refreshKey }: {
  entries: Entry[]; depth: number; onOpenFile: (path: string) => void; activeFile: string | null; refreshKey: number;
}) {
  return (
    <>
      {entries.map(entry => entry.type === 'dir'
        ? <DirNode key={entry.path} entry={entry} depth={depth} onOpenFile={onOpenFile} activeFile={activeFile} refreshKey={refreshKey}/>
        : (
          <button key={entry.path} className={'tree-row' + (activeFile === entry.path ? ' selected' : '')} style={{ paddingLeft: 8 + depth * 12 + 16 }}
            disabled={entry.type !== 'file'} title={entry.type === 'symlink' ? 'Symbolic links are not followed' : entry.path}
            onClick={() => onOpenFile(entry.path)}>
            <File size={12}/><span>{entry.name}</span>{entry.type === 'symlink' && <small>link</small>}
          </button>
        ))}
    </>
  );
}

export function WorkspaceTree({ workspaceName, onOpenFile, activeFile, refreshKey }: {
  workspaceName: string; onOpenFile: (path: string) => void; activeFile: string | null; refreshKey: number;
}) {
  const [root, setRoot] = useState<Listing | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    loadDir('').then(l => { setRoot(l); setError(''); }).catch(e => setError(e.message));
  }, [refreshKey]);

  return (
    <div className="workspace-tree" aria-label="Workspace files">
      <div className="tree-title" title={workspaceName}>{workspaceName}</div>
      {error && <div className="tree-error">{error}</div>}
      {root && <TreeList entries={root.entries} depth={0} onOpenFile={onOpenFile} activeFile={activeFile} refreshKey={refreshKey}/>}
      {root?.truncated && <div className="tree-error">Only the first 1000 entries are shown.</div>}
    </div>
  );
}

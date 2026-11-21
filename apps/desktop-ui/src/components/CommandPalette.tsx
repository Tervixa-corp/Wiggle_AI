import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FileCode2, Search } from 'lucide-react';
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
  for (const node of nodes) {
    if (node.isDir && node.children) out.push(...flattenFiles(node.children));
    else if (!node.isDir) out.push(node.path);
  }
  return out;
}

interface Entry {
  id: string;
  label: string;
  kind: 'command' | 'file';
  hint?: string;
  run: () => void;
}

const COMMANDS: Array<{ id: string; label: string; hint?: string }> = [
  { id: 'new-session', label: 'New session', hint: 'Ctrl N' },
  { id: 'change-workspace', label: 'Change workspace folder…' },
  { id: 'chat', label: 'Open chat' },
  { id: 'swarm', label: 'Open agent swarm' },
  { id: 'toggle-sidebar', label: 'Toggle sidebar', hint: 'Ctrl B' },
  { id: 'toggle-aux', label: 'Toggle context pane', hint: 'Ctrl J' },
  { id: 'browser', label: 'Open preview pane' },
  { id: 'settings-appearance', label: 'Appearance — theme, density, font' },
  { id: 'settings', label: 'Settings — providers' },
  { id: 'connectors', label: 'Connectors & MCP servers' },
  { id: 'plugins', label: 'Plugin marketplace' },
  { id: 'skills', label: 'Skills library' },
  { id: 'memory', label: 'Memory' },
  { id: 'keybindings', label: 'Keyboard shortcuts' },
  { id: 'undo', label: 'Undo the last workspace snapshot' },
  { id: 'redo', label: 'Redo the last undone snapshot' },
  { id: 'cycle-theme', label: 'Cycle colour theme' },
];

export const CommandPalette: React.FC<Props> = ({ open, onClose, tree, onOpenFile, onAction }) => {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const files = useMemo(() => flattenFiles(tree), [tree]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setIndex(0);
    }
  }, [open]);

  const entries: Entry[] = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const commandEntries = COMMANDS.filter(
      (command) => !needle || command.label.toLowerCase().includes(needle),
    ).map<Entry>((command) => ({
      id: command.id,
      label: command.label,
      kind: 'command',
      hint: command.hint,
      run: () => onAction(command.id),
    }));

    const fileEntries = files
      .filter((path) => !needle || path.toLowerCase().includes(needle))
      .slice(0, needle ? 14 : 6)
      .map<Entry>((path) => ({
        id: path,
        label: path,
        kind: 'file',
        run: () => onOpenFile(path),
      }));

    return [...commandEntries, ...fileEntries];
  }, [query, files, onAction, onOpenFile]);

  useEffect(() => {
    setIndex(0);
  }, [query]);

  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>('.is-active');
    node?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  if (!open) return null;

  const runAt = (position: number) => {
    const entry = entries[position];
    if (!entry) return;
    entry.run();
    onClose();
  };

  const commandCount = entries.filter((entry) => entry.kind === 'command').length;

  return (
    <div
      className="wg-palette-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="wg-palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <div style={{ position: 'relative' }}>
          <Search
            size={14}
            style={{
              position: 'absolute',
              left: 14,
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--wg-text-4)',
              pointerEvents: 'none',
            }}
          />
          <input
            autoFocus
            className="wg-palette-input"
            style={{ paddingLeft: 36 }}
            placeholder="Search files and commands…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') onClose();
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setIndex((value) => (value + 1) % Math.max(entries.length, 1));
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault();
                setIndex((value) => (value - 1 + entries.length) % Math.max(entries.length, 1));
              }
              if (event.key === 'Enter') {
                event.preventDefault();
                runAt(index);
              }
            }}
            aria-label="Search files and commands"
            spellCheck={false}
          />
        </div>

        <div className="wg-palette-list" ref={listRef}>
          {commandCount > 0 && <div className="wg-palette-section">Commands</div>}
          {entries.map((entry, position) => (
            <React.Fragment key={`${entry.kind}-${entry.id}`}>
              {entry.kind === 'file' && position === commandCount && (
                <div className="wg-palette-section">Files</div>
              )}
              <button
                className={`wg-palette-item ${position === index ? 'is-active' : ''}`}
                onMouseMove={() => setIndex(position)}
                onClick={() => runAt(position)}
              >
                {entry.kind === 'file' && <FileCode2 size={13} aria-hidden />}
                <span className={entry.kind === 'file' ? 'mono' : undefined}>{entry.label}</span>
                {entry.hint && <span className="wg-palette-hint">{entry.hint}</span>}
              </button>
            </React.Fragment>
          ))}
          {entries.length === 0 && <div className="wg-empty">Nothing matches “{query}”.</div>}
        </div>

        <div className="wg-palette-foot">
          <span>
            <span className="wg-kbd">↑</span> <span className="wg-kbd">↓</span> navigate
          </span>
          <span>
            <span className="wg-kbd">Enter</span> run
          </span>
          <span>
            <span className="wg-kbd">Esc</span> close
          </span>
        </div>
      </div>
    </div>
  );
};

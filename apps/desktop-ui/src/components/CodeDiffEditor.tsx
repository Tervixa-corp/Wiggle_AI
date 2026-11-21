import React, { useEffect, useMemo, useState } from 'react';
import { Columns2, RotateCcw, RotateCw, Save, X } from 'lucide-react';
import type { OpenEditorTab } from '../store/useWiggleStore';

interface EditorPrefs {
  wrap: boolean;
  lineNumbers: boolean;
  tabSize: number;
  autoSave: boolean;
  spellCheck: boolean;
}

interface Props {
  tab: OpenEditorTab;
  prefs: EditorPrefs;
  onChange: (path: string, content: string) => void;
  onSave: (path: string) => void;
  onToggleDiff: (path: string) => void;
  onUndo: () => void;
  onRedo: () => void;
}

interface DiffLine {
  kind: 'ctx' | 'add' | 'del';
  line: string;
}

function computeSimpleDiff(before: string, after: string): DiffLine[] {
  const a = before.split('\n');
  const b = after.split('\n');
  const max = Math.max(a.length, b.length);
  const out: DiffLine[] = [];
  for (let i = 0; i < max; i++) {
    if (a[i] === b[i]) {
      if (a[i] !== undefined) out.push({ kind: 'ctx', line: `  ${a[i]}` });
    } else {
      if (a[i] !== undefined) out.push({ kind: 'del', line: `- ${a[i]}` });
      if (b[i] !== undefined) out.push({ kind: 'add', line: `+ ${b[i]}` });
    }
  }
  return out;
}

export const CodeDiffEditor: React.FC<Props> = ({
  tab,
  prefs,
  onChange,
  onSave,
  onToggleDiff,
  onUndo,
  onRedo,
}) => {
  const [sideBySide, setSideBySide] = useState(false);
  const lines = useMemo(() => tab.content.split('\n'), [tab.content]);
  const diffLines = useMemo(
    () => computeSimpleDiff(tab.originalContent, tab.content),
    [tab.originalContent, tab.content]
  );

  // Auto-save waits for a pause so a keystroke burst commits one snapshot.
  useEffect(() => {
    if (!prefs.autoSave || !tab.dirty) return;
    const timer = setTimeout(() => onSave(tab.path), 2000);
    return () => clearTimeout(timer);
  }, [prefs.autoSave, tab.dirty, tab.content, tab.path, onSave]);

  return (
    <div className="editor-wrap">
      <div className="editor-toolbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="mono" style={{ fontSize: 12 }}>
            {tab.path}
          </span>
          {tab.dirty && <span className="wb-badge" style={{ color: 'var(--status-warn)' }}>Modified</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button className="btn-flat" style={{ height: 24, fontSize: 11 }} onClick={() => onToggleDiff(tab.path)}>
            <Columns2 size={12} />
            <span>{tab.diffMode ? 'Editor' : 'Diff Review'}</span>
          </button>
          {tab.diffMode && (
            <>
              <button className="btn-flat" style={{ height: 24, fontSize: 11 }} onClick={() => setSideBySide((s) => !s)}>
                <span>{sideBySide ? 'Inline' : 'Side-by-Side'}</span>
              </button>
              <button
                className="btn-flat"
                style={{ height: 24, fontSize: 11, color: 'var(--status-err)' }}
                onClick={() => onChange(tab.path, tab.originalContent)}
              >
                <X size={12} />
                <span>Revert</span>
              </button>
            </>
          )}
          <button className="icon-btn" title="/undo snapshot" onClick={onUndo}>
            <RotateCcw size={13} />
          </button>
          <button className="icon-btn" title="/redo snapshot" onClick={onRedo}>
            <RotateCw size={13} />
          </button>
          <button
            className="btn-primary"
            style={{ height: 24, padding: '0 9px', fontSize: 11 }}
            disabled={!tab.dirty}
            onClick={() => onSave(tab.path)}
          >
            <Save size={12} />
            <span>Save</span>
          </button>
        </div>
      </div>

      {tab.diffMode ? (
        sideBySide ? (
          <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', minHeight: 0 }}>
            <pre className="diff-view" style={{ margin: 0, padding: 10, borderRight: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>
              {tab.originalContent}
            </pre>
            <pre className="diff-view" style={{ margin: 0, padding: 10, color: 'var(--text-primary)' }}>
              {tab.content}
            </pre>
          </div>
        ) : (
          <div className="diff-view">
            {diffLines.map((d, idx) => (
              <div key={idx} className={`diff-line ${d.kind}`}>
                {d.line}
              </div>
            ))}
          </div>
        )
      ) : (
        <div className="editor-surface">
          {prefs.lineNumbers && (
            <div className="line-gutter">
              {lines.map((_, idx) => (
                <div key={idx}>{idx + 1}</div>
              ))}
            </div>
          )}
          <textarea
            className="code-textarea"
            spellCheck={prefs.spellCheck}
            wrap={prefs.wrap ? 'soft' : 'off'}
            style={prefs.wrap ? { whiteSpace: 'pre-wrap' } : { whiteSpace: 'pre', overflowX: 'auto' }}
            value={tab.content}
            onChange={(e) => onChange(tab.path, e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
                e.preventDefault();
                onSave(tab.path);
                return;
              }
              if (e.key === 'Tab') {
                e.preventDefault();
                const indent = ' '.repeat(prefs.tabSize);
                const start = e.currentTarget.selectionStart;
                const end = e.currentTarget.selectionEnd;
                const next = `${tab.content.slice(0, start)}${indent}${tab.content.slice(end)}`;
                onChange(tab.path, next);
                requestAnimationFrame(() => {
                  e.currentTarget.selectionStart = start + indent.length;
                  e.currentTarget.selectionEnd = start + indent.length;
                });
              }
            }}
          />
        </div>
      )}
    </div>
  );
};

import { useMemo } from 'react';
import { FileCode2, GitCompare, X } from 'lucide-react';
import { useWiggle } from '../store/useWiggleStore';
import { collapseContext, diffLines, diffStats } from '../lib/diff';
import type { DiffLine } from '../lib/diff';

function FileView({ content }: { content: string }) {
  const lines = useMemo(() => content.split('\n'), [content]);
  return (
    <div className="code">
      <div>
        {lines.map((_, index) => <div className="gutter" key={index}>{index + 1}</div>)}
      </div>
      <div>
        {lines.map((line, index) => <div className="line" key={index}>{line || ' '}</div>)}
      </div>
    </div>
  );
}

function DiffView({ before, after }: { before: string | null; after: string }) {
  const rendered = useMemo(() => {
    if (before === null) {
      // A newly created file: show every line as an addition.
      return after.split('\n').map((text, index) => ({ type: 'add' as const, text, leftLine: null, rightLine: index + 1 }));
    }
    return diffLines(before, after);
  }, [before, after]);

  const stats = useMemo(() => diffStats(rendered as DiffLine[]), [rendered]);
  const collapsed = useMemo(() => collapseContext(rendered as DiffLine[], 3), [rendered]);

  return (
    <div>
      <div className="editor-head">
        <GitCompare size={12} />
        <span>{before === null ? 'New file' : 'Changes'}</span>
        <span className="spacer" />
        <span className="diff-stats">
          <span className="add">+{stats.added}</span>
          <span className="del">-{stats.removed}</span>
        </span>
      </div>
      <div className="editor-scroll">
        {collapsed.map((entry, index) =>
          entry.type === 'skip' ? (
            <span className="diff-skip" key={`skip-${index}`}>⋯ {entry.count} unchanged line{entry.count === 1 ? '' : 's'}</span>
          ) : (
            <div className={`diff-line ${entry.type}`} key={`line-${index}`}>
              <span className="num">{entry.leftLine ?? ''}</span>
              <span className="num">{entry.rightLine ?? ''}</span>
              <span className="mark">{entry.type === 'add' ? '+' : entry.type === 'del' ? '-' : ''}</span>
              <span className="text">{entry.text || ' '}</span>
            </div>
          ),
        )}
      </div>
    </div>
  );
}

export function CodeDiffEditor() {
  const { tabs, activeTab, selectTab, closeTab, files } = useWiggle();
  const tab = tabs.find((entry) => entry.path === activeTab) ?? null;

  if (!tabs.length) {
    return (
      <div className="pane">
        <div className="empty-state">
          <h1 className="empty-title">No file open</h1>
          <p className="empty-copy">Pick a file in the sidebar, or open a diff from a tool result.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="pane">
      <div className="tabbar" role="tablist">
        {tabs.map((entry) => (
          <div
            key={entry.path}
            className={`tab ${entry.path === activeTab ? 'active' : ''}`}
            role="tab"
            aria-selected={entry.path === activeTab}
          >
            <button className="label" onClick={() => selectTab(entry.path)} title={entry.path} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {entry.kind === 'diff' ? <GitCompare size={12} /> : <FileCode2 size={12} />}
              {entry.path.split('/').pop()}
            </button>
            <button className="close" onClick={() => closeTab(entry.path)} aria-label={`Close ${entry.path}`}><X size={11} /></button>
          </div>
        ))}
      </div>

      {!tab ? (
        <div className="empty-state"><p className="empty-copy">Select a tab.</p></div>
      ) : tab.kind === 'diff' ? (
        <DiffView before={tab.before ?? null} after={tab.after ?? ''} />
      ) : (
        <>
          <div className="editor-head">
            <FileCode2 size={12} />
            <span className="path">{tab.path}</span>
            <span className="spacer" />
            <span>{files[tab.path] === undefined ? 'loading…' : `${files[tab.path].split('\n').length} lines`}</span>
          </div>
          <div className="editor-scroll">
            <FileView content={files[tab.path] ?? ''} />
          </div>
        </>
      )}
    </div>
  );
}

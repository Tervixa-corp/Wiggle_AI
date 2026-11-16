import { useCallback, useEffect, useMemo, useState } from 'react';
import { FileCode2, Undo2, Redo2, Pencil, Check, X } from 'lucide-react';

type Op = { type: 'ctx' | 'add' | 'del'; text: string; hunk?: number };
type Proposal = { id: string; path: string; status: string; hunks: number; stats: { added: number; removed: number }; ops: Op[] };
type EditState = { undoDepth: number; redoDepth: number; undo: { id: string; path: string } | null; redo: { id: string; path: string } | null };
type FileState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; content: string };

async function api<T = any>(method: 'GET' | 'POST', url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (HTTP ${response.status}).`);
  return data as T;
}

// Show changed lines with three lines of context; collapse long unchanged runs.
function visibleOps(ops: Op[]) {
  const keep = new Set<number>();
  ops.forEach((op, i) => {
    if (op.type !== 'ctx') for (let k = Math.max(0, i - 3); k <= Math.min(ops.length - 1, i + 3); k++) keep.add(k);
  });
  const rows: Array<{ kind: 'op'; op: Op } | { kind: 'gap'; count: number }> = [];
  let gap = 0;
  ops.forEach((op, i) => {
    if (keep.has(i)) {
      if (gap) { rows.push({ kind: 'gap', count: gap }); gap = 0; }
      rows.push({ kind: 'op', op });
    } else gap++;
  });
  if (gap) rows.push({ kind: 'gap', count: gap });
  return rows;
}

export function FileViewer({ path, refreshKey, onChanged }: { path: string; refreshKey: number; onChanged: () => void }) {
  const [state, setState] = useState<FileState>({ status: 'loading' });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [accepted, setAccepted] = useState<Set<number>>(new Set());
  const [edits, setEdits] = useState<EditState | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const loadFile = useCallback(() => {
    setState({ status: 'loading' });
    fetch(`/api/workspace/file?path=${encodeURIComponent(path)}`)
      .then(async r => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || `Could not open file (HTTP ${r.status}).`);
        return data;
      })
      .then(data => setState({ status: 'ready', content: data.content }))
      .catch(e => setState({ status: 'error', message: e.message }));
  }, [path]);

  const loadEdits = useCallback(() => {
    api<EditState>('GET', '/api/edits').then(setEdits).catch(() => setEdits(null));
  }, []);

  // A different file resets the editor; a refresh only reloads contents so notices stay visible.
  useEffect(() => { setEditing(false); setProposal(null); setNotice(null); }, [path]);
  useEffect(() => { loadFile(); }, [path, refreshKey, loadFile]);

  useEffect(() => { loadEdits(); }, [path, refreshKey, loadEdits]);

  async function run(action: () => Promise<void>) {
    setBusy(true); setNotice(null);
    try { await action(); }
    catch (e) { setNotice({ kind: 'error', text: (e as Error).message }); }
    finally { setBusy(false); loadEdits(); }
  }

  function startEdit() {
    if (state.status !== 'ready') return;
    setDraft(state.content); setEditing(true); setProposal(null); setNotice(null);
  }

  function review() {
    run(async () => {
      const created = await api<Proposal>('POST', '/api/edits', { path, content: draft });
      if (created.hunks === 0) { setNotice({ kind: 'ok', text: 'No changes to review.' }); return; }
      setProposal(created);
      setAccepted(new Set(Array.from({ length: created.hunks }, (_, i) => i)));
    });
  }

  function apply() {
    if (!proposal) return;
    run(async () => {
      await api('POST', `/api/edits/${proposal.id}/approve`, { hunks: [...accepted].sort((a, b) => a - b) });
      setNotice({ kind: 'ok', text: `Applied ${accepted.size} of ${proposal.hunks} change${proposal.hunks === 1 ? '' : 's'}.` });
      setProposal(null); setEditing(false);
      onChanged();
    });
  }

  function rejectAll() {
    if (!proposal) return;
    run(async () => {
      await api('POST', `/api/edits/${proposal.id}/reject`, {});
      setProposal(null);
      setNotice({ kind: 'ok', text: 'Proposal rejected. The file is unchanged.' });
    });
  }

  function undo() { run(async () => { await api('POST', '/api/edits/undo', {}); setNotice({ kind: 'ok', text: 'Undid the last applied edit.' }); onChanged(); }); }
  function redo() { run(async () => { await api('POST', '/api/edits/redo', {}); setNotice({ kind: 'ok', text: 'Redid the edit.' }); onChanged(); }); }

  // Keyboard: Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z, unless the user is typing in a field.
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable)) return;
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z' || busy) return;
      e.preventDefault();
      if (e.shiftKey) { if (edits?.redo) redo(); } else if (edits?.undo) undo();
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  const rows = useMemo(() => (proposal ? visibleOps(proposal.ops) : []), [proposal]);
  const lines = state.status === 'ready' ? state.content.split('\n') : [];

  return (
    <div className="file-viewer">
      <div className="file-viewer-head">
        <FileCode2 size={14}/><span className="file-path">{path}</span>
        {proposal ? <span className="badge warn">Pending review</span> : editing ? <span className="badge">Editing</span> : <span className="badge">Read-only</span>}
        <div className="file-actions">
          <button className="ghost" onClick={undo} disabled={busy || !edits?.undo} title="Undo last applied edit (Ctrl+Z)"><Undo2 size={13}/> Undo{edits?.undoDepth ? ` (${edits.undoDepth})` : ''}</button>
          <button className="ghost" onClick={redo} disabled={busy || !edits?.redo} title="Redo (Ctrl+Shift+Z)"><Redo2 size={13}/> Redo{edits?.redoDepth ? ` (${edits.redoDepth})` : ''}</button>
          {!editing && state.status === 'ready' && <button className="ghost" onClick={startEdit} disabled={busy}><Pencil size={13}/> Edit</button>}
        </div>
      </div>

      {notice && <div className={'file-notice ' + notice.kind} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.text}</div>}
      {state.status === 'loading' && <div className="file-viewer-note">Loading…</div>}
      {state.status === 'error' && <div className="file-viewer-note error" role="alert">{state.message}</div>}

      {state.status === 'ready' && !editing && (
        <div className="file-code" role="region" aria-label={`Contents of ${path}`}>
          <table><tbody>
            {lines.map((line, i) => (
              <tr key={i}><td className="ln">{i + 1}</td><td className="lc"><pre>{line || ' '}</pre></td></tr>
            ))}
          </tbody></table>
        </div>
      )}

      {state.status === 'ready' && editing && !proposal && (
        <div className="editor">
          <textarea aria-label={`Edit ${path}`} spellCheck={false} value={draft} onChange={e => setDraft(e.target.value)} />
          <div className="editor-footer">
            <span>Changes are proposed first. Nothing is written until you approve.</span>
            <div>
              <button className="ghost" onClick={() => { setEditing(false); setNotice(null); }} disabled={busy}><X size={13}/> Cancel</button>
              <button className="primary" onClick={review} disabled={busy}>Review changes</button>
            </div>
          </div>
        </div>
      )}

      {proposal && (
        <div className="review">
          <div className="review-head">
            <span>{proposal.stats.added > 0 && <span className="stat-add">+{proposal.stats.added}</span>} {proposal.stats.removed > 0 && <span className="stat-del">−{proposal.stats.removed}</span>}</span>
            <span className="muted">{accepted.size} of {proposal.hunks} change{proposal.hunks === 1 ? '' : 's'} accepted</span>
          </div>
          <div className="diff" role="region" aria-label="Proposed changes">
            {rows.map((row, i) => row.kind === 'gap'
              ? <div key={i} className="diff-gap">… {row.count} unchanged line{row.count === 1 ? '' : 's'}</div>
              : <div key={i} className={'diff-line ' + row.op.type}>
                  <span className="sign">{row.op.type === 'add' ? '+' : row.op.type === 'del' ? '−' : ' '}</span>
                  <span className="diff-text">{row.op.text || ' '}</span>
                </div>)}
          </div>
          <div className="hunk-list">
            {Array.from({ length: proposal.hunks }, (_, h) => (
              <label key={h} className="hunk-toggle">
                <input type="checkbox" checked={accepted.has(h)} onChange={e => setAccepted(prev => { const next = new Set(prev); e.target.checked ? next.add(h) : next.delete(h); return next; })} />
                Change {h + 1}
              </label>
            ))}
          </div>
          <div className="editor-footer">
            <span>Accepted changes are written atomically and can be undone.</span>
            <div>
              <button className="ghost" onClick={rejectAll} disabled={busy}><X size={13}/> Reject all</button>
              <button className="primary" onClick={apply} disabled={busy || accepted.size === 0}><Check size={13}/> Apply {accepted.size}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

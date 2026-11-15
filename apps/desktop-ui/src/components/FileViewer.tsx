import { useEffect, useState } from 'react';
import { FileCode2 } from 'lucide-react';

type FileState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; content: string; size: number };

// Read-only viewer. Editing is intentionally not available until a permission-gated write path exists.
export function FileViewer({ path, refreshKey }: { path: string; refreshKey: number }) {
  const [state, setState] = useState<FileState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    fetch(`/api/workspace/file?path=${encodeURIComponent(path)}`)
      .then(async r => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || `Could not open file (HTTP ${r.status}).`);
        return data;
      })
      .then(data => { if (!cancelled) setState({ status: 'ready', content: data.content, size: data.size }); })
      .catch(e => { if (!cancelled) setState({ status: 'error', message: e.message }); });
    return () => { cancelled = true; };
  }, [path, refreshKey]);

  return (
    <div className="file-viewer">
      <div className="file-viewer-head">
        <FileCode2 size={14}/><span>{path}</span>
        <small>read-only</small>
      </div>
      {state.status === 'loading' && <div className="file-viewer-note">Loading…</div>}
      {state.status === 'error' && <div className="file-viewer-note error" role="alert">{state.message}</div>}
      {state.status === 'ready' && (
        <div className="file-code" role="region" aria-label={`Contents of ${path}`}>
          <table><tbody>
            {state.content.split('\n').map((line, i) => (
              <tr key={i}><td className="ln">{i + 1}</td><td className="lc"><pre>{line || ' '}</pre></td></tr>
            ))}
          </tbody></table>
        </div>
      )}
    </div>
  );
}

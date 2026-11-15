import React, { useState } from 'react';
import { ArrowLeft, ArrowRight, Bot, RefreshCw } from 'lucide-react';

interface DomElementRef {
  refId: string;
  role: string;
  tag: string;
  name: string;
  href?: string | null;
}

export const BrowserPane: React.FC = () => {
  const [urlInput, setUrlInput] = useState('http://127.0.0.1:4317/');
  const [activeUrl, setActiveUrl] = useState('http://127.0.0.1:4317/');
  const [history, setHistory] = useState<string[]>(['http://127.0.0.1:4317/']);
  const [histIdx, setHistIdx] = useState(0);
  const [agentControl, setAgentControl] = useState(true);
  const [tree, setTree] = useState<string>('');
  const [elements, setElements] = useState<DomElementRef[]>([]);
  const [consoleLogs, setConsoleLogs] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const inspectUrl = async (target: string, pushHist = true) => {
    setLoading(true);
    setActiveUrl(target);
    if (pushHist) {
      const next = [...history.slice(0, histIdx + 1), target];
      setHistory(next);
      setHistIdx(next.length - 1);
    }
    try {
      const r = await fetch('/api/browser/inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: target }),
      });
      const data = await r.json();
      if (r.ok) {
        setTree(data.accessibilityTree || '(no interactive elements detected)');
        setElements(data.elements || []);
        setConsoleLogs((prev) => [
          ...prev.slice(-20),
          `[HTTP ${data.status}] ${data.title} (${(data.elements || []).length} refs)`,
        ]);
      } else {
        setConsoleLogs((prev) => [...prev.slice(-20), `[error] ${data.error}`]);
      }
    } catch (err) {
      setConsoleLogs((prev) => [
        ...prev.slice(-20),
        `[error] ${err instanceof Error ? err.message : 'Inspect failed'}`,
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="aux-body">
      <div className="browser-bar">
        <button
          className="icon-btn"
          disabled={histIdx <= 0}
          onClick={() => {
            const nextIdx = histIdx - 1;
            setHistIdx(nextIdx);
            setUrlInput(history[nextIdx]);
            inspectUrl(history[nextIdx], false);
          }}
        >
          <ArrowLeft size={13} />
        </button>
        <button
          className="icon-btn"
          disabled={histIdx >= history.length - 1}
          onClick={() => {
            const nextIdx = histIdx + 1;
            setHistIdx(nextIdx);
            setUrlInput(history[nextIdx]);
            inspectUrl(history[nextIdx], false);
          }}
        >
          <ArrowRight size={13} />
        </button>
        <button className="icon-btn" onClick={() => inspectUrl(activeUrl, false)} title="Inspect DOM">
          <RefreshCw size={13} />
        </button>
        <input
          className="input-flat mono"
          style={{ flex: 1, height: 24, fontSize: 11 }}
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && inspectUrl(urlInput)}
        />
        <button
          className={`btn-flat`}
          style={{
            height: 24,
            padding: '0 7px',
            fontSize: 11,
            borderColor: agentControl ? 'var(--border-focus)' : 'var(--border-subtle)',
          }}
          onClick={() => setAgentControl((v) => !v)}
          title="Toggle Agent Browser Control"
        >
          <Bot size={11} />
          <span>{agentControl ? 'Agent' : 'Manual'}</span>
        </button>
      </div>

      <div className="browser-frame-wrap">
        <iframe title="Wiggle Browser Preview" className="browser-iframe" src={activeUrl} sandbox="allow-scripts allow-same-origin" />
        <div className="dom-inspector">
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, color: 'var(--text-muted)' }}>
            <span>DOM ACCESSIBILITY TREE ({elements.length} refs)</span>
            <button
              className="btn-flat"
              style={{ height: 20, fontSize: 10.5, padding: '0 6px' }}
              onClick={() => inspectUrl(urlInput, false)}
            >
              {loading ? 'Scanning...' : 'Capture Tree'}
            </button>
          </div>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', color: 'var(--text-secondary)' }}>
            {tree || 'Click "Capture Tree" or press Enter in URL bar to inspect [ref=e1] DOM nodes.'}
          </pre>
          {consoleLogs.length > 0 && (
            <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--border-subtle)' }}>
              <div style={{ color: 'var(--text-muted)', marginBottom: 4 }}>CONSOLE STREAM</div>
              {consoleLogs.map((l, i) => (
                <div key={i} style={{ color: 'var(--text-secondary)' }}>
                  {l}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

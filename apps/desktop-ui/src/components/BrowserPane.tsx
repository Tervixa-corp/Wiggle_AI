import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Eye,
  FileText,
  Monitor,
  RefreshCw,
  Search,
  Smartphone,
  Tablet,
} from 'lucide-react';

interface Props {
  home?: string;
}

interface InspectResult {
  url: string;
  status: number;
  title: string;
  text: string;
  consoleLogs?: Array<{ level: string; message: string }>;
}

type Device = 'fit' | 'desktop' | 'tablet' | 'phone';
type Mode = 'preview' | 'reader';

const DEV_DEFAULT = 'http://localhost:5173/';

function isLoopback(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === '[::1]' ||
      parsed.hostname === '0.0.0.0'
    );
  } catch {
    return false;
  }
}

function withProtocol(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
  return `http://${trimmed}`;
}

const DEVICES: Array<{ id: Device; label: string; icon: React.ReactNode }> = [
  { id: 'fit', label: 'Fit pane', icon: <Monitor size={13} /> },
  { id: 'desktop', label: 'Desktop 1280', icon: <Monitor size={13} /> },
  { id: 'tablet', label: 'Tablet 820', icon: <Tablet size={13} /> },
  { id: 'phone', label: 'Phone 390', icon: <Smartphone size={13} /> },
];

export const BrowserPane: React.FC<Props> = ({ home }) => {
  const start = home && home.trim() ? withProtocol(home) : DEV_DEFAULT;
  const [urlInput, setUrlInput] = useState(start);
  const [activeUrl, setActiveUrl] = useState(start);
  const [mode, setMode] = useState<Mode>(isLoopback(start) ? 'preview' : 'reader');
  const [device, setDevice] = useState<Device>('fit');
  const [history, setHistory] = useState<string[]>([start]);
  const [histIdx, setHistIdx] = useState(0);
  const [nonce, setNonce] = useState(0);
  const [result, setResult] = useState<InspectResult | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const frameClass = useMemo(
    () =>
      device === 'desktop'
        ? 'is-desktop'
        : device === 'tablet'
          ? 'is-tablet'
          : device === 'phone'
            ? 'is-phone'
            : '',
    [device],
  );

  const navigate = (target: string, pushHistory = true) => {
    const value = withProtocol(target);
    if (!value) return;
    setActiveUrl(value);
    setUrlInput(value);
    setError('');
    if (pushHistory) {
      const next = [...history.slice(0, histIdx + 1), value];
      setHistory(next);
      setHistIdx(next.length - 1);
    }
    // Local targets are meant to be rendered, not read.
    if (isLoopback(value)) {
      setMode('preview');
      setNonce((value) => value + 1);
    } else {
      setMode('reader');
      void read(value);
    }
  };

  const read = async (target: string) => {
    const value = withProtocol(target);
    if (!value) return;
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/browser/inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: value }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      setResult(data);
    } catch (caught) {
      setResult(null);
      setError(caught instanceof Error ? caught.message : 'Could not read that page.');
    } finally {
      setLoading(false);
    }
  };

  const go = (delta: number) => {
    const nextIdx = histIdx + delta;
    if (nextIdx < 0 || nextIdx >= history.length) return;
    setHistIdx(nextIdx);
    navigate(history[nextIdx], false);
  };

  const reload = () => {
    if (mode === 'preview') setNonce((value) => value + 1);
    else void read(activeUrl);
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    if (next === 'reader' && !result) void read(activeUrl);
  };

  return (
    <div className="wg-browser">
      <div className="wg-browser-bar">
        <button
          className="wg-sidebar-action"
          disabled={histIdx <= 0}
          onClick={() => go(-1)}
          aria-label="Back"
          title="Back"
        >
          <ArrowLeft size={13} />
        </button>
        <button
          className="wg-sidebar-action"
          disabled={histIdx >= history.length - 1}
          onClick={() => go(1)}
          aria-label="Forward"
          title="Forward"
        >
          <ArrowRight size={13} />
        </button>
        <button
          className="wg-sidebar-action"
          onClick={reload}
          aria-label="Reload"
          title="Reload"
        >
          <RefreshCw size={12} className={loading ? 'spin' : ''} />
        </button>

        <input
          className="wg-browser-url"
          value={urlInput}
          onChange={(event) => setUrlInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') navigate(urlInput);
          }}
          placeholder="localhost:5173"
          aria-label="Address"
          spellCheck={false}
        />

        <button
          className="wg-sidebar-action"
          onClick={() => navigate(urlInput)}
          aria-label="Go"
          title="Go"
        >
          <Search size={12} />
        </button>

        <a
          className="wg-sidebar-action"
          href={activeUrl}
          target="_blank"
          rel="noreferrer"
          title="Open in the system browser"
          aria-label="Open in the system browser"
        >
          <ExternalLink size={12} />
        </a>
      </div>

      <div className="wg-browser-bar" style={{ height: 32, borderBottom: '1px solid var(--wg-line)' }}>
        <div className="wg-browser-devices" role="group" aria-label="Preview mode">
          <button
            className={`wg-browser-device ${mode === 'preview' ? 'is-active' : ''}`}
            onClick={() => switchMode('preview')}
            title="Live preview"
            aria-label="Live preview"
          >
            <Eye size={12} />
          </button>
          <button
            className={`wg-browser-device ${mode === 'reader' ? 'is-active' : ''}`}
            onClick={() => switchMode('reader')}
            title="Text reader"
            aria-label="Text reader"
          >
            <FileText size={12} />
          </button>
        </div>

        {mode === 'preview' && (
          <div className="wg-browser-devices" role="group" aria-label="Viewport size">
            {DEVICES.map((entry) => (
              <button
                key={entry.id}
                className={`wg-browser-device ${device === entry.id ? 'is-active' : ''}`}
                onClick={() => setDevice(entry.id)}
                title={entry.label}
                aria-label={entry.label}
              >
                {entry.icon}
              </button>
            ))}
          </div>
        )}

        <span className="wg-status-item" style={{ marginLeft: 'auto', fontSize: 10.5 }}>
          {mode === 'preview'
            ? isLoopback(activeUrl)
              ? 'live'
              : 'remote sites render blank — switch to reader'
            : result
              ? `HTTP ${result.status} · ${result.text.length} chars`
              : 'extracting text'}
        </span>
      </div>

      <div className="wg-browser-stage">
        {mode === 'preview' ? (
          <div className="wg-browser-viewport">
            <iframe
              key={`${activeUrl}-${nonce}`}
              className={`wg-browser-frame ${frameClass}`}
              src={activeUrl}
              title="Preview"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
              referrerPolicy="no-referrer"
            />
          </div>
        ) : (
          <div className="dom-inspector">
            {error && (
              <div className="wg-browser-fallback">
                <div className="wg-browser-note" style={{ color: 'var(--wg-text-2)' }}>
                  {error}
                </div>
              </div>
            )}

            {!result && !error && (
              <p className="dom-empty">
                The reader fetches the page on the local runtime and extracts readable text for the agent. No scripts
                run in this view and no cookies are shared.
              </p>
            )}

            {result && (
              <>
                <div className="dom-title">{result.title || 'Untitled page'}</div>
                <div className="dom-url mono">{result.url}</div>
                <pre className="dom-text">{result.text || '(no readable text)'}</pre>

                {result.consoleLogs?.length ? (
                  <div className="dom-log">
                    <div className="telemetry-title">Fetch log</div>
                    {result.consoleLogs.map((entry, index) => (
                      <div key={index} className="dom-log-row mono">
                        <span className="dom-log-level">{entry.level}</span>
                        <span>{entry.message}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

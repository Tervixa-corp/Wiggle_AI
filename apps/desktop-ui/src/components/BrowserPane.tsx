import { useState } from 'react';
import { ArrowLeft, ArrowRight, Globe, RotateCw } from 'lucide-react';

/**
 * Embedded browser preview.
 *
 * This is a human-operated frame only. The agent cannot drive it: DOM
 * actuation and accessibility-tree extraction are not implemented in this
 * build, and many sites refuse to be framed.
 */
export function BrowserPane() {
  const [url, setUrl] = useState('');
  const [loaded, setLoaded] = useState<string | null>(null);

  const navigate = () => {
    const value = url.trim();
    if (!value) return;
    const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    setLoaded(withScheme);
  };

  return (
    <div className="pane">
      <div className="browser-bar">
        <button className="icon-button" disabled aria-label="Back"><ArrowLeft size={13} /></button>
        <button className="icon-button" disabled aria-label="Forward"><ArrowRight size={13} /></button>
        <button className="icon-button" onClick={() => setLoaded((current) => current)} aria-label="Reload"><RotateCw size={13} /></button>
        <input
          className="field url"
          placeholder="http://localhost:3000"
          value={url}
          spellCheck={false}
          onChange={(event) => setUrl(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') navigate();
          }}
        />
      </div>

      {loaded ? (
        <iframe className="browser-frame" src={loaded} title="Browser preview" sandbox="allow-scripts allow-forms allow-same-origin" referrerPolicy="no-referrer" />
      ) : (
        <div className="browser-placeholder">
          <div className="frame-box">
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
              <Globe size={18} />
              <span>Enter a URL to preview a local dev server.</span>
            </div>
          </div>
          <span>Human-operated preview. The agent cannot read or click inside this frame.</span>
        </div>
      )}
    </div>
  );
}

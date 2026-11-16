import { useState, type ReactNode } from 'react';
import { CircleHelp } from 'lucide-react';
import type { Mode } from '../lib/storage';

export const settingsSections = ['Identity & instructions', 'Models & providers', 'Agents & swarm', 'MCP connectors', 'Skills & plugins', 'Personal memory', 'Permissions & sandbox', 'Built-in browser', 'Git & GitHub', 'Appearance & keybindings'];

type Connection = { configured: boolean; model: string; provider: string; workspace: string | null } | null;

type Props = {
  section: string;
  connection: Connection;
  theme: 'dark' | 'light';
  onTheme: (theme: 'dark' | 'light') => void;
  mode: Mode;
  onMode: (mode: Mode) => void;
  sessionCount: number;
  onClearSessions: () => void;
};

function Note({ children }: { children: ReactNode }) {
  return <div className="settings-note"><CircleHelp size={16} /> {children}</div>;
}

function Row({ title, detail, children }: { title: string; detail: string; children: ReactNode }) {
  return <div className="setting-row"><div><strong>{title}</strong><small>{detail}</small></div>{children}</div>;
}

const shortcuts: Array<[string, string]> = [
  ['Open settings', 'Ctrl / ⌘ + ,'],
  ['Close settings', 'Escape'],
  ['Send message', 'Enter'],
  ['New line in message', 'Shift + Enter'],
  ['Undo last applied edit (file view)', 'Ctrl / ⌘ + Z'],
];

export function SettingsContent({ section, connection, theme, onTheme, mode, onMode, sessionCount, onClearSessions }: Props) {
  const [confirming, setConfirming] = useState(false);
  let body: ReactNode;

  if (section === 'Identity & instructions') {
    body = <>
      <p>The identity header is sent with every chat and agent request. It is read-only in this build.</p>
      <pre className="identity-text">You are Tervixa Wiggle, an autonomous AI software engineering, research, and workstation agent developed by Tervixa Corporation. You can list, read and search files in the workspace, and propose edits that wait for approval in Suggest mode.</pre>
      <Note>Editing instructions and loading project files such as WIGGLE.md into chat are not implemented yet.</Note>
    </>;
  } else if (section === 'Models & providers') {
    body = <>
      <p>The provider and model the local server is configured to use. API keys stay on the server and are never shown here.</p>
      <Row title="Provider" detail="Host of the configured endpoint"><span className="muted-value">{connection?.configured ? connection.provider : 'Not configured'}</span></Row>
      <Row title="Model" detail="Set with WIGGLE_MODEL on the server"><span className="muted-value">{connection?.configured ? connection.model : '—'}</span></Row>
      <Note>To change the model or provider, set WIGGLE_BASE_URL, WIGGLE_MODEL and WIGGLE_API_KEY and restart the local server. Switching models from this screen is not implemented.</Note>
    </>;
  } else if (section === 'Agents & swarm') {
    body = <>
      <p>Parallel agents and swarm orchestration are not implemented in this build. The agent in chat runs one tool loop at a time.</p>
      <Note>Overview shows 0 active agents. Nothing on this screen is configurable yet.</Note>
    </>;
  } else if (section === 'MCP connectors') {
    body = <>
      <p>MCP servers are not connected in this build. Tools, resources and prompts from MCP are not available to the agent.</p>
      <Note>Planned: a stdio client first, with SSE and HTTP later.</Note>
    </>;
  } else if (section === 'Skills & plugins') {
    body = <>
      <p>Skills are loaded only by the Rust command-line tool (wiggle prompt). The desktop app does not load skills, and plugin hooks are not implemented.</p>
      <Note>Installing skills from this screen and running lifecycle hooks are not implemented yet.</Note>
    </>;
  } else if (section === 'Personal memory') {
    body = <>
      <p>Chat sessions are saved in this browser's local storage. Long-term memory facts and search across past chats are not implemented.</p>
      <Row title="Saved sessions" detail={`${sessionCount} stored in this browser`}>
        {confirming
          ? <div className="confirm-actions">
              <button className="outline-button danger" onClick={() => { setConfirming(false); onClearSessions(); }}>Confirm clear</button>
              <button className="outline-button" onClick={() => setConfirming(false)}>Cancel</button>
            </div>
          : <button className="outline-button" onClick={() => setConfirming(true)}>Clear saved sessions</button>}
      </Row>
    </>;
  } else if (section === 'Permissions & sandbox') {
    body = <>
      <p>How the agent's edits are handled. This choice is shared with the composer in chat.</p>
      <Row title="Permission mode" detail="Suggest: edits wait for your approval. Auto-apply: edits are written immediately and can be undone.">
        <select aria-label="Permission mode" value={mode} onChange={e => onMode(e.target.value as Mode)}>
          <option value="suggest">Suggest edits</option>
          <option value="auto-edit">Auto-apply edits</option>
        </select>
      </Row>
      <Row title="Workspace access" detail="Read-only, except for edits you approve"><span className="muted-value">{connection?.workspace ? 'Enabled' : 'No workspace'}</span></Row>
      <Row title="Secret files" detail=".env files, keys and excluded folders are never read or searched"><span className="muted-value">Excluded</span></Row>
      <Row title="Shell and network tools" detail="Not enabled. They need explicit permission and security tests first."><span className="muted-value">Off</span></Row>
    </>;
  } else if (section === 'Built-in browser') {
    body = <Note>The built-in browser is not implemented in this build.</Note>;
  } else if (section === 'Git & GitHub') {
    body = <>
      <p>Git status and GitHub integration are not implemented. The status bar shows "No repository" for this reason.</p>
      <Note>Planned: read-only repository status first, then pull requests from the desktop app.</Note>
    </>;
  } else {
    body = <>
      <p>Make the workbench feel like yours.</p>
      <Row title="Color theme" detail="Choose the appearance of the workbench. Saved in this browser.">
        <select aria-label="Color theme" value={theme} onChange={e => onTheme(e.target.value === 'light' ? 'light' : 'dark')}>
          <option value="dark">Carbon dark</option>
          <option value="light">Crisp light</option>
        </select>
      </Row>
      {shortcuts.map(([label, keys]) => <Row key={label} title={label} detail="Fixed shortcut"><kbd>{keys}</kbd></Row>)}
      <Note>Custom keybindings are not implemented yet.</Note>
    </>;
  }

  return <div className="settings-content">
    <div className="eyebrow">SETTINGS / {section.toUpperCase()}</div>
    <h2>{section}</h2>
    {body}
  </div>;
}

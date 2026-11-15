import { useEffect, useState } from 'react';
import { Folder, GitBranch, LayoutPanelLeft, PanelRight, Settings } from 'lucide-react';
import { ActivityRail } from './components/ActivityRail';
import { Sidebar } from './components/Sidebar';
import { ChatWorkbench } from './components/ChatWorkbench';
import { AgentSwarmView } from './components/AgentSwarmView';
import { CodeDiffEditor } from './components/CodeDiffEditor';
import { TerminalPane } from './components/TerminalPane';
import { BrowserPane } from './components/BrowserPane';
import { StatusBar } from './components/StatusBar';
import { SettingsModal } from './components/SettingsModal';
import { useWiggle } from './store/useWiggleStore';

type Aux = 'overview' | 'terminal' | 'browser';

function AuxPanel({ tab, setTab }: { tab: Aux; setTab: (tab: Aux) => void }) {
  const { status, session, undo, redo } = useWiggle();
  const approvals = session.messages.flatMap((message) => message.tools).filter((tool) => tool.status === 'awaiting_approval').length;

  return (
    <aside className="aux" aria-label="Details">
      <div className="aux-head">
        <button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>Overview</button>
        <button className={tab === 'terminal' ? 'active' : ''} onClick={() => setTab('terminal')}>Terminal</button>
        <button className={tab === 'browser' ? 'active' : ''} onClick={() => setTab('browser')}>Browser</button>
      </div>

      {tab === 'overview' ? (
        <div className="aux-body">
          <div className="mono-list">
            <div className="row"><span className="key">Workspace</span><span className="val">{status?.workspace.name ?? '—'}</span></div>
            <div className="row"><span className="key">Branch</span><span className="val">{status?.branch ?? '—'}</span></div>
            <div className="row"><span className="key">Model</span><span className="val">{status?.model || 'not connected'}</span></div>
            <div className="row"><span className="key">Provider</span><span className="val">{status?.provider ?? '—'}</span></div>
            <div className="row"><span className="key">Permissions</span><span className="val">{status?.permissions ?? '—'}</span></div>
            <div className="row"><span className="key">Skills</span><span className="val">{status?.skills ?? 0}</span></div>
            <div className="row"><span className="key">Memory</span><span className="val">{status?.memory ?? 0} fact(s)</span></div>
            <div className="row"><span className="key">History</span><span className="val">{status?.history.undo ?? 0} undo / {status?.history.redo ?? 0} redo</span></div>
            <div className="row"><span className="key">Approvals</span><span className="val">{approvals} pending</span></div>
          </div>

          <div style={{ padding: 10, display: 'flex', gap: 6 }}>
            <button className="button" onClick={() => void undo()} disabled={!status?.history.undo}>Undo turn</button>
            <button className="button" onClick={() => void redo()} disabled={!status?.history.redo}>Redo turn</button>
          </div>

          <div style={{ padding: '0 10px 12px' }}>
            <p className="note" style={{ margin: 0 }}>
              The agent edits files in place and records a snapshot per turn. Undo restores the previous
              content of every file the turn touched.
            </p>
          </div>
        </div>
      ) : tab === 'terminal' ? (
        <TerminalPane />
      ) : (
        <BrowserPane />
      )}
    </aside>
  );
}

export default function App() {
  const { view, setView, status, offline, tabs } = useWiggle();
  const [settings, setSettings] = useState(false);
  const [sidebar, setSidebar] = useState(true);
  const [auxOpen, setAuxOpen] = useState(true);
  const [auxTab, setAuxTab] = useState<Aux>('overview');

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const meta = event.ctrlKey || event.metaKey;
      if (meta && event.key === ',') {
        event.preventDefault();
        setSettings(true);
      } else if (meta && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        window.dispatchEvent(new Event('wiggle:focus-composer'));
        setView('chat');
      } else if (meta && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        setSidebar((value) => !value);
      } else if (meta && event.key.toLowerCase() === 'j') {
        event.preventDefault();
        setAuxOpen((value) => !value);
      } else if (event.key === 'Escape') {
        setSettings(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setView]);

  return (
    <div className="app">
      <header className="titlebar">
        <div className="brand">
          <span className="brand-name">TERVIXA WIGGLE</span>
          <span className="brand-rule" />
          <span className="brand-sub">v0.2.0</span>
        </div>
        <div className="titlebar-meta">
          <Folder size={11} />
          <span className="truncate">{status?.workspace.name ?? 'no workspace'}</span>
          <span className="sep">·</span>
          <GitBranch size={11} />
          <span>{status?.branch ?? '—'}</span>
          {offline && <span className="tag">offline</span>}
        </div>
        <div className="titlebar-actions">
          <button className="icon-button" aria-pressed={sidebar} onClick={() => setSidebar((value) => !value)} title="Toggle sidebar (Ctrl+B)">
            <LayoutPanelLeft size={14} />
          </button>
          <button className="icon-button" aria-pressed={auxOpen} onClick={() => setAuxOpen((value) => !value)} title="Toggle details panel (Ctrl+J)">
            <PanelRight size={14} />
          </button>
          <button className="icon-button" onClick={() => setSettings(true)} title="Settings (Ctrl+,)" aria-label="Settings">
            <Settings size={14} />
          </button>
        </div>
      </header>

      <div className="body">
        <ActivityRail onSettings={() => setSettings(true)} />
        {sidebar && <Sidebar />}

        <main className="workbench">
          <div className="tabbar" role="tablist">
            <button className={`tab ${view === 'chat' ? 'active' : ''}`} onClick={() => setView('chat')} role="tab" aria-selected={view === 'chat'}>
              <span className="label">Chat</span>
            </button>
            <button className={`tab ${view === 'agents' ? 'active' : ''}`} onClick={() => setView('agents')} role="tab" aria-selected={view === 'agents'}>
              <span className="label">Agents</span>
              <span className="count">1</span>
            </button>
            <button className={`tab ${view === 'editor' ? 'active' : ''}`} onClick={() => setView('editor')} role="tab" aria-selected={view === 'editor'}>
              <span className="label">Editor</span>
              {tabs.length > 0 && <span className="count">{tabs.length}</span>}
            </button>
          </div>

          {view === 'chat' && <ChatWorkbench />}
          {view === 'agents' && <AgentSwarmView />}
          {view === 'editor' && <CodeDiffEditor />}
        </main>

        {auxOpen && <AuxPanel tab={auxTab} setTab={setAuxTab} />}
      </div>

      <StatusBar />
      {settings && <SettingsModal onClose={() => setSettings(false)} />}
    </div>
  );
}

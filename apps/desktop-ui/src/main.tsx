import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Activity, ArrowDownLeft, ArrowRight, Bot, Braces, Check, ChevronDown, ChevronRight, CircleHelp, Command, FileCode2, Folder, GitBranch, Globe, LayoutPanelLeft, MessageSquare, MoreHorizontal, PanelRight, Plus, RefreshCw, Search, Settings, SquareTerminal, X, Zap } from 'lucide-react';
import { WorkspaceTree } from './components/WorkspaceTree';
import { FileViewer } from './components/FileViewer';
import { StepList, PendingProposals, type Step, type Proposal } from './components/AgentPanels';
import './style.css';

type Message = { role: 'user' | 'assistant' | 'system'; text: string; steps?: Step[] };
type Mode = 'suggest' | 'auto-edit';
type Session = { id: string; name: string; messages: Message[] };
const initialSession = (): Session => ({ id: crypto.randomUUID(), name: 'New session', messages: [] });
const settingsSections = ['Identity & instructions','Models & providers','Agents & swarm','MCP connectors','Skills & plugins','Personal memory','Permissions & sandbox','Built-in browser','Git & GitHub','Appearance & keybindings'];
function App() {
 const [sessions, setSessions] = useState<Session[]>([initialSession()]);
 const [active, setActive] = useState(sessions[0].id);
 const [input, setInput] = useState('');
 const [connection, setConnection] = useState<{configured: boolean; model: string; provider: string; workspace: string | null} | null>(null);
 const [pending, setPending] = useState<string[]>([]);
 const [mode, setMode] = useState<Mode>(() => (localStorage.getItem('wiggle-mode') === 'auto-edit' ? 'auto-edit' : 'suggest'));
 const [proposals, setProposals] = useState<Proposal[]>([]);
 const [proposalBusy, setProposalBusy] = useState(false);
 const [proposalNotice, setProposalNotice] = useState<string | null>(null);
 useEffect(() => { fetch('/api/status').then(r => { if (!r.ok) throw new Error(); return r.json(); }).then(setConnection).catch(() => setConnection(null)); }, []);
 const [view, setView] = useState<'chat'|'agents'|'file'>('chat');
 const [openFiles, setOpenFiles] = useState<string[]>([]);
 const [openFile, setOpenFile] = useState<string | null>(null);
 const [refreshKey, setRefreshKey] = useState(0);
 const [aux, setAux] = useState<'overview'|'terminal'|'browser'>('overview');
 const [settings, setSettings] = useState(false);
 const [section, setSection] = useState('Appearance & keybindings');
 const [light, setLight] = useState(() => localStorage.getItem('wiggle-theme') === 'light');
 const [sidebar, setSidebar] = useState(true);
 const [right, setRight] = useState(true);
   const session = sessions.find(s => s.id === active)!;
  useEffect(() => { localStorage.setItem('wiggle-mode', mode); }, [mode]);
  // Pending edits live on the server. Reload them whenever the workspace or file tree changes.
  useEffect(() => {
    if (!connection?.workspace) { setProposals([]); return; }
    fetch('/api/edits').then(r => (r.ok ? r.json() : null)).then(data => setProposals(data?.proposals ?? [])).catch(() => setProposals([]));
  }, [connection?.workspace, refreshKey]);
  function openPath(path: string) { setOpenFiles(f => (f.includes(path) ? f : [...f, path])); setOpenFile(path); setView('file'); }
  async function proposalAction(proposal: Proposal, action: 'approve' | 'reject') {
    setProposalBusy(true); setProposalNotice(null);
    try {
      const body = action === 'approve' ? { hunks: Array.from({ length: proposal.hunks }, (_, i) => i) } : {};
      const response = await fetch(`/api/edits/${proposal.id}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Request failed.');
      setProposalNotice(action === 'approve' ? `Applied edit to ${proposal.path}. You can undo it from the file view.` : `Rejected edit to ${proposal.path}.`);
      setRefreshKey(k => k + 1);
    } catch (error) { setProposalNotice(error instanceof Error ? error.message : 'Request failed.'); }
    finally { setProposalBusy(false); }
  }
 useEffect(() => { document.documentElement.dataset.theme = light ? 'light' : 'dark'; localStorage.setItem('wiggle-theme', light ? 'light' : 'dark'); }, [light]);
 useEffect(() => { const handler = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === ',') { e.preventDefault(); setSettings(true); } if (e.key === 'Escape') setSettings(false); }; window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler); }, []);
 function newSession() { const next = initialSession(); setSessions(s => [next, ...s]); setActive(next.id); setView('chat'); }
 async function submit() {
  const text = input.trim(); if (!text || pending.includes(active)) return;
  const sessionId = active;
  const nextMessages: Message[] = [...session.messages, {role:'user', text}];
  setSessions(all => all.map(s => s.id !== sessionId ? s : {...s, name: s.messages.length ? s.name : text.slice(0,30), messages: nextMessages}));
  setInput('');
  if (!connection?.configured) { setSessions(all => all.map(s => s.id !== sessionId ? s : {...s, messages: [...s.messages, {role:'system', text:'No model is connected. Start the local server with WIGGLE_MODEL configured to send messages.'}]})); return; }
  setPending(ids => [...ids, sessionId]);
  try {
    const response = await fetch('/api/agent', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({mode, messages: nextMessages.filter(m => m.role !== 'system').map(m => ({role:m.role, content:m.text}))})});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Request failed.');
    const steps: Step[] = Array.isArray(data.steps) ? data.steps : [];
    setSessions(all => all.map(s => s.id !== sessionId ? s : {...s, messages: [...s.messages, {role:'assistant', text:data.text, steps}]}));
    // Refresh the file tree and pending edits after any proposal or applied edit.
    if (steps.some(step => step.name === 'propose_edit')) setRefreshKey(k => k + 1);
  } catch (error) { setSessions(all => all.map(s => s.id !== sessionId ? s : {...s, messages: [...s.messages, {role:'system', text:error instanceof Error ? error.message : 'Request failed.'}]})); }
  finally { setPending(ids => ids.filter(id => id !== sessionId)); }
 }
 return <div className="app">
  <header className="titlebar"><div className="brand"><span className="brandmark">w<span>.</span></span><strong>WIGGLE</strong><span className="brand-divider"/><span className="brand-sub">by Tervixa</span></div><div className="workspace"><Folder size={13}/><span>Workspace</span><ChevronRight size={12}/><strong>{connection?.workspace || 'Not connected'}</strong></div><div className="header-actions"><span className="prototype">EARLY PREVIEW</span><button className="icon-button" aria-label="Toggle sidebar" onClick={() => setSidebar(!sidebar)}><LayoutPanelLeft size={15}/></button><button className="icon-button" aria-label="Toggle details panel" onClick={() => setRight(!right)}><PanelRight size={15}/></button></div></header>
  <div className="body"><nav className="rail" aria-label="Main navigation"><button className={view === 'chat' ? 'rail-button selected' : 'rail-button'} title="Chat" onClick={() => setView('chat')}><MessageSquare size={18}/></button><button className={view === 'agents' ? 'rail-button selected' : 'rail-button'} title="Agents" onClick={() => setView('agents')}><Bot size={19}/></button><div className="rail-spacer"/><button className="rail-button" title="Settings" onClick={() => setSettings(true)}><Settings size={18}/></button></nav>
   {sidebar && <aside className="sidebar"><div className="sidebar-heading"><span>WORKSPACE</span><MoreHorizontal size={16}/></div><button className="new-session" onClick={newSession}><Plus size={15}/><span>New session</span></button><div className="side-label"><span>SESSIONS</span><button className="icon-button" aria-label="New session" onClick={newSession}><Plus size={14}/></button></div><div className="session-list">{sessions.map(s => <button key={s.id} className={'session '+(s.id === active?'active':'')} onClick={() => {setActive(s.id); setView('chat');}}><MessageSquare size={14}/><span>{s.name}</span>{s.id === active && <MoreHorizontal size={14}/>}</button>)}</div><div className="side-label files-label"><span>FILES</span>{connection?.workspace && <button className="icon-button" aria-label="Refresh files" title="Refresh files" onClick={() => setRefreshKey(k => k + 1)}><RefreshCw size={13}/></button>}</div>{connection?.workspace ? <WorkspaceTree workspaceName={connection.workspace} activeFile={openFile} refreshKey={refreshKey} onOpenFile={openPath}/> : <div className="empty-files"><Folder size={16}/><span>No workspace open</span><small>Set WIGGLE_WORKSPACE and restart the local server to browse files read-only.</small></div>}<div className="sidebar-bottom"><span className="status-dot"/> Local preview <span className="muted">v0.1</span></div></aside>}
   <main className="workbench"><div className="tabs"><button className={view==='chat'?'tab active':'tab'} onClick={()=>setView('chat')}><MessageSquare size={14}/> Chat</button><button className={view==='agents'?'tab active':'tab'} onClick={()=>setView('agents')}><Bot size={15}/> Agents <span className="count">0</span></button>{openFiles.map(f => <div key={f} className={view==='file' && openFile===f ? 'tab active file-tab' : 'tab file-tab'}><button className="file-tab-open" onClick={()=>{setOpenFile(f);setView('file');}}><FileCode2 size={13}/> {f.split('/').pop()}</button><button className="icon-button" aria-label={`Close ${f}`} onClick={()=>{setOpenFiles(list=>list.filter(x=>x!==f)); if(openFile===f){setOpenFile(null);setView('chat');}}}><X size={12}/></button></div>)}<div className="tabs-right"><span>LOCAL SESSION</span><MoreHorizontal size={16}/></div></div>
    {view === 'file' && openFile ? <FileViewer path={openFile} refreshKey={refreshKey} onChanged={() => setRefreshKey(k => k + 1)}/> : view === 'chat' ? <><div className="chat-scroll">{session.messages.length === 0 ? <div className="welcome"><div className="welcome-mark"><span>w</span><i>.</i></div><div className="eyebrow"><span className="status-dot"/> YOUR WORKSPACE, IN FOCUS</div><h1>What are we working on?</h1><p>A quiet space to think, build, and get things done.<br/>Start a conversation to get started.</p><div className="prompt-grid"><button onClick={()=>setInput('Help me understand this codebase')}><FileCode2 size={16}/><span><strong>Explore a codebase</strong><small>Understand how things fit together</small></span><ArrowRight size={14}/></button><button onClick={()=>setInput('Help me plan a new feature')}><Braces size={16}/><span><strong>Plan a feature</strong><small>Turn an idea into a clear plan</small></span><ArrowRight size={14}/></button></div><div className="preview-notice"><CircleHelp size={14}/> {connection?.configured ? `Connected to ${connection.provider}. Requests are sent to the configured provider.` : 'Start the local server and configure a model to chat.'}</div></div> : <div className="messages">{session.messages.map((m,i)=><div className="message" key={i}><div className={'avatar '+m.role}>{m.role==='user'?'Y':'w.'}</div><div><div className="message-title">{m.role==='user'?'You':'Wiggle'} <span>{m.role==='system'?'· Notice':''}</span></div><p>{m.text}</p>{m.steps && m.steps.length > 0 && <StepList steps={m.steps}/>}</div></div>)}</div>}</div><div className="composer-wrap">{proposalNotice && <div className="preview-notice" role="status">{proposalNotice}</div>}<PendingProposals proposals={proposals} busy={proposalBusy} onApprove={p => proposalAction(p, 'approve')} onReject={p => proposalAction(p, 'reject')} onReview={openPath}/><div className="composer"><textarea aria-label="Message" placeholder="Ask anything, or describe a task..." value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();submit();}}}/><div className="composer-footer"><div><label className="composer-mode"><Zap size={13}/><span className="sr-only">Permission mode</span><select className="mode-select" aria-label="Permission mode" value={mode} onChange={e => setMode(e.target.value as Mode)} title={mode === 'suggest' ? 'Suggest: edits wait for your approval' : 'Auto-apply: edits are written immediately and can be undone'}><option value="suggest">Suggest edits</option><option value="auto-edit">Auto-apply edits</option></select></label><span className="composer-divider"/><span className="model-label">{connection?.configured ? connection.model : 'No model connected'}</span></div><button className="send" aria-label="Send message" disabled={!input.trim() || pending.includes(active)} onClick={submit}><ArrowDownLeft size={15}/></button></div></div><div className="composer-hint"><span><kbd>Enter</kbd> to send <span className="dot-sep">·</span> <kbd>Shift Enter</kbd> for new line</span><span>Wiggle can make mistakes. Review its work.</span></div></div></> : <div className="placeholder-page"><div className="page-icon"><Bot size={21}/></div><h2>Agents</h2><p>Parallel agent orchestration is not connected in this preview.</p><button onClick={()=>setView('chat')}>Back to chat <ArrowRight size={14}/></button></div>}
   </main>
   {right && <aside className="aux"><div className="aux-tabs"><button className={aux==='overview'?'active':''} onClick={()=>setAux('overview')}>Overview</button><button className={aux==='terminal'?'active':''} onClick={()=>setAux('terminal')}>Terminal</button><button className={aux==='browser'?'active':''} onClick={()=>setAux('browser')}>Browser</button></div>{aux==='overview'?<><div className="aux-head"><div><h3>Session overview</h3><p>Context for your current session</p></div><Activity size={16}/></div><div className="overview-section"><div className="section-title">CONNECTION <span>01</span></div><div className="info-row"><span>Provider</span><strong>{connection?.configured ? connection.provider : 'Not configured'}</strong></div><div className="info-row"><span>Model</span><strong>{connection?.configured ? connection.model : '—'}</strong></div><button className="outline-button" onClick={()=>{setSection('Models & providers');setSettings(true);}}>View settings <ArrowRight size={13}/></button></div><div className="overview-section"><div className="section-title">SESSION <span>02</span></div><div className="info-row"><span>Status</span><strong><span className="idle-dot"/> {pending.includes(active) ? 'Waiting' : 'Idle'}</strong></div><div className="info-row"><span>Messages</span><strong>{session.messages.filter(m=>m.role==='user').length}</strong></div><div className="info-row"><span>Active agents</span><strong>0</strong></div></div><div className="overview-section"><div className="section-title">INTEGRATIONS <span>03</span></div><div className="integration"><div className="integration-icon"><Command size={15}/></div><div><strong>MCP connectors</strong><small>Not connected</small></div><span>—</span></div><div className="integration"><div className="integration-icon"><Zap size={15}/></div><div><strong>Skills</strong><small>Not connected</small></div><span>—</span></div></div><div className="aux-footer"><CircleHelp size={14}/><span>Built for thoughtful work.</span></div></>:<div className="aux-empty">{aux==='terminal'?<SquareTerminal size={22}/>:<Globe size={22}/>}<strong>{aux==='terminal'?'Terminal':'Browser'} is not connected</strong><span>This feature is planned for a future build.</span></div>}</aside>}
  </div><footer className="statusbar"><div><GitBranch size={13}/> No repository <span className="status-separator"/><span className="idle-dot"/> Agents idle</div><div><span>Local preview</span><span className="status-separator"/><span>UTF-8</span></div></footer>
  {settings && <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setSettings(false);}}><div className="modal" role="dialog" aria-modal="true" aria-label="Settings"><div className="modal-head"><div><Settings size={17}/><strong>Settings</strong></div><button className="icon-button" aria-label="Close settings" onClick={()=>setSettings(false)}><X size={18}/></button></div><div className="modal-body"><div className="settings-nav"><div className="side-label">CONFIGURATION</div>{settingsSections.map(s=><button className={section===s?'active':''} key={s} onClick={()=>setSection(s)}>{s}</button>)}</div><div className="settings-content"><div className="eyebrow">SETTINGS / {section.toUpperCase()}</div><h2>{section}</h2>{section==='Appearance & keybindings'?<><p>Make the workbench feel like yours.</p><div className="setting-row"><div><strong>Color theme</strong><small>Choose the appearance of the workbench.</small></div><select value={light?'light':'dark'} onChange={e=>setLight(e.target.value==='light')}><option value="dark">Carbon dark</option><option value="light">Crisp light</option></select></div><div className="setting-row"><div><strong>Open settings</strong><small>Keyboard shortcut</small></div><kbd>Ctrl / ⌘ + ,</kbd></div></>:section==='Models & providers'?<><p>Configure a model on the local server before starting it.</p><div className="settings-note"><CircleHelp size={16}/> Set WIGGLE_MODEL, WIGGLE_API_KEY and optionally WIGGLE_BASE_URL in your environment. API keys stay on the server. See the README for setup.</div></>:<><p>This section is reserved for a future integration.</p><div className="settings-note"><CircleHelp size={16}/> No configuration is available in this preview.</div></>}</div></div></div></div>}
 </div>
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);

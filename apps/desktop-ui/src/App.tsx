import React, { useEffect } from 'react';
import {
  Activity,
  Bot,
  Command,
  FileCode2,
  Folder,
  GitBranch,
  Globe,
  MessageSquare,
  PanelLeft,
  PanelRight,
  SquareTerminal,
  X,
} from 'lucide-react';
import { ActivityRail } from './components/ActivityRail';
import { AgentSwarmView } from './components/AgentSwarmView';
import { BrowserPane } from './components/BrowserPane';
import { ChatWorkbench } from './components/ChatWorkbench';
import { CodeDiffEditor } from './components/CodeDiffEditor';
import { CommandPalette } from './components/CommandPalette';
import { SettingsModal } from './components/SettingsModal';
import { Sidebar } from './components/Sidebar';
import { StatusBar } from './components/StatusBar';
import { TerminalPane } from './components/TerminalPane';
import { useWiggleStore } from './store/useWiggleStore';

export function App() {
  const store = useWiggleStore();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault();
        store.setSettingsOpen(true);
      } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'k' || e.key.toLowerCase() === 'p')) {
        e.preventDefault();
        store.setCmdPaletteOpen((v) => !v);
      } else if (e.key === 'Escape') {
        store.setSettingsOpen(false);
        store.setCmdPaletteOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const activeFileTab = store.activeWorkbenchTab.startsWith('file:')
    ? store.openTabs.find((t) => `file:${t.path}` === store.activeWorkbenchTab) || null
    : null;

  return (
    <div className="wiggle-app">
      <header className="titlebar">
        <div className="titlebar-left">
          <span className="brand-mark">TERVIXA WIGGLE</span>
          <span className="title-pill">
            <Folder size={11} />
            <span>{store.status?.workspaceName || 'Wiggle_AI'}</span>
          </span>
          <span className="title-pill">
            <GitBranch size={11} />
            <span>{store.status?.gitBranch || 'local'}</span>
          </span>
        </div>
        <div className="titlebar-right">
          <button
            className="title-pill"
            onClick={() => store.setCmdPaletteOpen(true)}
            title="Command Palette (Ctrl+K)"
          >
            <Command size={11} />
            <span>Ctrl+K</span>
          </button>
          <button
            className="icon-btn"
            aria-label="Toggle sidebar"
            onClick={() => store.setShowSidebar((v) => !v)}
          >
            <PanelLeft size={14} />
          </button>
          <button
            className="icon-btn"
            aria-label="Toggle auxiliary pane"
            onClick={() => store.setShowAux((v) => !v)}
          >
            <PanelRight size={14} />
          </button>
        </div>
      </header>

      <div className="workbench-body">
        <ActivityRail
          activeView={store.activeWorkbenchTab}
          onSelectChat={() => store.setActiveWorkbenchTab('chat')}
          onSelectAgents={() => store.setActiveWorkbenchTab('agents')}
          onToggleSidebar={() => store.setShowSidebar((v) => !v)}
          onSelectBrowser={() => {
            store.setShowAux(true);
            store.setAuxTab('browser');
          }}
          onOpenMcpSettings={() => {
            store.setSettingsSection('MCP Connectors');
            store.setSettingsOpen(true);
          }}
          onOpenSettings={() => store.setSettingsOpen(true)}
        />

        {store.showSidebar && (
          <Sidebar
            sessions={store.sessions}
            activeSessionId={store.activeSession.id}
            onSelectSession={(id) => {
              store.setActiveSessionId(id);
              store.setActiveWorkbenchTab('chat');
            }}
            onNewSession={store.createSession}
            tree={store.tree}
            activeFilePath={activeFileTab?.path || null}
            onOpenFile={store.openFile}
            onOpenCmdPalette={() => store.setCmdPaletteOpen(true)}
          />
        )}

        <main className="center-workbench">
          <div className="workbench-tabs">
            <button
              className={`wb-tab ${store.activeWorkbenchTab === 'chat' ? 'active' : ''}`}
              onClick={() => store.setActiveWorkbenchTab('chat')}
            >
              <MessageSquare size={13} />
              <span>Chat</span>
            </button>
            <button
              className={`wb-tab ${store.activeWorkbenchTab === 'agents' ? 'active' : ''}`}
              onClick={() => store.setActiveWorkbenchTab('agents')}
            >
              <Bot size={13} />
              <span>Agents</span>
              <span className="wb-badge">{store.swarmTasks.length || 5}</span>
            </button>
            {store.openTabs.map((tab) => (
              <div
                key={tab.path}
                className={`wb-tab ${store.activeWorkbenchTab === `file:${tab.path}` ? 'active' : ''}`}
                onClick={() => store.setActiveWorkbenchTab(`file:${tab.path}`)}
                role="tab"
                tabIndex={0}
              >
                <FileCode2 size={13} />
                <span className="mono">{tab.path.split('/').pop()}</span>
                {tab.dirty && <span className="dot dot-warn" />}
                <button
                  className="icon-btn"
                  style={{ width: 16, height: 16 }}
                  aria-label={`Close ${tab.path}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    store.closeFileTab(tab.path);
                  }}
                >
                  <X size={11} />
                </button>
              </div>
            ))}
          </div>

          {store.activeWorkbenchTab === 'chat' && (
            <ChatWorkbench
              session={store.activeSession}
              status={store.status}
              pending={store.pendingSessionIds.includes(store.activeSession.id)}
              agentMode={store.agentMode}
              onChangeMode={store.setAgentMode}
              attachments={store.attachments}
              onRemoveAttachment={(id) =>
                store.setAttachments((prev) => prev.filter((a) => a.id !== id))
              }
              onAddAttachment={(att) => store.setAttachments((prev) => [...prev, att])}
              tree={store.tree}
              skills={store.skills}
              onSend={store.sendMessage}
            />
          )}

          {store.activeWorkbenchTab === 'agents' && (
            <AgentSwarmView tasks={store.swarmTasks} onRunSwarm={store.runSwarm} />
          )}

          {activeFileTab && (
            <CodeDiffEditor
              tab={activeFileTab}
              onChange={store.updateFileContent}
              onSave={store.saveFile}
              onToggleDiff={store.toggleTabDiff}
              onUndo={store.runUndo}
              onRedo={store.runRedo}
            />
          )}
        </main>

        {store.showAux && (
          <aside className="aux-pane">
            <div className="aux-tabs">
              <button
                className={`aux-tab ${store.auxTab === 'browser' ? 'active' : ''}`}
                onClick={() => store.setAuxTab('browser')}
              >
                <Globe size={12} />
                <span>Browser</span>
              </button>
              <button
                className={`aux-tab ${store.auxTab === 'terminal' ? 'active' : ''}`}
                onClick={() => store.setAuxTab('terminal')}
              >
                <SquareTerminal size={12} />
                <span>Terminal</span>
              </button>
              <button
                className={`aux-tab ${store.auxTab === 'inspector' ? 'active' : ''}`}
                onClick={() => store.setAuxTab('inspector')}
              >
                <Activity size={12} />
                <span>Inspector</span>
              </button>
            </div>

            {store.auxTab === 'browser' && <BrowserPane />}

            {store.auxTab === 'terminal' && (
              <TerminalPane
                log={store.terminalLog}
                onRunCommand={store.runTerminalCommand}
                onClear={() => store.setTerminalLog('')}
                onAttachTerminal={(output) => {
                  store.setAttachments((prev) => [
                    ...prev,
                    { id: crypto.randomUUID(), type: 'terminal', label: 'output', content: output },
                  ]);
                  store.setActiveWorkbenchTab('chat');
                }}
              />
            )}

            {store.auxTab === 'inspector' && (
              <div className="aux-body" style={{ overflowY: 'auto' }}>
                <div className="telemetry-section">
                  <div className="telemetry-title">ACTIVE AGENT TELEMETRY</div>
                  <div className="kv-row">
                    <span>Provider</span>
                    <strong>{store.status?.providerId || 'unconfigured'}</strong>
                  </div>
                  <div className="kv-row">
                    <span>Model</span>
                    <strong className="mono">{store.status?.model || '—'}</strong>
                  </div>
                  <div className="kv-row">
                    <span>Memory</span>
                    <strong>{store.status?.memoryCount ?? 0} facts active</strong>
                  </div>
                  <div className="kv-row">
                    <span>Skills</span>
                    <strong>{store.status?.skillsCount ?? 0} loaded</strong>
                  </div>
                  <div className="kv-row">
                    <span>MCP</span>
                    <strong>{store.status?.mcpCount ?? 0} ready</strong>
                  </div>
                </div>
                <div className="telemetry-section">
                  <div className="telemetry-title">7-STAGE PROMPT COMPILER</div>
                  {[
                    '1. Tervixa Wiggle Identity & Env',
                    '2. Personal Memory Context',
                    '3. WIGGLE.md / CLAUDE.md Rules',
                    '4. Dynamic SKILL.md Injection',
                    '5. @file / @terminal & MCP Tools',
                    '6. Slash & Hook Transform',
                    '7. Agent / Swarm Routing',
                  ].map((stage) => (
                    <div key={stage} className="kv-row">
                      <span>{stage}</span>
                      <span className="dot dot-ok" />
                    </div>
                  ))}
                </div>
                <div style={{ padding: 12 }}>
                  <button
                    className="btn-flat"
                    style={{ width: '100%' }}
                    onClick={() => {
                      store.setSettingsSection('Models & BYOK Providers');
                      store.setSettingsOpen(true);
                    }}
                  >
                    Open Provider Settings
                  </button>
                </div>
              </div>
            )}
          </aside>
        )}
      </div>

      <StatusBar
        status={store.status}
        pendingCount={store.pendingSessionIds.length}
        tokenEstimate={store.tokenEstimate}
      />

      <SettingsModal
        open={store.settingsOpen}
        section={store.settingsSection}
        onSelectSection={store.setSettingsSection}
        onClose={() => store.setSettingsOpen(false)}
        settings={store.settings}
        presets={store.presets}
        skills={store.skills}
        memories={store.memories}
        mcpServers={store.mcpServers}
        mcpCatalog={store.mcpCatalog}
        status={store.status}
        onSaveSettings={store.saveSettings}
        onRefreshMetadata={async () => {
          await store.refreshMetadata();
          await store.refreshStatus();
        }}
      />

      <CommandPalette
        open={store.cmdPaletteOpen}
        onClose={() => store.setCmdPaletteOpen(false)}
        tree={store.tree}
        onOpenFile={store.openFile}
        onAction={(action) => {
          if (action === 'new-session') store.createSession();
          if (action === 'swarm') store.setActiveWorkbenchTab('agents');
          if (action === 'undo') store.runUndo();
          if (action === 'redo') store.runRedo();
          if (action === 'settings') store.setSettingsOpen(true);
          if (action === 'theme') {
            const next = store.settings?.theme === 'light' ? 'dark' : 'light';
            store.saveSettings({ theme: next });
          }
        }}
      />
    </div>
  );
}

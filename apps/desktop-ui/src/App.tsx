import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  Command,
  FileCode2,
  Folder,
  GitBranch,
  Globe,
  Minus,
  PanelLeft,
  PanelRight,
  Square,
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
import { desktopShell, shell } from './lib/desktopShell';
import { matchesShortcut, shortcutFor } from './lib/shortcuts';
import { useWiggleStore } from './store/useWiggleStore';

const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 420;
const AUX_MIN = 280;
const AUX_MAX = 680;
const CENTER_MIN = 380;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function readWidth(key: string, fallback: number, min: number, max: number) {
  if (typeof window === 'undefined') return fallback;
  const stored = Number(window.localStorage.getItem(key));
  return Number.isFinite(stored) && stored > 0 ? clamp(stored, min, max) : fallback;
}

export function App() {
  const store = useWiggleStore();
  const nativeChrome = desktopShell();
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    readWidth('wg-sidebar-w', 264, SIDEBAR_MIN, SIDEBAR_MAX),
  );
  const [auxWidth, setAuxWidth] = useState(() => readWidth('wg-aux-w', 380, AUX_MIN, AUX_MAX));
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window === 'undefined' ? 1440 : window.innerWidth,
  );
  const [dragging, setDragging] = useState<'sidebar' | 'aux' | null>(null);
  const dragRef = useRef({ startX: 0, startWidth: 0, kind: 'sidebar' as 'sidebar' | 'aux' });

  useEffect(() => {
    window.localStorage.setItem('wg-sidebar-w', String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    window.localStorage.setItem('wg-aux-w', String(auxWidth));
  }, [auxWidth]);

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const overrides = store.settings?.shortcutOverrides ?? {};

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (matchesShortcut(event, shortcutFor('palette', overrides))) {
        event.preventDefault();
        store.setCmdPaletteOpen((value) => !value);
        return;
      }
      if (matchesShortcut(event, shortcutFor('settings', overrides))) {
        event.preventDefault();
        store.setSettingsOpen(true);
        return;
      }
      if (matchesShortcut(event, shortcutFor('sidebar', overrides))) {
        event.preventDefault();
        store.setShowSidebar((value) => !value);
        return;
      }
      if (matchesShortcut(event, shortcutFor('aux', overrides))) {
        event.preventDefault();
        store.setShowAux((value) => !value);
        return;
      }
      if (matchesShortcut(event, shortcutFor('newSession', overrides))) {
        event.preventDefault();
        store.createSession();
        return;
      }
      if (event.key === 'Escape') {
        store.setSettingsOpen(false);
        store.setCmdPaletteOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // The store setters are stable state setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overrides]);

  const beginResize = useCallback(
    (kind: 'sidebar' | 'aux') => (event: React.PointerEvent) => {
      event.preventDefault();
      dragRef.current = {
        startX: event.clientX,
        startWidth: kind === 'sidebar' ? sidebarWidth : auxWidth,
        kind,
      };
      setDragging(kind);

      const onMove = (moveEvent: PointerEvent) => {
        const { startX, startWidth, kind: active } = dragRef.current;
        const delta = moveEvent.clientX - startX;
        if (active === 'sidebar') {
          setSidebarWidth(clamp(startWidth + delta, SIDEBAR_MIN, SIDEBAR_MAX));
        } else {
          setAuxWidth(clamp(startWidth - delta, AUX_MIN, AUX_MAX));
        }
      };

      const onUp = () => {
        setDragging(null);
        document.body.style.cursor = '';
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };

      document.body.style.cursor = 'col-resize';
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [sidebarWidth, auxWidth],
  );

  const activeFileTab = store.openTabs.find((tab) => tab.path === store.activeFilePath) ?? null;
  const showEditor = Boolean(activeFileTab);
  const knowledge = store.settings?.interfaceLayout === 'knowledge';
  const agentsEnabled = !knowledge && store.settings?.dynamicWorkflows !== false;

  // The window can shrink to 960px; keep the transcript readable by capping the
  // auxiliary pane rather than letting it squeeze the centre to a sliver.
  const sidebarShown = store.showSidebar;
  const sidebarActual = sidebarShown
    ? clamp(sidebarWidth, SIDEBAR_MIN, Math.max(SIDEBAR_MIN, viewportWidth - CENTER_MIN - AUX_MIN - 52))
    : 0;
  const auxCap = Math.max(
    AUX_MIN,
    viewportWidth - 48 - (sidebarShown ? sidebarActual + 1 : 0) - CENTER_MIN,
  );
  const auxActual = Math.min(auxWidth, auxCap);

  const beginWindowDrag = (event: React.MouseEvent) => {
    if (!nativeChrome) return;
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest('button, input, textarea, a, select, [role="button"]')) return;
    shell.drag();
  };

  return (
    <div
      className={`wg-app ${nativeChrome ? 'is-native' : 'is-hosted'}`}
      style={
        {
          '--wg-sidebar-w': `${sidebarActual}px`,
          '--wg-aux-w': `${auxActual}px`,
        } as React.CSSProperties
      }
    >
      <header
        className="wg-titlebar"
        onMouseDown={beginWindowDrag}
        onDoubleClick={(event) => {
          if (!nativeChrome) return;
          const target = event.target as HTMLElement;
          if (target.closest('button, input, textarea, a, select, [role="button"]')) return;
          shell.maximize();
        }}
      >
        <div className="wg-titlebar-left">
          <span className="wg-mark" aria-hidden>
            TW
          </span>
          <span className="wg-wordmark">Tervixa Wiggle</span>
          <span className="wg-titlebar-sep" />

          <button
            className="wg-chip"
            title={`${store.status?.workspaceRoot || 'Workspace'} — click to change folder`}
            onClick={() => {
              if (nativeChrome) shell.changeWorkspace();
              else {
                store.setSettingsSection('System');
                store.setSettingsOpen(true);
              }
            }}
          >
            <Folder size={11} aria-hidden />
            <span>{store.status?.workspaceName || 'workspace'}</span>
          </button>
          <span className="wg-chip is-static" title="Current git branch">
            <GitBranch size={11} aria-hidden />
            <span>{store.status?.gitBranch || 'local'}</span>
          </span>
        </div>

        <div className="wg-titlebar-right">
          <button
            className="wg-chip wg-chip-key"
            onClick={() => store.setCmdPaletteOpen(true)}
            title="Command palette (Ctrl+K)"
          >
            <Command size={11} aria-hidden />
            <span>Search</span>
            <kbd className="wg-kbd">Ctrl K</kbd>
          </button>
          <button
            className={`wg-tb-btn ${store.showSidebar ? 'is-on' : ''}`}
            aria-label="Toggle sidebar"
            aria-pressed={store.showSidebar}
            title="Toggle sidebar (Ctrl+B)"
            onClick={() => store.setShowSidebar((value) => !value)}
          >
            <PanelLeft size={14} />
          </button>
          <button
            className={`wg-tb-btn ${store.showAux ? 'is-on' : ''}`}
            aria-label="Toggle context pane"
            aria-pressed={store.showAux}
            title="Toggle context pane (Ctrl+J)"
            onClick={() => store.setShowAux((value) => !value)}
          >
            <PanelRight size={14} />
          </button>

          {nativeChrome && (
            <div className="wg-winbtns" role="group" aria-label="Window">
              <button
                className="wg-winbtn"
                aria-label="Minimise"
                title="Minimise"
                onClick={() => shell.minimize()}
              >
                <Minus size={13} strokeWidth={1.6} />
              </button>
              <button
                className="wg-winbtn"
                aria-label="Maximise"
                title="Maximise"
                onClick={() => shell.maximize()}
              >
                <Square size={9} strokeWidth={1.6} />
              </button>
              <button
                className="wg-winbtn is-close"
                aria-label="Close"
                title="Close"
                onClick={() => shell.close()}
              >
                <X size={13} strokeWidth={1.6} />
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="wg-body">
        <ActivityRail
          activeView={showEditor ? 'files' : store.centerView}
          agentsEnabled={agentsEnabled}
          onSelectChat={() => {
            store.setCenterView('chat');
            store.setActiveFilePath(null);
          }}
          onSelectAgents={() => {
            store.setCenterView('agents');
            store.setActiveFilePath(null);
          }}
          onToggleSidebar={() => store.setShowSidebar((value) => !value)}
          onOpenExtensions={() => {
            store.setSettingsSection('Plugins');
            store.setSettingsOpen(true);
          }}
          onOpenSettings={() => store.setSettingsOpen(true)}
        />

        {store.showSidebar && (
          <>
            <Sidebar
              sessions={store.sessions}
              activeSessionId={store.activeSession.id}
              onSelectSession={store.setActiveSessionId}
              onNewSession={store.createSession}
              onDeleteSession={store.deleteSession}
              tree={store.tree}
              activeFilePath={store.activeFilePath}
              onOpenFile={(path) => void store.openFile(path)}
            />
            <div
              className={`wg-resize ${dragging === 'sidebar' ? 'is-dragging' : ''}`}
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize sidebar"
              onPointerDown={beginResize('sidebar')}
            />
          </>
        )}

        <main className="wg-center">
          {store.openTabs.length > 0 && (
            <div className="wg-tabstrip" role="tablist" aria-label="Open files">
              {store.openTabs.map((tab) => (
                <div
                  key={tab.path}
                  className={`wg-tab ${store.activeFilePath === tab.path ? 'is-active' : ''}`}
                  onClick={() => store.setActiveFilePath(tab.path)}
                  role="tab"
                  aria-selected={store.activeFilePath === tab.path}
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      store.setActiveFilePath(tab.path);
                    }
                  }}
                  title={tab.path}
                >
                  <FileCode2 size={12} aria-hidden />
                  <span className="wg-tab-label mono">{tab.path.split('/').pop()}</span>
                  {tab.dirty && <span className="wg-tab-dirty" aria-label="Unsaved changes" />}
                  <button
                    className="wg-tab-close"
                    aria-label={`Close ${tab.path}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      store.closeFileTab(tab.path);
                    }}
                  >
                    <X size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {showEditor ? (
            <CodeDiffEditor
              tab={activeFileTab!}
              prefs={{
                wrap: store.settings?.editorWrap !== false,
                lineNumbers: store.settings?.editorLineNumbers !== false,
                tabSize: store.settings?.editorTabSize ?? 2,
                autoSave: Boolean(store.settings?.editorAutoSave),
                spellCheck: store.settings?.spellcheck !== false,
              }}
              onChange={store.updateFileContent}
              onSave={(path) => void store.saveFile(path)}
              onToggleDiff={store.toggleTabDiff}
              onUndo={() => void store.runUndo()}
              onRedo={() => void store.runRedo()}
            />
          ) : store.centerView === 'chat' || !agentsEnabled ? (
            <ChatWorkbench store={store} />
          ) : (
            <AgentSwarmView store={store} />
          )}
        </main>

        {store.showAux && (
          <>
            <div
              className={`wg-resize ${dragging === 'aux' ? 'is-dragging' : ''}`}
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize context pane"
              onPointerDown={beginResize('aux')}
            />
            <aside className="wg-aux" aria-label="Context pane">
              <div className="wg-aux-head">
                <button
                  className={`wg-aux-tab ${store.auxTab === 'inspector' ? 'is-active' : ''}`}
                  onClick={() => store.setAuxTab('inspector')}
                >
                  <Activity size={11} aria-hidden />
                  <span>Context</span>
                </button>
                <button
                  className={`wg-aux-tab ${store.auxTab === 'browser' ? 'is-active' : ''}`}
                  onClick={() => store.setAuxTab('browser')}
                >
                  <Globe size={11} aria-hidden />
                  <span>Preview</span>
                </button>
                <button
                  className={`wg-aux-tab ${store.auxTab === 'terminal' ? 'is-active' : ''}`}
                  onClick={() => store.setAuxTab('terminal')}
                >
                  <SquareTerminal size={11} aria-hidden />
                  <span>Terminal</span>
                </button>
                <span className="wg-aux-tabs-spacer" />
                <button
                  className="wg-sidebar-action"
                  aria-label="Close context pane"
                  title="Close context pane"
                  onClick={() => store.setShowAux(false)}
                >
                  <X size={12} />
                </button>
              </div>

              <div className="wg-aux-body">
                {store.auxTab === 'browser' && <BrowserPane home={store.settings?.browserHome || ''} />}

                {store.auxTab === 'terminal' && (
                  <TerminalPane
                    log={store.terminalLog}
                    onRunCommand={store.runTerminalCommand}
                    onClear={() => store.setTerminalLog('')}
                    onAttachTerminal={(output) => {
                      store.setAttachments((previous) => [
                        ...previous,
                        { id: crypto.randomUUID(), type: 'terminal', label: 'output', content: output },
                      ]);
                      store.setCenterView('chat');
                      store.setActiveFilePath(null);
                    }}
                  />
                )}

                {store.auxTab === 'inspector' && (
                  <div className="wg-aux-scroll">
                    <div className="telemetry-section">
                      <div className="telemetry-title">Session</div>
                      <div className="kv-row">
                        <span>Provider</span>
                        <strong className="mono">{store.status?.providerId || 'unconfigured'}</strong>
                      </div>
                      <div className="kv-row">
                        <span>Model</span>
                        <strong className="mono truncate">{store.status?.model || '—'}</strong>
                      </div>
                      <div className="kv-row">
                        <span>Protocol</span>
                        <strong className="mono">{store.status?.protocol || '—'}</strong>
                      </div>
                      <div className="kv-row">
                        <span>Key</span>
                        <strong>{store.status?.ready ? 'resolvable' : 'missing'}</strong>
                      </div>
                      <div className="kv-row">
                        <span>Mode</span>
                        <strong>{store.agentMode}</strong>
                      </div>
                      <div className="kv-row">
                        <span>Steps</span>
                        <strong>{store.settings?.maxSteps ?? 8}</strong>
                      </div>
                    </div>

                    <div className="telemetry-section">
                      <div className="telemetry-title">Local inventory</div>
                      <div className="kv-row">
                        <span>Skills</span>
                        <strong>{store.status?.skillsCount ?? 0}</strong>
                      </div>
                      <div className="kv-row">
                        <span>Plugins</span>
                        <strong>{store.status?.pluginsCount ?? 0}</strong>
                      </div>
                      <div className="kv-row">
                        <span>Connectors</span>
                        <strong>{store.status?.mcpCount ?? 0}</strong>
                      </div>
                      <div className="kv-row">
                        <span>Memories</span>
                        <strong>{store.status?.memoryCount ?? 0}</strong>
                      </div>
                      <div className="kv-row">
                        <span>Undo / redo</span>
                        <strong>
                          {store.status?.undoCount ?? 0} / {store.status?.redoCount ?? 0}
                        </strong>
                      </div>
                    </div>

                    <div className="telemetry-section">
                      <div className="telemetry-title">Prompt compiler</div>
                      {[
                        'Identity guard',
                        'Environment',
                        'Project rules',
                        'Matched skills',
                        'Attachments',
                        'Memory',
                        'Tool policy',
                      ].map((stage) => (
                        <div key={stage} className="kv-row">
                          <span>{stage}</span>
                          <span className="wg-dot is-ok" aria-hidden />
                        </div>
                      ))}
                    </div>

                  </div>
                )}
              </div>
            </aside>
          </>
        )}
      </div>

      <StatusBar
        status={store.status}
        pendingCount={store.pendingSessionIds.length}
        tokenEstimate={store.tokenEstimate}
      />

      <SettingsModal store={store} />

      <CommandPalette
        open={store.cmdPaletteOpen}
        onClose={() => store.setCmdPaletteOpen(false)}
        tree={store.tree}
        onOpenFile={(path) => void store.openFile(path)}
        onAction={(action) => {
          if (action === 'new-session') store.createSession();
          if (action === 'change-workspace') {
            if (nativeChrome) shell.changeWorkspace();
          }
          if (action === 'chat') {
            store.setCenterView('chat');
            store.setActiveFilePath(null);
          }
          if (action === 'swarm') {
            store.setCenterView('agents');
            store.setActiveFilePath(null);
          }
          if (action === 'toggle-sidebar') store.setShowSidebar((value) => !value);
          if (action === 'toggle-aux') store.setShowAux((value) => !value);
          if (action === 'browser') {
            store.setShowAux(true);
            store.setAuxTab('browser');
          }
          if (action === 'settings') {
            store.setSettingsSection('Models');
            store.setSettingsOpen(true);
          }
          if (action === 'settings-appearance') {
            store.setSettingsSection('Appearance');
            store.setSettingsOpen(true);
          }
          if (action === 'connectors') {
            store.setSettingsSection('Plugins');
            store.setSettingsOpen(true);
          }
          if (action === 'plugins') {
            store.setSettingsSection('Plugins');
            store.setSettingsOpen(true);
          }
          if (action === 'skills') {
            store.setSettingsSection('Skills');
            store.setSettingsOpen(true);
          }
          if (action === 'memory') {
            store.setSettingsSection('Memory');
            store.setSettingsOpen(true);
          }
          if (action === 'keybindings') {
            store.setSettingsSection('Shortcuts');
            store.setSettingsOpen(true);
          }
          if (action === 'undo') void store.runUndo();
          if (action === 'redo') void store.runRedo();
          if (action === 'cycle-theme') {
            const themes = ['system', 'dark', 'light', 'graphite', 'midnight', 'porcelain'];
            const current = store.settings?.theme || 'dark';
            const at = themes.indexOf(current);
            void store.saveSettings({ theme: themes[(at + 1) % themes.length] });
          }
        }}
      />
    </div>
  );
}

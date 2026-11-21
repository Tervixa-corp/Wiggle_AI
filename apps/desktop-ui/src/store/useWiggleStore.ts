import { useCallback, useEffect, useRef, useState } from 'react';
import { notifyDesktop, playAttentionSound } from '../lib/notify';

/* ------------------------------------------------------------------ */
/* Types mirroring the local API                                       */
/* ------------------------------------------------------------------ */

export type AgentMode = 'agent' | 'plan' | 'ask' | 'swarm';
export type ApprovalMode = 'suggest' | 'auto_edit' | 'full_auto';

export interface ToolRun {
  id: string;
  name: string;
  input: Record<string, unknown>;
  status: 'running' | 'ok' | 'error' | 'denied';
  output?: string;
  durationMs?: number;
  /** Tool-specific detail: file diffs for edits, endpoints for skills/MCP. */
  meta?: Record<string, unknown>;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  /** Streamed model reasoning, when the provider exposes it. */
  thinking?: string;
  tools?: ToolRun[];
  streaming?: boolean;
  error?: boolean;
  meta?: {
    provider?: string;
    providerId?: string;
    model?: string;
    protocol?: string;
    mode?: string;
    step?: number;
    maxSteps?: number;
    stages?: Array<{ name: string; applied: boolean; detail?: string }>;
    notices?: string[];
    steps?: number;
    toolCalls?: number;
    usage?: Record<string, unknown> | null;
    snapshotId?: string | null;
    touched?: string[];
    cancelled?: boolean;
  };
}

export interface Session {
  id: string;
  name: string;
  messages: ChatMessage[];
}

export interface FileNode {
  name: string;
  path: string;
  isDir: boolean;
  bytes?: number;
  children?: FileNode[];
}

export interface OpenEditorTab {
  path: string;
  content: string;
  originalContent: string;
  dirty: boolean;
  diffMode: boolean;
}

export interface ContextAttachment {
  id: string;
  type: 'file' | 'folder' | 'terminal' | 'web' | 'docs';
  label: string;
  path?: string;
  content?: string;
}

export interface ProviderRoute {
  protocol: string;
  base: string;
  keyOptional?: boolean;
  tokenField?: string;
}

export interface ProviderEntry {
  id: string;
  name: string;
  doc: string;
  env: string[];
  routes: ProviderRoute[];
  modelCount: number;
}

export interface ProviderModel {
  id: string;
  name: string;
  route: number;
}

export type TranscriptWidth = 'narrow' | 'comfortable' | 'wide';
export type TranscriptView = 'normal' | 'thinking' | 'verbose';

export interface BrowserCookie {
  id: string;
  domain: string;
  name: string;
  value: string;
  path?: string;
  hasValue?: boolean;
}

export interface BrowserProfile {
  id: string;
  name: string;
  userAgent: string;
  allowedHosts: string[];
  cookies: BrowserCookie[];
}

export interface Worktree {
  path: string;
  branch: string;
  head: string;
  bare: boolean;
  detached: boolean;
  locked: boolean;
  primary: boolean;
}

export interface PullRequestInfo {
  branch: string;
  remote: string;
  base: string;
  ghAvailable: boolean;
  ghVersion: string;
  compareUrl: string;
  uncommitted: number;
  ahead: number | null;
}

export interface UsageSummary {
  days: number;
  totals: { input: number; output: number; total: number; turns: number };
  buckets: Array<{ day: string; input: number; output: number; turns: number }>;
  models: Array<{ model: string; input: number; output: number; turns: number }>;
  recorded: number;
}

export interface WiggleSettings {
  version: number;
  providerId: string;
  model: string;
  protocol: string;
  baseUrl: string;
  customIdentityInstructions: string;
  approvalMode: ApprovalMode;
  maxParallelAgents: number;
  maxSteps: number;
  outputStyle: 'default' | 'concise' | 'explanatory' | 'learning';
  dynamicWorkflows: boolean;
  theme: string;
  /** Classic is the graphite workspace; modern is the Freebuff Desktop interface. */
  uiTheme: 'classic' | 'modern';
  /** Premium palette id applied on top of the modern interface. */
  uiPalette: string;
  density: 'comfortable' | 'compact';
  uiFont: string;
  uiZoom: number;
  contrast: 'default' | 'strong';
  reduceMotion: boolean;
  interfaceLayout: 'software' | 'knowledge';
  startupView: 'chat' | 'agents';
  transcriptWidth: TranscriptWidth;
  defaultTranscriptView: TranscriptView;
  showChangedFiles: boolean;
  showBackgroundActivity: boolean;
  spellcheck: boolean;
  codeFont: string;
  codeFontSize: number;
  terminalFontSize: number;
  terminalScrollback: number;
  terminalShell: 'auto' | 'powershell' | 'cmd' | 'bash';
  editorTabSize: number;
  editorWrap: boolean;
  editorLineNumbers: boolean;
  editorAutoSave: boolean;
  notifyAgent: boolean;
  notifyPermissions: boolean;
  notifyQuestions: boolean;
  notifyErrors: boolean;
  notifySound: boolean;
  flashTaskbar: boolean;
  browserTools: boolean;
  openLinksInBrowser: boolean;
  autoOpenFiles: boolean;
  browserAllowedHosts: string[];
  browserProfiles: BrowserProfile[];
  activeBrowserProfile: string;
  browserSendCookies: boolean;
  worktreeAuto: boolean;
  prBaseBranch: string;
  prDraft: boolean;
  remoteTarget: 'local' | 'wsl' | 'ssh';
  wslDistro: string;
  sshHost: string;
  remoteWorkdir: string;
  memoryAutoExtract: boolean;
  browserHeadless: boolean;
  browserHome: string;
  disabledSkills: string[];
  disabledPlugins: string[];
  shellAllowlist: string[];
  roleModels: Record<string, string>;
  mcpServers: Record<string, ConnectorServer>;
  installedPlugins: string[];
  installedSkills: string[];
  pluginMeta: Record<string, InstalledPluginMeta>;
  shortcutOverrides: Record<string, string>;
  keyStatus: Record<string, boolean>;
  lastWorkspace: string;
}

export interface InstalledPluginMeta {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  category: string;
  homepage: string;
  installedAt: string;
  bytes: number;
  files: number;
  skills: string[];
  commands: Array<{ id: string; name: string; kind: string; description: string }>;
  previousInstall?: boolean;
}

export interface StatusInfo {
  version: string;
  configured: boolean;
  ready: boolean;
  model: string;
  provider: string;
  providerId: string;
  protocol: string;
  workspaceName: string;
  workspaceRoot: string;
  gitBranch: string;
  skillsCount: number;
  mcpCount: number;
  memoryCount: number;
  undoCount: number;
  redoCount: number;
  pluginsCount: number;
  platform: string;
  configDir: string;
}

export interface SkillItem {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  source: 'bundled' | 'installed' | 'workspace' | string;
  directory: string;
}

export interface MemoryItem {
  id: string;
  category: string;
  content: string;
  tags: string[];
  pinned: boolean;
  createdAt?: string;
  updatedAt: string;
}

export interface SwarmTask {
  id: string;
  role: string;
  title?: string;
  status: string;
  leasedFiles: string[];
  summary: string;
}

export interface ConnectorCatalogEntry {
  id: string;
  name: string;
  vendor: string;
  category: string;
  description: string;
  kind: 'mcp' | 'hosted';
  transport?: 'http' | 'sse';
  url?: string;
  auth?: string;
  docs: string;
  installed: boolean;
}

export interface ConnectorServer {
  id: string;
  name: string;
  url: string;
  transport: 'http' | 'sse' | 'stdio';
  command?: string;
  args?: string[];
  token: string;
  tokenEnv?: string;
  hasToken?: boolean;
  enabled: boolean;
  source: string;
  catalog?: ConnectorCatalogEntry | null;
}

export interface PluginEntry {
  id: string;
  name: string;
  description: string;
  category: string;
  author: string;
  homepage: string;
  keywords: string[];
  skills: string[];
  source: { source: string; url?: string; path?: string; ref?: string; sha?: string };
  installed: boolean;
  install: InstalledPluginMeta | null;
}

export interface PluginCommand {
  id: string;
  name: string;
  kind: string;
  description: string;
  body: string;
  plugin: string;
  command: string;
}

export interface ApprovalRequest {
  id: string;
  tool: string;
  input: Record<string, unknown>;
}

interface CatalogState<T> {
  items: T[];
  loading: boolean;
  error: string;
  loadedAt: number;
}

const SESSION_STORAGE_KEY = 'wiggle-sessions-v1';

const makeInitialSession = (): Session => ({
  id: crypto.randomUUID(),
  name: 'new-session',
  messages: [],
});

async function jsonRequest(path: string, init?: RequestInit) {
  const response = await fetch(path, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Request failed (HTTP ${response.status})`) as Error & {
      code?: string;
      hosted?: boolean;
      docs?: string;
    };
    error.code = data.code;
    error.hosted = data.hosted;
    error.docs = data.docs;
    throw error;
  }
  return data;
}

const jsonPost = (path: string, body: unknown) =>
  jsonRequest(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });

/** Read an SSE body from /api/chat and dispatch each JSON event. */
async function readChatStream(
  response: Response,
  onEvent: (event: Record<string, any>) => void,
) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('The server did not return a stream.');
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index: number;
    while ((index = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      for (const line of block.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const raw = line.slice(5).trim();
        if (!raw) continue;
        try {
          onEvent(JSON.parse(raw));
        } catch {
          // A malformed fragment is ignored; the next event still arrives.
        }
      }
    }
  }
}

const emptyCatalog = <T,>(): CatalogState<T> => ({ items: [], loading: false, error: '', loadedAt: 0 });

export function useWiggleStore() {
  /* ------------------------------- sessions ------------------------------- */
  const [sessions, setSessions] = useState<Session[]>(() => {
    try {
      const saved = localStorage.getItem(SESSION_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map((session: Session) => ({
            ...session,
            messages: (session.messages ?? []).map((message) => ({ ...message, streaming: false })),
          }));
        }
      }
    } catch {
      // Storage is best-effort.
    }
    return [makeInitialSession()];
  });

  const [activeSessionId, setActiveSessionId] = useState<string>(sessions[0].id);

  /* --------------------------------- shell -------------------------------- */
  const [status, setStatus] = useState<StatusInfo | null>(null);
  const [tree, setTree] = useState<FileNode[]>([]);
  const [treeTruncated, setTreeTruncated] = useState(false);
  const [openTabs, setOpenTabs] = useState<OpenEditorTab[]>([]);
  const [centerView, setCenterView] = useState<'chat' | 'agents'>('chat');
  const startupApplied = useRef(false);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [auxTab, setAuxTab] = useState<'inspector' | 'terminal' | 'browser'>('inspector');
  const [showSidebar, setShowSidebar] = useState(true);
  const [showAux, setShowAux] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState('General');
  const [worktrees, setWorktrees] = useState<Worktree[]>([]);
  const [worktreeBusy, setWorktreeBusy] = useState(false);
  const [pullRequest, setPullRequest] = useState<PullRequestInfo | null>(null);
  const [prBusy, setPrBusy] = useState(false);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [remoteState, setRemoteState] = useState<{ ok: boolean; output: string; target?: string; distros?: string[]; tunnel?: string } | null>(null);
  const [cmdPaletteOpen, setCmdPaletteOpen] = useState(false);

  /* -------------------------------- runtime -------------------------------- */
  const [agentMode, setAgentMode] = useState<AgentMode>('agent');
  const [pendingSessionIds, setPendingSessionIds] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<ContextAttachment[]>([]);
  const [approval, setApproval] = useState<ApprovalRequest | null>(null);
  const [tokenEstimate, setTokenEstimate] = useState(0);

  /* -------------------------------- catalogs -------------------------------- */
  const [settings, setSettings] = useState<WiggleSettings | null>(null);
  const [protocolLabels, setProtocolLabels] = useState<Record<string, string>>({});
  const [configDir, setConfigDir] = useState('');
  const [providers, setProviders] = useState<CatalogState<ProviderEntry>>(emptyCatalog);
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [plugins, setPlugins] = useState<CatalogState<PluginEntry>>(emptyCatalog);
  const [pluginCatalogTotal, setPluginCatalogTotal] = useState(0);
  const [pluginCategories, setPluginCategories] = useState<string[]>([]);
  const [pluginCommands, setPluginCommands] = useState<PluginCommand[]>([]);
  const [connectors, setConnectors] = useState<CatalogState<ConnectorCatalogEntry>>(emptyCatalog);
  const [connectorServers, setConnectorServers] = useState<ConnectorServer[]>([]);
  const [connectorStats, setConnectorStats] = useState({ remote: 0, hosted: 0 });
  const [installingPlugins, setInstallingPlugins] = useState<string[]>([]);
  const [busyConnectors, setBusyConnectors] = useState<string[]>([]);
  const [swarmTasks, setSwarmTasks] = useState<SwarmTask[]>([]);
  const [swarmGoal, setSwarmGoal] = useState('');
  const [terminalLog, setTerminalLog] = useState<string>(
    'Tervixa Wiggle shell ready. Commands run in the workspace under the permission screen.\n',
  );
  const abortRef = useRef<AbortController | null>(null);
  const modelCache = useRef(new Map<string, ProviderModel[]>());

  useEffect(() => {
    try {
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(sessions.slice(0, 20)));
    } catch {
      // Quota is not fatal.
    }
  }, [sessions]);

  const activeSession = sessions.find((session) => session.id === activeSessionId) || sessions[0];

  // Honour the startup view once, after the persisted settings arrive.
  useEffect(() => {
    if (startupApplied.current || !settings) return;
    startupApplied.current = true;
    if (settings.startupView === 'agents' && settings.interfaceLayout !== 'knowledge' && !activeFilePath) {
      setCenterView('agents');
    }
  }, [settings, activeFilePath]);

  /* ------------------------------ data loaders ----------------------------- */
  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await jsonRequest('/api/status'));
    } catch {
      setStatus(null);
    }
  }, []);

  const refreshWorkspace = useCallback(async () => {
    try {
      const data = await jsonRequest('/api/workspace/tree');
      setTree(data.tree || []);
      setTreeTruncated(Boolean(data.truncated));
    } catch {
      // The UI can run without a server; the empty state explains it.
    }
  }, []);

  const refreshSettings = useCallback(async () => {
    try {
      const data = await jsonRequest('/api/settings');
      setSettings(data.settings);
      setProtocolLabels(data.protocolLabels || {});
      setConfigDir(data.configDir || '');
    } catch {
      // Leave the previous settings visible.
    }
  }, []);

  const refreshSkills = useCallback(async () => {
    try {
      const data = await jsonRequest('/api/skills');
      setSkills(data.skills || []);
    } catch {
      // ignore
    }
  }, []);

  const refreshMemory = useCallback(async () => {
    try {
      const data = await jsonRequest('/api/memory');
      setMemories(data.entries || []);
    } catch {
      // ignore
    }
  }, []);

  const refreshProviders = useCallback(async () => {
    setProviders((state) => ({ ...state, loading: true, error: '' }));
    try {
      const data = await jsonRequest('/api/providers');
      setProviders({ items: data.providers || [], loading: false, error: '', loadedAt: Date.now() });
    } catch (error) {
      setProviders((state) => ({
        ...state,
        loading: false,
        error: error instanceof Error ? error.message : 'Could not load providers.',
      }));
    }
  }, []);

  const refreshPlugins = useCallback(async () => {
    setPlugins((state) => ({ ...state, loading: true, error: '' }));
    try {
      const data = await jsonRequest('/api/plugins');
      setPlugins({ items: data.plugins || [], loading: false, error: '', loadedAt: Date.now() });
      setPluginCatalogTotal(data.catalogTotal || 0);
      setPluginCategories(data.categories || []);
    } catch (error) {
      setPlugins((state) => ({
        ...state,
        loading: false,
        error: error instanceof Error ? error.message : 'Could not load plugins.',
      }));
    }
  }, []);

  const refreshPluginCommands = useCallback(async () => {
    try {
      const data = await jsonRequest('/api/plugins/commands');
      setPluginCommands(data.commands || []);
    } catch {
      setPluginCommands([]);
    }
  }, []);

  const refreshConnectors = useCallback(async () => {
    setConnectors((state) => ({ ...state, loading: true, error: '' }));
    try {
      const data = await jsonRequest('/api/connectors');
      setConnectors({ items: data.catalog || [], loading: false, error: '', loadedAt: Date.now() });
      setConnectorServers(data.servers || []);
      setConnectorStats({ remote: data.remoteCount || 0, hosted: data.hostedCount || 0 });
    } catch (error) {
      setConnectors((state) => ({
        ...state,
        loading: false,
        error: error instanceof Error ? error.message : 'Could not load connectors.',
      }));
    }
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.allSettled([
      refreshStatus(),
      refreshWorkspace(),
      refreshSettings(),
      refreshSkills(),
      refreshMemory(),
      refreshConnectors(),
      refreshPluginCommands(),
    ]);
  }, [refreshStatus, refreshWorkspace, refreshSettings, refreshSkills, refreshMemory, refreshConnectors, refreshPluginCommands]);

  useEffect(() => {
    void refreshAll();
    void refreshProviders();
    void refreshPlugins();
  }, [refreshAll, refreshProviders, refreshPlugins]);

  useEffect(() => {
    const chosen = settings?.theme || localStorage.getItem('wiggle-theme') || 'graphite';
    const prefersLight = typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches;
    const theme = chosen === 'system' ? (prefersLight ? 'light' : 'graphite') : chosen;
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.dataset.themeChoice = chosen;
    root.dataset.ui = settings?.uiTheme === 'modern' ? 'modern' : 'classic';
    root.dataset.palette = settings?.uiPalette || 'freebuff';
    root.dataset.density = settings?.density || 'comfortable';
    root.dataset.font = settings?.uiFont || 'inter';
    root.dataset.contrast = settings?.contrast || 'default';
    root.dataset.reduceMotion = settings?.reduceMotion ? 'true' : 'false';
    root.dataset.layout = settings?.interfaceLayout || 'software';
    root.dataset.transcriptWidth = settings?.transcriptWidth || 'comfortable';
    root.style.setProperty('--wg-zoom', String((settings?.uiZoom ?? 100) / 100));
    root.style.setProperty('--wg-code-font', settings?.codeFont?.trim() || "'JetBrains Mono', monospace");
    root.style.setProperty('--wg-code-size', `${settings?.codeFontSize ?? 13}px`);
    root.style.setProperty('--wg-term-size', `${settings?.terminalFontSize ?? 13}px`);
    localStorage.setItem('wiggle-theme', chosen);
  }, [
    settings?.theme,
    settings?.uiTheme,
    settings?.uiPalette,
    settings?.density,
    settings?.uiFont,
    settings?.contrast,
    settings?.reduceMotion,
    settings?.interfaceLayout,
    settings?.transcriptWidth,
    settings?.uiZoom,
    settings?.codeFont,
    settings?.codeFontSize,
    settings?.terminalFontSize,
  ]);

  /* -------------------------------- sessions ------------------------------- */
  const createSession = () => {
    const next = makeInitialSession();
    setSessions((previous) => [next, ...previous]);
    setActiveSessionId(next.id);
    setCenterView('chat');
    setActiveFilePath(null);
  };

  const clearSessions = () => {
    const next = makeInitialSession();
    setSessions([next]);
    setActiveSessionId(next.id);
  };

  const deleteSession = (id: string) => {
    setSessions((previous) => {
      const remaining = previous.filter((session) => session.id !== id);
      if (!remaining.length) {
        const next = makeInitialSession();
        setActiveSessionId(next.id);
        return [next];
      }
      setActiveSessionId((current) => (current === id ? remaining[0].id : current));
      return remaining;
    });
  };

  const selectSession = (id: string) => {
    setActiveSessionId(id);
    setCenterView('chat');
    setActiveFilePath(null);
  };

  /* --------------------------------- editor -------------------------------- */
  const openFile = async (relativePath: string) => {
    const existing = openTabs.find((tab) => tab.path === relativePath);
    if (existing) {
      setActiveFilePath(relativePath);
      return;
    }
    try {
      const data = await jsonRequest(`/api/workspace/file?path=${encodeURIComponent(relativePath)}`);
      setOpenTabs((previous) => [
        ...previous,
        {
          path: data.path,
          content: data.content,
          originalContent: data.content,
          dirty: false,
          diffMode: false,
        },
      ]);
      setActiveFilePath(data.path);
    } catch {
      // Opening an unreadable file is a no-op rather than a broken tab.
    }
  };

  const closeFileTab = (relativePath: string) => {
    setOpenTabs((previous) => previous.filter((tab) => tab.path !== relativePath));
    setActiveFilePath((current) => (current === relativePath ? null : current));
  };

  const updateFileContent = (relativePath: string, nextContent: string) => {
    setOpenTabs((previous) =>
      previous.map((tab) =>
        tab.path === relativePath
          ? { ...tab, content: nextContent, dirty: nextContent !== tab.originalContent }
          : tab,
      ),
    );
  };

  const toggleTabDiff = (relativePath: string) => {
    setOpenTabs((previous) =>
      previous.map((tab) => (tab.path === relativePath ? { ...tab, diffMode: !tab.diffMode } : tab)),
    );
  };

  /**
   * Re-read clean editor tabs from disk. Dirty tabs keep the user's edits.
   * Called after undo/redo, agent turns and terminal commands so the editor
   * never shows content the workspace has already changed underneath it.
   */
  const reloadCleanTabs = async () => {
    const targets = openTabs.filter((tab) => !tab.dirty);
    if (targets.length === 0) return;
    const results = await Promise.allSettled(
      targets.map((tab) => jsonRequest(`/api/workspace/file?path=${encodeURIComponent(tab.path)}`)),
    );
    const fresh = new Map<string, string>();
    results.forEach((result, index) => {
      if (result.status === 'fulfilled' && typeof result.value?.content === 'string') {
        fresh.set(targets[index].path, result.value.content);
      }
    });
    if (fresh.size === 0) return;
    setOpenTabs((previous) =>
      previous.map((tab) => {
        const content = !tab.dirty ? fresh.get(tab.path) : undefined;
        return content === undefined || content === tab.content
          ? tab
          : { ...tab, content, originalContent: content };
      }),
    );
  };

  const saveFile = async (relativePath: string) => {
    const tab = openTabs.find((entry) => entry.path === relativePath);
    if (!tab) return;
    await jsonPost('/api/workspace/file', {
      path: tab.path,
      content: tab.content,
      label: `editor save ${tab.path}`,
    });
    setOpenTabs((previous) =>
      previous.map((entry) =>
        entry.path === relativePath ? { ...entry, originalContent: entry.content, dirty: false } : entry,
      ),
    );
    await refreshStatus();
    await refreshWorkspace();
  };

  const runUndo = async () => {
    try {
      const data = await jsonPost('/api/workspace/undo', {});
      appendSystemNote(`Undid snapshot: ${data.record?.label ?? 'change'}`);
    } catch (error) {
      appendSystemNote(error instanceof Error ? error.message : 'Nothing to undo.');
    }
    await refreshAll();
    await reloadCleanTabs();
  };

  const runRedo = async () => {
    try {
      const data = await jsonPost('/api/workspace/redo', {});
      appendSystemNote(`Redid snapshot: ${data.record?.label ?? 'change'}`);
    } catch (error) {
      appendSystemNote(error instanceof Error ? error.message : 'Nothing to redo.');
    }
    await refreshAll();
    await reloadCleanTabs();
  };

  /* ---------------------------------- chat --------------------------------- */
  const appendSystemNote = (text: string) => {
    setSessions((all) =>
      all.map((session) =>
        session.id !== activeSessionId
          ? session
          : {
              ...session,
              messages: [...session.messages, { id: crypto.randomUUID(), role: 'system', text }],
            },
      ),
    );
  };

  const patchMessage = (sessionId: string, messageId: string, updater: (message: ChatMessage) => ChatMessage) => {
    setSessions((all) =>
      all.map((session) =>
        session.id !== sessionId
          ? session
          : {
              ...session,
              messages: session.messages.map((message) =>
                message.id === messageId ? updater(message) : message,
              ),
            },
      ),
    );
  };

  const stopChat = async () => {
    try {
      await jsonPost('/api/chat/stop', {});
    } catch {
      // Aborting locally is enough.
    }
    abortRef.current?.abort();
  };

  const resolveApproval = async (id: string, decision: 'allow' | 'deny') => {
    if (settings?.notifySound) playAttentionSound();
    setApproval((current) => (current?.id === id ? null : current));
    try {
      await jsonPost(`/api/approvals/${encodeURIComponent(id)}`, { decision });
    } catch {
      appendSystemNote('That approval request expired before it was answered.');
    }
  };

  const sendMessage = async (rawText: string) => {
    const text = rawText.trim();
    if (!text || pendingSessionIds.includes(activeSessionId)) return;

    const targetSession = activeSession;

    if (text === '/undo') return runUndo();
    if (text === '/redo') return runRedo();
    if (text === '/clear') {
      setSessions((all) =>
        all.map((session) => (session.id === targetSession.id ? { ...session, messages: [] } : session)),
      );
      return;
    }
    if (text.startsWith('/swarm')) {
      const goal = text.replace(/^\/swarm\s*/, '').trim() || 'Analyse this workspace and plan the next change.';
      await runSwarm(goal);
      return;
    }

    // A plugin slash command expands to the Markdown command body.
    let outbound = text;
    const pluginCommand = pluginCommands.find(
      (command) => text === command.command || text.startsWith(`${command.command} `),
    );
    if (pluginCommand) {
      outbound = `${pluginCommand.body}\n\n${text.slice(pluginCommand.command.length).trim()}`.trim();
    }

    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: 'user', text };
    const assistantMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      text: '',
      tools: [],
      streaming: true,
      meta: { mode: agentMode },
    };

    const outboundMessages = [...targetSession.messages, userMessage]
      .filter((message) => message.role !== 'system')
      .map((message) => ({ role: message.role, content: message.text }));

    setSessions((all) =>
      all.map((session) =>
        session.id !== targetSession.id
          ? session
          : {
              ...session,
              name: session.messages.length === 0 ? text.slice(0, 34) : session.name,
              messages: [...session.messages, userMessage, assistantMessage],
            },
      ),
    );
    setPendingSessionIds((ids) => [...ids, targetSession.id]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: outboundMessages,
          mode: agentMode,
          maxSteps: settings?.maxSteps,
          attachments,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `The server rejected the request (HTTP ${response.status}).`);
      }

      await readChatStream(response, (event) => {
        if (event.type === 'meta') {
          patchMessage(targetSession.id, assistantMessage.id, (message) => ({
            ...message,
            meta: { ...message.meta, ...event },
          }));
          return;
        }
        if (event.type === 'compile') {
          patchMessage(targetSession.id, assistantMessage.id, (message) => ({
            ...message,
            meta: { ...message.meta, stages: event.stages ?? [] },
          }));
          return;
        }
        if (event.type === 'step') {
          patchMessage(targetSession.id, assistantMessage.id, (message) => ({
            ...message,
            meta: { ...message.meta, step: event.step, maxSteps: event.maxSteps },
          }));
          return;
        }
        if (event.type === 'text') {
          patchMessage(targetSession.id, assistantMessage.id, (message) => ({
            ...message,
            text: message.text + String(event.delta ?? ''),
          }));
          return;
        }
        if (event.type === 'thinking') {
          patchMessage(targetSession.id, assistantMessage.id, (message) => ({
            ...message,
            thinking: (message.thinking ?? '') + String(event.delta ?? ''),
          }));
          return;
        }
        if (event.type === 'tool_call') {
          patchMessage(targetSession.id, assistantMessage.id, (message) => ({
            ...message,
            tools: [
              ...(message.tools ?? []),
              {
                id: String(event.id ?? crypto.randomUUID()),
                name: String(event.name ?? 'tool'),
                input: (event.input ?? {}) as Record<string, unknown>,
                status: 'running',
              },
            ],
          }));
          return;
        }
        if (event.type === 'tool_result') {
          patchMessage(targetSession.id, assistantMessage.id, (message) => ({
            ...message,
            tools: (message.tools ?? []).map((tool) =>
              tool.id === event.id
                ? {
                    ...tool,
                    status: event.ok ? 'ok' : /permission denied/i.test(String(event.output)) ? 'denied' : 'error',
                    output: String(event.output ?? ''),
                    meta: (event.meta ?? undefined) as Record<string, unknown> | undefined,
                    durationMs: Number(event.durationMs) || undefined,
                  }
                : tool,
            ),
          }));
          return;
        }
        if (event.type === 'approval') {
          setApproval({ id: event.id, tool: String(event.tool), input: event.input ?? {} });
          if (settings?.notifyPermissions) {
            notifyDesktop({
              title: 'Approval needed',
              body: `${String(event.tool)} is waiting for your decision.`,
              silent: !settings?.notifySound,
              flash: settings?.flashTaskbar,
            });
          }
          if (settings?.notifySound) playAttentionSound();
          return;
        }
        if (event.type === 'notice') {
          patchMessage(targetSession.id, assistantMessage.id, (message) => ({
            ...message,
            meta: { ...message.meta, notices: [...(message.meta?.notices ?? []), String(event.text)] },
          }));
          return;
        }
        if (event.type === 'done') {
          patchMessage(targetSession.id, assistantMessage.id, (message) => ({
            ...message,
            streaming: false,
            meta: {
              ...message.meta,
              steps: event.steps,
              toolCalls: event.toolCalls,
              usage: event.usage ?? null,
              snapshotId: event.snapshotId ?? null,
              touched: event.touched ?? [],
              cancelled: Boolean(event.cancelled),
            },
          }));
          return;
        }
        if (event.type === 'error') {
          patchMessage(targetSession.id, assistantMessage.id, (message) => ({
            ...message,
            streaming: false,
            error: true,
            text: message.text || String(event.message ?? 'The turn failed.'),
          }));
          return;
        }
        if (event.type === 'end') {
          patchMessage(targetSession.id, assistantMessage.id, (message) => ({
            ...message,
            streaming: false,
          }));
        }
      });

      patchMessage(targetSession.id, assistantMessage.id, (message) => ({
        ...message,
        streaming: false,
        text: message.text || (message.error ? message.text : 'The model returned no text.'),
      }));
      setTokenEstimate((tokens) => tokens + Math.ceil((text.length + 200) / 4));
      if (settings?.notifyAgent) {
        notifyDesktop({
          title: 'Turn finished',
          body: text.slice(0, 120),
          silent: !settings?.notifySound,
          flash: settings?.flashTaskbar,
        });
      }
      if (settings?.notifySound) playAttentionSound();
      await Promise.allSettled([refreshStatus(), refreshWorkspace(), refreshMemory()]);
      await reloadCleanTabs();
    } catch (error) {
      const aborted = error instanceof DOMException && error.name === 'AbortError';
      patchMessage(targetSession.id, assistantMessage.id, (message) => ({
        ...message,
        streaming: false,
        error: !aborted,
        text: aborted
          ? message.text || 'Stopped.'
          : message.text || (error instanceof Error ? error.message : 'The request failed.'),
      }));
      if (!aborted && settings?.notifyErrors) {
        notifyDesktop({
          title: 'Turn failed',
          body: error instanceof Error ? error.message : 'The request failed.',
          silent: !settings?.notifySound,
          flash: settings?.flashTaskbar,
        });
      }
    } finally {
      abortRef.current = null;
      setApproval(null);
      setPendingSessionIds((ids) => ids.filter((id) => id !== targetSession.id));
    }
  };

  /* --------------------------------- swarm --------------------------------- */
  const runSwarm = async (goal: string) => {
    setSwarmGoal(goal);
    const data = await jsonPost('/api/swarm', { goal });
    setSwarmTasks(data.tasks || []);
    setCenterView('agents');
    setActiveFilePath(null);
    await refreshStatus();
  };

  /* -------------------------------- terminal ------------------------------- */
  const runTerminalCommand = async (command: string) => {
    const limit = settings?.terminalScrollback ?? 4000;
    const clip = (text: string) => (text.length > limit ? text.slice(-limit) : text);
    setTerminalLog((previous) => clip(`${previous}$ ${command}\n`));
    try {
      const data = await jsonPost('/api/terminal', { command });
      setTerminalLog((previous) =>
        clip(`${previous}${data.stdout || ''}${data.stderr || ''}${data.ok ? '' : `[exit ${data.exitCode}]\n`}`),
      );
      await refreshWorkspace();
      await reloadCleanTabs();
    } catch (error) {
      setTerminalLog(
        (previous) => `${previous}[blocked] ${error instanceof Error ? error.message : 'Command failed.'}\n`,
      );
    }
  };

  /* -------------------------------- settings ------------------------------- */
  const saveSettings = async (patch: Partial<WiggleSettings> & { apiKey?: string; clearApiKey?: boolean }) => {
    const data = await jsonPost('/api/settings', patch);
    setSettings(data.settings);
    await refreshStatus();
    return data.settings as WiggleSettings;
  };

  const loadProviderModels = useCallback(async (providerId: string): Promise<ProviderModel[]> => {
    const cached = modelCache.current.get(providerId);
    if (cached) return cached;
    const data = await jsonRequest(`/api/providers/models?id=${encodeURIComponent(providerId)}`);
    const models: ProviderModel[] = data.models || [];
    modelCache.current.set(providerId, models);
    return models;
  }, []);

  const testProvider = async (draft: {
    providerId: string;
    model: string;
    protocol: string;
    baseUrl: string;
    apiKey?: string;
  }) => jsonPost('/api/providers/test', draft);

  /* --------------------------------- skills -------------------------------- */
  const toggleSkill = async (name: string, enabled: boolean) => {
    await jsonPost('/api/skills/toggle', { name, enabled });
    await Promise.allSettled([refreshSkills(), refreshStatus()]);
  };

  const installSkill = async (name: string, markdown: string) => {
    await jsonPost('/api/skills/install', { name, markdown });
    await Promise.allSettled([refreshSkills(), refreshStatus()]);
  };

  const removeSkill = async (name: string) => {
    await jsonPost('/api/skills/remove', { name });
    await Promise.allSettled([refreshSkills(), refreshStatus()]);
  };

  /* --------------------------------- memory -------------------------------- */
  const addMemory = async (content: string, pinned = false) => {
    await jsonPost('/api/memory', { content, pinned });
    await Promise.allSettled([refreshMemory(), refreshStatus()]);
  };

  const removeMemory = async (id: string) => {
    await jsonRequest(`/api/memory?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    await Promise.allSettled([refreshMemory(), refreshStatus()]);
  };

  /* --------------------------------- plugins ------------------------------- */
  const installPlugin = async (id: string) => {
    setInstallingPlugins((ids) => [...ids, id]);
    try {
      await jsonPost('/api/plugins/install', { id });
      await Promise.allSettled([
        refreshPlugins(),
        refreshSettings(),
        refreshSkills(),
        refreshPluginCommands(),
        refreshStatus(),
        refreshConnectors(),
      ]);
    } finally {
      setInstallingPlugins((ids) => ids.filter((entry) => entry !== id));
    }
  };

  const uninstallPlugin = async (id: string) => {
    await jsonPost('/api/plugins/uninstall', { id });
    await Promise.allSettled([
      refreshPlugins(),
      refreshSettings(),
      refreshSkills(),
      refreshPluginCommands(),
      refreshStatus(),
      refreshConnectors(),
    ]);
  };

  /* -------------------------------- connectors ------------------------------ */
  const markConnectorBusy = async (id: string, task: () => Promise<void>) => {
    setBusyConnectors((ids) => [...ids, id]);
    try {
      await task();
    } finally {
      setBusyConnectors((ids) => ids.filter((entry) => entry !== id));
    }
  };

  const addConnector = (id: string, token = '') =>
    markConnectorBusy(id, async () => {
      await jsonPost('/api/connectors/add', { id, token });
      await Promise.allSettled([refreshConnectors(), refreshStatus()]);
    });

  const addCustomConnector = async (draft: { name: string; url: string; transport?: string; token?: string }) => {
    await jsonPost('/api/connectors/custom', draft);
    await Promise.allSettled([refreshConnectors(), refreshStatus()]);
  };

  const removeConnector = (id: string) =>
    markConnectorBusy(id, async () => {
      await jsonPost('/api/connectors/remove', { id });
      await Promise.allSettled([refreshConnectors(), refreshStatus()]);
    });

  const toggleConnector = (id: string, enabled: boolean) =>
    markConnectorBusy(id, async () => {
      await jsonPost('/api/connectors/toggle', { id, enabled });
      await Promise.allSettled([refreshConnectors(), refreshStatus()]);
    });

  const testConnector = (id: string) =>
    markConnectorBusy(id, async () => {
      // The result is returned to the caller through the UI; nothing is cached.
      await jsonPost('/api/connectors/test', { id });
    });

  const testConnectorResult = async (id: string) => jsonPost('/api/connectors/test', { id });

  const searchConnectorRegistry = async (query: string, cursor = '') => {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (cursor) params.set('cursor', cursor);
    return jsonRequest(`/api/connectors/registry?${params.toString()}`);
  };

  /* ----------------------------- workstation extras ----------------------------- */

  const loadWorktrees = useCallback(async () => {
    const data = await jsonRequest('/api/git/worktrees');
    const list = Array.isArray(data.worktrees) ? (data.worktrees as Worktree[]) : [];
    setWorktrees(list);
    return list;
  }, []);

  const createWorktree = async (draft: { branch: string; path?: string; base?: string }) => {
    setWorktreeBusy(true);
    try {
      const data = (await jsonPost('/api/git/worktrees', draft)) as { path: string; branch: string };
      await loadWorktrees();
      return data;
    } finally {
      setWorktreeBusy(false);
    }
  };

  const deleteWorktree = async (target: string, force = false) => {
    setWorktreeBusy(true);
    try {
      await jsonPost('/api/git/worktrees', { action: 'remove', path: target, force });
      await loadWorktrees();
    } finally {
      setWorktreeBusy(false);
    }
  };

  const loadPullRequest = useCallback(async () => {
    const data = (await jsonRequest('/api/git/pull-request')) as PullRequestInfo;
    setPullRequest(data);
    return data;
  }, []);

  const submitPullRequest = async (draft: { title: string; body?: string; base?: string; draft?: boolean }) => {
    setPrBusy(true);
    try {
      return (await jsonPost('/api/git/pull-request', draft)) as {
        ok: boolean;
        url?: string;
        compareUrl?: string;
        error?: string;
        code?: string;
        output?: string;
      };
    } finally {
      setPrBusy(false);
    }
  };

  const loadUsage = useCallback(async (days = 14) => {
    const data = (await jsonRequest(`/api/usage?days=${days}`)) as UsageSummary;
    setUsage(data);
    return data;
  }, []);

  const clearUsage = async () => {
    await jsonPost('/api/usage/clear', {});
    await loadUsage();
  };

  const testRemote = async () => {
    const data = (await jsonPost('/api/remote/test', {})) as { ok: boolean; output: string; distros?: string[]; tunnel?: string };
    setRemoteState(data);
    return data;
  };

  return {
    // sessions
    sessions,
    activeSession,
    setActiveSessionId: selectSession,
    createSession,
    deleteSession,
    clearSessions,
    pendingSessionIds,
    approval,
    resolveApproval,
    stopChat,
    sendMessage,
    agentMode,
    setAgentMode,
    attachments,
    setAttachments,
    tokenEstimate,
    // shell
    status,
    tree,
    treeTruncated,
    openTabs,
    activeFilePath,
    setActiveFilePath,
    openFile,
    closeFileTab,
    updateFileContent,
    toggleTabDiff,
    saveFile,
    centerView,
    setCenterView,
    auxTab,
    setAuxTab,
    showSidebar,
    setShowSidebar,
    showAux,
    setShowAux,
    settingsOpen,
    setSettingsOpen,
    settingsSection,
    setSettingsSection,
    cmdPaletteOpen,
    setCmdPaletteOpen,
    runUndo,
    runRedo,
    runTerminalCommand,
    terminalLog,
    setTerminalLog,
    // data
    settings,
    protocolLabels,
    configDir,
    providers,
    skills,
    memories,
    plugins,
    pluginCatalogTotal,
    pluginCategories,
    pluginCommands,
    connectors,
    connectorServers,
    connectorStats,
    installingPlugins,
    busyConnectors,
    refreshAll,
    refreshStatus,
    refreshWorkspace,
    refreshSettings,
    refreshSkills,
    refreshMemory,
    refreshProviders,
    refreshPlugins,
    refreshConnectors,
    loadProviderModels,
    testProvider,
    saveSettings,
    toggleSkill,
    installSkill,
    removeSkill,
    addMemory,
    removeMemory,
    installPlugin,
    uninstallPlugin,
    addConnector,
    addCustomConnector,
    removeConnector,
    toggleConnector,
    testConnector,
    testConnectorResult,
    searchConnectorRegistry,
    // workstation extras
    worktrees,
    worktreeBusy,
    pullRequest,
    prBusy,
    usage,
    remoteState,
    loadWorktrees,
    createWorktree,
    deleteWorktree,
    loadPullRequest,
    submitPullRequest,
    loadUsage,
    clearUsage,
    testRemote,
    // swarm
    swarmTasks,
    swarmGoal,
    runSwarm,
  };
}

export type WiggleStore = ReturnType<typeof useWiggleStore>;

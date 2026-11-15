import { useCallback, useEffect, useState } from 'react';

export interface ToolBlock {
  name: string;
  ok: boolean;
  output: string;
  changedFiles?: string[];
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  meta?: {
    route?: string;
    injectedMemories?: number;
    matchedSkills?: string[];
    instructionFiles?: string[];
  };
  tools?: ToolBlock[];
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

export interface ProviderPreset {
  id: string;
  name: string;
  protocol: string;
  baseUrl: string;
  envKey: string;
  defaultModel: string;
  local: boolean;
}

export interface WiggleSettings {
  activeProvider: string;
  activeModel: string;
  baseUrl: string;
  approvalMode: 'suggest' | 'auto_edit' | 'full_auto';
  maxParallelAgents: number;
  customIdentityInstructions: string;
  theme: 'dark' | 'light';
  memoryAutoExtract: boolean;
  browserHeadless: boolean;
  disabledSkills: string[];
  shellAllowlist: string[];
  roleModels: Record<string, string>;
}

export interface StatusInfo {
  version: string;
  configured: boolean;
  model: string;
  provider: string;
  providerId: string;
  workspaceName: string;
  gitBranch: string;
  skillsCount: number;
  mcpCount: number;
  memoryCount: number;
  undoCount: number;
  redoCount: number;
}

export interface SkillItem {
  id: string;
  name: string;
  description: string;
  body: string;
  source: string;
  path: string;
  enabled: boolean;
}

export interface MemoryItem {
  id: string;
  category: string;
  content: string;
  tags: string[];
  pinned: boolean;
  updatedAt: string;
}

export interface SwarmTask {
  id: string;
  role: string;
  status: string;
  leasedFiles: string[];
  summary: string;
}

const SESSION_STORAGE_KEY = 'wiggle-sessions-v1';

const makeInitialSession = (): Session => ({
  id: crypto.randomUUID(),
  name: 'new-session',
  messages: [],
});

export function useWiggleStore() {
  const [sessions, setSessions] = useState<Session[]>(() => {
    try {
      const saved = localStorage.getItem(SESSION_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // ignore storage failure
    }
    return [makeInitialSession()];
  });

  const [activeSessionId, setActiveSessionId] = useState<string>(sessions[0].id);
  const [status, setStatus] = useState<StatusInfo | null>(null);
  const [tree, setTree] = useState<FileNode[]>([]);
  const [openTabs, setOpenTabs] = useState<OpenEditorTab[]>([]);
  const [activeWorkbenchTab, setActiveWorkbenchTab] = useState<string>('chat');
  const [auxTab, setAuxTab] = useState<'inspector' | 'terminal' | 'browser'>('inspector');
  const [showSidebar, setShowSidebar] = useState(true);
  const [showAux, setShowAux] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState('Models & BYOK Providers');
  const [cmdPaletteOpen, setCmdPaletteOpen] = useState(false);
  const [agentMode, setAgentMode] = useState<'agent' | 'plan' | 'ask' | 'swarm'>('agent');
  const [pendingSessionIds, setPendingSessionIds] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<ContextAttachment[]>([]);
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [mcpServers, setMcpServers] = useState<Record<string, any>>({});
  const [mcpCatalog, setMcpCatalog] = useState<any[]>([]);
  const [settings, setSettings] = useState<WiggleSettings | null>(null);
  const [presets, setPresets] = useState<ProviderPreset[]>([]);
  const [swarmTasks, setSwarmTasks] = useState<SwarmTask[]>([]);
  const [terminalLog, setTerminalLog] = useState<string>(
    'Tervixa Wiggle PTY Shell ready. Commands follow Settings > Permissions & Sandbox.\n'
  );
  const [tokenEstimate, setTokenEstimate] = useState(0);

  useEffect(() => {
    try {
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(sessions.slice(0, 20)));
    } catch {
      // ignore quota
    }
  }, [sessions]);

  const refreshStatus = useCallback(async () => {
    try {
      const r = await fetch('/api/status');
      if (r.ok) setStatus(await r.json());
    } catch {
      setStatus(null);
    }
  }, []);

  const refreshWorkspace = useCallback(async () => {
    try {
      const r = await fetch('/api/workspace/tree');
      if (r.ok) {
        const data = await r.json();
        setTree(data.tree || []);
      }
    } catch {
      // UI-only mode
    }
  }, []);

  const refreshMetadata = useCallback(async () => {
    try {
      const [skRes, memRes, mcpRes, setRes] = await Promise.all([
        fetch('/api/skills'),
        fetch('/api/memory'),
        fetch('/api/mcp'),
        fetch('/api/settings'),
      ]);
      if (skRes.ok) setSkills((await skRes.json()).skills || []);
      if (memRes.ok) setMemories((await memRes.json()).entries || []);
      if (mcpRes.ok) {
        const d = await mcpRes.json();
        setMcpServers(d.mcpServers || {});
        setMcpCatalog(d.catalog || []);
      }
      if (setRes.ok) {
        const s = await setRes.json();
        setSettings(s.settings);
        setPresets(s.presets || []);
      }
    } catch {
      // UI-only static preview
    }
  }, []);

  useEffect(() => {
    refreshStatus();
    refreshWorkspace();
    refreshMetadata();
  }, [refreshStatus, refreshWorkspace, refreshMetadata]);

  useEffect(() => {
    const theme = settings?.theme || localStorage.getItem('wiggle-theme') || 'dark';
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('wiggle-theme', theme);
  }, [settings?.theme]);

  const activeSession = sessions.find((s) => s.id === activeSessionId) || sessions[0];

  const createSession = () => {
    const next = makeInitialSession();
    setSessions((prev) => [next, ...prev]);
    setActiveSessionId(next.id);
    setActiveWorkbenchTab('chat');
  };

  const openFile = async (relPath: string) => {
    const existing = openTabs.find((t) => t.path === relPath);
    if (existing) {
      setActiveWorkbenchTab(`file:${relPath}`);
      return;
    }
    try {
      const r = await fetch(`/api/workspace/file?path=${encodeURIComponent(relPath)}`);
      if (!r.ok) return;
      const data = await r.json();
      setOpenTabs((prev) => [
        ...prev,
        {
          path: data.path,
          content: data.content,
          originalContent: data.content,
          dirty: false,
          diffMode: false,
        },
      ]);
      setActiveWorkbenchTab(`file:${data.path}`);
    } catch {
      // ignore
    }
  };

  const updateFileContent = (relPath: string, nextContent: string) => {
    setOpenTabs((prev) =>
      prev.map((t) =>
        t.path === relPath ? { ...t, content: nextContent, dirty: nextContent !== t.originalContent } : t
      )
    );
  };

  const toggleTabDiff = (relPath: string) => {
    setOpenTabs((prev) =>
      prev.map((t) => (t.path === relPath ? { ...t, diffMode: !t.diffMode } : t))
    );
  };

  const saveFile = async (relPath: string) => {
    const tab = openTabs.find((t) => t.path === relPath);
    if (!tab) return;
    const r = await fetch('/api/workspace/file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: tab.path, content: tab.content, label: `editor save ${tab.path}` }),
    });
    if (r.ok) {
      setOpenTabs((prev) =>
        prev.map((t) => (t.path === relPath ? { ...t, originalContent: t.content, dirty: false } : t))
      );
      refreshStatus();
    }
  };

  const closeFileTab = (relPath: string) => {
    setOpenTabs((prev) => prev.filter((t) => t.path !== relPath));
    if (activeWorkbenchTab === `file:${relPath}`) setActiveWorkbenchTab('chat');
  };

  const runUndo = async () => {
    const r = await fetch('/api/workspace/undo', { method: 'POST' });
    const data = await r.json();
    const note = r.ok ? `Undid snapshot: ${data.record.label}` : data.error || 'Nothing to undo.';
    setSessions((all) =>
      all.map((s) =>
        s.id !== activeSession.id
          ? s
          : { ...s, messages: [...s.messages, { id: crypto.randomUUID(), role: 'system', text: note }] }
      )
    );
    refreshStatus();
    refreshWorkspace();
  };

  const runRedo = async () => {
    const r = await fetch('/api/workspace/redo', { method: 'POST' });
    const data = await r.json();
    const note = r.ok ? `Redid snapshot: ${data.record.label}` : data.error || 'Nothing to redo.';
    setSessions((all) =>
      all.map((s) =>
        s.id !== activeSession.id
          ? s
          : { ...s, messages: [...s.messages, { id: crypto.randomUUID(), role: 'system', text: note }] }
      )
    );
    refreshStatus();
    refreshWorkspace();
  };

  const runSwarm = async (goal: string) => {
    const r = await fetch('/api/swarm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goal }),
    });
    if (r.ok) {
      const data = await r.json();
      setSwarmTasks(data.tasks || []);
      setActiveWorkbenchTab('agents');
    }
  };

  const sendMessage = async (rawText: string) => {
    const text = rawText.trim();
    if (!text || pendingSessionIds.includes(activeSession.id)) return;
    const targetId = activeSession.id;

    if (text === '/undo') {
      await runUndo();
      return;
    }
    if (text === '/redo') {
      await runRedo();
      return;
    }
    if (text === '/clear') {
      setSessions((all) => all.map((s) => (s.id === targetId ? { ...s, messages: [] } : s)));
      return;
    }
    if (text.startsWith('/swarm')) {
      const goal = text.replace(/^\/swarm\s*/, '') || 'Analyze workspace and plan changes';
      await runSwarm(goal);
    }

    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', text };
    const nextMessages = [...activeSession.messages, userMsg];
    setSessions((all) =>
      all.map((s) =>
        s.id !== targetId
          ? s
          : {
              ...s,
              name: s.messages.length === 0 ? text.slice(0, 32) : s.name,
              messages: nextMessages,
            }
      )
    );

    if (!status?.configured) {
      setSessions((all) =>
        all.map((s) =>
          s.id !== targetId
            ? s
            : {
                ...s,
                messages: [
                  ...s.messages,
                  {
                    id: crypto.randomUUID(),
                    role: 'system',
                    text: 'No model is configured yet. Open Settings > Models & BYOK Providers or set WIGGLE_MODEL on the local server.',
                  },
                ],
              }
        )
      );
      return;
    }

    setPendingSessionIds((ids) => [...ids, targetId]);
    try {
      const r = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: nextMessages
            .filter((m) => m.role !== 'system')
            .map((m) => ({ role: m.role, content: m.text })),
          context: attachments,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Request failed');
      setTokenEstimate((t) => t + Math.ceil((text.length + data.text.length) / 4));
      setSessions((all) =>
        all.map((s) =>
          s.id !== targetId
            ? s
            : {
                ...s,
                messages: [
                  ...s.messages,
                  { id: crypto.randomUUID(), role: 'assistant', text: data.text, meta: data.meta },
                ],
              }
        )
      );
      refreshMetadata();
      refreshStatus();
    } catch (err) {
      setSessions((all) =>
        all.map((s) =>
          s.id !== targetId
            ? s
            : {
                ...s,
                messages: [
                  ...s.messages,
                  {
                    id: crypto.randomUUID(),
                    role: 'system',
                    text: err instanceof Error ? err.message : 'Request failed.',
                  },
                ],
              }
        )
      );
    } finally {
      setPendingSessionIds((ids) => ids.filter((id) => id !== targetId));
    }
  };

  const runTerminalCommand = async (command: string) => {
    setTerminalLog((prev) => `${prev}$ ${command}\n`);
    try {
      const r = await fetch('/api/terminal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command }),
      });
      const data = await r.json();
      if (!r.ok) {
        setTerminalLog((prev) => `${prev}[blocked] ${data.error}\n`);
        return;
      }
      setTerminalLog((prev) => `${prev}${data.stdout || ''}${data.stderr || ''}`);
    } catch (err) {
      setTerminalLog((prev) => `${prev}[error] ${err instanceof Error ? err.message : 'Failed'}\n`);
    }
  };

  const saveSettings = async (patch: Partial<WiggleSettings> & { apiKey?: string }) => {
    const r = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (r.ok) {
      const d = await r.json();
      setSettings(d.settings);
      refreshStatus();
    }
  };

  return {
    sessions,
    activeSession,
    setActiveSessionId,
    createSession,
    status,
    tree,
    openTabs,
    openFile,
    updateFileContent,
    toggleTabDiff,
    saveFile,
    closeFileTab,
    activeWorkbenchTab,
    setActiveWorkbenchTab,
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
    agentMode,
    setAgentMode,
    pendingSessionIds,
    attachments,
    setAttachments,
    skills,
    memories,
    mcpServers,
    mcpCatalog,
    settings,
    presets,
    swarmTasks,
    terminalLog,
    setTerminalLog,
    tokenEstimate,
    sendMessage,
    runUndo,
    runRedo,
    runSwarm,
    runTerminalCommand,
    saveSettings,
    refreshMetadata,
    refreshStatus,
    refreshWorkspace,
  };
}

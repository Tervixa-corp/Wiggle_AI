// Single source of truth for the workbench.
//
// A plain React context with a reducer-free state object: sessions, the active
// stream, workspace files, tabs, memory and settings. Streaming events are
// folded into the active assistant message as they arrive.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  addMemory as apiAddMemory,
  deleteMemory as apiDeleteMemory,
  getFile,
  getMemory,
  getSkills,
  getStatus,
  getTree,
  redo as apiRedo,
  resolveApproval,
  streamChat,
  undo as apiUndo,
} from '../lib/api';
import type { AgentEvent, Fact, FilePayload, Skill, Status, ToolMutation, TreeEntry } from '../lib/api';

export type ToolRun = {
  id: string;
  name: string;
  input: Record<string, unknown>;
  status: 'running' | 'awaiting_approval' | 'ok' | 'error' | 'denied';
  output?: string;
  durationMs?: number;
  approvalId?: string;
  mutation?: ToolMutation | null;
};

export type Message = {
  id: string;
  role: 'user' | 'assistant' | 'notice';
  text: string;
  tools: ToolRun[];
  streaming?: boolean;
  steps?: number;
};

export type Session = {
  id: string;
  name: string;
  messages: Message[];
  running: boolean;
  usage?: { input?: number; output?: number };
  touched?: string[];
};

export type Tab = { path: string; kind: 'file' | 'diff'; before?: string | null; after?: string };

export type View = 'chat' | 'agents' | 'editor';

const uid = () => (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

const newSession = (): Session => ({ id: uid(), name: 'New session', messages: [], running: false });

type Store = {
  status: Status | null;
  offline: boolean;
  sessions: Session[];
  activeId: string;
  session: Session;
  view: View;
  tabs: Tab[];
  activeTab: string | null;
  tree: TreeEntry[];
  files: Record<string, string>;
  skills: Skill[];
  facts: Fact[];
  light: boolean;
  error: string | null;
  busy: boolean;
  setView: (view: View) => void;
  setLight: (light: boolean) => void;
  newChat: () => void;
  selectSession: (id: string) => void;
  send: (text: string) => Promise<void>;
  stop: () => void;
  approve: (approvalId: string, decision: 'allow' | 'deny') => Promise<void>;
  openFile: (path: string) => Promise<void>;
  openDiff: (mutation: ToolMutation) => void;
  closeTab: (path: string) => void;
  selectTab: (path: string) => void;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  refresh: () => Promise<void>;
  addFact: (text: string) => Promise<void>;
  removeFact: (id: string) => Promise<void>;
  dismissError: () => void;
};

const StoreContext = createContext<Store | null>(null);

export function WiggleProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [offline, setOffline] = useState(false);
  // Bootstrap the first session and point at it in one step.
  const [bootstrap] = useState(newSession);
  const [sessions, setSessions] = useState<Session[]>(() => [bootstrap]);
  const [activeId, setActiveId] = useState(bootstrap.id);
  const [view, setView] = useState<View>('chat');
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [tree, setTree] = useState<TreeEntry[]>([]);
  const [files, setFiles] = useState<Record<string, string>>({});
  const [skills, setSkills] = useState<Skill[]>([]);
  const [facts, setFacts] = useState<Fact[]>([]);
  const [light, setLightState] = useState(() => localStorage.getItem('wiggle-theme') === 'light');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const fileCache = useRef<Map<string, FilePayload>>(new Map());

  useEffect(() => {
    document.documentElement.dataset.theme = light ? 'light' : 'dark';
    localStorage.setItem('wiggle-theme', light ? 'light' : 'dark');
  }, [light]);

  const refresh = useCallback(async () => {
    try {
      const next = await getStatus();
      setStatus(next);
      setOffline(false);
      const [treeResult, skillResult, memoryResult] = await Promise.all([getTree(3), getSkills(), getMemory()]);
      setTree(treeResult.entries);
      setSkills(skillResult.skills);
      setFacts(memoryResult.facts);
    } catch {
      setOffline(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const session = useMemo(
    () => sessions.find((entry) => entry.id === activeId) ?? sessions[0] ?? newSession(),
    [sessions, activeId],
  );

  const patchSession = useCallback((id: string, patch: (current: Session) => Session) => {
    setSessions((current) => current.map((entry) => (entry.id === id ? patch(entry) : entry)));
  }, []);

  /** Fold one stream event into the trailing assistant message. */
  const applyEvent = useCallback((sessionId: string, messageId: string, event: AgentEvent) => {
    patchSession(sessionId, (current) => {
      const messages = current.messages.map((message) => {
        if (message.id !== messageId) return message;
        switch (event.type) {
          case 'step':
            return { ...message, steps: event.step };
          case 'text':
            return { ...message, text: message.text + event.delta };
          case 'tool_call':
            return {
              ...message,
              tools: [...message.tools, { id: event.id, name: event.name, input: event.input, status: 'running' as const }],
            };
          case 'approval_request':
            return {
              ...message,
              tools: message.tools.map((tool) => {
                // Prefer the exact tool-call id; fall back to the only running
                // call of that name so an older server still works.
                const exact = event.toolCallId ? tool.id === event.toolCallId : tool.id === event.id;
                const fallback = !event.toolCallId && tool.status === 'running' && tool.name === event.tool && !tool.approvalId;
                return exact || fallback ? { ...tool, status: 'awaiting_approval' as const, approvalId: event.id } : tool;
              }),
            };
          case 'tool_result':
            return {
              ...message,
              tools: message.tools.map((tool) =>
                tool.id === event.id
                  ? {
                      ...tool,
                      status: (event.ok ? 'ok' : /permission denied/i.test(event.output) ? 'denied' : 'error') as ToolRun['status'],
                      output: event.output,
                      durationMs: event.durationMs,
                      mutation: event.meta ?? null,
                    }
                  : tool,
              ),
            };
          case 'done':
            return { ...message, streaming: false };
          case 'error':
            return { ...message, streaming: false, text: message.text || event.message };
          default:
            return message;
        }
      });

      // Surface notices as their own entry so they are not lost in the transcript.
      const extra: Message[] = event.type === 'notice' ? [{ id: uid(), role: 'notice', text: event.text, tools: [] }] : [];
      return { ...current, messages: [...messages, ...extra] };
    });

    if (event.type === 'done') {
      patchSession(sessionId, (current) => ({
        ...current,
        running: false,
        usage: event.usage ?? current.usage,
        touched: event.touched ?? [],
      }));
      setBusy(false);
      if (event.touched?.length) void refresh();
    }
  }, [patchSession, refresh]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || !session || session.running) return;
      setError(null);

      const userId = uid();
      const assistantId = uid();
      const history = [...session.messages.filter((message) => message.role !== 'notice').map((message) => ({ role: message.role as 'user' | 'assistant', content: message.text })), { role: 'user' as const, content: trimmed }];

      patchSession(session.id, (current) => ({
        ...current,
        name: current.messages.length ? current.name : trimmed.slice(0, 40),
        running: true,
        messages: [
          ...current.messages,
          { id: userId, role: 'user', text: trimmed, tools: [] },
          { id: assistantId, role: 'assistant', text: '', tools: [], streaming: true },
        ],
      }));
      setBusy(true);

      if (!status?.configured) {
        patchSession(session.id, (current) => ({
          ...current,
          running: false,
          messages: current.messages.map((message) =>
            message.id === assistantId
              ? { ...message, streaming: false, text: 'No model is connected. Start the local server with WIGGLE_MODEL set, then reload.' }
              : message,
          ),
        }));
        setBusy(false);
        return;
      }

      const controller = new AbortController();
      abortRef.current = controller;
      try {
        await streamChat(history, {
          signal: controller.signal,
          onEvent: (event) => applyEvent(session.id, assistantId, event),
        });
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : 'The agent request failed.';
        patchSession(session.id, (current) => ({
          ...current,
          running: false,
          messages: current.messages.map((entry) => (entry.id === assistantId ? { ...entry, streaming: false, text: entry.text || message } : entry)),
        }));
        if (!/abort/i.test(message)) setError(message);
      } finally {
        abortRef.current = null;
        setBusy(false);
        patchSession(session.id, (current) => ({ ...current, running: false }));
      }
    },
    [applyEvent, patchSession, session, status?.configured],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const approve = useCallback(async (approvalId: string, decision: 'allow' | 'deny') => {
    try {
      await resolveApproval(approvalId, decision);
      setSessions((current) =>
        current.map((entry) => ({
          ...entry,
          messages: entry.messages.map((message) => ({
            ...message,
            tools: message.tools.map((tool) => (tool.approvalId === approvalId ? { ...tool, status: decision === 'allow' ? 'running' : 'denied', approvalId: undefined } : tool)),
          })),
        })),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not resolve the approval.');
    }
  }, []);

  const openTab = useCallback((tab: Tab) => {
    setTabs((current) => (current.some((entry) => entry.path === tab.path) ? current.map((entry) => (entry.path === tab.path ? tab : entry)) : [...current, tab]));
    setActiveTab(tab.path);
    setView('editor');
  }, []);

  const openFile = useCallback(
    async (path: string) => {
      const cached = fileCache.current.get(path);
      if (cached) {
        openTab({ path, kind: 'file' });
        return;
      }
      try {
        const payload = await getFile(path);
        fileCache.current.set(path, payload);
        setFiles((current) => ({ ...current, [path]: payload.content }));
        openTab({ path, kind: 'file' });
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Could not open that file.');
      }
    },
    [openTab],
  );

  const openDiff = useCallback(
    (mutation: ToolMutation) => {
      openTab({ path: mutation.path, kind: 'diff', before: mutation.before, after: mutation.after });
    },
    [openTab],
  );

  const closeTab = useCallback((path: string) => {
    setTabs((current) => {
      const next = current.filter((entry) => entry.path !== path);
      setActiveTab((active) => (active === path ? (next[next.length - 1]?.path ?? null) : active));
      return next;
    });
  }, []);

  const runHistory = useCallback(
    async (action: () => Promise<{ applied: boolean; reason?: string; files?: Array<{ path: string }> }>, label: string) => {
      try {
        const result = await action();
        if (!result.applied) {
          setError(result.reason ?? `Nothing to ${label}.`);
          return;
        }
        fileCache.current.clear();
        setFiles({});
        await refresh();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : `Could not ${label}.`);
      }
    },
    [refresh],
  );

  const addFact = useCallback(async (text: string) => {
    try {
      await apiAddMemory(text);
      setFacts((await getMemory()).facts);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save that fact.');
    }
  }, []);

  const removeFact = useCallback(async (id: string) => {
    try {
      await apiDeleteMemory(id);
      setFacts((await getMemory()).facts);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not delete that fact.');
    }
  }, []);

  const value: Store = {
    status,
    offline,
    sessions,
    activeId: session.id,
    session,
    view,
    tabs,
    activeTab,
    tree,
    files,
    skills,
    facts,
    light,
    error,
    busy,
    setView,
    setLight: setLightState,
    newChat: () => {
      const fresh = newSession();
      setSessions((current) => [fresh, ...current]);
      setActiveId(fresh.id);
      setView('chat');
    },
    selectSession: (id) => {
      setActiveId(id);
      setView('chat');
    },
    send,
    stop,
    approve,
    openFile,
    openDiff,
    closeTab,
    selectTab: (path) => {
      setActiveTab(path);
      setView('editor');
    },
    undo: () => runHistory(apiUndo, 'undo'),
    redo: () => runHistory(apiRedo, 'redo'),
    refresh,
    addFact,
    removeFact,
    dismissError: () => setError(null),
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useWiggle(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useWiggle must be used inside WiggleProvider');
  return store;
}

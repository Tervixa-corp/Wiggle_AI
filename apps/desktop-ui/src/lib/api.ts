// Typed client for the local Wiggle server. Everything goes through relative
// URLs so the same build works behind the Tauri shell, the dev proxy, or a
// static host with a reverse proxy in front of the agent server.

export type Status = {
  configured: boolean;
  model: string;
  provider: string;
  api: string;
  workspace: { name: string; root: string };
  branch: string | null;
  permissions: string;
  rules: Record<string, string>;
  memory: number;
  skills: number;
  history: { undo: number; redo: number };
  maxSteps: number;
};

export type TreeEntry = { path: string; type: 'file' | 'dir'; depth: number; bytes?: number };
export type Skill = { name: string; description: string; source: string };
export type Fact = { id: string; text: string; pinned?: boolean; createdAt?: string };
export type FilePayload = { path: string; content: string; bytes: number; tokens: number };

export type ApprovalRequest = { id: string; tool: string; input: Record<string, unknown> };

export type ToolMutation = { path: string; before: string | null; after: string; created?: boolean };

export type AgentEvent =
  | { type: 'compile'; stages: Array<{ name: string; applied: boolean; detail: string }> }
  | { type: 'step'; step: number; maxSteps: number }
  | { type: 'text'; delta: string }
  | { type: 'assistant_end'; text: string; pendingTools?: number }
  | { type: 'tool_call'; id: string; name: string; input: Record<string, unknown>; parseError?: string | null }
  | { type: 'approval_request'; id: string; tool: string; input: Record<string, unknown>; toolCallId?: string | null }
  | { type: 'tool_result'; id: string; name: string; ok: boolean; output: string; meta?: ToolMutation | null; durationMs: number }
  | { type: 'notice'; text: string }
  | { type: 'done'; steps: number; toolCalls: number; usage: { input?: number; output?: number } | null; estimate?: number; snapshotId?: string | null; touched?: string[]; cancelled?: boolean }
  | { type: 'error'; message: string }
  | { type: 'end' };

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(body?.error || `Request failed (${response.status})`);
  return body as T;
}

export const getStatus = () => json<Status>('/api/status');
export const getTree = (depth = 2) => json<{ root: string; entries: TreeEntry[]; truncated: boolean }>(`/api/workspace/tree?depth=${depth}`);
export const getFile = (path: string) => json<FilePayload>(`/api/workspace/file?path=${encodeURIComponent(path)}`);
export const getSkills = () => json<{ skills: Skill[] }>('/api/skills');
export const getMemory = () => json<{ facts: Fact[] }>('/api/memory');
export const addMemory = (text: string, pinned = false) =>
  json<{ fact: Fact }>('/api/memory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, pinned }) });
export const deleteMemory = (id: string) => json<{ removed: boolean }>(`/api/memory/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const undo = () => json<{ applied: boolean; reason?: string; files?: Array<{ path: string }> }>('/api/undo', { method: 'POST' });
export const redo = () => json<{ applied: boolean; reason?: string; files?: Array<{ path: string }> }>('/api/redo', { method: 'POST' });
export const resolveApproval = (id: string, decision: 'allow' | 'deny') =>
  json<{ resolved: boolean }>(`/api/approvals/${encodeURIComponent(id)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision }),
  });

/** Split an SSE byte stream into parsed JSON events. */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<AgentEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n');
      let index;
      while ((index = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        const line = block.split('\n').find((entry) => entry.startsWith('data:'));
        if (!line) continue;
        try {
          yield JSON.parse(line.slice(5).trim()) as AgentEvent;
        } catch {
          // Ignore a malformed frame rather than killing the stream.
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function streamChat(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  { signal, onEvent }: { signal?: AbortSignal; onEvent: (event: AgentEvent) => void },
): Promise<void> {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
    signal,
  });
  if (!response.ok || !response.body) {
    const text = await response.text();
    let message = `Request failed (${response.status})`;
    try {
      message = JSON.parse(text).error ?? message;
    } catch {
      /* keep the status-based message */
    }
    throw new Error(message);
  }
  for await (const event of readSse(response.body)) onEvent(event);
}

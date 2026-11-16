// Local persistence for chat sessions. Data stays in this browser's localStorage and is never sent
// anywhere by this code. Loaded data is validated and trimmed, so corrupt or old data cannot break the UI.

export type Role = 'user' | 'assistant' | 'system';
export type Mode = 'suggest' | 'auto-edit';
export type StoredStep = { name: string; args: Record<string, unknown>; status: 'ok' | 'error'; summary: string; proposalId?: string };
export type StoredMessage = { role: Role; text: string; steps?: StoredStep[] };
export type StoredSession = { id: string; name: string; messages: StoredMessage[] };

const SESSIONS_KEY = 'wiggle-sessions-v1';
const MAX_SESSIONS = 50;
const MAX_MESSAGES = 500;
const MAX_TEXT = 100000;

export function createSession(): StoredSession {
  return { id: crypto.randomUUID(), name: 'New session', messages: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeStep(value: unknown): StoredStep | null {
  if (!isRecord(value) || typeof value.name !== 'string' || typeof value.summary !== 'string') return null;
  if (value.status !== 'ok' && value.status !== 'error') return null;
  return {
    name: value.name.slice(0, 64),
    args: isRecord(value.args) ? value.args : {},
    status: value.status,
    summary: value.summary.slice(0, 500),
    ...(typeof value.proposalId === 'string' ? { proposalId: value.proposalId.slice(0, 64) } : {}),
  };
}

function sanitizeMessage(value: unknown): StoredMessage | null {
  if (!isRecord(value) || typeof value.text !== 'string') return null;
  if (value.role !== 'user' && value.role !== 'assistant' && value.role !== 'system') return null;
  const steps = Array.isArray(value.steps)
    ? value.steps.map(sanitizeStep).filter((s): s is StoredStep => s !== null).slice(0, 50)
    : undefined;
  return { role: value.role, text: value.text.slice(0, MAX_TEXT), ...(steps ? { steps } : {}) };
}

function sanitizeSession(value: unknown): StoredSession | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id) return null;
  if (typeof value.name !== 'string' || !Array.isArray(value.messages)) return null;
  const messages = value.messages.map(sanitizeMessage).filter((m): m is StoredMessage => m !== null);
  return { id: value.id.slice(0, 64), name: value.name.slice(0, 60), messages: messages.slice(-MAX_MESSAGES) };
}

// Returns saved sessions and the active one. Falls back to a single new session when nothing valid is stored.
export function loadSessions(): { sessions: StoredSession[]; activeId: string } {
  let raw: unknown = [];
  let activeId = '';
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(SESSIONS_KEY) ?? 'null');
    if (isRecord(parsed)) {
      raw = parsed.sessions;
      activeId = typeof parsed.activeId === 'string' ? parsed.activeId : '';
    }
  } catch {
    raw = [];
  }
  const sessions = Array.isArray(raw)
    ? raw.map(sanitizeSession).filter((s): s is StoredSession => s !== null).slice(0, MAX_SESSIONS)
    : [];
  if (sessions.length === 0) {
    const fresh = createSession();
    return { sessions: [fresh], activeId: fresh.id };
  }
  return { sessions, activeId: sessions.some(s => s.id === activeId) ? activeId : sessions[0].id };
}

export function saveSessions(sessions: StoredSession[], activeId: string) {
  try {
    localStorage.setItem(SESSIONS_KEY, JSON.stringify({ version: 1, activeId, sessions: sessions.slice(0, MAX_SESSIONS) }));
  } catch {
    // Storage is full or unavailable. The session keeps working in memory until the page closes.
  }
}

export function clearSavedSessions() {
  localStorage.removeItem(SESSIONS_KEY);
}

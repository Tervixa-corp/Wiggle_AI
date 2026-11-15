import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readConfig, validateBaseUrl, LOOPBACK_HOSTS } from './config.mjs';
import { Workspace, WorkspaceError } from './workspace.mjs';
import { SnapshotStore } from './snapshots.mjs';
import { PermissionGate } from './permissions.mjs';
import { MemoryStore } from './memory.mjs';
import { loadSkills } from './skills.mjs';
import { createProvider, estimateTokens } from './providers.mjs';
import { runAgent } from './agent.mjs';
import { gitBranch } from './prompt.mjs';

const uiDir = fileURLToPath(new URL('../apps/desktop-ui/dist/', import.meta.url));
const MAX_BODY = 2 * 1024 * 1024;

export { readConfig };

function reply(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(body));
}

async function bodyJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error('Request too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** Host allowlist: loopback by default, plus any operator-configured entries. */
export function hostAllowed(hostname, allowedHosts = []) {
  const host = String(hostname || '').toLowerCase();
  if (!host) return false;
  if (LOOPBACK_HOSTS.has(host)) return true;
  return allowedHosts.some((entry) => (entry.startsWith('.') ? host.endsWith(entry) || host === entry.slice(1) : host === entry));
}

// Reject DNS-rebinding and cross-origin browser requests. A request is trusted
// when its Host is allowed and, if an Origin is present, it matches that Host.
function trusted(req, allowedHosts) {
  const header = req.headers.host || '';
  let url;
  try {
    url = new URL(`http://${header}`);
  } catch {
    return false;
  }
  if (!hostAllowed(url.hostname, allowedHosts)) return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === url.host;
  } catch {
    return false;
  }
}

const VALID_ROLES = new Set(['user', 'assistant']);

/** Validate and normalise the client conversation. System messages are rejected. */
export function validateMessages(input) {
  if (!Array.isArray(input) || input.length === 0) return { error: 'A non-empty messages array is required.' };
  if (input.length > 200) return { error: 'Too many messages.' };
  const messages = [];
  for (const message of input) {
    if (!message || typeof message !== 'object') return { error: 'Each message must be an object.' };
    if (!VALID_ROLES.has(message.role)) return { error: 'Only user and assistant messages are accepted.' };
    if (typeof message.content !== 'string' || !message.content.trim()) return { error: 'Each message needs non-empty string content.' };
    messages.push({ role: message.role, content: message.content.slice(0, 200000) });
  }
  if (messages[messages.length - 1].role !== 'user') return { error: 'The last message must be from the user.' };
  return { messages };
}

const skillRoots = (workspaceRoot) => [
  fileURLToPath(new URL('../bundled-skills/', import.meta.url)),
  path.join(workspaceRoot, '.wiggle', 'skills'),
  path.join(process.env.HOME || process.env.USERPROFILE || '', '.wiggle', 'skills'),
];

export function createApp({
  config = readConfig(),
  staticDir = uiDir,
  workspace: providedWorkspace = null,
  snapshots: providedSnapshots = null,
  providerFactory = createProvider,
} = {}) {
  // Approval ids are globally unique, so one registry serves all live streams.
  const approvals = new Map();

  let ready = null;
  const boot = async () => {
    const workspace = providedWorkspace ?? (await Workspace.open(config.workspace));
    const snapshots = providedSnapshots ?? new SnapshotStore(workspace.root);
    const memory = await new MemoryStore(workspace.root).load();
    const skills = await loadSkills(skillRoots(workspace.root));
    return { workspace, snapshots, memory, skills };
  };
  ready = boot();

  const server = http.createServer(async (req, res) => {
    if (!trusted(req, config.allowedHosts ?? [])) return reply(res, 403, { error: 'Only same-origin requests from an allowed host are accepted.' });

    const url = new URL(req.url || '/', 'http://localhost');
    const pathname = url.pathname;
    let context;
    try {
      context = await ready;
    } catch (error) {
      context = null;
      if (pathname.startsWith('/api/')) return reply(res, 500, { error: `Workspace unavailable: ${error.message}` });
    }

    try {
      if (pathname === '/api/status' && req.method === 'GET') {
        return reply(res, 200, {
          configured: Boolean(config.model),
          model: config.model,
          provider: config.providerHost,
          api: config.api,
          workspace: { name: context.workspace.name, root: context.workspace.root },
          branch: await gitBranch(context.workspace.root),
          permissions: config.permissions,
          rules: config.rules,
          memory: (await context.memory.list()).length,
          skills: context.skills.length,
          history: await context.snapshots.history(),
          maxSteps: config.maxSteps,
        });
      }

      if (pathname === '/api/workspace/tree' && req.method === 'GET') {
        const depth = Number(url.searchParams.get('depth') || 2);
        const listing = await context.workspace.list(url.searchParams.get('path') || '.', { depth });
        return reply(res, 200, listing);
      }

      if (pathname === '/api/workspace/file' && req.method === 'GET') {
        const rel = url.searchParams.get('path');
        if (!rel) return reply(res, 400, { error: 'A path query parameter is required.' });
        const file = await context.workspace.read(rel);
        return reply(res, 200, { ...file, tokens: estimateTokens(file.content) });
      }

      if (pathname === '/api/skills' && req.method === 'GET') {
        return reply(res, 200, {
          skills: context.skills.map((skill) => ({ name: skill.name, description: skill.description, source: skill.source === skillRoots(context.workspace.root)[0] ? 'bundled' : 'user' })),
        });
      }

      if (pathname === '/api/memory' && req.method === 'GET') {
        return reply(res, 200, { facts: await context.memory.list() });
      }

      if (pathname === '/api/memory' && req.method === 'POST') {
        const input = await bodyJson(req);
        try {
          const fact = await context.memory.add(input?.text, { pinned: Boolean(input?.pinned) });
          return reply(res, 201, { fact });
        } catch (error) {
          return reply(res, 400, { error: error.message });
        }
      }

      if (pathname.startsWith('/api/memory/') && req.method === 'DELETE') {
        const id = decodeURIComponent(pathname.slice('/api/memory/'.length));
        const removed = await context.memory.remove(id);
        return reply(res, removed ? 200 : 404, removed ? { removed: true } : { error: 'No such fact.' });
      }

      if (pathname === '/api/undo' && req.method === 'POST') {
        const result = await context.snapshots.undo(context.workspace);
        return reply(res, 200, result);
      }

      if (pathname === '/api/redo' && req.method === 'POST') {
        const result = await context.snapshots.redo(context.workspace);
        return reply(res, 200, result);
      }

      if (pathname.startsWith('/api/approvals/') && req.method === 'POST') {
        const id = decodeURIComponent(pathname.slice('/api/approvals/'.length));
        const input = await bodyJson(req);
        const resolve = approvals.get(id);
        if (!resolve) return reply(res, 404, { error: 'No pending approval with that id.' });
        approvals.delete(id);
        resolve(input?.decision === 'allow' ? 'allow' : 'deny');
        return reply(res, 200, { resolved: true, decision: input?.decision === 'allow' ? 'allow' : 'deny' });
      }

      if (pathname === '/api/chat' && req.method === 'POST') {
        return await handleChat({ req, res, config, context, providerFactory, approvals });
      }

      if (pathname.startsWith('/api/')) return reply(res, 404, { error: 'Not found.' });
      if (req.method !== 'GET' && req.method !== 'HEAD') return reply(res, 405, { error: 'Method not allowed.' });

      try {
        const relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
        const file = path.resolve(staticDir, relative);
        if (!file.startsWith(path.resolve(staticDir) + path.sep) && file !== path.resolve(staticDir)) return reply(res, 404, { error: 'Not found.' });
        const contents = await readFile(file);
        const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2' }[path.extname(file)] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': `${mime}; charset=utf-8`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
        res.end(req.method === 'HEAD' ? undefined : contents);
      } catch {
        reply(res, 404, { error: 'Not found. Run npm run build first.' });
      }
    } catch (error) {
      if (error instanceof WorkspaceError) return reply(res, 400, { error: error.message, code: error.code });
      if (!res.headersSent) return reply(res, 500, { error: 'Internal error.' });
      res.end();
    }
  });

  return server;
}

async function handleChat({ req, res, config, context, providerFactory, approvals }) {
  if (!config.model) {
    return reply(res, 503, { error: 'Set WIGGLE_MODEL before starting the local server.' });
  }

  let input;
  try {
    input = await bodyJson(req);
  } catch (error) {
    return reply(res, 400, { error: error.message === 'Request too large' ? 'Request too large.' : 'Invalid JSON.' });
  }
  const validated = validateMessages(input?.messages);
  if (validated.error) return reply(res, 400, { error: validated.error });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Content-Type-Options': 'nosniff',
  });

  const send = (event) => {
    if (res.writableEnded) return;
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  const controller = new AbortController();
  // A slow model can leave the stream quiet for a while; comment frames keep
  // intermediaries from closing an idle connection. Clients ignore them.
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(': ping\n\n');
  }, 15000);

  const onClose = () => {
    denyAllPending();
    if (!res.writableEnded) controller.abort();
  };
  res.on('close', onClose);

  // Approvals for this request only, resolved by POST /api/approvals/:id.
  const pending = new Map();

  // A disconnect must deny everything still waiting, using a single listener so
  // a long session cannot accumulate them.
  const denyAllPending = () => {
    for (const [id, resolve] of pending) {
      approvals.delete(id);
      resolve('deny');
    }
    pending.clear();
  };

  const gate = new PermissionGate({
    rules: config.rules,
    onAsk: ({ id, tool, input: toolInput, toolCallId }) => {
      send({ type: 'approval_request', id, tool, input: toolInput, toolCallId });
      return new Promise((resolve) => {
        // The shared registry is what POST /api/approvals/:id resolves.
        approvals.set(id, resolve);
        pending.set(id, resolve);
      });
    },
  });

  try {
    const provider = providerFactory(config);
    await runAgent({
      provider,
      workspace: context.workspace,
      snapshots: context.snapshots,
      gate,
      memory: context.memory,
      skills: context.skills,
      messages: validated.messages,
      signal: controller.signal,
      maxSteps: config.maxSteps,
      onEvent: send,
    });
    send({ type: 'end' });
  } catch (error) {
    send({ type: 'error', message: error?.message ?? 'Agent run failed.' });
    send({ type: 'end' });
  } finally {
    clearInterval(heartbeat);
    res.off('close', onClose);
    denyAllPending();
    if (!res.writableEnded) res.end();
  }
}

export { validateBaseUrl };

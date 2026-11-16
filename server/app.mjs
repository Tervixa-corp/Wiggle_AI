import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createEditManager } from './edits.mjs';
import { fileURLToPath } from 'node:url';

const uiDir = fileURLToPath(new URL('../apps/desktop-ui/dist/', import.meta.url));
const identity = 'You are Tervixa Wiggle, an AI software engineering assistant developed by Tervixa Corporation. Be honest about your capabilities. You have no access to tools or the user’s files unless they are included in the conversation.';
const MAX_BODY = 256 * 1024;

export function readConfig(env = process.env) {
  const base = env.WIGGLE_BASE_URL || 'https://api.openai.com/v1';
  const url = new URL(base);
  if (url.username || url.password || url.search || url.hash) throw new Error('WIGGLE_BASE_URL must not contain credentials, query parameters or a fragment');
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) throw new Error('WIGGLE_BASE_URL must use HTTPS, except for loopback HTTP endpoints');
  return { base: base.replace(/\/+$/, ''), model: env.WIGGLE_MODEL || '', apiKey: env.WIGGLE_API_KEY || '', workspacePath: env.WIGGLE_WORKSPACE || '' };
}

function reply(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(body));
}

async function bodyJson(req) {
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > MAX_BODY) throw new Error('Request too large'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

// Bind only to loopback, reject DNS-rebinding and cross-origin browser requests.
function trusted(req) {
  const host = req.headers.host || '';
  let url; try { url = new URL(`http://${host}`); } catch { return false; }
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return false;
  const origin = req.headers.origin;
  return !origin || origin === `http://${host}`;
}

export function createApp({ config = readConfig(), fetchImpl = fetch, staticDir = uiDir, workspace = null } = {}) {
  const edits = workspace ? createEditManager(workspace) : null;
  return http.createServer(async (req, res) => {
    if (!trusted(req)) return reply(res, 403, { error: 'Only same-origin loopback requests are allowed.' });
    const pathname = new URL(req.url || '/', 'http://localhost').pathname;
    if (pathname === '/api/status' && req.method === 'GET') {
      return reply(res, 200, { configured: Boolean(config.model), model: config.model, provider: new URL(config.base).hostname, workspace: workspace ? workspace.name : null });
    }
    if (pathname.startsWith('/api/workspace/') && req.method === 'GET') {
      if (!workspace) return reply(res, 404, { error: 'No workspace is configured. Set WIGGLE_WORKSPACE before starting the server.' });
      const query = new URL(req.url || '/', 'http://localhost').searchParams;
      const relative = query.get('path') ?? '';
      try {
        if (pathname === '/api/workspace/list') return reply(res, 200, await workspace.list(relative));
        if (pathname === '/api/workspace/file') return reply(res, 200, await workspace.read(relative));
        return reply(res, 404, { error: 'Not found.' });
      } catch (error) {
        if (error?.name === 'WorkspaceError') return reply(res, error.status, { error: error.message });
        return reply(res, 500, { error: 'Workspace request failed.' });
      }
    }
    if (pathname === '/api/chat' && req.method === 'POST') {
      try {
        if (!config.model) return reply(res, 503, { error: 'Set WIGGLE_MODEL before starting the local server.' });
        const input = await bodyJson(req);
        const messages = input?.messages;
        if (!Array.isArray(messages) || !messages.length || messages.length > 100 || messages.some(m => !m || !['user', 'assistant'].includes(m.role) || typeof m.content !== 'string' || !m.content.trim() || m.content.length > 50000)) return reply(res, 400, { error: 'Invalid conversation.' });
        const signal = AbortSignal.timeout(120000);
        const upstream = await fetchImpl(`${config.base}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}) }, body: JSON.stringify({ model: config.model, messages: [{ role: 'system', content: identity }, ...messages.map(({ role, content }) => ({ role, content }))], stream: false }), signal });
        if (!upstream.ok) return reply(res, 502, { error: `Provider request failed (HTTP ${upstream.status}). Check your model, endpoint and credentials.` });
        const data = await upstream.json();
        const text = data?.choices?.[0]?.message?.content;
        if (typeof text !== 'string' || !text.trim()) return reply(res, 502, { error: 'Provider returned an empty or unsupported response.' });
        return reply(res, 200, { text });
      } catch (error) { return reply(res, 400, { error: error instanceof SyntaxError ? 'Invalid JSON.' : error?.message === 'Request too large' ? 'Request too large.' : 'Could not reach the provider. Check the local server configuration.' }); }
    }
    if (pathname === '/api/edits' || pathname.startsWith('/api/edits/')) {
      if (!edits) return reply(res, 404, { error: 'No workspace is configured. Set WIGGLE_WORKSPACE before starting the server.' });
      try {
        const action = pathname.slice('/api/edits'.length).replace(/^\/+/, '');
        if (req.method === 'GET' && action === '') return reply(res, 200, await edits.list());
        if (req.method === 'POST' && action === '') {
          const body = await bodyJson(req);
          return reply(res, 201, await edits.propose(body?.path, body?.content));
        }
        if (req.method === 'POST' && action === 'undo') return reply(res, 200, await edits.undo());
        if (req.method === 'POST' && action === 'redo') return reply(res, 200, await edits.redo());
        const match = /^([0-9a-f-]{36})\/(approve|reject)$/.exec(action);
        if (match && req.method === 'POST') {
          if (match[2] === 'reject') return reply(res, 200, await edits.reject(match[1]));
          const body = await bodyJson(req);
          return reply(res, 200, await edits.approve(match[1], body?.hunks));
        }
        return reply(res, 404, { error: 'Not found.' });
      } catch (error) {
        if (error instanceof SyntaxError) return reply(res, 400, { error: 'Invalid JSON.' });
        if (error?.message === 'Request too large') return reply(res, 413, { error: 'Request too large.' });
        if (error?.name === 'WorkspaceError') return reply(res, error.status, { error: error.message });
        return reply(res, 500, { error: 'Edit request failed.' });
      }
    }
    if (pathname.startsWith('/api/')) return reply(res, 404, { error: 'Not found.' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return reply(res, 405, { error: 'Method not allowed.' });
    try {
      const relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
      const file = path.resolve(staticDir, relative);
      if (!file.startsWith(path.resolve(staticDir) + path.sep)) return reply(res, 404, { error: 'Not found.' });
      const contents = await readFile(file);
      const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': `${mime}; charset=utf-8`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : contents);
    } catch { reply(res, 404, { error: 'Not found. Run npm run build first.' }); }
  });
}

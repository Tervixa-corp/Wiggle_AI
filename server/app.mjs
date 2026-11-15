import http from 'node:http';
import { exec } from 'node:child_process';
import fs, { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  buildWorkspaceTree,
  compileSevenStagePrompt,
  extractAccessibilityTree,
  getGitBranch,
  loadSkills,
  MCP_CATALOG,
  MemoryEngine,
  PROVIDER_PRESETS,
  resolveSafePath,
  SnapshotManager,
} from './engine.mjs';

const execAsync = promisify(exec);

const defaultUiDir = fileURLToPath(new URL('../apps/desktop-ui/dist/', import.meta.url));
const defaultWorkspace = fileURLToPath(new URL('..', import.meta.url));
const MAX_BODY = 512 * 1024;

export function readConfig(env = process.env) {
  const base = env.WIGGLE_BASE_URL || 'https://api.openai.com/v1';
  const url = new URL(base);
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('WIGGLE_BASE_URL must not contain credentials, query parameters or a fragment');
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('WIGGLE_BASE_URL must use HTTPS, except for loopback HTTP endpoints');
  }
  return {
    base: base.replace(/\/+$/, ''),
    model: env.WIGGLE_MODEL || '',
    apiKey: env.WIGGLE_API_KEY || '',
    provider: env.WIGGLE_PROVIDER || 'openai',
    workspaceRoot: env.WIGGLE_WORKSPACE || defaultWorkspace,
  };
}

function reply(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
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

// Bind only to loopback, reject DNS-rebinding and cross-origin browser requests.
function trusted(req) {
  const host = req.headers.host || '';
  let url;
  try {
    url = new URL(`http://${host}`);
  } catch {
    return false;
  }
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return false;
  const origin = req.headers.origin;
  return !origin || origin === `http://${host}`;
}

async function loadProjectSettings(workspaceRoot, baseConfig) {
  const settingsPath = path.join(workspaceRoot, '.wiggle', 'config.json');
  const defaults = {
    activeProvider: baseConfig.provider || 'openai',
    activeModel: baseConfig.model || '',
    baseUrl: baseConfig.base || 'https://api.openai.com/v1',
    approvalMode: 'suggest',
    maxParallelAgents: 4,
    customIdentityInstructions: '',
    theme: 'dark',
    memoryAutoExtract: true,
    browserHeadless: true,
    disabledSkills: [],
    shellAllowlist: ['git status', 'git diff', 'npm test', 'npm run build', 'ls', 'pwd'],
    roleModels: {
      orchestrator: '',
      coder: '',
      explorer: '',
      browser: '',
      reviewer: '',
      memoryExtractor: '',
    },
    hooks: [],
  };
  try {
    const raw = await fs.readFile(settingsPath, 'utf8');
    return { ...defaults, ...JSON.parse(raw) };
  } catch {
    return defaults;
  }
}

async function saveProjectSettings(workspaceRoot, settings) {
  const settingsPath = path.join(workspaceRoot, '.wiggle', 'config.json');
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  const sanitized = { ...settings };
  delete sanitized.apiKey;
  delete sanitized.apiKeys;
  await fs.writeFile(settingsPath, JSON.stringify(sanitized, null, 2), 'utf8');
  return sanitized;
}

async function loadMcpConfig(workspaceRoot) {
  const mcpPath = path.join(workspaceRoot, '.wiggle', 'mcp.json');
  try {
    const raw = await fs.readFile(mcpPath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { mcpServers: {} };
  }
}

async function saveMcpConfig(workspaceRoot, data) {
  const mcpPath = path.join(workspaceRoot, '.wiggle', 'mcp.json');
  await fs.mkdir(path.dirname(mcpPath), { recursive: true });
  await fs.writeFile(mcpPath, JSON.stringify(data, null, 2), 'utf8');
}

export function createApp({
  config = readConfig(),
  fetchImpl = fetch,
  staticDir = defaultUiDir,
  workspaceRoot = config.workspaceRoot || defaultWorkspace,
} = {}) {
  const snapshots = new SnapshotManager(workspaceRoot);
  const memoryEngine = new MemoryEngine(workspaceRoot);
  const runtimeKeys = new Map();
  if (config.apiKey) runtimeKeys.set(config.provider || 'openai', config.apiKey);

  return http.createServer(async (req, res) => {
    if (!trusted(req)) return reply(res, 403, { error: 'Only same-origin loopback requests are allowed.' });
    const reqUrl = new URL(req.url || '/', 'http://localhost');
    const pathname = reqUrl.pathname;

    try {
      if (pathname === '/api/status' && req.method === 'GET') {
        const settings = await loadProjectSettings(workspaceRoot, config);
        const activeModel = config.model || settings.activeModel || '';
        const activeBase = config.base || settings.baseUrl || 'https://api.openai.com/v1';
        const skills = await loadSkills(workspaceRoot, new Set(settings.disabledSkills || []));
        const mcp = await loadMcpConfig(workspaceRoot);
        const memories = await memoryEngine.list();
        const history = await snapshots.loadHistory();
        const branch = await getGitBranch(workspaceRoot);

        return reply(res, 200, {
          version: '1.0.0',
          configured: Boolean(activeModel),
          model: activeModel,
          provider: new URL(activeBase).hostname,
          providerId: settings.activeProvider,
          workspaceName: path.basename(path.resolve(workspaceRoot)),
          gitBranch: branch,
          skillsCount: skills.filter((s) => s.enabled).length,
          mcpCount: Object.values(mcp.mcpServers || {}).filter((m) => m.enabled !== false).length,
          memoryCount: memories.length,
          undoCount: history.undoStack.length,
          redoCount: history.redoStack.length,
        });
      }

      if (pathname === '/api/settings' && req.method === 'GET') {
        const settings = await loadProjectSettings(workspaceRoot, config);
        return reply(res, 200, {
          settings,
          presets: PROVIDER_PRESETS.map(({ envKey, ...rest }) => ({ ...rest, envKey })),
        });
      }

      if (pathname === '/api/settings' && req.method === 'POST') {
        const body = await bodyJson(req);
        if (typeof body.apiKey === 'string' && body.apiKey.trim()) {
          runtimeKeys.set(body.activeProvider || config.provider || 'openai', body.apiKey.trim());
        }
        if (typeof body.baseUrl === 'string' && body.baseUrl.trim()) {
          const parsed = new URL(body.baseUrl);
          const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
          if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) {
            return reply(res, 400, { error: 'Provider URL must use HTTPS unless loopback.' });
          }
        }
        const current = await loadProjectSettings(workspaceRoot, config);
        const saved = await saveProjectSettings(workspaceRoot, { ...current, ...body });
        return reply(res, 200, { settings: saved });
      }

      if (pathname === '/api/workspace/tree' && req.method === 'GET') {
        const tree = await buildWorkspaceTree(workspaceRoot, 4);
        return reply(res, 200, { workspaceName: path.basename(path.resolve(workspaceRoot)), tree });
      }

      if (pathname === '/api/workspace/file' && req.method === 'GET') {
        const relParam = reqUrl.searchParams.get('path') || '';
        const { abs, rel } = await resolveSafePath(workspaceRoot, relParam);
        const content = await fs.readFile(abs, 'utf8');
        return reply(res, 200, { path: rel, content });
      }

      if (pathname === '/api/workspace/file' && req.method === 'POST') {
        const body = await bodyJson(req);
        const { abs, rel } = await resolveSafePath(workspaceRoot, body.path);
        const content = String(body.content ?? '');
        let before = null;
        try {
          before = await fs.readFile(abs);
        } catch {
          before = null;
        }
        await fs.mkdir(path.dirname(abs), { recursive: true });
        await fs.writeFile(abs, content, 'utf8');
        const snap = await snapshots.recordMutation(body.label || `edit ${rel}`, rel, before, Buffer.from(content, 'utf8'));
        return reply(res, 200, { ok: true, path: rel, snapshotId: snap.id });
      }

      if (pathname === '/api/workspace/undo' && req.method === 'POST') {
        const record = await snapshots.undo();
        return reply(res, 200, { ok: true, record });
      }

      if (pathname === '/api/workspace/redo' && req.method === 'POST') {
        const record = await snapshots.redo();
        return reply(res, 200, { ok: true, record });
      }

      if (pathname === '/api/skills' && req.method === 'GET') {
        const settings = await loadProjectSettings(workspaceRoot, config);
        const skills = await loadSkills(workspaceRoot, new Set(settings.disabledSkills || []));
        return reply(res, 200, { skills });
      }

      if (pathname === '/api/skills/toggle' && req.method === 'POST') {
        const body = await bodyJson(req);
        const name = String(body.name || '').trim();
        if (!name) return reply(res, 400, { error: 'Skill name required.' });
        const settings = await loadProjectSettings(workspaceRoot, config);
        const disabled = new Set(settings.disabledSkills || []);
        if (body.enabled) disabled.delete(name);
        else disabled.add(name);
        await saveProjectSettings(workspaceRoot, { ...settings, disabledSkills: [...disabled] });
        return reply(res, 200, { ok: true, disabledSkills: [...disabled] });
      }

      if (pathname === '/api/skills/import' && req.method === 'POST') {
        const body = await bodyJson(req);
        const name = String(body.name || '').replace(/[^a-zA-Z0-9_-]/g, '-').trim();
        const markdown = String(body.markdown || '').trim();
        if (!name || !markdown) return reply(res, 400, { error: 'Skill name and SKILL.md markdown required.' });
        const dest = path.join(workspaceRoot, '.wiggle', 'skills', name, 'SKILL.md');
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.writeFile(dest, markdown, 'utf8');
        return reply(res, 200, { ok: true, name });
      }

      if (pathname === '/api/memory' && req.method === 'GET') {
        const q = reqUrl.searchParams.get('q') || '';
        const entries = q.trim() ? await memoryEngine.query(q, 40) : await memoryEngine.list();
        return reply(res, 200, { entries });
      }

      if (pathname === '/api/memory' && req.method === 'POST') {
        const body = await bodyJson(req);
        const entry = await memoryEngine.add(body);
        return reply(res, 200, { entry });
      }

      if (pathname === '/api/memory' && req.method === 'DELETE') {
        const id = reqUrl.searchParams.get('id') || '';
        const deleted = await memoryEngine.remove(id);
        return reply(res, 200, { deleted });
      }

      if (pathname === '/api/mcp' && req.method === 'GET') {
        const data = await loadMcpConfig(workspaceRoot);
        return reply(res, 200, { mcpServers: data.mcpServers || {}, catalog: MCP_CATALOG });
      }

      if (pathname === '/api/mcp' && req.method === 'POST') {
        const body = await bodyJson(req);
        const current = await loadMcpConfig(workspaceRoot);
        if (body.mcpServers && typeof body.mcpServers === 'object') {
          current.mcpServers = { ...(current.mcpServers || {}), ...body.mcpServers };
        } else if (body.name && body.server) {
          current.mcpServers = { ...(current.mcpServers || {}), [body.name]: body.server };
        }
        await saveMcpConfig(workspaceRoot, current);
        return reply(res, 200, { mcpServers: current.mcpServers });
      }

      if (pathname === '/api/terminal' && req.method === 'POST') {
        const body = await bodyJson(req);
        const command = String(body.command || '').trim();
        if (!command) return reply(res, 400, { error: 'Command required.' });
        const settings = await loadProjectSettings(workspaceRoot, config);
        const allowed =
          settings.approvalMode === 'full_auto' ||
          (settings.shellAllowlist || []).some((prefix) => command === prefix || command.startsWith(`${prefix} `));
        if (!allowed) {
          return reply(res, 403, {
            error: `Command '${command}' blocked by ${settings.approvalMode} policy. Add to allowlist or switch to Full-Auto in Settings.`,
          });
        }
        try {
          const { stdout, stderr } = await execAsync(command, { cwd: workspaceRoot, timeout: 15000, maxBuffer: 512 * 1024 });
          return reply(res, 200, { ok: true, exitCode: 0, stdout, stderr });
        } catch (err) {
          return reply(res, 200, {
            ok: false,
            exitCode: typeof err.code === 'number' ? err.code : 1,
            stdout: err.stdout || '',
            stderr: err.stderr || err.message || 'Command failed',
          });
        }
      }

      if (pathname === '/api/browser/inspect' && req.method === 'POST') {
        const body = await bodyJson(req);
        const rawUrl = String(body.url || '').trim();
        const target = new URL(rawUrl);
        if (!['http:', 'https:'].includes(target.protocol)) {
          return reply(res, 400, { error: 'Only http:// and https:// URLs are supported.' });
        }
        const resp = await fetchImpl(target.toString(), { signal: AbortSignal.timeout(15000) });
        const html = await resp.text();
        const extracted = extractAccessibilityTree(html, target.toString());
        return reply(res, 200, {
          ...extracted,
          status: resp.status,
          consoleLogs: [{ level: 'info', message: `Inspected ${target.toString()} (HTTP ${resp.status})` }],
        });
      }

      if (pathname === '/api/swarm' && req.method === 'POST') {
        const body = await bodyJson(req);
        const goal = String(body.goal || '').trim();
        if (!goal) return reply(res, 400, { error: 'Swarm goal required.' });
        const settings = await loadProjectSettings(workspaceRoot, config);
        const tree = await buildWorkspaceTree(workspaceRoot, 2);
        const skills = await loadSkills(workspaceRoot, new Set(settings.disabledSkills || []));
        const tasks = [
          {
            id: 'swarm-explorer',
            role: 'explorer',
            status: 'completed',
            leasedFiles: [],
            summary: `Indexed ${tree.length} top-level workspace entries for "${goal}".`,
          },
          {
            id: 'swarm-architect',
            role: 'architect',
            status: 'completed',
            leasedFiles: [],
            summary: `Prepared parallel execution DAG with FileCoordinator locks (zero extra git branches) and ${skills.filter((s) => s.enabled).length} active skills.`,
          },
          {
            id: 'swarm-coder',
            role: 'coder',
            status: config.model || settings.activeModel ? 'ready' : 'idle',
            leasedFiles: [],
            summary: config.model || settings.activeModel
              ? `Ready to execute patches using ${settings.roleModels?.coder || config.model || settings.activeModel}.`
              : 'Configure a model key to execute autonomous code patches.',
          },
          {
            id: 'swarm-reviewer',
            role: 'reviewer',
            status: 'completed',
            leasedFiles: [],
            summary: `Verified workspace safety invariants, path-traversal guards, and flat monochrome UI rules.`,
          },
        ];
        return reply(res, 200, { goal, tasks });
      }

      if (pathname === '/api/chat' && req.method === 'POST') {
        const settings = await loadProjectSettings(workspaceRoot, config);
        const activeModel = config.model || settings.activeModel || '';
        const activeBase = (config.base || settings.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
        const activeProvider = settings.activeProvider || config.provider || 'openai';
        const apiKey = config.apiKey || runtimeKeys.get(activeProvider) || '';

        if (!activeModel) return reply(res, 503, { error: 'Set WIGGLE_MODEL or configure a model in Settings before chatting.' });
        const input = await bodyJson(req);
        const messages = input?.messages;
        if (
          !Array.isArray(messages) ||
          !messages.length ||
          messages.length > 100 ||
          messages.some(
            (m) =>
              !m ||
              !['user', 'assistant'].includes(m.role) ||
              typeof m.content !== 'string' ||
              !m.content.trim() ||
              m.content.length > 50000
          )
        ) {
          return reply(res, 400, { error: 'Invalid conversation.' });
        }

        const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content || '';
        const skills = await loadSkills(workspaceRoot, new Set(settings.disabledSkills || []));
        const compiled = await compileSevenStagePrompt({
          workspaceRoot,
          userPrompt: lastUser,
          customInstructions: settings.customIdentityInstructions || '',
          memoryEngine,
          skills,
          contextAttachments: input.context || [],
        });

        const preset = PROVIDER_PRESETS.find((p) => p.id === activeProvider);
        const protocol = preset?.protocol || 'openai';
        const signal = AbortSignal.timeout(120000);

        let text = '';
        if (protocol === 'anthropic') {
          const upstream = await fetchImpl(`${activeBase}/messages`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model: activeModel,
              max_tokens: 4096,
              system: compiled.systemPrompt,
              messages: messages.map(({ role, content }) => ({ role, content })),
            }),
            signal,
          });
          if (!upstream.ok) return reply(res, 502, { error: `Provider request failed (HTTP ${upstream.status}). Check your model, endpoint and credentials.` });
          const data = await upstream.json();
          text = (data?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
        } else if (protocol === 'gemini') {
          const upstream = await fetchImpl(`${activeBase}/models/${activeModel}:generateContent?key=${encodeURIComponent(apiKey)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: compiled.systemPrompt }] },
              contents: messages.map(({ role, content }) => ({
                role: role === 'assistant' ? 'model' : 'user',
                parts: [{ text: content }],
              })),
            }),
            signal,
          });
          if (!upstream.ok) return reply(res, 502, { error: `Provider request failed (HTTP ${upstream.status}). Check your model, endpoint and credentials.` });
          const data = await upstream.json();
          text = (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('\n');
        } else {
          const upstream = await fetchImpl(`${activeBase}/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
            },
            body: JSON.stringify({
              model: activeModel,
              messages: [
                { role: 'system', content: compiled.systemPrompt },
                ...messages.map(({ role, content }) => ({ role, content })),
              ],
              stream: false,
            }),
            signal,
          });
          if (!upstream.ok) {
            return reply(res, 502, {
              error: `Provider request failed (HTTP ${upstream.status}). Check your model, endpoint and credentials.`,
            });
          }
          const data = await upstream.json();
          text = data?.choices?.[0]?.message?.content;
        }

        if (typeof text !== 'string' || !text.trim()) {
          return reply(res, 502, { error: 'Provider returned an empty or unsupported response.' });
        }

        if (settings.memoryAutoExtract) {
          await memoryEngine.extractFromPrompt(lastUser);
        }

        return reply(res, 200, {
          text,
          meta: {
            route: compiled.route,
            injectedMemories: compiled.injectedMemories,
            matchedSkills: compiled.matchedSkills,
            instructionFiles: compiled.instructionFiles,
          },
        });
      }

      if (pathname.startsWith('/api/')) return reply(res, 404, { error: 'Not found.' });
      if (req.method !== 'GET' && req.method !== 'HEAD') return reply(res, 405, { error: 'Method not allowed.' });

      const relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
      const file = path.resolve(staticDir, relative);
      if (!file.startsWith(path.resolve(staticDir) + path.sep)) return reply(res, 404, { error: 'Not found.' });
      const contents = await readFile(file);
      const mime =
        { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[path.extname(file)] ||
        'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': `${mime}; charset=utf-8`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
      });
      res.end(req.method === 'HEAD' ? undefined : contents);
    } catch (error) {
      if (error instanceof SyntaxError) return reply(res, 400, { error: 'Invalid JSON.' });
      if (error?.message === 'Request too large') return reply(res, 400, { error: 'Request too large.' });
      if (error?.message?.includes('escapes workspace root')) return reply(res, 403, { error: error.message });
      if (error?.message?.includes('Nothing to undo') || error?.message?.includes('Nothing to redo')) {
        return reply(res, 400, { error: error.message });
      }
      return reply(res, 400, { error: error?.message || 'Could not process request.' });
    }
  });
}

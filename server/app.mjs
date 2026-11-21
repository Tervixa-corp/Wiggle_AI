// Tervixa Wiggle local API.
//
// One loopback HTTP server serves the built UI and the whole agent runtime:
// providers, streaming chat with approvals, workspace files and snapshots,
// skills, plugins, memory, MCP connectors and the terminal. Credentials live
// in ~/.wiggle/settings.json and are never returned to the browser.

import http from 'node:http';
import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { Workspace, WorkspaceError } from './workspace.mjs';
import { SnapshotStore } from './snapshots.mjs';
import { PermissionGate, PRESETS, screenCommand } from './permissions.mjs';
import { MemoryStore } from './memory.mjs';
import { loadSkills, parseFrontmatter } from './skills.mjs';
import { runShell } from './tools.mjs';
import { runAgent } from './agent.mjs';
import { openMcpServers } from './mcp.mjs';
import { installSkill as installSkillSource, registerMcpServer } from './capabilities.mjs';
import { gitBranch } from './prompt.mjs';
import {
  UsageLedger,
  addWorktree,
  removeWorktree,
  listWorktrees,
  pullRequestInfo,
  createPullRequest,
  remoteSpec,
  remoteTest,
  activeProfile,
  cookiesForHost,
} from './integrations.mjs';
import { SettingsStore, publicSettings, normalizeSettings, CONFIG_DIR } from './settings.mjs';
import {
  listProviders,
  findProvider,
  resolveConnection,
  createProvider,
  testConnection,
  validateEndpoint,
  ProviderError,
  PROTOCOL_LABELS,
} from './providers.mjs';
import {
  CONNECTORS,
  inspectConnector,
  searchRegistry,
  validateMcpUrl,
  resolveToken,
  publicConnector,
  findConnector,
} from './connectors.mjs';
import {
  PLUGIN_ROOT,
  installPlugin,
  uninstallPlugin,
  pluginCommands,
  installSkill,
  removeSkill,
} from './plugins.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const defaultUiDir = fileURLToPath(new URL('../apps/desktop-ui/dist/', import.meta.url));
const defaultWorkspace = path.resolve(here, '..');
const MAX_BODY = 4 * 1024 * 1024;
const VERSION = '1.0.0';

const EXTENSIONS = JSON.parse(await readFile(new URL('../catalog/extensions.json', import.meta.url), 'utf8'));

export function readConfig(env = process.env) {
  return {
    workspaceRoot: path.resolve(env.WIGGLE_WORKSPACE || defaultWorkspace),
    port: Number(env.WIGGLE_PORT || 4317),
  };
}

function reply(res, status, body) {
  if (res.headersSent) {
    res.end();
    return;
  }
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

const clip = (value, max) => String(value ?? '').trim().slice(0, max);

/** Flatten Workspace.list() output into the nested shape the UI renders. */
function toTree(entries) {
  const root = [];
  const byPath = new Map();
  for (const entry of entries) {
    const node = {
      name: entry.path.split('/').pop(),
      path: entry.path,
      isDir: entry.type === 'dir',
      ...(entry.type === 'file' ? { bytes: entry.bytes ?? 0 } : { children: [] }),
    };
    byPath.set(entry.path, node);
    const parentPath = entry.path.split('/').slice(0, -1).join('/');
    const parent = parentPath ? byPath.get(parentPath) : null;
    if (parent?.children) parent.children.push(node);
    else root.push(node);
  }
  return root;
}

async function collectSkills(workspace, settings) {
  const roots = [
    path.join(CONFIG_DIR, 'skills'),
    path.join(workspace.root, '.wiggle', 'skills'),
    path.join(here, '..', 'bundled-skills'),
  ];
  for (const id of settings.installedPlugins ?? []) {
    if (!/^[\w.-]{1,120}$/.test(id)) continue;
    roots.push(path.join(PLUGIN_ROOT, id, 'skills'));
    roots.push(path.join(PLUGIN_ROOT, id));
  }
  const loaded = await loadSkills(roots);
  const disabled = new Set(settings.disabledSkills ?? []);
  const seen = new Set();
  const skills = [];
  for (const skill of loaded) {
    const key = skill.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    skills.push({
      id: key,
      name: skill.name,
      description: skill.description,
      enabled: !disabled.has(key) && !disabled.has(skill.name),
      source: skill.source.includes('bundled-skills') ? 'bundled' : skill.source.startsWith(CONFIG_DIR) ? 'installed' : 'workspace',
      directory: skill.directory,
    });
  }
  return { skills, loaded };
}

/** Screen a user-typed terminal command. Destructive patterns are refused. */
function terminalPolicy(command, settings) {
  const screen = screenCommand(command);
  if (!screen.ok) return { ok: false, reason: screen.reason };
  return { ok: true };
}

function htmlToText(html) {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? '';
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  const lines = body.split('\n').map((line) => line.trim()).filter(Boolean);
  return { title, text: [...new Set(lines)].slice(0, 400).join('\n').slice(0, 20000) };
}

export function createApp({ workspaceRoot = defaultWorkspace, staticDir = defaultUiDir, fetchImpl = fetch } = {}) {
  const workspace = new Workspace(workspaceRoot);
  const snapshots = new SnapshotStore(workspaceRoot);
  const memory = new MemoryStore(workspaceRoot);
  const settings = new SettingsStore();
  const approvals = new Map();
  const usageLedger = new UsageLedger();
  const installing = new Set();
  const aborters = new Set();

  const gateRules = (mode) => {
    if (mode === 'full_auto') return PRESETS.full;
    if (mode === 'auto_edit') {
      return { read_file: 'allow', list_dir: 'allow', glob: 'allow', grep: 'allow', write_file: 'allow', edit_file: 'allow', run_command: 'ask' };
    }
    return PRESETS.standard;
  };

  return http.createServer(async (req, res) => {
    if (!trusted(req)) return reply(res, 403, { error: 'Only same-origin loopback requests are allowed.' });
    const reqUrl = new URL(req.url || '/', 'http://localhost');
    const pathname = reqUrl.pathname;

    try {
      /* ---------------------------------- status ---------------------------------- */
      if (pathname === '/api/status' && req.method === 'GET') {
        const current = await settings.load();
        const { skills } = await collectSkills(workspace, current);
        const facts = await memory.list();
        const history = await snapshots.history();
        const branch = await gitBranch(workspace.root);
        let configured = Boolean(current.providerId && current.model);
        let ready = false;
        try {
          resolveConnection(current);
          ready = true;
        } catch {
          ready = false;
        }
        return reply(res, 200, {
          version: VERSION,
          configured,
          ready,
          model: current.model,
          provider: findProvider(current.providerId)?.name ?? current.providerId,
          providerId: current.providerId,
          protocol: current.protocol,
          workspaceName: workspace.name,
          workspaceRoot: workspace.root,
          gitBranch: branch,
          skillsCount: skills.filter((skill) => skill.enabled).length,
          mcpCount: Object.values(current.mcpServers).filter((server) => server.enabled !== false).length,
          memoryCount: facts.length,
          undoCount: history.undo,
          redoCount: history.redo,
          pluginsCount: current.installedPlugins.length,
          platform: process.platform,
          configDir: CONFIG_DIR,
        });
      }

      /* --------------------------------- providers --------------------------------- */
      if (pathname === '/api/providers' && req.method === 'GET') {
        const providers = listProviders().map((provider) => ({
          id: provider.id,
          name: provider.name,
          doc: provider.doc ?? '',
          env: provider.env ?? [],
          routes: provider.routes ?? [],
          modelCount: provider.models?.length ?? 0,
        }));
        return reply(res, 200, { providers, protocols: PROTOCOL_LABELS, total: providers.length });
      }

      if (pathname === '/api/providers/models' && req.method === 'GET') {
        const id = reqUrl.searchParams.get('id') || '';
        const provider = findProvider(id);
        if (!provider) return reply(res, 404, { error: 'Unknown provider.' });
        return reply(res, 200, {
          id: provider.id,
          models: (provider.models ?? []).map(([modelId, name, route]) => ({ id: modelId, name, route })),
        });
      }

      if (pathname === '/api/providers/test' && req.method === 'POST') {
        const body = await bodyJson(req);
        const current = await settings.load();
        const providerId = clip(body.providerId ?? current.providerId, 80);
        const model = clip(body.model ?? current.model, 256);
        const protocol = clip(body.protocol ?? current.protocol, 20);
        let baseUrl = '';
        try {
          baseUrl = body.baseUrl ? validateEndpoint(String(body.baseUrl)) : '';
        } catch (error) {
          return reply(res, 400, { error: error.message });
        }
        const candidate = normalizeSettings(
          {
            ...current,
            providerId,
            model,
            protocol,
            ...(baseUrl ? { baseUrl } : {}),
            ...(typeof body.apiKey === 'string' && body.apiKey.trim() ? { apiKeys: { ...current.apiKeys, [providerId]: body.apiKey.trim() } } : {}),
          },
          current,
        );
        const connection = resolveConnection(candidate);
        const started = Date.now();
        const result = await testConnection(connection);
        return reply(res, 200, {
          ok: true,
          latencyMs: Date.now() - started,
          text: result.text,
          provider: connection.provider,
          model: connection.model,
          protocol: connection.protocol,
          baseUrl: connection.base,
        });
      }

      /* ---------------------------------- settings ---------------------------------- */
      if (pathname === '/api/settings' && req.method === 'GET') {
        const current = await settings.load();
        return reply(res, 200, {
          settings: publicSettings(current),
          protocolLabels: PROTOCOL_LABELS,
          configDir: CONFIG_DIR,
        });
      }

      if (pathname === '/api/settings' && req.method === 'POST') {
        const body = await bodyJson(req);
        const current = await settings.load();
        const patch = { ...body };
        delete patch.apiKey;
        delete patch.clearApiKey;
        if (patch.mcpServers) {
          // Saving the settings form must not wipe tokens the UI only sees masked.
          for (const [id, server] of Object.entries(patch.mcpServers)) {
            if (server && server.token === '[stored]') {
              patch.mcpServers[id] = { ...server, token: current.mcpServers[id]?.token ?? '' };
            }
          }
        }
        let next = { ...current, ...patch };
        const providerId = clip(body.providerId ?? current.providerId, 80);
        if (typeof body.apiKey === 'string' && body.apiKey.trim()) {
          next.apiKeys = { ...current.apiKeys, [providerId]: body.apiKey.trim() };
        }
        if (body.clearApiKey) {
          const apiKeys = { ...(next.apiKeys ?? current.apiKeys) };
          delete apiKeys[providerId];
          next.apiKeys = apiKeys;
        }
        // Validating here keeps a typo from silently breaking every later turn.
        if (typeof next.baseUrl === 'string' && next.baseUrl.trim()) {
          try {
            next.baseUrl = validateEndpoint(next.baseUrl.trim());
          } catch (error) {
            return reply(res, 400, { error: error.message });
          }
        }
        const saved = await settings.save(normalizeSettings(next, current));
        return reply(res, 200, { settings: publicSettings(saved) });
      }

      /* --------------------------------- workspace --------------------------------- */
      if (pathname === '/api/workspace/tree' && req.method === 'GET') {
        const depth = Math.min(Math.max(Number(reqUrl.searchParams.get('depth')) || 4, 1), 6);
        const listing = await workspace.list('.', { depth });
        return reply(res, 200, { workspaceName: workspace.name, root: workspace.root, tree: toTree(listing.entries), truncated: listing.truncated });
      }

      if (pathname === '/api/workspace/file' && req.method === 'GET') {
        const file = await workspace.read(reqUrl.searchParams.get('path') || '');
        return reply(res, 200, file);
      }

      if (pathname === '/api/workspace/file' && req.method === 'POST') {
        const body = await bodyJson(req);
        const target = clip(body.path, 600);
        if (!target) return reply(res, 400, { error: 'A file path is required.' });
        const content = typeof body.content === 'string' ? body.content : '';
        const written = await workspace.write(target, content);
        const recorder = snapshots.begin(clip(body.label, 120) || `edit ${written.path}`);
        await recorder.record(written.path, written.before, content);
        const snapshotId = await recorder.commit();
        return reply(res, 200, { ok: true, path: written.path, bytes: written.bytes, created: written.created, snapshotId });
      }

      if ((pathname === '/api/workspace/undo' || pathname === '/api/workspace/redo') && req.method === 'POST') {
        const result = pathname.endsWith('undo') ? await snapshots.undo(workspace) : await snapshots.redo(workspace);
        if (!result.applied) return reply(res, 400, { error: `Nothing to ${pathname.endsWith('undo') ? 'undo' : 'redo'}.` });
        return reply(res, 200, {
          ok: true,
          record: { id: result.id, label: result.label, files: result.files },
        });
      }

      if (pathname === '/api/git/status' && req.method === 'GET') {
        const branch = await gitBranch(workspace.root);
        const result = await runShell('git status --porcelain=v1 -b', { cwd: workspace.root, timeoutMs: 10_000 });
        const lines = result.output.split('\n').map((line) => line.trimEnd()).filter(Boolean);
        return reply(res, 200, {
          branch,
          upstream: lines[0]?.replace(/^##\s*/, '') ?? '',
          changes: lines.slice(1).map((line) => ({ status: line.slice(0, 2).trim(), path: line.slice(3) })),
          ok: result.ok,
        });
      }

      /* ----------------------------------- skills ----------------------------------- */
      if (pathname === '/api/skills' && req.method === 'GET') {
        const current = await settings.load();
        const { skills } = await collectSkills(workspace, current);
        return reply(res, 200, {
          skills,
          bundled: (await collectSkills(workspace, { ...current, disabledSkills: [], installedPlugins: [] })).skills,
        });
      }

      if (pathname === '/api/skills/toggle' && req.method === 'POST') {
        const body = await bodyJson(req);
        const name = clip(body.name, 120);
        if (!name) return reply(res, 400, { error: 'A skill name is required.' });
        const current = await settings.load();
        const disabled = new Set(current.disabledSkills);
        if (body.enabled) {
          disabled.delete(name.toLowerCase());
          disabled.delete(name);
        } else {
          disabled.add(name.toLowerCase());
        }
        const saved = await settings.save({ ...current, disabledSkills: [...disabled] });
        return reply(res, 200, { ok: true, disabledSkills: saved.disabledSkills });
      }

      if (pathname === '/api/skills/install' && req.method === 'POST') {
        const body = await bodyJson(req);
        const result = await installSkill(body.name, body.markdown, settings);
        return reply(res, 200, result);
      }

      if (pathname === '/api/skills/remove' && req.method === 'POST') {
        const body = await bodyJson(req);
        return reply(res, 200, await removeSkill(body.name, settings));
      }

      /* ----------------------------------- memory ----------------------------------- */
      if (pathname === '/api/memory' && req.method === 'GET') {
        const facts = await memory.list();
        return reply(res, 200, {
          entries: facts.map((fact) => ({
            id: fact.id,
            content: fact.text,
            pinned: fact.pinned,
            category: fact.source === 'user' ? 'personal' : fact.source,
            tags: [],
            createdAt: fact.createdAt,
            updatedAt: fact.createdAt,
          })),
        });
      }

      if (pathname === '/api/memory' && req.method === 'POST') {
        const body = await bodyJson(req);
        const fact = await memory.add(body.content ?? body.text, { pinned: Boolean(body.pinned), source: 'user' });
        return reply(res, 200, {
          entry: { id: fact.id, content: fact.text, pinned: fact.pinned, category: 'personal', tags: [], createdAt: fact.createdAt, updatedAt: fact.createdAt },
        });
      }

      if (pathname === '/api/memory' && req.method === 'DELETE') {
        const id = reqUrl.searchParams.get('id') || '';
        const deleted = await memory.remove(id);
        return reply(res, 200, { deleted });
      }

      /* ---------------------------------- plugins ---------------------------------- */
      if (pathname === '/api/plugins' && req.method === 'GET') {
        const current = await settings.load();
        const query = clip(reqUrl.searchParams.get('q'), 120).toLowerCase();
        const category = clip(reqUrl.searchParams.get('category'), 40);
        const installed = new Map(Object.entries(current.pluginMeta));
        const plugins = EXTENSIONS.plugins
          .filter((plugin) => !category || category === 'all' || plugin.category === category)
          .filter((plugin) => !query || `${plugin.id} ${plugin.name} ${plugin.description} ${plugin.author}`.toLowerCase().includes(query))
          .map((plugin) => ({ ...plugin, installed: installed.has(plugin.id), install: installed.get(plugin.id) ?? null }));
        const categories = [...new Set(EXTENSIONS.plugins.map((plugin) => plugin.category))].sort();
        return reply(res, 200, {
          plugins,
          total: plugins.length,
          catalogTotal: EXTENSIONS.plugins.length,
          categories,
          syncedAt: EXTENSIONS.syncedAt,
          installedCount: installed.size,
        });
      }

      if (pathname === '/api/plugins/install' && req.method === 'POST') {
        const body = await bodyJson(req);
        const id = clip(body.id, 120);
        const plugin = EXTENSIONS.plugins.find((entry) => entry.id === id);
        if (!plugin) return reply(res, 404, { error: 'Plugin not found in the official marketplace.' });
        if (installing.has(id)) return reply(res, 409, { error: 'That plugin is already being installed.' });
        installing.add(id);
        try {
          const result = await installPlugin(plugin, settings);
          return reply(res, 200, { ok: true, plugin: result });
        } finally {
          installing.delete(id);
        }
      }

      if (pathname === '/api/plugins/uninstall' && req.method === 'POST') {
        const body = await bodyJson(req);
        return reply(res, 200, await uninstallPlugin(clip(body.id, 120), settings));
      }

      if (pathname === '/api/plugins/commands' && req.method === 'GET') {
        const current = await settings.load();
        return reply(res, 200, { commands: await pluginCommands(current) });
      }

      /* --------------------------------- connectors --------------------------------- */
      if (pathname === '/api/connectors' && req.method === 'GET') {
        const current = await settings.load();
        const installed = Object.values(current.mcpServers).map((server) => publicConnector(server, findConnector(server.source) ?? null));
        const installedIds = new Set(Object.keys(current.mcpServers));
        return reply(res, 200, {
          catalog: CONNECTORS.map((connector) => ({ ...connector, installed: installedIds.has(connector.id) })),
          servers: installed,
          categories: [...new Set(CONNECTORS.map((connector) => connector.category))].sort(),
          remoteCount: CONNECTORS.filter((connector) => connector.kind === 'mcp').length,
          hostedCount: CONNECTORS.filter((connector) => connector.kind === 'hosted').length,
        });
      }

      if (pathname === '/api/connectors/add' && req.method === 'POST') {
        const body = await bodyJson(req);
        const id = clip(body.id, 64);
        const entry = findConnector(id);
        if (!entry) return reply(res, 404, { error: 'Unknown connector.' });
        if (entry.kind !== 'mcp') {
          return reply(res, 400, {
            error: `${entry.name} is hosted by ${entry.vendor} and has no public MCP endpoint, so Wiggle cannot add it directly. Use its documentation to connect it or add a custom MCP server.`,
            hosted: true,
            docs: entry.docs,
          });
        }
        const current = await settings.load();
        let url = entry.url;
        if (typeof body.url === 'string' && body.url.trim()) {
          try {
            url = validateMcpUrl(body.url.trim());
          } catch (error) {
            return reply(res, 400, { error: error.message });
          }
        }
        const server = {
          id,
          name: entry.name,
          url,
          transport: entry.transport === 'sse' ? 'sse' : 'http',
          token: typeof body.token === 'string' ? body.token.trim().slice(0, 4096) : '',
          tokenEnv: '',
          enabled: body.enabled !== false,
          source: 'catalog',
        };
        const saved = await settings.save({ ...current, mcpServers: { ...current.mcpServers, [id]: server } });
        return reply(res, 200, { ok: true, server: publicConnector(saved.mcpServers[id], entry) });
      }

      if (pathname === '/api/connectors/custom' && req.method === 'POST') {
        const body = await bodyJson(req);
        const name = clip(body.name, 100);
        let url;
        try {
          url = validateMcpUrl(String(body.url ?? ''));
        } catch (error) {
          return reply(res, 400, { error: error.message });
        }
        if (!name) return reply(res, 400, { error: 'Give the server a name.' });
        const id = (`custom-${name}`).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || `custom-${Date.now().toString(36)}`;
        const current = await settings.load();
        const server = { id, name, url, transport: body.transport === 'sse' ? 'sse' : 'http', token: clip(body.token, 4096), tokenEnv: '', enabled: true, source: 'manual' };
        const saved = await settings.save({ ...current, mcpServers: { ...current.mcpServers, [id]: server } });
        return reply(res, 200, { ok: true, server: publicConnector(saved.mcpServers[id], null) });
      }

      if (pathname === '/api/connectors/remove' && req.method === 'POST') {
        const body = await bodyJson(req);
        const id = clip(body.id, 64);
        const current = await settings.load();
        const mcpServers = { ...current.mcpServers };
        delete mcpServers[id];
        await settings.save({ ...current, mcpServers });
        return reply(res, 200, { ok: true });
      }

      if (pathname === '/api/connectors/toggle' && req.method === 'POST') {
        const body = await bodyJson(req);
        const id = clip(body.id, 64);
        const current = await settings.load();
        const server = current.mcpServers[id];
        if (!server) return reply(res, 404, { error: 'Connector is not installed.' });
        const saved = await settings.save({
          ...current,
          mcpServers: { ...current.mcpServers, [id]: { ...server, enabled: Boolean(body.enabled) } },
        });
        return reply(res, 200, { ok: true, server: publicConnector(saved.mcpServers[id], findConnector(server.source) ?? null) });
      }

      if (pathname === '/api/connectors/test' && req.method === 'POST') {
        const body = await bodyJson(req);
        const id = clip(body.id, 64);
        const current = await settings.load();
        const server = current.mcpServers[id];
        if (!server) return reply(res, 404, { error: 'Connector is not installed.' });
        if (!server.url) return reply(res, 400, { error: 'This connector has no URL. Start its local server and add the endpoint first.' });
        const result = await inspectConnector(server, resolveToken(server), fetchImpl);
        return reply(res, 200, result);
      }

      if (pathname === '/api/connectors/registry' && req.method === 'GET') {
        const result = await searchRegistry(clip(reqUrl.searchParams.get('q'), 100), clip(reqUrl.searchParams.get('cursor'), 1000), fetchImpl);
        return reply(res, 200, result);
      }

      /* --------------------------------- approvals --------------------------------- */
      if (pathname.startsWith('/api/approvals/') && req.method === 'POST') {
        const id = pathname.slice('/api/approvals/'.length);
        const body = await bodyJson(req);
        const pending = approvals.get(id);
        if (!pending) return reply(res, 404, { error: 'That approval has expired.' });
        approvals.delete(id);
        pending.resolve(body.decision === 'allow' ? 'allow' : 'deny');
        return reply(res, 200, { ok: true, decision: body.decision === 'allow' ? 'allow' : 'deny' });
      }

      /* ----------------------------------- terminal ----------------------------------- */
      if (pathname === '/api/terminal' && req.method === 'POST') {
        const body = await bodyJson(req);
        const command = clip(body.command, 4000);
        if (!command) return reply(res, 400, { error: 'A command is required.' });
        const current = await settings.load();
        const policy = terminalPolicy(command, current);
        if (!policy.ok) return reply(res, 403, { error: `Blocked: ${policy.reason}.` });
        const remote = remoteSpec(current);
        const result = await runShell(command, {
          cwd: workspace.root,
          timeoutMs: Math.min(Math.max(Number(body.timeoutSeconds) || 30, 1), 120) * 1000,
          shell: current.terminalShell,
          remote,
        });
        return reply(res, 200, {
          ok: result.ok,
          exitCode: result.code,
          stdout: result.output,
          stderr: result.ok ? '' : result.output,
          target: remote.kind,
        });
      }

      /* -------------------------------- worktrees -------------------------------- */
      if (pathname === '/api/git/worktrees' && req.method === 'GET') {
        const result = await listWorktrees(workspace.root);
        return reply(res, result.ok ? 200 : 400, result);
      }

      if (pathname === '/api/git/worktrees' && req.method === 'POST') {
        const body = await bodyJson(req);
        try {
          if (body.action === 'remove') {
            const removed = await removeWorktree({
              root: workspace.root,
              target: clip(body.path, 400),
              force: Boolean(body.force),
            });
            return reply(res, 200, { ok: true, ...removed });
          }
          const created = await addWorktree({
            root: workspace.root,
            target: clip(body.path, 400),
            branch: clip(body.branch, 120),
            base: clip(body.base, 120),
          });
          return reply(res, 200, { ok: true, ...created });
        } catch (error) {
          return reply(res, 400, { error: error.message });
        }
      }

      /* ------------------------------ pull requests ------------------------------ */
      if (pathname === '/api/git/pull-request') {
        const current = await settings.load();
        if (req.method === 'GET') {
          return reply(res, 200, await pullRequestInfo(workspace.root, current.prBaseBranch));
        }
        const body = await bodyJson(req);
        try {
          const result = await createPullRequest({
            root: workspace.root,
            title: clip(body.title, 200),
            body: clip(body.body, 20000),
            base: clip(body.base, 120) || current.prBaseBranch,
            draft: body.draft === undefined ? current.prDraft : Boolean(body.draft),
          });
          return reply(res, result.ok ? 200 : 400, result);
        } catch (error) {
          return reply(res, 400, { error: error.message });
        }
      }

      /* ---------------------------------- remote ---------------------------------- */
      if (pathname === '/api/remote/test' && req.method === 'POST') {
        const current = await settings.load();
        return reply(res, 200, await remoteTest(remoteSpec(current)));
      }

      /* ---------------------------------- usage ---------------------------------- */
      if (pathname === '/api/usage' && req.method === 'GET') {
        return reply(res, 200, await usageLedger.summary(Number(reqUrl.searchParams.get('days')) || 14));
      }

      if (pathname === '/api/usage/clear' && req.method === 'POST') {
        await usageLedger.clear();
        return reply(res, 200, { ok: true });
      }

      /* ---------------------------------- browser ---------------------------------- */
      if (pathname === '/api/browser/inspect' && req.method === 'POST') {
        const body = await bodyJson(req);
        let target;
        try {
          target = new URL(String(body.url ?? ''));
        } catch {
          return reply(res, 400, { error: 'Enter a valid http(s) URL.' });
        }
        if (!['http:', 'https:'].includes(target.protocol)) return reply(res, 400, { error: 'Only http:// and https:// URLs are supported.' });
        const browserSettings = await settings.load();
        if (browserSettings.browserTools === false) {
          return reply(res, 403, { error: 'Browser tools are turned off in Settings → Browser.' });
        }
        const allowed = (browserSettings.browserAllowedHosts ?? []).map((host) => host.toLowerCase());
        if (allowed.length > 0 && !allowed.includes(target.hostname.toLowerCase())) {
          return reply(res, 403, { error: `${target.hostname} is not in the allowed sites list.` });
        }
        const profile = activeProfile(browserSettings);
        const profileHosts = (profile?.allowedHosts ?? []).map((host) => host.toLowerCase());
        if (profileHosts.length > 0 && !profileHosts.includes(target.hostname.toLowerCase())) {
          return reply(res, 403, { error: `${target.hostname} is not in the ${profile?.name ?? 'active'} profile's allowed sites.` });
        }
        const headers = { 'User-Agent': profile?.userAgent || 'Tervixa-Wiggle/1.0' };
        const cookieHeader = cookiesForHost(browserSettings, target.hostname);
        if (cookieHeader) headers.Cookie = cookieHeader;
        const upstream = await fetchImpl(target.href, {
          redirect: 'follow',
          signal: AbortSignal.timeout(15_000),
          headers,
        });
        const html = (await upstream.text()).slice(0, 2_000_000);
        const extracted = htmlToText(html);
        return reply(res, 200, {
          url: target.href,
          status: upstream.status,
          title: extracted.title,
          text: extracted.text,
          profile: profile?.name ?? '',
          cookiesSent: cookieHeader ? cookieHeader.split('; ').length : 0,
          consoleLogs: [{ level: 'info', message: `Fetched ${target.href} (HTTP ${upstream.status})` }],
        });
      }

      /* ------------------------------------ chat ------------------------------------ */
      if (pathname === '/api/chat' && req.method === 'POST') {
        const body = await bodyJson(req);
        const messages = body.messages;
        if (
          !Array.isArray(messages) ||
          !messages.length ||
          messages.length > 200 ||
          messages.some(
            (message) =>
              !message ||
              !['user', 'assistant'].includes(message.role) ||
              typeof message.content !== 'string' ||
              !message.content.trim() ||
              message.content.length > 100_000,
          )
        ) {
          return reply(res, 400, { error: 'Invalid conversation.' });
        }

        const current = await settings.load();
        let connection;
        try {
          connection = resolveConnection(current);
        } catch (error) {
          return reply(res, error.code === 'not_configured' ? 503 : 400, {
            error: error.message,
            code: error.code ?? 'provider_error',
          });
        }

        // Resolve @-attachments into a context block on the last user turn.
        const attachments = Array.isArray(body.attachments) ? body.attachments.slice(0, 12) : [];
        if (attachments.length) {
          const blocks = [];
          for (const attachment of attachments) {
            const label = clip(attachment?.label ?? attachment?.path ?? attachment?.type, 300);
            if (attachment?.type === 'file' && attachment?.path) {
              try {
                const file = await workspace.read(String(attachment.path));
                blocks.push(`<file path="${label}">\n${String(file.content).slice(0, 60_000)}\n</file>`);
              } catch {
                blocks.push(`<file path="${label}" unavailable="true" />`);
              }
            } else if (typeof attachment?.content === 'string') {
              blocks.push(`<context type="${clip(attachment.type, 20) || 'text'}" label="${label}">\n${attachment.content.slice(0, 40_000)}\n</context>`);
            }
          }
          const lastUserIndex = messages.map((message) => message.role).lastIndexOf('user');
          if (blocks.length && lastUserIndex >= 0) {
            messages[lastUserIndex] = {
              ...messages[lastUserIndex],
              content: `<attached_context>\n${blocks.join('\n')}\n</attached_context>\n\n${messages[lastUserIndex].content}`.slice(0, 100_000),
            };
          }
        }

        const mode = ['agent', 'plan', 'ask', 'swarm'].includes(body.mode) ? body.mode : 'agent';
        const rules = mode === 'ask' ? Object.fromEntries(Object.keys(PRESETS.standard).map((key) => [key, 'deny'])) : mode === 'plan' ? PRESETS.readonly : gateRules(current.approvalMode);
        let emit = () => {};
        const gate = new PermissionGate({
          rules,
          onAsk: (request) =>
            new Promise((resolve) => {
              approvals.set(request.id, { resolve, tool: request.tool });
              emit({ type: 'approval', id: request.id, tool: request.tool, input: request.input ?? {} });
              const timer = setTimeout(() => approvals.delete(request.id), 125_000);
              timer.unref?.();
            }),
        });

        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-store',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        res.flushHeaders?.();
        let closed = false;
        const send = (event) => {
          if (closed) return;
          try {
            res.write(`data: ${JSON.stringify(event)}\n\n`);
          } catch {
            closed = true;
          }
        };
        emit = send;

        const controller = new AbortController();
        aborters.add(controller);
        res.on('close', () => {
          closed = true;
          controller.abort();
          aborters.delete(controller);
        });

        send({ type: 'meta', provider: connection.provider, providerId: connection.providerId, model: connection.model, protocol: connection.protocol, mode, approvalMode: current.approvalMode });

        let mcpRuntime = null;
        try {
          const { loaded } = await collectSkills(workspace, current);
          const enabled = loaded.filter((skill) => !(current.disabledSkills ?? []).includes(skill.name.toLowerCase()));
          const provider = createProvider(connection);
          // Connect the enabled MCP servers for this turn only. A server that
          // does not answer is reported and skipped, never fatal.
          const mcpServers = Object.values(current.mcpServers).filter(
            (server) => server && server.url && server.enabled !== false,
          );
          if (mcpServers.length) {
            mcpRuntime = await openMcpServers(mcpServers, { fetchImpl }).catch(() => null);
            for (const failure of mcpRuntime?.failures ?? []) {
              send({ type: 'notice', text: `MCP server ${failure.name} did not answer: ${failure.error}` });
            }
          }
          const turn = await runAgent({
            provider,
            workspace,
            snapshots,
            gate,
            memory: current.memoryAutoExtract ? memory : null,
            skills: enabled,
            customInstructions: current.customIdentityInstructions,
            outputStyle: current.outputStyle,
            messages: messages.map(({ role, content }) => ({ role, content })),
            signal: controller.signal,
            remote: remoteSpec(current),
            maxSteps: Math.min(Math.max(Number(body.maxSteps) || current.maxSteps, 1), 30),
            mcp: mcpRuntime,
            config: {
              installSkill: (options) => installSkillSource({ settings, ...options }),
              registerMcp: (options) => registerMcpServer({ settings, ...options }),
            },
            onEvent: send,
          });
          if (turn?.usage) {
            await usageLedger
              .record({ model: connection.model, providerId: connection.providerId, usage: turn.usage, mode })
              .catch(() => {});
          }
          send({ type: 'end' });
        } catch (error) {
          const code = error instanceof ProviderError ? error.code || 'provider_error' : 'agent_error';
          send({ type: 'error', message: error?.message ?? 'The turn failed.', code });
        } finally {
          await mcpRuntime?.close?.().catch(() => {});
          aborters.delete(controller);
          closed = true;
          res.end();
        }
        return;
      }

      if (pathname === '/api/chat/stop' && req.method === 'POST') {
        for (const controller of aborters) controller.abort();
        return reply(res, 200, { ok: true, stopped: aborters.size });
      }

      /* ------------------------------------ swarm ------------------------------------ */
      if (pathname === '/api/swarm' && req.method === 'POST') {
        const body = await bodyJson(req);
        const goal = clip(body.goal, 4000);
        if (!goal) return reply(res, 400, { error: 'Describe the goal for the swarm.' });
        const current = await settings.load();
        const connection = resolveConnection(current);
        const provider = createProvider(connection);
        const planner = [
          'You are the orchestrator of a software-engineering swarm. Break the goal into 3-5 parallel work items.',
          'Answer with JSON only, shaped as {"tasks":[{"role":"explorer|architect|coder|reviewer","title":"...","detail":"..."}]}.',
          'Roles: explorer gathers context, architect designs the change, coder writes it, reviewer verifies it. Never include more than one coder.',
        ].join('\n');
        const result = await provider.streamChat({
          messages: [{ role: 'user', content: goal }],
          system: planner,
          tools: [],
          signal: AbortSignal.timeout(60_000),
          onDelta: () => {},
        });
        let tasks = [];
        const match = /\{[\s\S]*\}/.exec(result.text ?? '');
        if (match) {
          try {
            const parsed = JSON.parse(match[0]);
            tasks = (parsed.tasks ?? []).slice(0, Math.min(Math.max(Number(current.maxParallelAgents) || 4, 1), 12)).map((task, index) => ({
              id: `swarm-${index + 1}`,
              role: ['explorer', 'architect', 'coder', 'reviewer'].includes(task.role) ? task.role : 'coder',
              title: clip(task.title, 160),
              summary: clip(task.detail, 600),
              status: 'queued',
              leasedFiles: [],
            }));
          } catch {
            tasks = [];
          }
        }
        if (!tasks.length) {
          return reply(res, 502, { error: 'The model did not return a usable plan. Try a shorter goal.' });
        }
        return reply(res, 200, { goal, tasks, model: connection.model, provider: connection.provider });
      }

      /* ----------------------------------- static ----------------------------------- */
      if (pathname.startsWith('/api/')) return reply(res, 404, { error: 'Not found.' });
      if (req.method !== 'GET' && req.method !== 'HEAD') return reply(res, 405, { error: 'Method not allowed.' });

      const relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
      const file = path.resolve(staticDir, relative);
      if (!file.startsWith(path.resolve(staticDir) + path.sep)) return reply(res, 404, { error: 'Not found.' });
      const info = await stat(file).catch(() => null);
      if (!info?.isFile()) return reply(res, 404, { error: 'The UI has not been built yet. Run npm run build.' });
      const contents = await readFile(file);
      const mime =
        {
          '.html': 'text/html',
          '.js': 'text/javascript',
          '.css': 'text/css',
          '.svg': 'image/svg+xml',
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.ico': 'image/x-icon',
          '.json': 'application/json',
          '.woff2': 'font/woff2',
          '.map': 'application/json',
        }[path.extname(file).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': `${mime}; charset=utf-8`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : contents);
    } catch (error) {
      if (res.headersSent) {
        try {
          res.end();
        } catch {
          // The socket is already gone.
        }
        return;
      }
      if (error instanceof SyntaxError) return reply(res, 400, { error: 'Invalid JSON.' });
      if (error?.message === 'Request too large') return reply(res, 400, { error: 'Request too large.' });
      if (error instanceof WorkspaceError) return reply(res, error.code === 'outside_workspace' ? 403 : 400, { error: error.message, code: error.code });
      if (error instanceof ProviderError) {
        const configError = ['missing_key', 'not_configured', 'needs_manual_setup', 'invalid_protocol'].includes(error.code);
        return reply(res, configError ? 400 : error.status && error.status < 500 ? 400 : 502, { error: error.message, code: error.code });
      }
      return reply(res, 400, { error: error?.message || 'Could not process the request.' });
    }
  });
}

export { CONNECTORS, PROTOCOL_LABELS };

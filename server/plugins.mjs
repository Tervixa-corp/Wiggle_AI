// Claude plugin installer.
//
// A plugin in the official marketplace is a git repository (or a subdirectory
// of one) containing a `.claude-plugin/plugin.json` manifest plus any mix of
// skills, commands, agents and MCP server definitions. Installing one means
// fetching that directory once, then registering its MCP servers and exposing
// its skills to the agent. Nothing is executed at install time.

import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, open, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { parseFrontmatter } from './skills.mjs';

export const PLUGIN_ROOT = path.join(process.env.WIGGLE_CONFIG_DIR || path.join(os.homedir(), '.wiggle'), 'plugins');
const CACHE_ROOT = path.join(process.env.WIGGLE_CONFIG_DIR || path.join(os.homedir(), '.wiggle'), 'cache');
const MAX_PLUGIN_BYTES = 120 * 1024 * 1024;
const MAX_PLUGIN_FILES = 6000;
const CLONE_TIMEOUT_MS = 90_000;

function run(command, args, { cwd, timeoutMs = CLONE_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, { cwd, shell: false, windowsHide: true, env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', SystemRoot: process.env.SystemRoot ?? '', PATHEXT: process.env.PATHEXT ?? '' } });
    } catch (error) {
      resolve({ ok: false, output: error.message });
      return;
    }
    let output = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (chunk) => { if (output.length < 20000) output += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { if (output.length < 20000) output += chunk.toString('utf8'); });
    child.on('error', (error) => { clearTimeout(timer); resolve({ ok: false, output: error.message }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ ok: code === 0, output, code }); });
  });
}

function safeRepoUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('The plugin source is not a valid URL.');
  }
  if (url.protocol !== 'https:') throw new Error('Plugin sources must use HTTPS.');
  if (url.username || url.password) throw new Error('Plugin source URLs must not contain credentials.');
  if (!['github.com', 'gitlab.com', 'bitbucket.org'].includes(url.hostname)) {
    throw new Error('Only github.com, gitlab.com and bitbucket.org plugin sources are supported.');
  }
  if (!/^\/[\w.-]+\/[\w.-]+(?:\.git)?\/?$/.test(url.pathname)) throw new Error('Unsupported repository URL.');
  return url.href.replace(/\/+$/, '');
}

function safeSubpath(value) {
  const cleaned = String(value ?? '').replace(/\\/g, '/').replace(/^\.?\//, '').replace(/\/+$/, '');
  if (!cleaned) return '';
  if (cleaned.split('/').includes('..') || path.isAbsolute(cleaned)) throw new Error('The plugin subdirectory is invalid.');
  return cleaned;
}

async function measure(dir) {
  let bytes = 0;
  let files = 0;
  const walk = async (current) => {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === '.git') continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) {
        files += 1;
        bytes += (await stat(full)).size;
      }
      if (bytes > MAX_PLUGIN_BYTES || files > MAX_PLUGIN_FILES) throw new Error('Plugin exceeds the 120 MB / 6000 file limit.');
    }
  };
  await walk(dir);
  return { bytes, files };
}

/** Download a URL to disk with a hard size cap. */
async function download(url, destination, maxBytes = 160 * 1024 * 1024) {
  const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Download failed (HTTP ${response.status}).`);
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > maxBytes) throw new Error('The plugin archive is larger than the 160 MB limit.');
  const file = await open(destination, 'w');
  let total = 0;
  try {
    for await (const chunk of response.body) {
      total += chunk.length;
      if (total > maxBytes) throw new Error('The plugin archive is larger than the 160 MB limit.');
      await file.write(chunk);
    }
  } finally {
    await file.close();
  }
  return total;
}

/** Fetch a marketplace source into a temporary directory. */
async function fetchSource(source) {
  if (!source || typeof source !== 'object') throw new Error('This plugin has no install source.');
  // Relative sources live in the marketplace repository itself.
  const repoUrl = source.url || (source.path ? 'https://github.com/anthropics/claude-plugins-official.git' : '');
  const url = safeRepoUrl(repoUrl);
  const subpath = safeSubpath(source.path);
  const ref = typeof source.ref === 'string' && source.ref.trim() ? source.ref.trim().slice(0, 120) : '';
  const sha = typeof source.sha === 'string' && /^[0-9a-f]{7,40}$/i.test(source.sha.trim()) ? source.sha.trim() : '';

  const temp = await mkdtemp(path.join(os.tmpdir(), 'wiggle-plugin-'));
  const parsed = new URL(url);
  const orgRepo = parsed.pathname.replace(/^\/|\.git$/g, '');

  // GitHub: pull only the plugin directory through jsDelivr's CDN. Cloning or
  // downloading a whole marketplace repository is far too slow when a plugin
  // is a few files in one subdirectory.
  if (parsed.hostname === 'github.com') {
    const sourceDir = path.join(temp, 'plugin');
    await mkdir(sourceDir, { recursive: true });
    const revision = sha || ref || '';
    const versions = revision ? [revision] : ['main', 'master', 'HEAD'];
    let lastError = null;
    for (const version of versions) {
      try {
        await rm(sourceDir, { recursive: true, force: true });
        await mkdir(sourceDir, { recursive: true });
        const written = await fetchGithubDirectory(orgRepo, version, subpath, sourceDir);
        if (written.files === 0) throw new Error(`The plugin directory "${subpath}" is empty or missing.`);
        const size = await measure(sourceDir);
        return { checkout: sourceDir, sourceDir, size, temp };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError ?? new Error('Could not download the plugin from GitHub.');
  }

  const checkout = path.join(temp, 'repo');
  const cloneArgs = ['clone', '--depth', '1'];
  if (ref && !sha) cloneArgs.push('--branch', ref);
  cloneArgs.push(url, checkout);
  const cloned = await run('git', cloneArgs);
  if (!cloned.ok) throw new Error(`Could not download the plugin repository: ${cloned.output.split('\n').filter(Boolean).slice(-2).join(' ')}`);
  if (sha) {
    const fetched = await run('git', ['fetch', '--depth', '1', 'origin', sha], { cwd: checkout });
    if (!fetched.ok) throw new Error('Could not fetch the pinned plugin revision.');
    const checked = await run('git', ['checkout', 'FETCH_HEAD'], { cwd: checkout });
    if (!checked.ok) throw new Error('Could not check out the pinned plugin revision.');
  }
  const sourceDir = subpath ? path.join(checkout, ...subpath.split('/')) : checkout;
  const exists = await stat(sourceDir).catch(() => null);
  if (!exists?.isDirectory()) throw new Error(`The plugin directory "${subpath}" is missing from the repository.`);
  const size = await measure(sourceDir);
  return { checkout, sourceDir, size, temp };
}

/** List every file in a GitHub repo at one revision using jsDelivr. */
async function jsdelivrFileList(orgRepo, version) {
  const endpoint = `https://data.jsdelivr.com/v1/packages/gh/${orgRepo}@${version}?structure=flat`;
  const response = await fetch(endpoint, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Could not list the repository (HTTP ${response.status}).`);
  const data = await response.json();
  if (!Array.isArray(data?.files)) throw new Error('The repository listing was invalid.');
  return data.files;
}

async function fetchGithubDirectory(orgRepo, version, subpath, destination) {
  const files = await jsdelivrFileList(orgRepo, version);
  const prefix = subpath ? `/${subpath}/` : '/';
  const selected = files.filter((file) => {
    if (typeof file?.name !== 'string') return false;
    if (subpath) return file.name === `/${subpath}` || file.name.startsWith(prefix);
    return true;
  });
  if (selected.length > MAX_PLUGIN_FILES) throw new Error('That plugin contains more than 6000 files.');
  const base = `https://raw.githubusercontent.com/${orgRepo}/${version}`;
  let total = 0;

  const queue = [...selected];
  const worker = async () => {
    for (;;) {
      const file = queue.shift();
      if (!file) return;
      if (file.type && file.type !== 'file') continue;
      const repoRelative = file.name.replace(/^\//, '');
      let relative = repoRelative;
      if (subpath) {
        if (relative === subpath) relative = relative.split('/').pop();
        else if (relative.startsWith(`${subpath}/`)) relative = relative.slice(subpath.length + 1);
        else continue;
      }
      if (!relative) continue;
      const target = path.join(destination, ...relative.split('/'));
      if (!target.startsWith(destination + path.sep)) continue;
      let response;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        response = await fetch(`${base}/${repoRelative.split('/').map(encodeURIComponent).join('/')}`, {
          redirect: 'follow',
          signal: AbortSignal.timeout(45_000),
        });
        if (response.ok) break;
        if (response.status !== 404 && response.status !== 429) break;
        await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
      }
      if (!response?.ok) throw new Error(`Could not download ${relative} (HTTP ${response?.status ?? 'network'}).`);
      const bytes = Buffer.from(await response.arrayBuffer());
      total += bytes.length;
      if (total > MAX_PLUGIN_BYTES) throw new Error('The plugin is larger than the 120 MB limit.');
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, bytes);
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, queue.length) }, worker));
  return { files: selected.length, bytes: total };
}

/** Read a Claude plugin bundle: manifest, skills, commands and MCP servers. */
export async function readBundle(dir) {
  let manifest = {};
  for (const candidate of ['.claude-plugin/plugin.json', 'plugin.json']) {
    try {
      manifest = JSON.parse(await readFile(path.join(dir, ...candidate.split('/')), 'utf8'));
      break;
    } catch {
      // Try the next location.
    }
  }

  const skills = [];
  const seenSkills = new Set();
  const addSkillDir = async (dir, id) => {
    try {
      const source = await readFile(path.join(dir, 'SKILL.md'), 'utf8');
      const { meta } = parseFrontmatter(source, id);
      const key = (meta.name || id).toLowerCase();
      if (seenSkills.has(key)) return;
      seenSkills.add(key);
      skills.push({ id: meta.name || id, name: meta.name || id, description: meta.description, directory: dir });
    } catch {
      // Not a skill directory.
    }
  };

  // Standard layout: skills/<name>/SKILL.md
  for (const base of ['skills']) {
    const entries = await readdir(path.join(dir, base), { withFileTypes: true }).catch(() => []);
    for (const entry of entries) if (entry.isDirectory()) await addSkillDir(path.join(dir, base, entry.name), entry.name);
  }
  // Skill-pack layout: <name>/SKILL.md at the plugin root.
  const reserved = new Set(['agents', 'commands', 'hooks', 'scripts', 'skills', 'assets', '.claude-plugin', 'node_modules']);
  const rootEntries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of rootEntries) {
    if (entry.isDirectory() && !reserved.has(entry.name) && !entry.name.startsWith('.')) {
      await addSkillDir(path.join(dir, entry.name), entry.name);
    }
  }
  await addSkillDir(dir, manifest.name || path.basename(dir));

  const commands = [];
  for (const folder of ['commands', 'agents']) {
    const files = await readdir(path.join(dir, folder), { withFileTypes: true }).catch(() => []);
    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith('.md')) continue;
      const id = file.name.slice(0, -3);
      const source = await readFile(path.join(dir, folder, file.name), 'utf8').catch(() => '');
      const { meta } = parseFrontmatter(source, id);
      commands.push({
        id,
        name: id,
        kind: folder === 'agents' ? 'agent' : 'command',
        description: meta.description || source.split('\n').find((line) => line.trim() && !line.startsWith('---'))?.replace(/^#+\s*/, '').slice(0, 160) || '',
        body: source.slice(0, 20000),
      });
    }
  }

  let mcpServers = {};
  for (const candidate of ['.mcp.json', 'mcp.json']) {
    try {
      const parsed = JSON.parse(await readFile(path.join(dir, candidate), 'utf8'));
      if (parsed?.mcpServers && typeof parsed.mcpServers === 'object') {
        mcpServers = parsed.mcpServers;
        break;
      }
    } catch {
      // No MCP definition.
    }
  }
  if (manifest.mcpServers && typeof manifest.mcpServers === 'object') mcpServers = { ...mcpServers, ...manifest.mcpServers };

  return {
    manifest: {
      name: typeof manifest.name === 'string' ? manifest.name : '',
      version: typeof manifest.version === 'string' ? manifest.version : '',
      description: typeof manifest.description === 'string' ? manifest.description : '',
      author: manifest.author?.name ?? (typeof manifest.author === 'string' ? manifest.author : ''),
    },
    skills,
    commands,
    mcpServers,
  };
}

/** Normalise a Claude `.mcp.json` server entry into Wiggle's shape. */
function normalizeMcpEntry(id, entry, pluginId) {
  if (!entry || typeof entry !== 'object') return null;
  const url = typeof entry.url === 'string' ? entry.url : typeof entry.serverUrl === 'string' ? entry.serverUrl : '';
  if (url) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) return null;
    return {
      id,
      name: entry.name || id,
      url: parsed.href,
      transport: entry.type === 'sse' ? 'sse' : 'http',
      token: '',
      tokenEnv: '',
      enabled: false,
      source: `plugin:${pluginId}`,
    };
  }
  // stdio servers are recorded but start disabled: Wiggle does not spawn
  // third-party commands without the user opting in.
  if (entry.command) {
    return {
      id,
      name: entry.name || id,
      url: '',
      transport: 'stdio',
      command: String(entry.command).slice(0, 500),
      args: Array.isArray(entry.args) ? entry.args.slice(0, 40).map((a) => String(a).slice(0, 300)) : [],
      token: '',
      tokenEnv: '',
      enabled: false,
      source: `plugin:${pluginId}`,
    };
  }
  return null;
}

/**
 * Install one marketplace plugin.
 * @param {object} plugin catalog entry
 * @param {object} settings SettingsStore
 */
export async function installPlugin(plugin, settings) {
  const id = String(plugin.id || '').trim();
  if (!/^[\w.-]{1,120}$/.test(id)) throw new Error('Invalid plugin id.');
  await mkdir(PLUGIN_ROOT, { recursive: true });
  const destination = path.join(PLUGIN_ROOT, id);
  const existing = await stat(destination).catch(() => null);

  const fetched = await fetchSource(plugin.source);
  try {
    await rm(destination, { recursive: true, force: true });
    await cp(fetched.sourceDir, destination, {
      recursive: true,
      filter: (source) => !source.includes(`${path.sep}.git${path.sep}`) && !source.endsWith(`${path.sep}.git`),
    });

    const bundle = await readBundle(destination);
    const meta = {
      id,
      name: bundle.manifest.name || plugin.name || id,
      version: bundle.manifest.version || '',
      description: bundle.manifest.description || plugin.description || '',
      author: bundle.manifest.author || plugin.author || '',
      category: plugin.category || 'other',
      homepage: plugin.homepage || '',
      installedAt: new Date().toISOString(),
      bytes: fetched.size.bytes,
      files: fetched.size.files,
      skills: bundle.skills.map((skill) => skill.id),
      commands: bundle.commands.map((command) => ({ id: command.id, name: command.name, kind: command.kind, description: command.description })),
      source: plugin.source,
      previousInstall: Boolean(existing),
    };

    const servers = {};
    for (const [serverId, entry] of Object.entries(bundle.mcpServers)) {
      const normalized = normalizeMcpEntry(`${id}__${serverId}`.slice(0, 64), entry, id);
      if (normalized) servers[normalized.id] = normalized;
    }

    await settings.update((current) => {
      const mcpServers = { ...current.mcpServers };
      // Drop servers from a previous install of this plugin before merging.
      for (const [serverId, server] of Object.entries(mcpServers)) {
        if (server.source === `plugin:${id}`) delete mcpServers[serverId];
      }
      Object.assign(mcpServers, servers);
      const pluginMeta = { ...(current.pluginMeta ?? {}), [id]: meta };
      const installed = [...new Set([...(current.installedPlugins ?? []), id])];
      return { ...current, mcpServers, pluginMeta, installedPlugins: installed };
    });

    return { ...meta, path: destination, mcpServers: Object.keys(servers), skills: bundle.skills, commands: bundle.commands };
  } finally {
    await rm(fetched.temp, { recursive: true, force: true }).catch(() => {});
  }
}

export async function uninstallPlugin(id, settings) {
  if (!/^[\w.-]{1,120}$/.test(id)) throw new Error('Invalid plugin id.');
  await rm(path.join(PLUGIN_ROOT, id), { recursive: true, force: true });
  await settings.update((current) => {
    const mcpServers = Object.fromEntries(Object.entries(current.mcpServers).filter(([, server]) => server.source !== `plugin:${id}`));
    const pluginMeta = { ...(current.pluginMeta ?? {}) };
    delete pluginMeta[id];
    return {
      ...current,
      mcpServers,
      pluginMeta,
      installedPlugins: (current.installedPlugins ?? []).filter((entry) => entry !== id),
    };
  });
  return { ok: true, id };
}

/** Every skill directory contributed by installed plugins. */
export async function pluginSkillRoots(settings) {
  const roots = [];
  for (const id of settings.installedPlugins ?? []) {
    if (!/^[\w.-]{1,120}$/.test(id)) continue;
    const dir = path.join(PLUGIN_ROOT, id, 'skills');
    roots.push(dir);
    roots.push(path.join(PLUGIN_ROOT, id)); // root-level SKILL.md
  }
  return roots;
}

/** Commands and agents declared by installed plugins, for the slash menu. */
export async function pluginCommands(settings) {
  const out = [];
  for (const id of settings.installedPlugins ?? []) {
    if (!/^[\w.-]{1,120}$/.test(id)) continue;
    const dir = path.join(PLUGIN_ROOT, id);
    const bundle = await readBundle(dir).catch(() => null);
    if (!bundle) continue;
    for (const command of bundle.commands) {
      out.push({ ...command, plugin: id, command: `/${command.id}`, body: command.body });
    }
  }
  return out;
}

/** Write a downloaded .zip-less bundle: a single SKILL.md the user pasted. */
export async function installSkill(name, markdown, settings) {
  const clean = String(name ?? '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  if (!clean) throw new Error('A skill needs a name.');
  if (typeof markdown !== 'string' || markdown.trim().length < 20) throw new Error('Paste the SKILL.md contents first.');
  const dir = path.join(process.env.WIGGLE_CONFIG_DIR || path.join(os.homedir(), '.wiggle'), 'skills', clean);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'SKILL.md'), markdown.slice(0, 24000), 'utf8');
  await settings.update((current) => ({
    ...current,
    installedSkills: [...new Set([...(current.installedSkills ?? []), clean])],
  }));
  return { ok: true, id: clean };
}

export async function removeSkill(name, settings) {
  const clean = String(name ?? '').toLowerCase();
  if (!/^[a-z0-9_-]{1,80}$/.test(clean)) throw new Error('Invalid skill name.');
  await rm(path.join(process.env.WIGGLE_CONFIG_DIR || path.join(os.homedir(), '.wiggle'), 'skills', clean), { recursive: true, force: true });
  await settings.update((current) => ({
    ...current,
    installedSkills: (current.installedSkills ?? []).filter((entry) => entry !== clean),
    disabledSkills: (current.disabledSkills ?? []).filter((entry) => entry !== clean),
  }));
  return { ok: true };
}

export const PLUGIN_CACHE = CACHE_ROOT;

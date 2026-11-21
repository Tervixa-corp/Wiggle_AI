// Workstation integrations: usage ledger, git worktrees, pull requests,
// remote (WSL/SSH) execution and browser profile cookies.
//
// Everything here is local. Nothing contacts a network service except the
// provider the user configured, and `gh`/`git`/`ssh` when the user asks.

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const CONFIG_DIR = process.env.WIGGLE_CONFIG_DIR || path.join(os.homedir(), '.wiggle');

/* -------------------------------------------------------------------------- */
/* Small process runner (no shell, so arguments are never re-quoted)          */
/* -------------------------------------------------------------------------- */

export function exec(file, args, { cwd, timeoutMs = 30_000, input = '' } = {}) {
  return new Promise((resolve) => {
    let output = '';
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    let child;
    try {
      child = spawn(file, args, { cwd, windowsHide: true, env: process.env });
    } catch (error) {
      resolve({ ok: false, code: null, output: error.message });
      return;
    }
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* already gone */
      }
      finish({ ok: false, code: null, output: `${output}\n[timed out after ${Math.round(timeoutMs / 1000)}s]` });
    }, timeoutMs);
    timer.unref?.();
    const collect = (chunk) => {
      // wsl.exe answers in UTF-16LE: strip the NUL bytes it interleaves so callers
      // only ever see text ("U\0b\0u\0n\0t\0u\0" becomes "Ubuntu").
      if (output.length < 200_000) output += chunk.toString('utf8').replace(/\0/g, '');
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', (error) => finish({ ok: false, code: null, output: error.message }));
    child.on('close', (code) => finish({ ok: code === 0, code, output: output.slice(0, 40_000) }));
    if (input) {
      child.stdin.write(input);
      child.stdin.end();
    }
  });
}

/* -------------------------------------------------------------------------- */
/* Usage ledger                                                                */
/* -------------------------------------------------------------------------- */

const readUsage = async (file) => {
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
    return Array.isArray(parsed.entries) ? parsed.entries : [];
  } catch {
    return [];
  }
};

const tokenNumber = (value) => (Number.isFinite(Number(value)) ? Math.max(0, Math.round(Number(value))) : 0);

export function normalizeUsage(usage) {
  const source = usage && typeof usage === 'object' ? usage : {};
  const input = tokenNumber(source.input_tokens ?? source.prompt_tokens ?? source.inputTokens ?? source.promptTokens);
  const output = tokenNumber(
    source.output_tokens ?? source.completion_tokens ?? source.outputTokens ?? source.completionTokens,
  );
  return { input, output, total: input + output };
}

export class UsageLedger {
  constructor(file = path.join(CONFIG_DIR, 'usage.json')) {
    this.file = file;
    this.entries = null;
  }

  async load() {
    if (this.entries) return this.entries;
    this.entries = await readUsage(this.file);
    return this.entries;
  }

  async record({ model = '', providerId = '', usage = null, mode = 'chat', at = Date.now() }) {
    const tokens = normalizeUsage(usage);
    if (tokens.total === 0) return null;
    const entries = await this.load();
    entries.push({ at: new Date(at).toISOString(), model, providerId, mode, ...tokens });
    if (entries.length > 5000) entries.splice(0, entries.length - 5000);
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, JSON.stringify({ entries }, null, 2), { encoding: 'utf8', mode: 0o600 });
    return tokens;
  }

  async summary(days = 14) {
    const entries = await this.load();
    const window = Math.min(Math.max(Number(days) || 14, 1), 90);
    const since = Date.now() - window * 86_400_000;
    const recent = entries.filter((entry) => Date.parse(entry.at) >= since);
    const buckets = new Map();
    for (let offset = window - 1; offset >= 0; offset -= 1) {
      const day = new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
      buckets.set(day, { day, input: 0, output: 0, turns: 0 });
    }
    const models = new Map();
    let input = 0;
    let output = 0;
    for (const entry of recent) {
      const day = String(entry.at).slice(0, 10);
      const bucket = buckets.get(day);
      const inTokens = tokenNumber(entry.input);
      const outTokens = tokenNumber(entry.output);
      input += inTokens;
      output += outTokens;
      if (bucket) {
        bucket.input += inTokens;
        bucket.output += outTokens;
        bucket.turns += 1;
      }
      const key = entry.model || 'unknown';
      const model = models.get(key) ?? { model: key, input: 0, output: 0, turns: 0 };
      model.input += inTokens;
      model.output += outTokens;
      model.turns += 1;
      models.set(key, model);
    }
    return {
      days: window,
      totals: { input, output, total: input + output, turns: recent.length },
      buckets: [...buckets.values()],
      models: [...models.values()].sort((a, b) => b.input + b.output - (a.input + a.output)).slice(0, 8),
      recorded: entries.length,
    };
  }

  async clear() {
    this.entries = [];
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, JSON.stringify({ entries: [] }, null, 2), { encoding: 'utf8', mode: 0o600 });
  }
}

/* -------------------------------------------------------------------------- */
/* Remote execution target                                                     */
/* -------------------------------------------------------------------------- */

export function remoteSpec(settings) {
  const target = settings?.remoteTarget ?? 'local';
  if (target === 'wsl') return { kind: 'wsl', distro: String(settings?.wslDistro ?? '').trim() };
  if (target === 'ssh') {
    return {
      kind: 'ssh',
      host: String(settings?.sshHost ?? '').trim(),
      workdir: String(settings?.remoteWorkdir ?? '').trim(),
    };
  }
  return { kind: 'local' };
}

export async function remoteTest(spec) {
  if (!spec || spec.kind === 'local') return { ok: true, target: 'local', output: 'Commands run on this machine.' };
  if (spec.kind === 'wsl') {
    if (!spec.distro) {
      const list = await exec('wsl.exe', ['-l', '-q'], { timeoutMs: 10_000 });
      const clean = list.output.replace(/\0/g, '').trim();
      return {
        ok: list.ok,
        target: 'wsl',
        output: `${list.ok ? 'WSL is available. Pick a distribution below.' : 'WSL is not available.'}\n${clean}`,
        distros: clean
          .split(/\r?\n/)
          .map((line) => line.replace(/[^\x20-\x7e]/g, '').trim())
          .filter(Boolean),
      };
    }
    const result = await exec('wsl.exe', ['-d', spec.distro, '--', 'bash', '-lc', 'uname -s; pwd'], { timeoutMs: 20_000 });
    return {
      ok: result.ok,
      target: 'wsl',
      output: (result.output || '').replace(/\0/g, '').trim() || 'No output from WSL.',
    };
  }
  if (!spec.host) return { ok: false, target: 'ssh', output: 'Enter a host such as user@machine or an SSH config alias.' };
  const remote = spec.workdir ? `cd ${shellQuote(spec.workdir)} && pwd` : 'pwd';
  const result = await exec(
    'ssh',
    ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=6', spec.host, remote],
    { timeoutMs: 25_000 },
  );
  return {
    ok: result.ok,
    target: 'ssh',
    output: result.output.trim() || (result.ok ? 'Connected.' : 'SSH failed without output.'),
    tunnel: spec.host ? `ssh -N -L 4317:127.0.0.1:4317 ${spec.host}` : '',
  };
}

export function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

/* -------------------------------------------------------------------------- */
/* Git worktrees                                                              */
/* -------------------------------------------------------------------------- */

const WORKTREE_BRANCH = /^[\w][\w./-]{0,119}$/;
const WORKTREE_PATH = /^[\w .:/\\@()-]{1,400}$/;

export async function listWorktrees(root) {
  const result = await exec('git', ['worktree', 'list', '--porcelain'], { cwd: root, timeoutMs: 15_000 });
  if (!result.ok) return { ok: false, error: result.output.trim() || 'git worktree failed.', worktrees: [] };
  const blocks = result.output.split(/\r?\n\r?\n/).map((block) => block.trim()).filter(Boolean);
  const worktrees = blocks.map((block) => {
    const record = { path: '', head: '', branch: '', bare: false, detached: false, locked: false };
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('worktree ')) record.path = line.slice(9).trim();
      else if (line.startsWith('HEAD ')) record.head = line.slice(5).trim();
      else if (line.startsWith('branch ')) record.branch = line.slice(7).replace(/^refs\/heads\//, '').trim();
      else if (line === 'bare') record.bare = true;
      else if (line === 'detached') record.detached = true;
      else if (line.startsWith('locked')) record.locked = true;
    }
    return { ...record, primary: record.path === root || path.resolve(record.path) === path.resolve(root) };
  });
  return { ok: true, worktrees };
}

export async function addWorktree({ root, target, branch, base }) {
  if (!WORKTREE_BRANCH.test(branch ?? '')) throw new Error('Branch names may use letters, digits, dot, slash, dash and underscore.');
  if (target && !WORKTREE_PATH.test(target)) throw new Error('That worktree path contains unsupported characters.');
  const destination = path.resolve(root, target || path.join('..', `${path.basename(root)}-worktrees`, branch.replace(/\//g, '-')));
  if (destination === path.resolve(root)) throw new Error('A worktree cannot replace the workspace itself.');
  try {
    await fs.access(destination);
    throw new Error('That path already exists.');
  } catch (error) {
    if (error?.message === 'That path already exists.') throw error;
  }
  if (base && !WORKTREE_BRANCH.test(base)) throw new Error('The base ref is not a valid branch name.');
  const args = ['worktree', 'add', '-b', branch, destination];
  if (base) args.push(base);
  const result = await exec('git', args, { cwd: root, timeoutMs: 60_000 });
  if (!result.ok) throw new Error(result.output.trim() || 'git worktree add failed.');
  return { path: destination, branch, base: base || 'HEAD', output: result.output.trim() };
}

export async function removeWorktree({ root, target, force = false }) {
  const destination = path.resolve(root, String(target ?? ''));
  const current = path.resolve(root);
  if (destination === current) throw new Error('The workspace itself is not a worktree to remove.');
  const relative = path.relative(current, destination);
  if (!relative || relative.startsWith('..')) {
    // Worktrees live outside the repository by design; git refuses unknown paths itself.
  }
  const args = ['worktree', 'remove', destination];
  if (force) args.push('--force');
  const result = await exec('git', args, { cwd: root, timeoutMs: 60_000 });
  if (!result.ok) throw new Error(result.output.trim() || 'git worktree remove failed.');
  return { removed: destination, output: result.output.trim() };
}

/* -------------------------------------------------------------------------- */
/* Pull requests                                                              */
/* -------------------------------------------------------------------------- */

export function compareUrl(remote, base, branch) {
  if (!remote) return '';
  const cleaned = remote.replace(/\.git$/, '').replace(/\/+$/, '');
  const https = cleaned
    .replace(/^git@([^:]+):/, 'https://$1/')
    .replace(/^ssh:\/\/git@([^/]+)\//, 'https://$1/');
  const encodedBase = encodeURIComponent(base);
  const encodedBranch = encodeURIComponent(branch);
  if (/github\.com/i.test(https)) return `${https}/compare/${encodedBase}...${encodedBranch}?expand=1`;
  if (/gitlab/i.test(https)) return `${https}/-/compare/${encodedBase}...${encodedBranch}`;
  if (/bitbucket/i.test(https)) return `${https}/pull-requests/new?source=${encodedBranch}&dest=${encodedBase}`;
  return '';
}

export async function pullRequestInfo(root, defaultBase) {
  const branchResult = await exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root, timeoutMs: 10_000 });
  const remoteResult = await exec('git', ['remote', 'get-url', 'origin'], { cwd: root, timeoutMs: 10_000 });
  const ghResult = await exec('gh', ['--version'], { cwd: root, timeoutMs: 8_000 });
  const branch = branchResult.ok ? branchResult.output.trim() : '';
  const remote = remoteResult.ok ? remoteResult.output.trim() : '';
  const base = defaultBase || 'main';
  const status = await exec('git', ['status', '--porcelain=v1'], { cwd: root, timeoutMs: 10_000 });
  const ahead = await exec('git', ['rev-list', '--count', `origin/${base}..HEAD`], { cwd: root, timeoutMs: 10_000 });
    return {
    branch,
    remote,
    base,
    ghAvailable: ghResult.ok,
    ghVersion: ghResult.ok ? ghResult.output.split(/\r?\n/)[0] : '',
    compareUrl: compareUrl(remote, base, branch || 'HEAD'),
    uncommitted: status.ok ? status.output.split(/\r?\n/).filter(Boolean).length : 0,
    ahead: ahead.ok ? Number(ahead.output.trim()) || 0 : null,
  };
}

export async function createPullRequest({ root, title, body, base, draft = false }) {
  if (!title || !title.trim()) throw new Error('A pull request title is required.');
  const info = await pullRequestInfo(root, base);
  if (!info.ghAvailable) {
    return {
      ok: false,
      code: 'gh_missing',
      compareUrl: info.compareUrl,
      error: 'The GitHub CLI (gh) is not installed, so the pull request was not opened.',
    };
  }
  const file = path.join(os.tmpdir(), `wiggle-pr-${process.pid}-${Date.now()}.md`);
  await fs.writeFile(file, body || title, 'utf8');
  try {
    const args = ['pr', 'create', '--title', title.trim(), '--body-file', file, '--base', info.base];
    if (draft) args.push('--draft');
    const result = await exec('gh', args, { cwd: root, timeoutMs: 120_000 });
    if (!result.ok) {
      return { ok: false, code: 'gh_failed', error: result.output.trim() || 'gh pr create failed.', compareUrl: info.compareUrl };
    }
    const url = /https?:\/\/\S+\/pull\/\d+/.exec(result.output)?.[0] ?? info.compareUrl;
    return { ok: true, url, output: result.output.trim(), branch: info.branch, base: info.base };
  } finally {
    await fs.unlink(file).catch(() => {});
  }
}

/* -------------------------------------------------------------------------- */
/* Browser profiles and cookies                                                */
/* -------------------------------------------------------------------------- */

export function activeProfile(settings) {
  const profiles = settings?.browserProfiles ?? [];
  const id = settings?.activeBrowserProfile || 'default';
  return profiles.find((profile) => profile.id === id) ?? profiles[0] ?? null;
}

export function cookiesForHost(settings, hostname) {
  const profile = activeProfile(settings);
  if (!profile || settings?.browserSendCookies === false) return '';
  const host = String(hostname ?? '').toLowerCase();
  return (profile.cookies ?? [])
    .filter((cookie) => {
      const domain = String(cookie.domain ?? '').toLowerCase().replace(/^\./, '');
      return domain && (host === domain || host.endsWith(`.${domain}`));
    })
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
}

export { CONFIG_DIR };

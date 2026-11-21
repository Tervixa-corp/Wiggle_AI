// Runtime capability changes the model may perform on the user's behalf:
// installing a skill from a URL or pasted Markdown, and registering an MCP
// server. Both are gated by the permission layer before they run, and both
// touch only Wiggle's own configuration directory - never the workspace.

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { parseFrontmatter } from './skills.mjs';
import { CONFIG_DIR } from './settings.mjs';
import { validateMcpUrl } from './connectors.mjs';

export const SKILL_ROOT = path.join(CONFIG_DIR, 'skills');

const MAX_SKILL_BYTES = 400_000;
const MAX_SKILL_CHARS = 24_000;
const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export function slugifySkill(raw) {
  return String(raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '')
    .slice(0, 64);
}

/**
 * Only https is fetched. A GitHub "blob" link is rewritten to the raw file so
 * the model can pass the URL the user copied from the browser.
 */
export function normalizeSkillUrl(raw) {
  let url;
  try {
    url = new URL(String(raw ?? '').trim());
  } catch {
    throw new Error('The skill source must be an absolute URL.');
  }
  if (url.protocol !== 'https:') throw new Error('Skill sources must use https.');
  if (url.username || url.password) throw new Error('The URL must not contain credentials.');
  const parts = url.pathname.split('/').filter(Boolean);
  if (url.hostname === 'github.com' && parts.length >= 4 && parts[2] === 'blob') {
    const [owner, repo, , branch, ...rest] = parts;
    url.hostname = 'raw.githubusercontent.com';
    url.pathname = `/${owner}/${repo}/${branch}/${rest.join('/')}`;
  }
  return url.href;
}

export async function fetchSkillMarkdown(rawUrl, { fetchImpl = fetch } = {}) {
  const url = normalizeSkillUrl(rawUrl);
  const response = await fetchImpl(url, {
    redirect: 'error',
    headers: { Accept: 'text/plain, text/markdown;q=0.9, */*;q=0.1' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Could not fetch the skill (HTTP ${response.status}).`);
  const type = String(response.headers?.get?.('content-type') ?? '');
  const body = await response.text();
  if (body.length > MAX_SKILL_BYTES) throw new Error('That skill file is too large.');
  if (/^text\/html/i.test(type) && !/^---/.test(body.trim())) {
    throw new Error('The URL returned a web page, not a SKILL.md file. Use the raw file link.');
  }
  return body;
}

/** A skill must carry frontmatter with a name and description, plus a body. */
export function validateSkillMarkdown(markdown, fallbackName = '') {
  const source = String(markdown ?? '').trim();
  if (source.length < 20) throw new Error('A skill needs a SKILL.md body.');
  const { meta, body } = parseFrontmatter(source, fallbackName);
  const name = slugifySkill(meta.name || fallbackName);
  if (!name) throw new Error('A skill needs a name in its frontmatter.');
  if (!meta.description) throw new Error('A skill needs a description in its frontmatter.');
  if (body.trim().length < 10) throw new Error('The skill body is empty.');
  return {
    id: name,
    name: meta.name || fallbackName,
    description: meta.description,
    body: body.slice(0, MAX_SKILL_CHARS),
    markdown: source.slice(0, MAX_SKILL_CHARS),
  };
}

/**
 * Install a skill into ~/.wiggle/skills/<id>/SKILL.md and enable it.
 * @param {object} options
 * @param {object} options.settings  SettingsStore (update() is used)
 */
export async function installSkill({
  settings,
  name = '',
  url = '',
  markdown = '',
  overwrite = true,
  root = SKILL_ROOT,
  fetchImpl = fetch,
} = {}) {
  if (!settings || typeof settings.update !== 'function') throw new Error('Settings are unavailable.');
  const source = String(markdown ?? '').trim() || (url ? await fetchSkillMarkdown(url, { fetchImpl }) : '');
  if (!source) throw new Error('Pass a source_url or the SKILL.md contents.');

  const fallback = slugifySkill(name) || slugifySkill(url.split('/').pop()?.replace(/\.md$/i, '') ?? '');
  const skill = validateSkillMarkdown(source, fallback);
  if (!NAME_RE.test(skill.id)) throw new Error('The skill name must be lowercase letters, digits, dots, dashes or underscores.');

  const directory = path.join(root, skill.id);
  const existed = await readFile(path.join(directory, 'SKILL.md'), 'utf8').then(
    () => true,
    () => false,
  );
  if (existed && !overwrite) throw new Error(`Skill ${skill.id} is already installed.`);

  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'SKILL.md'), skill.markdown, 'utf8');
  await settings.update((current) => ({
    ...current,
    installedSkills: [...new Set([...(current.installedSkills ?? []), skill.id])],
    disabledSkills: (current.disabledSkills ?? []).filter((entry) => entry !== skill.id),
  }));

  return {
    ok: true,
    id: skill.id,
    name: skill.name,
    description: skill.description,
    path: path.join(directory, 'SKILL.md'),
    replaced: existed,
    enabled: true,
  };
}

export async function uninstallSkill({ settings, id, root = SKILL_ROOT } = {}) {
  const clean = slugifySkill(id);
  if (!NAME_RE.test(clean)) throw new Error('Invalid skill name.');
  await rm(path.join(root, clean), { recursive: true, force: true });
  await settings.update((current) => ({
    ...current,
    installedSkills: (current.installedSkills ?? []).filter((entry) => entry !== clean),
    disabledSkills: (current.disabledSkills ?? []).filter((entry) => entry !== clean),
  }));
  return { ok: true, id: clean };
}

/** Register (or replace) a remote MCP server in Settings -> Plugins. */
export async function registerMcpServer({ settings, name, url, transport = 'http', token = '', tokenEnv = '' } = {}) {
  if (!settings || typeof settings.update !== 'function') throw new Error('Settings are unavailable.');
  const cleanName = String(name ?? '').trim().slice(0, 100);
  if (!cleanName) throw new Error('Give the MCP server a name.');
  const endpoint = validateMcpUrl(String(url ?? ''));
  const mode = transport === 'sse' ? 'sse' : 'http';
  const id = `custom-${slugifySkill(cleanName)}`.slice(0, 48) || `custom-${Date.now().toString(36)}`;
  const server = {
    id,
    name: cleanName,
    url: endpoint,
    transport: mode,
    token: String(token ?? '').slice(0, 4096),
    tokenEnv: String(tokenEnv ?? '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 80),
    enabled: true,
    source: 'manual',
  };
  await settings.update((current) => ({
    ...current,
    mcpServers: { ...current.mcpServers, [id]: server },
  }));
  return { ok: true, id, name: cleanName, url: endpoint, transport: mode, tokenEnv: server.tokenEnv };
}

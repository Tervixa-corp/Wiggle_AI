// Persistent workstation settings.
//
// Settings live outside the workspace so a provider key and the user's
// preferences survive switching projects. Credentials never leave this file:
// the HTTP API reports whether a key exists, never the key itself.

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const CONFIG_DIR = process.env.WIGGLE_CONFIG_DIR || path.join(os.homedir(), '.wiggle');
const SETTINGS_PATH = path.join(CONFIG_DIR, 'settings.json');

export const SETTINGS_DEFAULTS = {
  version: 2,
  providerId: '',
  model: '',
  protocol: '',
  baseUrl: '',
  apiKeys: {},
  customIdentityInstructions: '',
  approvalMode: 'suggest',
  maxParallelAgents: 4,
  maxSteps: 8,
  outputStyle: 'default',
  dynamicWorkflows: true,
  promptSuggestions: true,
  summaryNextSteps: true,
  autoArchiveDays: 0,
  followUpBehavior: 'queue',
  theme: 'graphite',
  uiTheme: 'classic',
  uiPalette: 'freebuff',
  density: 'comfortable',
  uiFont: 'inter',
  uiZoom: 100,
  contrast: 'default',
  reduceMotion: false,
  interfaceLayout: 'software',
  startupView: 'chat',
  transcriptWidth: 'comfortable',
  defaultTranscriptView: 'normal',
  showChangedFiles: true,
  showBackgroundActivity: true,
  spellcheck: true,
  codeFont: '',
  codeFontSize: 13,
  terminalFontSize: 13,
  terminalScrollback: 4000,
  terminalShell: 'auto',
  editorTabSize: 2,
  editorWrap: true,
  editorLineNumbers: true,
  editorAutoSave: false,
  notifyAgent: true,
  notifyPermissions: true,
  notifyQuestions: true,
  notifyErrors: true,
  notifySound: true,
  flashTaskbar: true,
  browserTools: true,
  openLinksInBrowser: true,
  autoOpenFiles: true,
  browserAllowedHosts: [],
  memoryAutoExtract: true,
  browserHeadless: true,
  browserHome: 'https://github.com/Tervixa-corp/Wiggle_AI',
  browserProfiles: [],
  activeBrowserProfile: 'default',
  browserSendCookies: true,
  worktreeAuto: false,
  prBaseBranch: 'main',
  prDraft: false,
  remoteTarget: 'local',
  wslDistro: '',
  sshHost: '',
  remoteWorkdir: '',
  disabledSkills: [],
  disabledPlugins: [],
  shellAllowlist: [],
  roleModels: {},
  mcpServers: {},
  installedPlugins: [],
  installedSkills: [],
  pluginMeta: {},
  pluginSources: {},
  shortcutOverrides: {},
  lastWorkspace: '',
};

const ARRAY_LIMITS = {
  disabledSkills: 500,
  disabledPlugins: 500,
  shellAllowlist: 100,
  installedPlugins: 500,
  installedSkills: 500,
  browserAllowedHosts: 100,
};

const STRING_LIMITS = {
  providerId: 80,
  model: 256,
  protocol: 20,
  baseUrl: 500,
  customIdentityInstructions: 20000,
  approvalMode: 20,
  theme: 20,
  uiTheme: 20,
  uiPalette: 40,
  density: 20,
  uiFont: 20,
  interfaceLayout: 20,
  startupView: 20,
  transcriptWidth: 20,
  defaultTranscriptView: 20,
  followUpBehavior: 20,
  outputStyle: 20,
  contrast: 20,
  terminalShell: 20,
  codeFont: 80,
  browserHome: 800,
  lastWorkspace: 1000,
  activeBrowserProfile: 60,
  prBaseBranch: 120,
  wslDistro: 120,
  sshHost: 200,
  remoteWorkdir: 500,
};

const NUMBER_RANGES = {
  maxParallelAgents: [1, 12],
  maxSteps: [1, 30],
  uiZoom: [70, 150],
  codeFontSize: [10, 24],
  terminalFontSize: [10, 24],
  terminalScrollback: [500, 20000],
  editorTabSize: [1, 8],
  autoArchiveDays: [0, 365],
};

const BOOLEAN_KEYS = [
  'memoryAutoExtract',
  'browserHeadless',
  'dynamicWorkflows',
  'promptSuggestions',
  'summaryNextSteps',
  'reduceMotion',
  'showChangedFiles',
  'showBackgroundActivity',
  'spellcheck',
  'editorWrap',
  'editorLineNumbers',
  'editorAutoSave',
  'notifyAgent',
  'notifyPermissions',
  'notifyQuestions',
  'notifyErrors',
  'notifySound',
  'flashTaskbar',
  'browserTools',
  'openLinksInBrowser',
  'autoOpenFiles',
  'browserSendCookies',
  'worktreeAuto',
  'prDraft',
];

const ENUMS = {
  theme: ['dark', 'light', 'system', 'obsidian', 'graphite', 'midnight', 'porcelain'],
  uiTheme: ['classic', 'modern'],
  uiPalette: [
    'freebuff',
    'nord',
    'dracula',
    'tokyo-night',
    'gruvbox',
    'one-dark',
    'catppuccin',
    'catppuccin-latte',
    'rose-pine',
    'solarized-light',
    'cyberpunk',
    'matrix',
    'amber-crt',
    'vaporwave',
    'midnight-blue',
    'high-contrast',
  ],
  density: ['comfortable', 'compact'],
  uiFont: ['inter', 'segoe', 'cascadia', 'mono'],
  interfaceLayout: ['software', 'knowledge'],
  startupView: ['chat', 'agents'],
  transcriptWidth: ['narrow', 'comfortable', 'wide'],
  defaultTranscriptView: ['normal', 'thinking', 'verbose'],
  followUpBehavior: ['queue', 'steer'],
  outputStyle: ['default', 'concise', 'explanatory', 'learning'],
  contrast: ['default', 'strong'],
  terminalShell: ['auto', 'powershell', 'cmd', 'bash'],
  approvalMode: ['suggest', 'auto_edit', 'full_auto'],
  remoteTarget: ['local', 'wsl', 'ssh'],
};

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function cleanString(value, limit) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, limit);
}

/** Coerce any persisted or client-supplied patch into the settings schema. */
export function normalizeSettings(input, base = SETTINGS_DEFAULTS) {
  const source = isPlainObject(input) ? input : {};
  const out = { ...SETTINGS_DEFAULTS, ...base };

  for (const [key, limit] of Object.entries(STRING_LIMITS)) {
    if (key in source) out[key] = cleanString(source[key], limit);
  }
  if (!['chat', 'responses', 'anthropic', 'gemini', ''].includes(out.protocol)) out.protocol = '';
  for (const [key, allowed] of Object.entries(ENUMS)) {
    const candidate = key in source ? source[key] : out[key];
    out[key] = allowed.includes(candidate) ? candidate : SETTINGS_DEFAULTS[key];
  }

  for (const [key, [min, max]] of Object.entries(NUMBER_RANGES)) {
    if (key in source) {
      const value = Number(source[key]);
      out[key] = Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : SETTINGS_DEFAULTS[key];
    }
  }
  for (const key of BOOLEAN_KEYS) {
    if (key in source) out[key] = Boolean(source[key]);
  }
  for (const [key, limit] of Object.entries(ARRAY_LIMITS)) {
    if (key in source) {
      out[key] = Array.isArray(source[key])
        ? [...new Set(source[key].filter((v) => typeof v === 'string' && v.trim()).map((v) => v.trim().slice(0, 200)))].slice(0, limit)
        : [];
    }
  }
  if (isPlainObject(source.roleModels)) {
    out.roleModels = Object.fromEntries(
      Object.entries(source.roleModels)
        .filter(([role, model]) => /^[\w-]{1,40}$/.test(role) && typeof model === 'string')
        .slice(0, 20)
        .map(([role, model]) => [role, model.trim().slice(0, 256)]),
    );
  }
  if (isPlainObject(source.shortcutOverrides)) {
    out.shortcutOverrides = Object.fromEntries(
      Object.entries(source.shortcutOverrides)
        .filter(([key, value]) => /^[\w.-]{1,40}$/.test(key) && typeof value === 'string')
        .slice(0, 100)
        .map(([key, value]) => [key, value.slice(0, 80)]),
    );
  }
  if (isPlainObject(source.apiKeys)) {
    out.apiKeys = Object.fromEntries(
      Object.entries(source.apiKeys)
        .filter(([id, key]) => /^[\w.-]{1,80}$/.test(id) && typeof key === 'string' && key.length <= 4096)
        .slice(0, 300),
    );
  }
  if (isPlainObject(source.mcpServers)) {
    out.mcpServers = Object.fromEntries(
      Object.entries(source.mcpServers)
        .filter(([id, server]) => /^[\w.-]{1,64}$/.test(id) && isPlainObject(server))
        .slice(0, 100)
        .map(([id, server]) => {
          const transport = ['sse', 'stdio'].includes(server.transport) ? server.transport : 'http';
          return [
            id,
            {
              id,
              name: cleanString(server.name, 100) || id,
              url: cleanString(server.url, 600),
              transport,
              command: cleanString(server.command, 500),
              args: Array.isArray(server.args) ? server.args.slice(0, 40).map((arg) => cleanString(arg, 300)) : [],
              token: cleanString(server.token, 4096),
              tokenEnv: cleanString(server.tokenEnv, 120),
              enabled: server.enabled !== false,
              source: cleanString(server.source, 80) || 'manual',
            },
          ];
        }),
    );
  }
  if (Array.isArray(source.browserProfiles)) {
    const previous = Array.isArray(base?.browserProfiles) ? base.browserProfiles : [];
    out.browserProfiles = source.browserProfiles
      .filter(isPlainObject)
      .slice(0, 20)
      .map((profile, index) => {
        const id = /^[\w-]{1,60}$/.test(profile.id) ? profile.id : `profile-${index + 1}`;
        const prior = previous.find((entry) => entry.id === id);
        const cookies = (Array.isArray(profile.cookies) ? profile.cookies : [])
          .filter(isPlainObject)
          .slice(0, 200)
          .map((cookie, cookieIndex) => {
            const cookieId = /^[\w-]{1,60}$/.test(cookie.id) ? cookie.id : `cookie-${cookieIndex + 1}`;
            const priorCookie =
              prior?.cookies?.find((entry) => entry.id === cookieId) ??
              prior?.cookies?.find((entry) => entry.domain === cookie.domain && entry.name === cookie.name);
            const incoming = cleanString(cookie.value, 4096);
            return {
              id: cookieId,
              domain: cleanString(cookie.domain, 200).toLowerCase().replace(/^\./, ''),
              name: cleanString(cookie.name, 120),
              path: cleanString(cookie.path, 200) || '/',
              value: incoming === '[stored]' ? (priorCookie?.value ?? '') : incoming,
            };
          })
          .filter((cookie) => cookie.domain && cookie.name);
        return {
          id,
          name: cleanString(profile.name, 80) || `Profile ${index + 1}`,
          userAgent: cleanString(profile.userAgent, 300),
          allowedHosts: Array.isArray(profile.allowedHosts)
            ? [...new Set(profile.allowedHosts.filter((host) => typeof host === 'string' && host.trim()).map((host) => host.trim().toLowerCase().slice(0, 200)))].slice(0, 50)
            : [],
          cookies,
        };
      });
  }
  if (isPlainObject(source.pluginMeta)) {
    out.pluginMeta = Object.fromEntries(
      Object.entries(source.pluginMeta)
        .filter(([id, meta]) => /^[\w.-]{1,120}$/.test(id) && isPlainObject(meta))
        .slice(0, 300)
        .map(([id, meta]) => [
          id,
          {
            id,
            name: cleanString(meta.name, 140) || id,
            version: cleanString(meta.version, 40),
            description: cleanString(meta.description, 400),
            author: cleanString(meta.author, 140),
            category: cleanString(meta.category, 40),
            homepage: cleanString(meta.homepage, 400),
            installedAt: cleanString(meta.installedAt, 40),
            bytes: Number(meta.bytes) || 0,
            files: Number(meta.files) || 0,
            skills: Array.isArray(meta.skills) ? meta.skills.slice(0, 100).map((s) => cleanString(s, 100)) : [],
            commands: Array.isArray(meta.commands)
              ? meta.commands.slice(0, 100).map((c) => ({
                  id: cleanString(c?.id, 80),
                  name: cleanString(c?.name, 80),
                  kind: c?.kind === 'agent' ? 'agent' : 'command',
                  description: cleanString(c?.description, 200),
                }))
              : [],
            previousInstall: Boolean(meta.previousInstall),
          },
        ]),
    );
  }
  return out;
}

export function publicSettings(settings) {
  const { apiKeys, mcpServers, browserProfiles, ...rest } = settings;
  return {
    ...rest,
    browserProfiles: (browserProfiles ?? []).map((profile) => ({
      ...profile,
      cookies: (profile.cookies ?? []).map((cookie) => ({ ...cookie, value: '[stored]', hasValue: Boolean(cookie.value) })),
    })),
    keyStatus: Object.fromEntries(Object.entries(apiKeys ?? {}).map(([id, key]) => [id, Boolean(key)])),
    mcpServers: Object.fromEntries(
      Object.entries(mcpServers ?? {}).map(([id, server]) => [
        id,
        { ...server, token: server.token ? '[stored]' : '', hasToken: Boolean(server.token || (server.tokenEnv && process.env[server.tokenEnv])) },
      ]),
    ),
  };
}

export class SettingsStore {
  constructor(file = SETTINGS_PATH) {
    this.file = file;
    this.data = null;
  }

  async load() {
    if (this.data) return this.data;
    try {
      const parsed = JSON.parse(await fs.readFile(this.file, 'utf8'));
      this.data = normalizeSettings(parsed);
    } catch {
      this.data = normalizeSettings({});
    }
    return this.data;
  }

  async save(patch) {
    const current = await this.load();
    this.data = normalizeSettings(patch, current);
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.${process.pid}.tmp`;
    await fs.writeFile(temp, JSON.stringify(this.data, null, 2), { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temp, this.file);
    return this.data;
  }

  async update(updater) {
    const current = await this.load();
    const next = updater({ ...current });
    return this.save(next);
  }
}

export { CONFIG_DIR, SETTINGS_PATH };

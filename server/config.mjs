// Environment configuration. Everything is read once at startup; the browser
// never supplies provider settings and never receives credentials.

import path from 'node:path';
import { PRESET_NAMES, PRESETS } from './permissions.mjs';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** Validate a provider base URL: HTTPS, or plain HTTP on loopback only. */
export function validateBaseUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError('WIGGLE_BASE_URL must be an absolute URL');
  }
  if (url.username || url.password) throw new ConfigError('WIGGLE_BASE_URL must not contain credentials');
  if (url.search || url.hash) throw new ConfigError('WIGGLE_BASE_URL must not contain query parameters or a fragment');
  const loopback = LOOPBACK_HOSTS.has(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new ConfigError('WIGGLE_BASE_URL must use HTTPS, except for loopback HTTP endpoints');
  }
  return raw.replace(/\/+$/, '');
}

const DEFAULT_BASE = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
};

export function readConfig(env = process.env, cwd = process.cwd()) {
  const api = (env.WIGGLE_API || 'openai').trim().toLowerCase();
  if (!['openai', 'anthropic'].includes(api)) throw new ConfigError('WIGGLE_API must be "openai" or "anthropic"');

  const preset = (env.WIGGLE_PERMISSIONS || 'standard').trim().toLowerCase();
  if (!PRESET_NAMES.includes(preset)) throw new ConfigError(`WIGGLE_PERMISSIONS must be one of: ${PRESET_NAMES.join(', ')}`);

  const maxSteps = Number(env.WIGGLE_MAX_STEPS || 8);
  if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 30) throw new ConfigError('WIGGLE_MAX_STEPS must be an integer between 1 and 30');

  const base = validateBaseUrl((env.WIGGLE_BASE_URL || DEFAULT_BASE[api]).trim());

  // Loopback only unless the operator explicitly widens the Host allowlist.
  // Entries may be exact hostnames or suffixes beginning with a dot.
  const allowedHosts = (env.WIGGLE_ALLOWED_HOSTS || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  const host = (env.WIGGLE_HOST || '127.0.0.1').trim();

  return {
    api,
    base,
    host,
    allowedHosts,
    providerHost: new URL(base).hostname,
    model: (env.WIGGLE_MODEL || '').trim(),
    apiKey: (env.WIGGLE_API_KEY || '').trim(),
    workspace: path.resolve(env.WIGGLE_WORKSPACE || cwd),
    permissions: preset,
    rules: { ...PRESETS[preset] },
    maxSteps,
  };
}

export { LOOPBACK_HOSTS };

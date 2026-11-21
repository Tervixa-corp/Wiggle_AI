#!/usr/bin/env node
// Refresh catalog/extensions.json from the official Claude plugin marketplace.
//
// The marketplace manifest is the only machine-readable source that carries
// install metadata (`source`), so the app can actually clone a plugin instead
// of pretending to install it. Run with: node scripts/sync-marketplace.mjs

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE_URL = 'https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json';
const OUT = fileURLToPath(new URL('../catalog/extensions.json', import.meta.url));

const clip = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

function normaliseSource(source) {
  if (typeof source === 'string') return { source: 'git-subdir', path: source };
  if (!source || typeof source !== 'object') return null;
  const url = clip(source.url, 500);
  if (!/^https:\/\/[\w.-]+\/[\w./-]+(?:\.git)?$/.test(url)) return null;
  if (source.source === 'git-subdir') {
    return {
      source: 'git-subdir',
      url,
      path: clip(source.path, 300),
      ref: clip(source.ref || source.sha, 120),
      sha: clip(source.sha, 80),
    };
  }
  return { source: 'url', url, ref: clip(source.ref || source.sha, 120), sha: clip(source.sha, 80) };
}

const response = await fetch(SOURCE_URL, { headers: { Accept: 'application/json' } });
if (!response.ok) throw new Error(`Marketplace request failed: HTTP ${response.status}`);
const manifest = await response.json();
if (!Array.isArray(manifest.plugins)) throw new Error('Marketplace manifest has no plugins array');

const plugins = [];
const seen = new Set();
for (const plugin of manifest.plugins) {
  const name = clip(plugin.name, 120);
  if (!name || seen.has(name.toLowerCase())) continue;
  const source = normaliseSource(plugin.source);
  if (!source) continue;
  seen.add(name.toLowerCase());
  plugins.push({
    id: name,
    name: plugin.displayName ? clip(plugin.displayName, 120) : name,
    description: clip(plugin.description, 600),
    category: clip(plugin.category, 40) || 'other',
    author: clip(plugin.author?.name, 120),
    homepage: /^https:\/\//.test(plugin.homepage ?? '') ? clip(plugin.homepage, 400) : '',
    keywords: Array.isArray(plugin.keywords) ? plugin.keywords.filter((k) => typeof k === 'string').slice(0, 12).map((k) => clip(k, 40)) : [],
    skills: Array.isArray(plugin.skills) ? plugin.skills.filter((k) => typeof k === 'string').slice(0, 40) : [],
    source,
  });
}

plugins.sort((a, b) => a.name.localeCompare(b.name));
const payload = {
  syncedAt: new Date().toISOString(),
  source: 'https://github.com/anthropics/claude-plugins-official',
  plugins,
};
await writeFile(OUT, JSON.stringify(payload, null, 2), 'utf8');
console.log(`Wrote ${plugins.length} plugins to ${path.relative(process.cwd(), OUT)}`);

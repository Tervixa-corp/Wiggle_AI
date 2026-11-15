#!/usr/bin/env node
// Render the workbench headlessly and assert on the markup.
//
// The app is a single-page React tree; a type check cannot prove it mounts.
// This bundles the real components with esbuild and renders them in Node, so a
// broken import or a crash in render fails CI instead of showing a blank window.

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));

// Minimal browser globals the store touches during render.
const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
};

// The smoke test runs without a server: every API call must fail gracefully.
globalThis.fetch = async () => {
  throw new Error('offline smoke test');
};

const outDir = await mkdtemp(path.join(process.env.TMPDIR || tmpdir(), 'wiggle-smoke-'));
const outfile = path.join(outDir, 'smoke.cjs');

try {
  await build({
    entryPoints: [path.join(root, 'test/ui/smoke.entry.tsx')],
    outfile,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    jsx: 'automatic',
    target: 'node22',
    logLevel: 'warning',
    define: { 'process.env.NODE_ENV': '"production"' },
  });

  // CJS keeps React's dynamic requires of node builtins working.
  const module = createRequire(import.meta.url)(outfile);

  // Markup escapes punctuation, so compare against decoded text.
  const decode = (html) => html
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'");

  const app = module.renderApp();
  assert.match(app, /TERVIXA WIGGLE/, 'brand should render');
  assert.match(app, /class="rail"/, 'activity rail should render');
  assert.match(app, /Sessions/, 'session list should render');
  assert.match(app, /What are we working on\?/, 'empty chat state should render');
  assert.match(app, /class="statusbar"/, 'status bar should render');
  assert.match(app, /no workspace|Wiggle_AI/, 'titlebar should show workspace state');
  assert.ok(!/linear-gradient|radial-gradient|conic-gradient/.test(app), 'no gradients in markup');

  const chat = module.renderChat();
  assert.match(chat, /Describe a task|Connect a model/, 'composer should render');

  const editor = module.renderEditor();
  assert.match(editor, /No file open/, 'editor empty state should render');

  const settings = decode(module.renderSettings());
  for (const label of ['Identity & system prompt', 'Models & providers', 'Personal memory', 'Permissions & sandbox', 'Appearance & keys']) {
    assert.ok(settings.includes(label), `settings should list ${label}`);
  }

  console.log('render smoke: ok');
} finally {
  await rm(outDir, { recursive: true, force: true });
}

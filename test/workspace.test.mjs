import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createWorkspace, validateRelativePath, isSecretPath, MAX_FILE_BYTES } from '../server/workspace.mjs';
import { createApp } from '../server/app.mjs';

async function fixture() {
  const base = await mkdtemp(path.join(os.tmpdir(), 'wiggle-ws-'));
  const root = path.join(base, 'project');
  const outside = path.join(base, 'outside');
  await mkdir(path.join(root, 'src'), { recursive: true });
  await mkdir(path.join(root, '.git'), { recursive: true });
  await mkdir(path.join(root, 'node_modules', 'pkg'), { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(path.join(root, 'src', 'index.ts'), 'export const x = 1;\n');
  await writeFile(path.join(root, '.env'), 'API_KEY=hunter2\n');
  await writeFile(path.join(root, '.git', 'config'), '[core]\n');
  await writeFile(path.join(root, 'node_modules', 'pkg', 'a.js'), 'x');
  await writeFile(path.join(root, 'bin.dat'), Buffer.from([1, 2, 0, 3]));
  await writeFile(path.join(root, 'big.txt'), 'a'.repeat(MAX_FILE_BYTES + 1));
  await writeFile(path.join(outside, 'secret.txt'), 'outside secret');
  await symlink(path.join(outside, 'secret.txt'), path.join(root, 'escape.txt'));
  await symlink(outside, path.join(root, 'escape-dir'));
  return { base, root, outside, cleanup: () => rm(base, { recursive: true, force: true }) };
}

test('validateRelativePath rejects traversal, absolute and malformed paths', () => {
  assert.equal(validateRelativePath(''), '.');
  assert.equal(validateRelativePath('./src//index.ts'), 'src/index.ts');
  for (const bad of ['../etc/passwd', 'src/../../x', '/etc/passwd', 'C:\\Windows', '\\\\server\\share', 'a\0b']) {
    assert.throws(() => validateRelativePath(bad), /not allowed|NUL/, bad);
  }
  assert.throws(() => validateRelativePath(42), /must be a string/);
  assert.throws(() => validateRelativePath('a'.repeat(2000)), /too long/);
});

test('isSecretPath flags credentials and VCS internals', () => {
  for (const p of ['.env', '.env.local', 'config/.git/config', 'keys/server.pem', '.ssh/id_ed25519', '.npmrc']) assert.equal(isSecretPath(p), true, p);
  for (const p of ['src/env.ts', 'docs/keys.md', 'README.md']) assert.equal(isSecretPath(p), false, p);
});

test('lists workspace entries and skips VCS and dependency folders', async () => {
  const f = await fixture();
  try {
    const ws = await createWorkspace(f.root);
    const top = await ws.list('');
    const names = top.entries.map(e => e.name);
    assert.ok(names.includes('src'));
    assert.ok(!names.includes('.git'));
    assert.ok(!names.includes('node_modules'));
    assert.ok(!names.includes('.env'));
    assert.equal(top.entries.find(e => e.name === 'src').type, 'dir');
    const src = await ws.list('src');
    assert.deepEqual(src.entries.map(e => e.path), ['src/index.ts']);
  } finally { await f.cleanup(); }
});

test('reads files inside the workspace', async () => {
  const f = await fixture();
  try {
    const ws = await createWorkspace(f.root);
    const file = await ws.read('src/index.ts');
    assert.equal(file.content, 'export const x = 1;\n');
    assert.equal(file.path, 'src/index.ts');
  } finally { await f.cleanup(); }
});

test('refuses traversal, secrets, symlink escapes, binaries and oversized files', async () => {
  const f = await fixture();
  try {
    const ws = await createWorkspace(f.root);
    await assert.rejects(ws.read('../outside/secret.txt'), { status: 403 });
    await assert.rejects(ws.read('/etc/passwd'), { status: 403 });
    await assert.rejects(ws.read('.env'), { status: 403 });
    await assert.rejects(ws.read('.git/config'), { status: 403 });
    await assert.rejects(ws.read('escape.txt'), { status: 403 });
    await assert.rejects(ws.read('escape-dir/secret.txt'), { status: 403 });
    await assert.rejects(ws.list('escape-dir'), { status: 403 });
    await assert.rejects(ws.read('bin.dat'), { status: 415 });
    await assert.rejects(ws.read('big.txt'), { status: 413 });
    await assert.rejects(ws.read('missing.txt'), { status: 404 });
  } finally { await f.cleanup(); }
});

test('lists symlinks without following them outside the root', async () => {
  const f = await fixture();
  try {
    const ws = await createWorkspace(f.root);
    const top = await ws.list('');
    assert.equal(top.entries.find(e => e.name === 'escape-dir').type, 'symlink');
  } finally { await f.cleanup(); }
});

test('createWorkspace rejects missing directories and plain files', async () => {
  const f = await fixture();
  try {
    await assert.rejects(createWorkspace(path.join(f.base, 'nope')), /does not exist/);
    await assert.rejects(createWorkspace(path.join(f.root, 'bin.dat')), /must be a directory/);
  } finally { await f.cleanup(); }
});

async function withApp(workspace, fn) {
  const app = createApp({ config: { base: 'https://example.com/v1', model: 'm', apiKey: 'k' }, workspace });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  try { await fn(`http://127.0.0.1:${app.address().port}`); } finally { await new Promise(resolve => app.close(resolve)); }
}

test('workspace HTTP routes are read-only and report 404 when unconfigured', async () => {
  await withApp(null, async base => {
    assert.equal((await fetch(`${base}/api/workspace/list`)).status, 404);
  });
  const f = await fixture();
  try {
    const ws = await createWorkspace(f.root);
    await withApp(ws, async base => {
      const status = await (await fetch(`${base}/api/status`)).json();
      assert.equal(status.workspace, path.basename(f.root));
      const list = await fetch(`${base}/api/workspace/list?path=src`);
      assert.equal(list.status, 200);
      assert.equal((await list.json()).entries[0].name, 'index.ts');
      const file = await fetch(`${base}/api/workspace/file?path=${encodeURIComponent('../outside/secret.txt')}`);
      assert.equal(file.status, 403);
      const write = await fetch(`${base}/api/workspace/file?path=new.txt`, { method: 'POST', body: 'x' });
      assert.equal(write.status, 404);
      const cross = await fetch(`${base}/api/workspace/file?path=src/index.ts`, { headers: { Origin: 'https://attacker.example' } });
      assert.equal(cross.status, 403);
    });
  } finally { await f.cleanup(); }
});

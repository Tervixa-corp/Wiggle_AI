import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createWorkspace } from '../server/workspace.mjs';
import { createEditManager, lineDiff, applyOps, MAX_EDIT_BYTES } from '../server/edits.mjs';
import { createApp } from '../server/app.mjs';

async function fixture(files = {}) {
  const base = await mkdtemp(path.join(os.tmpdir(), 'wiggle-edit-'));
  const root = path.join(base, 'project');
  const outside = path.join(base, 'outside');
  await mkdir(path.join(root, 'src'), { recursive: true });
  await mkdir(path.join(root, 'node_modules', 'pkg'), { recursive: true });
  await mkdir(outside, { recursive: true });
  const defaults = { 'src/a.txt': 'one\ntwo\nthree\n', 'src/b.txt': 'alpha\nbeta\n' };
  for (const [name, content] of Object.entries({ ...defaults, ...files })) await writeFile(path.join(root, name), content);
  await writeFile(path.join(root, '.env'), 'SECRET=1\n');
  await writeFile(path.join(root, 'node_modules', 'pkg', 'x.js'), 'x\n');
  await writeFile(path.join(outside, 'target.txt'), 'outside\n');
  await symlink(path.join(outside, 'target.txt'), path.join(root, 'link.txt'));
  await writeFile(path.join(root, 'bin.dat'), Buffer.from([1, 0, 2]));
  return { base, root, outside, cleanup: () => rm(base, { recursive: true, force: true }) };
}

test('lineDiff marks additions, deletions and hunks; applyOps rebuilds exact text', () => {
  const before = 'a\nb\nc\nd\n';
  const after = 'a\nB\nc\nd\ne\n';
  const { ops, hunks } = lineDiff(before, after);
  assert.equal(hunks, 2);
  assert.equal(applyOps(ops, [0, 1]), after);
  assert.equal(applyOps(ops, []), before);
  // Hunk 0 replaces b with B; hunk 1 appends e. Accepting only hunk 0 keeps the append rejected.
  assert.equal(applyOps(ops, [0]), 'a\nB\nc\nd\n');
  assert.equal(applyOps(ops, [1]), 'a\nb\nc\nd\ne\n');
});

test('lineDiff handles empty files and full rewrites within limits', () => {
  assert.equal(applyOps(lineDiff('', 'new\n').ops, [0]), 'new\n');
  const big = Array.from({ length: 3000 }, (_, i) => `line ${i}`).join('\n');
  const changed = big.replace('line 1500', 'changed');
  const { ops } = lineDiff(big, changed);
  assert.equal(applyOps(ops, [...Array(lineDiff(big, changed).hunks).keys()]), changed);
});

test('propose does not touch disk; approve writes accepted hunks only', async () => {
  const f = await fixture();
  try {
    const ws = await createWorkspace(f.root);
    const edits = createEditManager(ws);
    const p = await edits.propose('src/a.txt', 'ONE\ntwo\nthree\nfour\n');
    assert.equal(p.status, 'pending');
    assert.equal(await readFile(path.join(f.root, 'src/a.txt'), 'utf8'), 'one\ntwo\nthree\n');
    const applied = await edits.approve(p.id, [0]);
    assert.equal(applied.status, 'partially applied');
    assert.equal(await readFile(path.join(f.root, 'src/a.txt'), 'utf8'), 'ONE\ntwo\nthree\n');
    await assert.rejects(edits.approve(p.id, [0]), { status: 409 });
  } finally { await f.cleanup(); }
});

test('approve refuses when the file changed after the proposal', async () => {
  const f = await fixture();
  try {
    const ws = await createWorkspace(f.root);
    const edits = createEditManager(ws);
    const p = await edits.propose('src/a.txt', 'changed\n');
    await writeFile(path.join(f.root, 'src/a.txt'), 'someone else\n');
    await assert.rejects(edits.approve(p.id), /changed after this proposal/);
    assert.equal(await readFile(path.join(f.root, 'src/a.txt'), 'utf8'), 'someone else\n');
  } finally { await f.cleanup(); }
});

test('reject leaves the file untouched and cannot be approved later', async () => {
  const f = await fixture();
  try {
    const edits = createEditManager(await createWorkspace(f.root));
    const p = await edits.propose('src/b.txt', 'gamma\n');
    assert.equal((await edits.reject(p.id)).status, 'rejected');
    await assert.rejects(edits.approve(p.id), { status: 409 });
    assert.equal(await readFile(path.join(f.root, 'src/b.txt'), 'utf8'), 'alpha\nbeta\n');
  } finally { await f.cleanup(); }
});

test('undo and redo restore exact content and refuse on external changes', async () => {
  const f = await fixture();
  try {
    const edits = createEditManager(await createWorkspace(f.root));
    const file = path.join(f.root, 'src/a.txt');
    const p = await edits.propose('src/a.txt', 'v2\n');
    await edits.approve(p.id);
    assert.equal(await readFile(file, 'utf8'), 'v2\n');
    await edits.undo();
    assert.equal(await readFile(file, 'utf8'), 'one\ntwo\nthree\n');
    await edits.redo();
    assert.equal(await readFile(file, 'utf8'), 'v2\n');
    await assert.rejects(edits.redo(), /Nothing to redo/);
    await writeFile(file, 'manual\n');
    await assert.rejects(edits.undo(), /changed since this edit/);
    await assert.rejects(createEditManager(await createWorkspace(f.root)).undo(), /Nothing to undo/);
  } finally { await f.cleanup(); }
});

test('edits refuse traversal, secrets, symlink escapes, vendored folders, binaries and oversized content', async () => {
  const f = await fixture();
  try {
    const edits = createEditManager(await createWorkspace(f.root));
    await assert.rejects(edits.propose('../outside/target.txt', 'x'), { status: 403 });
    await assert.rejects(edits.propose('/etc/passwd', 'x'), { status: 403 });
    await assert.rejects(edits.propose('.env', 'x'), { status: 403 });
    await assert.rejects(edits.propose('link.txt', 'x'), { status: 403 });
    await assert.rejects(edits.propose('node_modules/pkg/x.js', 'x'), { status: 403 });
    await assert.rejects(edits.propose('bin.dat', 'x'), { status: 415 });
    await assert.rejects(edits.propose('src/a.txt', 'x'.repeat(MAX_EDIT_BYTES + 1)), { status: 413 });
    await assert.rejects(edits.propose('src/a.txt', 'bad\0byte'), { status: 415 });
    await assert.rejects(edits.propose('src/a.txt', 42), /must be a string/);
    assert.equal(await readFile(path.join(f.outside, 'target.txt'), 'utf8'), 'outside\n');
  } finally { await f.cleanup(); }
});

async function withApp(workspace, fn) {
  const app = createApp({ config: { base: 'https://example.com/v1', model: 'm', apiKey: 'k' }, workspace });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  try { await fn(`http://127.0.0.1:${app.address().port}`); } finally { await new Promise(resolve => app.close(resolve)); }
}

test('HTTP edit flow: propose, review, approve, undo, and origin checks', async () => {
  const f = await fixture();
  try {
    const ws = await createWorkspace(f.root);
    await withApp(ws, async base => {
      const post = (url, body, headers = {}) => fetch(`${base}${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body ?? {}) });
      const created = await post('/api/edits', { path: 'src/b.txt', content: 'alpha\nBETA\n' });
      assert.equal(created.status, 201);
      const proposal = await created.json();
      assert.equal(proposal.status, 'pending');
      assert.equal(proposal.hunks, 1);
      const approved = await post(`/api/edits/${proposal.id}/approve`, { hunks: [0] });
      assert.equal(approved.status, 200);
      assert.equal(await readFile(path.join(f.root, 'src/b.txt'), 'utf8'), 'alpha\nBETA\n');
      const list = await (await fetch(`${base}/api/edits`)).json();
      assert.equal(list.undoDepth, 1);
      assert.equal((await post('/api/edits/undo')).status, 200);
      assert.equal(await readFile(path.join(f.root, 'src/b.txt'), 'utf8'), 'alpha\nbeta\n');
      assert.equal((await post('/api/edits/undo')).status, 409);
      const cross = await post('/api/edits', { path: 'src/a.txt', content: 'x' }, { Origin: 'https://attacker.example' });
      assert.equal(cross.status, 403);
      assert.equal((await post('/api/edits/not-a-real-id/approve', {})).status, 404);
    });
  } finally { await f.cleanup(); }
});

test('HTTP edit routes are unavailable without a workspace', async () => {
  await withApp(null, async base => {
    const res = await fetch(`${base}/api/edits`);
    assert.equal(res.status, 404);
  });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Workspace } from '../server/workspace.mjs';
import { SnapshotStore } from '../server/snapshots.mjs';

async function sandbox(fn) {
  const root = await mkdtemp(path.join(tmpdir(), 'wiggle-snap-'));
  try {
    await mkdir(path.join(root, 'src'), { recursive: true });
    await writeFile(path.join(root, 'src', 'a.txt'), 'one\n', 'utf8');
    await fn(await Workspace.open(root), root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const read = (root, rel) => readFile(path.join(root, rel), 'utf8');
const exists = (root, rel) => access(path.join(root, rel)).then(() => true, () => false);

test('undo restores the previous content and redo reapplies it', async () => {
  await sandbox(async (workspace, root) => {
    const snapshots = new SnapshotStore(root);
    const recorder = snapshots.begin('edit a');
    const before = await read(root, 'src/a.txt');
    await workspace.write('src/a.txt', 'two\n');
    await recorder.record('src/a.txt', before, 'two\n');
    assert.ok(await recorder.commit());

    assert.equal(await read(root, 'src/a.txt'), 'two\n');
    const undone = await snapshots.undo(workspace);
    assert.equal(undone.applied, true);
    assert.equal(await read(root, 'src/a.txt'), 'one\n');

    const redone = await snapshots.redo(workspace);
    assert.equal(redone.applied, true);
    assert.equal(await read(root, 'src/a.txt'), 'two\n');
  });
});

test('undo deletes files that the turn created', async () => {
  await sandbox(async (workspace, root) => {
    const snapshots = new SnapshotStore(root);
    const recorder = snapshots.begin('create b');
    await workspace.write('src/b.txt', 'new\n');
    await recorder.record('src/b.txt', null, 'new\n');
    await recorder.commit();

    assert.equal(await exists(root, 'src/b.txt'), true);
    await snapshots.undo(workspace);
    assert.equal(await exists(root, 'src/b.txt'), false);
  });
});

test('a turn that touches a file twice keeps the earliest before-state', async () => {
  await sandbox(async (workspace, root) => {
    const snapshots = new SnapshotStore(root);
    const recorder = snapshots.begin('two edits');
    await workspace.write('src/a.txt', 'two\n');
    await recorder.record('src/a.txt', 'one\n', 'two\n');
    await workspace.write('src/a.txt', 'three\n');
    await recorder.record('src/a.txt', 'two\n', 'three\n');
    await recorder.commit();

    assert.equal(recorder.touched.length, 1);
    assert.equal(await read(root, 'src/a.txt'), 'three\n');
    await snapshots.undo(workspace);
    assert.equal(await read(root, 'src/a.txt'), 'one\n');
  });
});

test('undo and redo report an empty stack instead of throwing', async () => {
  await sandbox(async (workspace, root) => {
    const snapshots = new SnapshotStore(root);
    assert.deepEqual(await snapshots.undo(workspace), { applied: false, reason: 'nothing to undo' });
    assert.deepEqual(await snapshots.redo(workspace), { applied: false, reason: 'nothing to redo' });
  });
});

test('a new turn clears the redo branch', async () => {
  await sandbox(async (workspace, root) => {
    const snapshots = new SnapshotStore(root);
    const first = snapshots.begin('first');
    await workspace.write('src/a.txt', 'two\n');
    await first.record('src/a.txt', 'one\n', 'two\n');
    await first.commit();
    await snapshots.undo(workspace);
    assert.equal((await snapshots.history()).redo, 1);

    const second = snapshots.begin('second');
    await workspace.write('src/c.txt', 'x\n');
    await second.record('src/c.txt', null, 'x\n');
    await second.commit();
    assert.equal((await snapshots.history()).redo, 0);
  });
});

test('no files touched means no snapshot is recorded', async () => {
  await sandbox(async (_workspace, root) => {
    const snapshots = new SnapshotStore(root);
    const recorder = snapshots.begin('read only');
    assert.equal(await recorder.commit(), null);
    assert.deepEqual(await snapshots.history(), { undo: 0, redo: 0 });
  });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Workspace, WorkspaceError, globToRegExp } from '../server/workspace.mjs';

async function sandbox(fn) {
  const root = await mkdtemp(path.join(tmpdir(), 'wiggle-ws-'));
  try {
    await mkdir(path.join(root, 'src'), { recursive: true });
    await writeFile(path.join(root, 'src', 'main.rs'), 'fn main() {}\n', 'utf8');
    await writeFile(path.join(root, 'README.md'), '# sample\n', 'utf8');
    await fn(await Workspace.open(root), root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('reads files inside the workspace', async () => {
  await sandbox(async (workspace) => {
    const file = await workspace.read('src/main.rs');
    assert.equal(file.path, 'src/main.rs');
    assert.match(file.content, /fn main/);
  });
});

test('refuses traversal, absolute paths and NUL bytes', async () => {
  await sandbox(async (workspace) => {
    for (const attempt of ['../secrets', 'src/../../etc/passwd', '/etc/passwd', 'C:\\Windows\\win.ini', 'src/\0bad']) {
      await assert.rejects(() => workspace.read(attempt), WorkspaceError, `expected ${JSON.stringify(attempt)} to be refused`);
    }
  });
});

test('refuses symlinks that escape the workspace', async () => {
  await sandbox(async (workspace, root) => {
    const outside = await mkdtemp(path.join(tmpdir(), 'wiggle-outside-'));
    try {
      await writeFile(path.join(outside, 'secret.txt'), 'classified\n', 'utf8');
      await symlink(outside, path.join(root, 'escape'), 'dir');
      await assert.rejects(() => workspace.read('escape/secret.txt'), (error) => error.code === 'outside_workspace');
      // A file that does not exist yet, under a symlinked directory, must fail too.
      await assert.rejects(() => workspace.write('escape/new.txt', 'x'), (error) => error.code === 'outside_workspace');
      // Files are still readable through normal paths.
      assert.match((await workspace.read('src/main.rs')).content, /fn main/);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

test('edit requires a unique match and reports it', async () => {
  await sandbox(async (workspace) => {
    await workspace.write('dup.txt', 'a\nb\na\n');
    await assert.rejects(() => workspace.edit('dup.txt', 'a', 'z'), (error) => error.code === 'ambiguous');
    const single = await workspace.edit('dup.txt', 'a\nb', 'a\nc');
    assert.equal(single.replacements, 1);
    assert.equal(await readFile(path.join(workspace.root, 'dup.txt'), 'utf8'), 'a\nc\na\n');
    const all = await workspace.edit('dup.txt', 'a', 'z', { all: true });
    assert.equal(all.replacements, 2);
    assert.equal(await readFile(path.join(workspace.root, 'dup.txt'), 'utf8'), 'z\nc\nz\n');
    await assert.rejects(() => workspace.edit('dup.txt', 'not-present', 'x'), (error) => error.code === 'not_found');
  });
});

test('write creates parent directories and records the prior content', async () => {
  await sandbox(async (workspace) => {
    const created = await workspace.write('deep/nested/file.txt', 'hello');
    assert.equal(created.created, true);
    assert.equal(created.before, null);
    const updated = await workspace.write('deep/nested/file.txt', 'again');
    assert.equal(updated.created, false);
    assert.equal(updated.before, 'hello');
  });
});

test('list, glob and grep stay inside the workspace and skip heavy directories', async () => {
  await sandbox(async (workspace, root) => {
    await mkdir(path.join(root, 'node_modules', 'pkg'), { recursive: true });
    await writeFile(path.join(root, 'node_modules', 'pkg', 'index.js'), 'needle\n', 'utf8');
    const listing = await workspace.list('.', { depth: 3 });
    assert.ok(listing.entries.some((entry) => entry.path === 'src/main.rs'));
    assert.ok(!listing.entries.some((entry) => entry.path.includes('node_modules')));

    const matches = await workspace.glob('**/*.rs');
    assert.deepEqual(matches, ['src/main.rs']);

    const found = await workspace.grep('needle');
    assert.equal(found.matches.length, 0, 'node_modules must not be searched');
    const hits = await workspace.grep('fn main', { glob: '**/*.rs' });
    assert.equal(hits.matches.length, 1);
    assert.equal(hits.matches[0].path, 'src/main.rs');
  });
});

test('rejects binary files rather than feeding NUL bytes onward', async () => {
  await sandbox(async (workspace, root) => {
    await writeFile(path.join(root, 'blob.bin'), Buffer.from([0, 1, 2, 3]));
    await assert.rejects(() => workspace.read('blob.bin'), (error) => error.code === 'binary_file');
  });
});

test('globToRegExp handles the patterns the agent uses', () => {
  assert.ok(globToRegExp('**/*.ts').test('src/a.ts'));
  assert.ok(globToRegExp('**/*.ts').test('a.ts'));
  assert.ok(!globToRegExp('**/*.ts').test('src/a.rs'));
  assert.ok(globToRegExp('src/**/test_*.rs').test('src/deep/test_a.rs'));
  assert.ok(globToRegExp('*.md').test('README.md'));
  assert.ok(!globToRegExp('*.md').test('docs/README.md'));
  assert.ok(globToRegExp('file?.txt').test('file1.txt'));
});

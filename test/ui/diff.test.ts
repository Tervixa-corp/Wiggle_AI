import test from 'node:test';
import assert from 'node:assert/strict';

import { diffLines, diffStats, collapseContext } from '../../apps/desktop-ui/src/lib/diff.ts';

test('identical input produces only unchanged lines', () => {
  const lines = diffLines('a\nb\n', 'a\nb\n');
  assert.equal(lines.length, 3);
  assert.ok(lines.every((line) => line.type === 'same'));
  assert.deepEqual(diffStats(lines), { added: 0, removed: 0 });
});

test('a single changed line is one removal and one addition', () => {
  const lines = diffLines('a\nb\nc', 'a\nB\nc');
  assert.deepEqual(diffStats(lines), { added: 1, removed: 1 });
  assert.deepEqual(lines.map((line) => line.type), ['same', 'del', 'add', 'same']);
  const added = lines.find((line) => line.type === 'add');
  assert.equal(added?.text, 'B');
  assert.equal(added?.leftLine, null);
  assert.equal(added?.rightLine, 2);
});

test('pure additions and deletions are counted', () => {
  assert.deepEqual(diffStats(diffLines('', 'x\ny')), { added: 2, removed: 0 });
  assert.deepEqual(diffStats(diffLines('x\ny', '')), { added: 0, removed: 2 });
  assert.deepEqual(diffStats(diffLines('a', 'a\nb\nc')), { added: 2, removed: 0 });
});

test('line numbers track both sides', () => {
  const lines = diffLines('one\ntwo\nthree', 'one\nthree\nfour');
  const kept = lines.find((line) => line.text === 'three' && line.type === 'same');
  assert.equal(kept?.leftLine, 3);
  assert.equal(kept?.rightLine, 2);
});

test('context collapsing hides long unchanged runs but keeps a window', () => {
  const before = Array.from({ length: 40 }, (_, i) => `line${i}`).join('\n');
  const after = before.replace('line20', 'changed20');
  const collapsed = collapseContext(diffLines(before, after), 2);
  const skips = collapsed.filter((entry) => entry.type === 'skip') as Array<{ count: number }>;
  assert.ok(skips.length >= 2);
  assert.ok(skips.every((skip) => skip.count > 1));
  const visible = collapsed.filter((entry) => entry.type !== 'skip');
  assert.ok(visible.length < 40);
  assert.ok(visible.some((entry) => entry.type === 'add' && entry.text === 'changed20'));
});

test('very large inputs degrade to a full replacement instead of hanging', () => {
  const before = Array.from({ length: 2000 }, (_, i) => `a${i}`).join('\n');
  const after = Array.from({ length: 2000 }, (_, i) => `b${i}`).join('\n');
  const started = Date.now();
  const lines = diffLines(before, after);
  assert.ok(Date.now() - started < 1000);
  assert.deepEqual(diffStats(lines), { added: 2000, removed: 2000 });
});

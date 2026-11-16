// Approval-gated text edits for the read-only workspace.
// Proposals never touch disk. Approving writes only the accepted hunks, atomically, after checking
// that the file still matches what was proposed. Every applied edit can be undone and redone.
import { createHash, randomUUID } from 'node:crypto';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { WorkspaceError } from './workspace.mjs';

export const MAX_EDIT_BYTES = 128 * 1024;
const MAX_LCS_CELLS = 4_000_000;
const MAX_PROPOSALS = 200;

const sha256 = buffer => createHash('sha256').update(buffer).digest('hex');

// Line diff as a list of ops: {type: 'ctx'|'add'|'del', text, hunk?}. Consecutive changes share a hunk id.
export function lineDiff(beforeText, afterText) {
  const a = beforeText.split('\n');
  const b = afterText.split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length, endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const ops = [];
  for (let i = 0; i < start; i++) ops.push({ type: 'ctx', text: a[i] });
  const midA = a.slice(start, endA), midB = b.slice(start, endB);
  const n = midA.length, m = midB.length;
  if (n * m > MAX_LCS_CELLS) {
    for (const text of midA) ops.push({ type: 'del', text });
    for (const text of midB) ops.push({ type: 'add', text });
  } else {
    const width = m + 1;
    const table = new Uint32Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        table[i * width + j] = midA[i] === midB[j]
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
      }
    }
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) { ops.push({ type: 'ctx', text: midA[i] }); i++; j++; }
      else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) { ops.push({ type: 'del', text: midA[i] }); i++; }
      else { ops.push({ type: 'add', text: midB[j] }); j++; }
    }
    while (i < n) ops.push({ type: 'del', text: midA[i++] });
    while (j < m) ops.push({ type: 'add', text: midB[j++] });
  }
  for (let k = endA; k < a.length; k++) ops.push({ type: 'ctx', text: a[k] });
  // Group changes into hunks so the user can accept or reject each change block.
  let hunk = -1, inChange = false;
  for (const op of ops) {
    if (op.type === 'ctx') { inChange = false; continue; }
    if (!inChange) { hunk++; inChange = true; }
    op.hunk = hunk;
  }
  return { ops, hunks: hunk + 1 };
}

// Rebuild the file: accepted hunks take the new lines, rejected hunks keep the old lines.
export function applyOps(ops, acceptedHunks) {
  const accepted = new Set(acceptedHunks);
  const out = [];
  for (const op of ops) {
    if (op.type === 'ctx') out.push(op.text);
    else if (op.type === 'del' && !accepted.has(op.hunk)) out.push(op.text);
    else if (op.type === 'add' && accepted.has(op.hunk)) out.push(op.text);
  }
  return out.join('\n');
}

export function createEditManager(workspace) {
  const proposals = new Map();
  const undoStack = [];
  const redoStack = [];
  let queue = Promise.resolve();

  // Serialize all state changes so concurrent requests cannot interleave writes.
  function locked(task) {
    const run = queue.then(task, task);
    queue = run.catch(() => {});
    return run;
  }

  async function writeAtomic(real, buffer) {
    const temp = `${real}.wiggle-${randomUUID()}.tmp`;
    try {
      await writeFile(temp, buffer, { flag: 'wx' });
      await rename(temp, real);
    } catch (error) {
      await unlink(temp).catch(() => {});
      throw error;
    }
  }

  async function currentBuffer(real) {
    return readFile(real);
  }

  function publicProposal(p) {
    return { id: p.id, path: p.path, status: p.status, hunks: p.hunks, stats: p.stats, ops: p.ops, createdAt: p.createdAt };
  }

  return {
    propose(relativePath, content) {
      return locked(async () => {
        if (typeof content !== 'string') throw new WorkspaceError('Content must be a string.');
        const afterBuffer = Buffer.from(content, 'utf8');
        if (afterBuffer.length > MAX_EDIT_BYTES) throw new WorkspaceError(`Edits are limited to ${MAX_EDIT_BYTES} bytes.`, 413);
        if (content.includes('\0')) throw new WorkspaceError('Binary content is not supported.', 415);
        const { rel, real } = await workspace.resolveFileForWrite(relativePath);
        const baseBuffer = await currentBuffer(real);
        if (baseBuffer.length > MAX_EDIT_BYTES) throw new WorkspaceError(`Files larger than ${MAX_EDIT_BYTES} bytes cannot be edited.`, 413);
        if (baseBuffer.subarray(0, 8192).includes(0)) throw new WorkspaceError('Binary files cannot be edited.', 415);
        let baseText;
        try { baseText = new TextDecoder('utf-8', { fatal: true }).decode(baseBuffer); }
        catch { throw new WorkspaceError('Only UTF-8 text files can be edited.', 415); }
        const { ops, hunks } = lineDiff(baseText, content);
        const added = ops.filter(o => o.type === 'add').length;
        const removed = ops.filter(o => o.type === 'del').length;
        const p = {
          id: randomUUID(), path: rel, status: 'pending', hunks, stats: { added, removed },
          ops, baseHash: sha256(baseBuffer), baseText, afterText: content, createdAt: new Date().toISOString(),
        };
        proposals.set(p.id, p);
        while (proposals.size > MAX_PROPOSALS) proposals.delete(proposals.keys().next().value);
        return publicProposal(p);
      });
    },

    list() {
      return locked(async () => ({
        proposals: [...proposals.values()].slice(-50).reverse().map(publicProposal),
        undoDepth: undoStack.length,
        redoDepth: redoStack.length,
        undo: undoStack.length ? { id: undoStack.at(-1).id, path: undoStack.at(-1).path } : null,
        redo: redoStack.length ? { id: redoStack.at(-1).id, path: redoStack.at(-1).path } : null,
      }));
    },

    approve(id, acceptedHunks) {
      return locked(async () => {
        const p = proposals.get(id);
        if (!p) throw new WorkspaceError('Proposal not found.', 404);
        if (p.status !== 'pending') throw new WorkspaceError(`Proposal is already ${p.status}.`, 409);
        const selected = acceptedHunks === undefined ? [...Array(p.hunks).keys()] : acceptedHunks;
        if (!Array.isArray(selected) || selected.some(h => !Number.isInteger(h) || h < 0 || h >= p.hunks)) {
          throw new WorkspaceError('Invalid hunk selection.');
        }
        if (selected.length === 0) throw new WorkspaceError('Select at least one change, or reject the proposal.');
        const { real } = await workspace.resolveFileForWrite(p.path);
        const beforeBuffer = await currentBuffer(real);
        if (sha256(beforeBuffer) !== p.baseHash) throw new WorkspaceError('The file changed after this proposal was made. Propose the edit again.', 409);
        const resultText = applyOps(p.ops, selected);
        const resultBuffer = Buffer.from(resultText, 'utf8');
        if (resultBuffer.equals(beforeBuffer)) throw new WorkspaceError('The selected changes do not alter the file.', 409);
        await writeAtomic(real, resultBuffer);
        undoStack.push({ id: p.id, path: p.path, before: beforeBuffer, after: resultBuffer, beforeHash: sha256(beforeBuffer), afterHash: sha256(resultBuffer), real });
        redoStack.length = 0;
        p.status = selected.length === p.hunks ? 'applied' : 'partially applied';
        p.acceptedHunks = selected;
        return publicProposal(p);
      });
    },

    reject(id) {
      return locked(async () => {
        const p = proposals.get(id);
        if (!p) throw new WorkspaceError('Proposal not found.', 404);
        if (p.status !== 'pending') throw new WorkspaceError(`Proposal is already ${p.status}.`, 409);
        p.status = 'rejected';
        return publicProposal(p);
      });
    },

    undo() {
      return locked(async () => {
        const op = undoStack.at(-1);
        if (!op) throw new WorkspaceError('Nothing to undo.', 409);
        const { real } = await workspace.resolveFileForWrite(op.path);
        if (sha256(await currentBuffer(real)) !== op.afterHash) throw new WorkspaceError('The file changed since this edit, so it cannot be undone safely.', 409);
        await writeAtomic(real, op.before);
        undoStack.pop();
        redoStack.push(op);
        return { path: op.path, undoDepth: undoStack.length, redoDepth: redoStack.length };
      });
    },

    redo() {
      return locked(async () => {
        const op = redoStack.at(-1);
        if (!op) throw new WorkspaceError('Nothing to redo.', 409);
        const { real } = await workspace.resolveFileForWrite(op.path);
        if (sha256(await currentBuffer(real)) !== op.beforeHash) throw new WorkspaceError('The file changed since the undo, so it cannot be redone safely.', 409);
        await writeAtomic(real, op.after);
        redoStack.pop();
        undoStack.push(op);
        return { path: op.path, undoDepth: undoStack.length, redoDepth: redoStack.length };
      });
    },
  };
}

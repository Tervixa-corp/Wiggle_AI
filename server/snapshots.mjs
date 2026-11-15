// Transactional snapshot engine backing /undo and /redo.
//
// Each agent turn records the before/after content of every file it touched.
// Content is stored once in a content-addressed blob directory, so a turn that
// edits one file repeatedly stores one blob per distinct revision. Undo restores
// the "before" side; redo restores the "after" side.

import { mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';

const MAX_STACK = 50;

const sha = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

export class SnapshotStore {
  constructor(root) {
    this.base = path.join(root, '.wiggle');
    this.blobs = path.join(this.base, 'blobs');
    this.turns = path.join(this.base, 'snapshots');
    this.statePath = path.join(this.base, 'state.json');
  }

  async ensureDirs() {
    await mkdir(this.blobs, { recursive: true });
    await mkdir(this.turns, { recursive: true });
  }

  async readState() {
    try {
      const parsed = JSON.parse(await readFile(this.statePath, 'utf8'));
      return { undo: Array.isArray(parsed.undo) ? parsed.undo : [], redo: Array.isArray(parsed.redo) ? parsed.redo : [] };
    } catch {
      return { undo: [], redo: [] };
    }
  }

  async writeState(state) {
    await this.ensureDirs();
    const payload = { undo: state.undo.slice(-MAX_STACK), redo: state.redo.slice(-MAX_STACK) };
    await writeFile(this.statePath, JSON.stringify(payload, null, 2), 'utf8');
  }

  async putBlob(content) {
    if (content === null) return null;
    const hash = sha(content);
    await mkdir(this.blobs, { recursive: true });
    await writeFile(path.join(this.blobs, hash), content, 'utf8');
    return hash;
  }

  async getBlob(hash) {
    if (hash === null) return null;
    return readFile(path.join(this.blobs, hash), 'utf8');
  }

  async loadManifest(id) {
    try {
      return JSON.parse(await readFile(path.join(this.turns, `${id}.json`), 'utf8'));
    } catch {
      throw new Error(`Snapshot ${id} is missing`);
    }
  }

  /** Begin recording a turn. Returns a recorder whose commit() is undoable. */
  begin(label = 'turn') {
    return new TurnRecorder(this, label);
  }

  async history() {
    const state = await this.readState();
    return { undo: state.undo.length, redo: state.redo.length };
  }

  async undo(workspace) {
    const state = await this.readState();
    const id = state.undo.pop();
    if (!id) return { applied: false, reason: 'nothing to undo' };
    const manifest = await this.loadManifest(id);
    const files = [];
    for (const file of [...manifest.files].reverse()) {
      files.push(await workspace.restore(file.path, await this.getBlob(file.before)));
    }
    state.redo.push(id);
    await this.writeState(state);
    return { applied: true, id, label: manifest.label, files };
  }

  async redo(workspace) {
    const state = await this.readState();
    const id = state.redo.pop();
    if (!id) return { applied: false, reason: 'nothing to redo' };
    const manifest = await this.loadManifest(id);
    const files = [];
    for (const file of manifest.files) {
      files.push(await workspace.restore(file.path, await this.getBlob(file.after)));
    }
    state.undo.push(id);
    await this.writeState(state);
    return { applied: true, id, label: manifest.label, files };
  }

  /** Persist a finished turn and push it onto the undo stack. */
  async commitTurn(recorder) {
    if (!recorder.files.size) return null;
    await this.ensureDirs();
    const manifest = {
      id: recorder.id,
      label: recorder.label,
      createdAt: new Date().toISOString(),
      files: [...recorder.files.values()],
    };
    await writeFile(path.join(this.turns, `${recorder.id}.json`), JSON.stringify(manifest, null, 2), 'utf8');
    const state = await this.readState();
    state.undo.push(recorder.id);
    state.redo = []; // a new turn invalidates the redo branch
    await this.writeState(state);
    return recorder.id;
  }

  /** Drop manifests that are no longer reachable from the undo/redo stacks. */
  async cleanup() {
    const state = await this.readState();
    const keep = new Set([...state.undo, ...state.redo]);
    const files = await readdir(this.turns).catch(() => []);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const id = file.slice(0, -'.json'.length);
      if (!keep.has(id)) await rm(path.join(this.turns, file), { force: true });
    }
  }
}

export class TurnRecorder {
  constructor(store, label) {
    this.store = store;
    this.label = label;
    this.id = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
    /** @type {Map<string, {path: string, before: string|null, after: string|null}>} */
    this.files = new Map();
  }

  /** Record a mutation. `before`/`after` are file contents, or null when absent. */
  async record(relPath, before, after) {
    const existing = this.files.get(relPath);
    if (existing) {
      // Keep the earliest "before" and the latest "after" for the whole turn.
      existing.after = await this.store.putBlob(after);
      return;
    }
    this.files.set(relPath, {
      path: relPath,
      before: await this.store.putBlob(before),
      after: await this.store.putBlob(after),
    });
  }

  get touched() {
    return [...this.files.keys()];
  }

  commit() {
    return this.store.commitTurn(this);
  }
}

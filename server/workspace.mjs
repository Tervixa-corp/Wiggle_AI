// Sandboxed workspace access for the Wiggle agent.
//
// Every path the agent can name is workspace-relative. Resolution refuses
// absolute paths, traversal segments, NUL bytes, and symlinks that point
// outside the workspace root (including a symlinked parent directory of a
// file that does not exist yet).

import { realpath, readdir, readFile, writeFile, mkdir, lstat, stat } from 'node:fs/promises';
import path from 'node:path';

export class WorkspaceError extends Error {
  constructor(message, code = 'workspace_error') {
    super(message);
    this.name = 'WorkspaceError';
    this.code = code;
  }
}

// Directories that are never interesting to an agent and can be enormous.
const SKIP_DIRS = new Set(['node_modules', '.git', '.wiggle', 'dist', 'target', 'build', '.next', '.venv', 'coverage']);
const MAX_READ_BYTES = 512 * 1024;
const MAX_TREE_ENTRIES = 5000;
const MAX_GREP_FILES = 2000;
const MAX_GREP_MATCHES = 200;

function inside(root, candidate) {
  return candidate === root || candidate.startsWith(root + path.sep);
}

/** Translate a simple glob (supports `**`, `*`, `?`) into an anchored RegExp. */
export function globToRegExp(pattern) {
  if (typeof pattern !== 'string' || !pattern.length) throw new WorkspaceError('glob pattern must be a non-empty string', 'invalid_argument');
  let out = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        const followedBySlash = pattern[i + 2] === '/';
        out += followedBySlash ? '(?:.*/)?' : '.*';
        i += followedBySlash ? 2 : 1;
        continue;
      }
      out += '[^/]*';
      continue;
    }
    if (ch === '?') {
      out += '[^/]';
      continue;
    }
    out += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

export class Workspace {
  /** @param {string} root absolute, already-resolved directory */
  constructor(root) {
    this.root = root;
    this.name = path.basename(root) || 'workspace';
  }

  static async open(root) {
    const absolute = path.resolve(root);
    const info = await stat(absolute).catch(() => null);
    if (!info?.isDirectory()) throw new WorkspaceError(`Workspace is not a directory: ${absolute}`, 'invalid_workspace');
    return new Workspace(await realpath(absolute));
  }

  /**
   * Resolve a workspace-relative path to a safe absolute path.
   * Walks up to the nearest existing ancestor and realpaths it so a symlinked
   * directory cannot be used to escape the sandbox.
   */
  async resolve(relative, { allowRoot = false } = {}) {
    if (typeof relative !== 'string') throw new WorkspaceError('path must be a string', 'invalid_argument');
    if (relative.includes('\0')) throw new WorkspaceError('path must not contain NUL bytes', 'invalid_argument');
    if (path.isAbsolute(relative) || /^[a-zA-Z]:[\\/]/.test(relative)) {
      throw new WorkspaceError('path must be relative to the workspace root', 'outside_workspace');
    }
    const normalized = path.normalize(relative === '' ? '.' : relative);
    if (normalized === '.' && !allowRoot) throw new WorkspaceError('a file path is required', 'invalid_argument');
    if (normalized === '..' || normalized.startsWith('..' + path.sep)) {
      throw new WorkspaceError('path must stay inside the workspace root', 'outside_workspace');
    }

    const absolute = path.resolve(this.root, normalized);
    if (!inside(this.root, absolute)) throw new WorkspaceError('path must stay inside the workspace root', 'outside_workspace');
    if (absolute === this.root && !allowRoot) throw new WorkspaceError('a file path is required', 'invalid_argument');

    // Find the deepest existing ancestor and verify its real path stays inside.
    let probe = absolute;
    for (;;) {
      const info = await lstat(probe).catch(() => null);
      if (info) {
        const real = await realpath(probe).catch(() => null);
        if (real === null || !inside(this.root, real)) {
          throw new WorkspaceError('path resolves outside the workspace root', 'outside_workspace');
        }
        break;
      }
      const parent = path.dirname(probe);
      if (parent === probe) throw new WorkspaceError('could not resolve path', 'invalid_argument');
      probe = parent;
    }
    return absolute;
  }

  /** Workspace-relative, forward-slash form used in tool output and diffs. */
  rel(absolute) {
    return path.relative(this.root, absolute).split(path.sep).join('/');
  }

  async read(relative) {
    const absolute = await this.resolve(relative);
    const info = await lstat(absolute);
    if (info.isDirectory()) throw new WorkspaceError(`${relative} is a directory; use list_dir`, 'is_directory');
    if (!info.isFile()) throw new WorkspaceError(`${relative} is not a regular file`, 'not_a_file');
    if (info.size > MAX_READ_BYTES) throw new WorkspaceError(`${relative} is larger than ${MAX_READ_BYTES} bytes`, 'too_large');
    const buffer = await readFile(absolute);
    // Reject binary content rather than feeding NUL bytes to the model.
    if (buffer.subarray(0, 8000).includes(0)) throw new WorkspaceError(`${relative} looks binary`, 'binary_file');
    return { path: this.rel(absolute), content: buffer.toString('utf8'), bytes: buffer.length };
  }

  async write(relative, content) {
    if (typeof content !== 'string') throw new WorkspaceError('content must be a string', 'invalid_argument');
    const absolute = await this.resolve(relative);
    const existing = await lstat(absolute).catch(() => null);
    if (existing?.isDirectory()) throw new WorkspaceError(`${relative} is a directory`, 'is_directory');
    const before = existing ? await readFile(absolute, 'utf8') : null;
    await mkdir(path.dirname(absolute), { recursive: true });
    // Re-validate after mkdir: a symlink could have been created in the parents.
    await this.resolve(relative);
    await writeFile(absolute, content, 'utf8');
    return { path: this.rel(absolute), created: !existing, bytes: Buffer.byteLength(content), before };
  }

  /**
   * Replace exact text. Fails when the needle is missing or ambiguous so the
   * agent cannot silently edit the wrong occurrence.
   */
  async edit(relative, oldText, newText, { all = false } = {}) {
    if (typeof oldText !== 'string' || oldText.length === 0) throw new WorkspaceError('old_text must be a non-empty string', 'invalid_argument');
    if (typeof newText !== 'string') throw new WorkspaceError('new_text must be a string', 'invalid_argument');
    if (oldText === newText) throw new WorkspaceError('old_text and new_text are identical', 'invalid_argument');
    const { content, path: relPath } = await this.read(relative);
    const count = content.split(oldText).length - 1;
    if (count === 0) throw new WorkspaceError('old_text was not found; read the file and copy the exact text', 'not_found');
    if (count > 1 && !all) throw new WorkspaceError(`old_text matched ${count} times; include more context or set all=true`, 'ambiguous');
    const updated = all ? content.split(oldText).join(newText) : content.replace(oldText, () => newText);
    await this.write(relative, updated);
    return { path: relPath, replacements: all ? count : 1, before: content };
  }

  async list(relative = '.', { depth = 2 } = {}) {
    const absolute = await this.resolve(relative, { allowRoot: true });
    const maxDepth = Math.min(Math.max(Number(depth) || 2, 1), 6);
    const entries = [];
    let budget = MAX_TREE_ENTRIES;

    const walk = async (dir, level) => {
      if (level > maxDepth || budget <= 0) return;
      let children;
      try {
        children = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      children.sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      for (const child of children) {
        if (budget-- <= 0) return;
        if (child.isDirectory() && SKIP_DIRS.has(child.name)) continue;
        const childAbs = path.join(dir, child.name);
        const relPath = this.rel(childAbs);
        if (child.isDirectory()) {
          entries.push({ path: relPath, type: 'dir', depth: level });
          await walk(childAbs, level + 1);
        } else if (child.isFile()) {
          const info = await lstat(childAbs).catch(() => null);
          entries.push({ path: relPath, type: 'file', depth: level, bytes: info?.size ?? 0 });
        }
      }
    };

    await walk(absolute, 1);
    return { root: this.name, entries, truncated: budget <= 0 };
  }

  async glob(pattern) {
    const matcher = globToRegExp(pattern);
    const { entries } = await this.list('.', { depth: 6 });
    return entries.filter((entry) => entry.type === 'file' && matcher.test(entry.path)).map((entry) => entry.path);
  }

  async grep(pattern, { glob = null, ignoreCase = false } = {}) {
    if (typeof pattern !== 'string' || !pattern.length) throw new WorkspaceError('pattern must be a non-empty string', 'invalid_argument');
    let regex;
    try {
      regex = new RegExp(pattern, ignoreCase ? 'i' : '');
    } catch {
      throw new WorkspaceError('pattern is not a valid regular expression', 'invalid_argument');
    }
    const fileMatcher = glob ? globToRegExp(glob) : null;
    const { entries } = await this.list('.', { depth: 6 });
    const files = entries.filter((entry) => entry.type === 'file' && (!fileMatcher || fileMatcher.test(entry.path))).slice(0, MAX_GREP_FILES);
    const matches = [];

    for (const file of files) {
      if (matches.length >= MAX_GREP_MATCHES) break;
      let buffer;
      try {
        buffer = await readFile(path.join(this.root, file.path));
      } catch {
        continue;
      }
      if (buffer.subarray(0, 4000).includes(0)) continue;
      const lines = buffer.toString('utf8').split('\n');
      for (let i = 0; i < lines.length; i += 1) {
        if (matches.length >= MAX_GREP_MATCHES) break;
        if (regex.test(lines[i])) {
          matches.push({ path: file.path, line: i + 1, text: lines[i].slice(0, 300) });
        }
      }
    }
    return { matches, filesSearched: files.length, truncated: matches.length >= MAX_GREP_MATCHES };
  }

  /** Restore a file to an exact prior state during undo/redo. */
  async restore(relative, content) {
    const absolute = await this.resolve(relative);
    if (content === null) {
      const { rm } = await import('node:fs/promises');
      await rm(absolute, { force: true });
      return { path: this.rel(absolute), deleted: true };
    }
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, content, 'utf8');
    return { path: this.rel(absolute), restored: true };
  }
}

export { MAX_READ_BYTES, SKIP_DIRS };

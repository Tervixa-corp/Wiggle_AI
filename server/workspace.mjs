// Read-only, workspace-scoped file access for the local gateway.
// Every path is resolved against the realpath of the workspace root, so traversal,
// absolute paths and symlinks that point outside the root are rejected.
import { open, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

export const MAX_FILE_BYTES = 256 * 1024;
export const MAX_DIR_ENTRIES = 1000;
const MAX_PATH_LENGTH = 1024;
const SKIPPED_DIRS = new Set(['.git', 'node_modules', 'target', 'dist', '.wiggle']);

export class WorkspaceError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'WorkspaceError';
    this.status = status;
  }
}

// Files that commonly hold credentials are never read, even inside the workspace.
export function isSecretPath(relative) {
  const parts = relative.split(/[\\/]+/).filter(Boolean);
  const base = parts[parts.length - 1] || '';
  if (parts.some(p => p === '.git')) return true;
  if (/^\.env(\..*)?$/i.test(base)) return true;
  if (/\.(pem|key|p12|pfx|kdbx)$/i.test(base)) return true;
  if (/^(id_rsa|id_ed25519|id_ecdsa|id_dsa)(\.pub)?$/i.test(base)) return true;
  if (/^(\.npmrc|\.netrc|\.pypirc|credentials|\.git-credentials)$/i.test(base)) return true;
  return false;
}

export function validateRelativePath(input) {
  if (input === undefined || input === null || input === '') return '.';
  if (typeof input !== 'string') throw new WorkspaceError('Path must be a string.');
  if (input.length > MAX_PATH_LENGTH) throw new WorkspaceError('Path is too long.');
  if (input.includes('\0')) throw new WorkspaceError('Path contains a NUL byte.');
  if (path.isAbsolute(input) || path.win32.isAbsolute(input) || /^[a-zA-Z]:/.test(input) || input.startsWith('\\') || input.startsWith('/')) {
    throw new WorkspaceError('Absolute paths are not allowed.', 403);
  }
  const segments = input.split(/[\\/]+/).filter(s => s !== '' && s !== '.');
  if (segments.includes('..')) throw new WorkspaceError('Parent directory segments are not allowed.', 403);
  return segments.join('/') || '.';
}

export async function createWorkspace(rootDir) {
  if (!rootDir || typeof rootDir !== 'string') throw new WorkspaceError('Workspace path is required.');
  const root = await realpath(rootDir).catch(() => { throw new WorkspaceError('Workspace directory does not exist.'); });
  if (!(await stat(root)).isDirectory()) throw new WorkspaceError('Workspace must be a directory.');

  // Resolve a validated relative path to a real path that must stay inside the root.
  async function resolveInside(relative) {
    const rel = validateRelativePath(relative);
    if (isSecretPath(rel)) throw new WorkspaceError('This file is excluded for security reasons.', 403);
    const joined = path.join(root, rel);
    let real;
    try { real = await realpath(joined); } catch { throw new WorkspaceError('Not found.', 404); }
    if (real !== root && !real.startsWith(root + path.sep)) throw new WorkspaceError('Path resolves outside the workspace.', 403);
    const realRel = path.relative(root, real).split(path.sep).join('/') || '.';
    if (isSecretPath(realRel)) throw new WorkspaceError('This file is excluded for security reasons.', 403);
    return { rel, real };
  }

  return {
    name: path.basename(root),
    root,

    async list(relative) {
      const { rel, real } = await resolveInside(relative);
      if (!(await stat(real)).isDirectory()) throw new WorkspaceError('Not a directory.');
      const dirents = await readdir(real, { withFileTypes: true });
      const entries = [];
      for (const d of dirents.sort((a, b) => a.name.localeCompare(b.name))) {
        if (entries.length >= MAX_DIR_ENTRIES) break;
        if (d.isDirectory() && SKIPPED_DIRS.has(d.name)) continue;
        const childRel = rel === '.' ? d.name : `${rel}/${d.name}`;
        if (isSecretPath(childRel)) continue;
        const type = d.isDirectory() ? 'dir' : d.isFile() ? 'file' : d.isSymbolicLink() ? 'symlink' : 'other';
        entries.push({ name: d.name, path: childRel, type });
      }
      return { path: rel, entries, truncated: dirents.length > MAX_DIR_ENTRIES };
    },

    // Resolve an existing regular file that may be edited. Excluded and vendored folders are never writable.
    async resolveFileForWrite(relative) {
      const rel = validateRelativePath(relative);
      if (rel === '.') throw new WorkspaceError('Choose a file, not the workspace root.');
      if (rel.split('/').some(part => SKIPPED_DIRS.has(part))) throw new WorkspaceError('This location is excluded from edits.', 403);
      const { real } = await resolveInside(rel);
      if (!(await stat(real)).isFile()) throw new WorkspaceError('Not a regular file.');
      return { rel, real };
    },

    async read(relative, { maxBytes = MAX_FILE_BYTES } = {}) {
      const { rel, real } = await resolveInside(relative);
      const info = await stat(real);
      if (!info.isFile()) throw new WorkspaceError('Not a regular file.');
      if (info.size > maxBytes) throw new WorkspaceError(`File is larger than ${maxBytes} bytes.`, 413);
      const handle = await open(real, 'r');
      try {
        const buffer = Buffer.alloc(Math.min(info.size, maxBytes));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        const content = buffer.subarray(0, bytesRead);
        if (content.subarray(0, 8192).includes(0)) throw new WorkspaceError('Binary files are not supported.', 415);
        return { path: rel, size: info.size, content: content.toString('utf8') };
      } finally { await handle.close(); }
    },
  };
}

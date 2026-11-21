// Copies the already-staged runtime payload into the Tauri crate so the MSI
// ships the same files as the standalone installer: the Node runtime, the
// gateway, the built workbench, the catalogs and the plugin/skill bundles.

import { cp, mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const source = path.join(repo, 'packaging', 'stage');
const target = path.join(repo, 'crates', 'wiggle-desktop', 'resources');

async function exists(target_path) {
  try {
    await stat(target_path);
    return true;
  } catch {
    return false;
  }
}

if (!(await exists(path.join(source, 'app'))) || !(await exists(path.join(source, 'node')))) {
  console.error('packaging/stage is missing. Build the runtime payload first.');
  process.exit(1);
}

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(path.join(source, 'app'), path.join(target, 'app'), { recursive: true });
await cp(path.join(source, 'node'), path.join(target, 'node'), { recursive: true });

console.log('Staged Tauri resources into crates/wiggle-desktop/resources');

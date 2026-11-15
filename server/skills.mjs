// SKILL.md loading and matching.
//
// A skill is Markdown with optional YAML-ish frontmatter:
//   ---
//   name: release-checklist
//   description: How to cut a release
//   ---
//   Steps...
// Skills are instructions for the model, never executable code, and they are
// never able to bypass the permission gate.

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const MAX_SKILL_BYTES = 24000;
const STOPWORDS = new Set(['the', 'a', 'an', 'and', 'or', 'to', 'of', 'in', 'on', 'for', 'with', 'is', 'are', 'be', 'how', 'use', 'using', 'this', 'that', 'it', 'my', 'me', 'i']);

export function tokenize(text) {
  return String(text ?? '')
    .toLowerCase()
    .split(/[^a-z0-9_+#.-]+/)
    .filter((word) => word.length > 2 && !STOPWORDS.has(word));
}

export function parseFrontmatter(source, fallbackName) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  if (!match) return { meta: { name: fallbackName, description: '' }, body: source.trim() };
  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const pair = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line.trim());
    if (pair) meta[pair[1].toLowerCase()] = pair[2].replace(/^['"]|['"]$/g, '').trim();
  }
  return {
    meta: { name: meta.name || fallbackName, description: meta.description || '' },
    body: source.slice(match[0].length).trim(),
  };
}

/** Load every SKILL.md one directory below each root. Missing roots are ignored. */
export async function loadSkills(roots) {
  const skills = [];
  const seen = new Set();
  for (const root of roots) {
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(root, entry.name);
      const file = path.join(dir, 'SKILL.md');
      try {
        const info = await readFile(file);
        if (info.length > MAX_SKILL_BYTES) continue;
        const { meta, body } = parseFrontmatter(info.toString('utf8'), entry.name);
        const key = meta.name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        skills.push({ name: meta.name, description: meta.description, body, source: root, directory: dir });
      } catch {
        continue;
      }
    }
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

/** Rank skills against a prompt by token overlap. Returns at most `limit`. */
export function matchSkills(skills, prompt, limit = 3) {
  const query = new Set(tokenize(prompt));
  if (!query.size) return [];
  const scored = skills.map((skill) => {
    const haystack = new Set(tokenize(`${skill.name} ${skill.description} ${skill.body.slice(0, 2000)}`));
    let score = 0;
    for (const token of query) {
      if (haystack.has(token)) score += 1;
      if (skill.name.toLowerCase().split('-').includes(token)) score += 2;
    }
    return { skill, score };
  });
  return scored
    .filter((entry) => entry.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.skill);
}

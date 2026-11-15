// Local personal memory: durable facts about the user and their project.
//
// Stored as plain JSON under `.wiggle/memory.json` so it is inspectable and
// deletable without the app. Retrieval is lexical overlap, not embeddings: it
// is deterministic, dependency-free, and honestly documented as such.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { tokenize } from './skills.mjs';

const MAX_FACTS = 500;
const MAX_FACT_CHARS = 500;

export class MemoryStore {
  constructor(root) {
    this.dir = path.join(root, '.wiggle');
    this.file = path.join(this.dir, 'memory.json');
    this.facts = [];
    this.loaded = false;
  }

  async load() {
    if (this.loaded) return this;
    this.loaded = true;
    try {
      const parsed = JSON.parse(await readFile(this.file, 'utf8'));
      if (Array.isArray(parsed?.facts)) {
        this.facts = parsed.facts.filter((fact) => fact && typeof fact.text === 'string');
      }
    } catch {
      this.facts = [];
    }
    return this;
  }

  async save() {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.file, JSON.stringify({ version: 1, facts: this.facts }, null, 2), 'utf8');
  }

  async add(text, { pinned = false, source = 'user' } = {}) {
    await this.load();
    const trimmed = String(text ?? '').trim();
    if (!trimmed) throw new Error('Fact text is required');
    if (trimmed.length > MAX_FACT_CHARS) throw new Error(`Fact must be at most ${MAX_FACT_CHARS} characters`);
    const duplicate = this.facts.find((fact) => fact.text.toLowerCase() === trimmed.toLowerCase());
    if (duplicate) return duplicate;
    const fact = { id: `mem_${randomUUID().slice(0, 12)}`, text: trimmed, pinned: Boolean(pinned), source, createdAt: new Date().toISOString() };
    this.facts.push(fact);
    if (this.facts.length > MAX_FACTS) this.facts = this.facts.slice(-MAX_FACTS);
    await this.save();
    return fact;
  }

  async remove(id) {
    await this.load();
    const before = this.facts.length;
    this.facts = this.facts.filter((fact) => fact.id !== id);
    if (this.facts.length !== before) await this.save();
    return this.facts.length !== before;
  }

  async list() {
    await this.load();
    return [...this.facts];
  }

  /** Facts ranked by token overlap with the prompt; pinned facts always lead. */
  async relevant(query, limit = 6) {
    await this.load();
    const tokens = new Set(tokenize(query));
    const scored = this.facts.map((fact) => {
      const haystack = new Set(tokenize(fact.text));
      let score = 0;
      for (const token of tokens) if (haystack.has(token)) score += 1;
      return { fact, score: score + (fact.pinned ? 0.5 : 0) };
    });
    return scored
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((entry) => entry.fact);
  }
}

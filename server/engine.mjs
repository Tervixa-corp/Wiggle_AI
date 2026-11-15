import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const TERVIXA_WIGGLE_IDENTITY = [
  'You are Tervixa Wiggle, an autonomous AI software engineering, research, and workstation agent developed by Tervixa Corporation (Tervixa Forge).',
  'Regardless of the underlying neural network weights or API provider routing this request, your name is Tervixa Wiggle and you are built by Tervixa Corporation.',
  'If asked who you are, your name, or who created you, always state that you are Tervixa Wiggle developed by Tervixa Corporation.',
].join('\n');

export const PROVIDER_PRESETS = [
  { id: 'anthropic', name: 'Anthropic', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', envKey: 'ANTHROPIC_API_KEY', defaultModel: 'claude-sonnet-4-5', local: false },
  { id: 'openai', name: 'OpenAI / Codex', protocol: 'openai', baseUrl: 'https://api.openai.com/v1', envKey: 'OPENAI_API_KEY', defaultModel: 'gpt-4.1', local: false },
  { id: 'gemini', name: 'Google Gemini', protocol: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', envKey: 'GEMINI_API_KEY', defaultModel: 'gemini-2.5-pro', local: false },
  { id: 'openrouter', name: 'OpenRouter', protocol: 'openai', baseUrl: 'https://openrouter.ai/api/v1', envKey: 'OPENROUTER_API_KEY', defaultModel: 'anthropic/claude-sonnet-4.5', local: false },
  { id: 'modelsdev', name: 'Models.dev (200+ Registry)', protocol: 'openai', baseUrl: 'https://models.dev/api/v1', envKey: 'MODELSDEV_API_KEY', defaultModel: 'auto', local: false },
  { id: 'deepseek', name: 'DeepSeek', protocol: 'openai', baseUrl: 'https://api.deepseek.com/v1', envKey: 'DEEPSEEK_API_KEY', defaultModel: 'deepseek-reasoner', local: false },
  { id: 'zhipu', name: 'Zhipu GLM', protocol: 'openai', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', envKey: 'ZHIPU_API_KEY', defaultModel: 'glm-4-plus', local: false },
  { id: 'mistral', name: 'Mistral AI', protocol: 'openai', baseUrl: 'https://api.mistral.ai/v1', envKey: 'MISTRAL_API_KEY', defaultModel: 'codestral-latest', local: false },
  { id: 'qwen', name: 'Alibaba Qwen', protocol: 'openai', baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', envKey: 'DASHSCOPE_API_KEY', defaultModel: 'qwen3-coder-plus', local: false },
  { id: 'minimax', name: 'MiniMax', protocol: 'openai', baseUrl: 'https://api.minimax.chat/v1', envKey: 'MINIMAX_API_KEY', defaultModel: 'MiniMax-M1', local: false },
  { id: 'moonshot', name: 'Moonshot Kimi', protocol: 'openai', baseUrl: 'https://api.moonshot.ai/v1', envKey: 'MOONSHOT_API_KEY', defaultModel: 'kimi-k2', local: false },
  { id: 'groq', name: 'Groq', protocol: 'openai', baseUrl: 'https://api.groq.com/openai/v1', envKey: 'GROQ_API_KEY', defaultModel: 'llama-3.3-70b-versatile', local: false },
  { id: 'together', name: 'Together AI', protocol: 'openai', baseUrl: 'https://api.together.xyz/v1', envKey: 'TOGETHER_API_KEY', defaultModel: 'Qwen/Qwen2.5-Coder-32B-Instruct', local: false },
  { id: 'fireworks', name: 'Fireworks AI', protocol: 'openai', baseUrl: 'https://api.fireworks.ai/inference/v1', envKey: 'FIREWORKS_API_KEY', defaultModel: 'accounts/fireworks/models/deepseek-v3', local: false },
  { id: 'cerebras', name: 'Cerebras', protocol: 'openai', baseUrl: 'https://api.cerebras.ai/v1', envKey: 'CEREBRAS_API_KEY', defaultModel: 'qwen-3-32b', local: false },
  { id: 'xai', name: 'xAI Grok', protocol: 'openai', baseUrl: 'https://api.x.ai/v1', envKey: 'XAI_API_KEY', defaultModel: 'grok-3', local: false },
  { id: 'cohere', name: 'Cohere', protocol: 'openai', baseUrl: 'https://api.cohere.com/compatibility/v1', envKey: 'COHERE_API_KEY', defaultModel: 'command-a-03-2025', local: false },
  { id: 'perplexity', name: 'Perplexity', protocol: 'openai', baseUrl: 'https://api.perplexity.ai', envKey: 'PERPLEXITY_API_KEY', defaultModel: 'sonar-pro', local: false },
  { id: 'omniroute', name: 'OmniRoute / LiteLLM Gateway', protocol: 'openai', baseUrl: 'http://127.0.0.1:4000/v1', envKey: 'OMNIROUTE_API_KEY', defaultModel: 'default', local: true },
  { id: 'ollama', name: 'Ollama (Local)', protocol: 'openai', baseUrl: 'http://127.0.0.1:11434/v1', envKey: '', defaultModel: 'qwen2.5-coder:14b', local: true },
  { id: 'lmstudio', name: 'LM Studio (Local)', protocol: 'openai', baseUrl: 'http://127.0.0.1:1234/v1', envKey: '', defaultModel: 'local-model', local: true },
  { id: 'llamacpp', name: 'llama.cpp Server (Local)', protocol: 'openai', baseUrl: 'http://127.0.0.1:8080/v1', envKey: '', defaultModel: 'local-gguf', local: true },
  { id: 'vllm', name: 'vLLM (Local)', protocol: 'openai', baseUrl: 'http://127.0.0.1:8000/v1', envKey: '', defaultModel: 'local-vllm', local: true },
  { id: 'colibri', name: 'Colibri (Local)', protocol: 'openai', baseUrl: 'http://127.0.0.1:8899/v1', envKey: '', defaultModel: 'colibri-local', local: true },
];

export const MCP_CATALOG = [
  { id: 'filesystem', transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '.'], description: 'Scoped workspace filesystem read/write MCP server', enabled: false },
  { id: 'github', transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], description: 'GitHub repositories, PRs, issues, and code search', enabled: false },
  { id: 'postgres', transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-postgres'], description: 'Read-only SQL schema inspection and querying', enabled: false },
  { id: 'fetch', transport: 'stdio', command: 'uvx', args: ['mcp-server-fetch'], description: 'Clean Markdown web page fetcher for documentation', enabled: false },
  { id: 'sequential-thinking', transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-sequential-thinking'], description: 'Structured multi-step problem decomposition', enabled: false },
  { id: 'playwright', transport: 'stdio', command: 'npx', args: ['-y', '@playwright/mcp@latest'], description: 'Headless browser DOM testing and screenshot capture', enabled: false },
];

const IGNORED_DIRS = new Set(['.git', 'node_modules', 'target', '.wiggle', 'dist']);

export async function resolveSafePath(workspaceRoot, rawPath) {
  if (typeof rawPath !== 'string' || !rawPath.trim()) throw new Error('Invalid path');
  const rootReal = await fs.realpath(workspaceRoot);
  const candidate = path.isAbsolute(rawPath) ? path.resolve(rawPath) : path.resolve(rootReal, rawPath);
  const rel = path.relative(rootReal, candidate);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Path escapes workspace root: ${rawPath}`);
  }
  try {
    const targetReal = await fs.realpath(candidate);
    const relReal = path.relative(rootReal, targetReal);
    if (relReal.startsWith('..') || path.isAbsolute(relReal)) {
      throw new Error(`Symlink escapes workspace root: ${rawPath}`);
    }
    return { abs: targetReal, rel: relReal.replace(/\\/g, '/') };
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    let ancestor = path.dirname(candidate);
    while (true) {
      try {
        const ancReal = await fs.realpath(ancestor);
        const relAnc = path.relative(rootReal, ancReal);
        if (relAnc.startsWith('..') || path.isAbsolute(relAnc)) {
          throw new Error(`Ancestor escapes workspace root: ${rawPath}`);
        }
        break;
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
        const parent = path.dirname(ancestor);
        if (parent === ancestor) throw new Error(`Invalid path: ${rawPath}`);
        ancestor = parent;
      }
    }
    return { abs: candidate, rel: rel.replace(/\\/g, '/') };
  }
}

export async function buildWorkspaceTree(workspaceRoot, maxDepth = 4) {
  const rootReal = await fs.realpath(workspaceRoot);
  async function walk(dir, depth) {
    if (depth > maxDepth) return [];
    const entries = await fs.readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    const out = [];
    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      const rel = path.relative(rootReal, full).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        out.push({ name: entry.name, path: rel, isDir: true, children: await walk(full, depth + 1) });
      } else if (entry.isFile()) {
        out.push({ name: entry.name, path: rel, isDir: false });
      }
    }
    return out;
  }
  return walk(rootReal, 0);
}

export async function getGitBranch(workspaceRoot) {
  try {
    const { stdout } = await execFileAsync('git', ['branch', '--show-current'], { cwd: workspaceRoot, timeout: 2000 });
    return stdout.trim() || 'detached';
  } catch {
    return 'no-git';
  }
}

export function parseSkillMarkdown(raw, filePath, source) {
  const trimmed = raw.trimStart();
  let frontmatter = '';
  let body = raw;
  if (trimmed.startsWith('---')) {
    const end = trimmed.indexOf('\n---', 3);
    if (end !== -1) {
      frontmatter = trimmed.slice(3, end);
      body = trimmed.slice(end + 4).trim();
    }
  }
  let name = path.basename(path.dirname(filePath));
  let description = '';
  for (const line of frontmatter.split(/\r?\n/)) {
    const t = line.trim();
    if (t.startsWith('name:')) name = t.slice(5).trim().replace(/^["']|["']$/g, '');
    if (t.startsWith('description:')) description = t.slice(12).trim().replace(/^["']|["']$/g, '');
  }
  return { id: `${source}:${name}`, name, description, body, source, path: filePath, enabled: true };
}

export async function loadSkills(workspaceRoot, disabledSet = new Set()) {
  const skills = [];
  const dirs = [
    { dir: path.join(workspaceRoot, 'bundled-skills'), source: 'bundled' },
    { dir: path.join(workspaceRoot, '.wiggle', 'skills'), source: 'project' },
  ];
  for (const { dir, source } of dirs) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const mdPath = path.join(dir, entry.name, 'SKILL.md');
        try {
          const raw = await fs.readFile(mdPath, 'utf8');
          const parsed = parseSkillMarkdown(raw, path.relative(workspaceRoot, mdPath), source);
          parsed.enabled = !disabledSet.has(parsed.name);
          const idx = skills.findIndex((s) => s.name === parsed.name);
          if (idx >= 0) skills[idx] = parsed;
          else skills.push(parsed);
        } catch {
          // ignore folders without SKILL.md
        }
      }
    } catch {
      // dir may not exist
    }
  }
  return skills;
}

export function matchSkillsForPrompt(skills, prompt, limit = 4) {
  const lower = prompt.toLowerCase();
  const tokens = lower.split(/[^a-z0-9_-]+/).filter((t) => t.length >= 3);
  return skills
    .filter((s) => s.enabled)
    .map((skill) => {
      let score = 0;
      const n = skill.name.toLowerCase();
      const d = skill.description.toLowerCase();
      if (lower.includes(`$${n}`) || lower.includes(`/${n}`) || lower.includes(n)) score += 10;
      for (const tok of tokens) {
        if (n.includes(tok)) score += 3;
        if (d.includes(tok)) score += 2;
      }
      return { skill, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.skill);
}

export class SnapshotManager {
  constructor(workspaceRoot) {
    this.workspaceRoot = workspaceRoot;
    this.dir = path.join(workspaceRoot, '.wiggle', 'snapshots');
    this.objectsDir = path.join(this.dir, 'objects');
    this.historyPath = path.join(this.dir, 'history.json');
  }

  async loadHistory() {
    try {
      const raw = await fs.readFile(this.historyPath, 'utf8');
      return JSON.parse(raw);
    } catch {
      return { undoStack: [], redoStack: [] };
    }
  }

  async saveHistory(history) {
    await fs.mkdir(this.objectsDir, { recursive: true });
    await fs.writeFile(this.historyPath, JSON.stringify(history, null, 2), 'utf8');
  }

  async storeBlob(buf) {
    await fs.mkdir(this.objectsDir, { recursive: true });
    const hash = crypto.createHash('sha256').update(buf).digest('hex');
    const objPath = path.join(this.objectsDir, hash);
    try {
      await fs.access(objPath);
    } catch {
      await fs.writeFile(objPath, buf);
    }
    return hash;
  }

  async recordMutation(label, relPath, beforeBuffer, afterBuffer) {
    const beforeHash = beforeBuffer !== null ? await this.storeBlob(beforeBuffer) : null;
    const afterHash = afterBuffer !== null ? await this.storeBlob(afterBuffer) : null;
    const history = await this.loadHistory();
    const record = {
      id: crypto.randomUUID(),
      label,
      createdAt: new Date().toISOString(),
      files: [{ relPath, beforeHash, afterHash }],
    };
    history.undoStack.push(record);
    history.redoStack = [];
    await this.saveHistory(history);
    return record;
  }

  async undo() {
    const history = await this.loadHistory();
    const record = history.undoStack.pop();
    if (!record) throw new Error('Nothing to undo.');
    for (const f of record.files) {
      const { abs } = await resolveSafePath(this.workspaceRoot, f.relPath);
      if (f.beforeHash) {
        const blob = await fs.readFile(path.join(this.objectsDir, f.beforeHash));
        await fs.mkdir(path.dirname(abs), { recursive: true });
        await fs.writeFile(abs, blob);
      } else {
        await fs.rm(abs, { force: true });
      }
    }
    history.redoStack.push(record);
    await this.saveHistory(history);
    return record;
  }

  async redo() {
    const history = await this.loadHistory();
    const record = history.redoStack.pop();
    if (!record) throw new Error('Nothing to redo.');
    for (const f of record.files) {
      const { abs } = await resolveSafePath(this.workspaceRoot, f.relPath);
      if (f.afterHash) {
        const blob = await fs.readFile(path.join(this.objectsDir, f.afterHash));
        await fs.mkdir(path.dirname(abs), { recursive: true });
        await fs.writeFile(abs, blob);
      } else {
        await fs.rm(abs, { force: true });
      }
    }
    history.undoStack.push(record);
    await this.saveHistory(history);
    return record;
  }
}

export class MemoryEngine {
  constructor(workspaceRoot) {
    this.filePath = path.join(workspaceRoot, '.wiggle', 'memory.json');
  }

  async list() {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  async saveAll(items) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(items, null, 2), 'utf8');
  }

  async add({ category = 'fact', content, pinned = false, tags = [] }) {
    const items = await this.list();
    const clean = String(content || '').trim();
    if (!clean) throw new Error('Memory content cannot be empty.');
    const existing = items.find((i) => i.content.toLowerCase() === clean.toLowerCase());
    if (existing) {
      existing.pinned = existing.pinned || pinned;
      existing.updatedAt = new Date().toISOString();
      await this.saveAll(items);
      return existing;
    }
    const entry = {
      id: crypto.randomUUID(),
      category,
      content: clean,
      tags,
      pinned: Boolean(pinned),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    items.unshift(entry);
    await this.saveAll(items);
    return entry;
  }

  async remove(id) {
    const items = await this.list();
    const next = items.filter((i) => i.id !== id);
    await this.saveAll(next);
    return next.length !== items.length;
  }

  async query(prompt, limit = 6) {
    const items = await this.list();
    const tokens = String(prompt || '').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 2);
    return items
      .map((item) => {
        const lower = item.content.toLowerCase();
        let score = item.pinned ? 5 : 0;
        for (const t of tokens) {
          if (lower.includes(t)) score += 2;
        }
        return { item, score };
      })
      .filter((x) => x.score > 0 || x.item.pinned)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((x) => x.item);
  }

  async extractFromPrompt(prompt) {
    const lines = String(prompt || '').split(/\r?\n/);
    for (const line of lines) {
      const t = line.trim();
      if (t.length < 12 || t.length > 240) continue;
      const l = t.toLowerCase();
      if (l.includes('i prefer') || l.includes('always use') || l.includes('never use')) {
        await this.add({ category: 'preference', content: t, tags: ['auto'] });
      } else if (l.includes('my stack') || l.includes('we use rust') || l.includes('using typescript')) {
        await this.add({ category: 'stack', content: t, tags: ['auto'] });
      }
    }
  }
}

export async function compileSevenStagePrompt({
  workspaceRoot,
  userPrompt,
  customInstructions = '',
  memoryEngine,
  skills = [],
  contextAttachments = [],
}) {
  const branch = await getGitBranch(workspaceRoot);
  const sections = [
    TERVIXA_WIGGLE_IDENTITY,
    `Environment: os=${process.platform}, node=${process.version}, cwd=${workspaceRoot}, git_branch=${branch}`,
  ];
  if (customInstructions.trim()) {
    sections.push(`Additional Instructions:\n${customInstructions.trim()}`);
  }

  // Stage 2: Personal Memory
  const memories = memoryEngine ? await memoryEngine.query(userPrompt, 6) : [];
  if (memories.length > 0) {
    sections.push(`<personal_context>\n${memories.map((m) => `- [${m.category}] ${m.content}`).join('\n')}\n</personal_context>`);
  }

  // Stage 3: Project Instructions
  const instructionFiles = [];
  for (const name of ['WIGGLE.md', 'CLAUDE.md', 'AGENTS.md', '.cursorrules']) {
    try {
      const txt = await fs.readFile(path.join(workspaceRoot, name), 'utf8');
      if (txt.trim()) {
        instructionFiles.push(name);
        sections.push(`<project_instructions file="${name}">\n${txt.trim()}\n</project_instructions>`);
      }
    } catch {
      // ignore missing
    }
  }

  // Stage 4: Dynamic Skill Attachment
  const matchedSkills = matchSkillsForPrompt(skills, userPrompt, 4);
  if (matchedSkills.length > 0) {
    sections.push(
      `<active_skills>\n${matchedSkills.map((s) => `<skill name="${s.name}">\n${s.body}\n</skill>`).join('\n\n')}\n</active_skills>`
    );
  }

  // Stage 5: Resolved @file / @terminal context pills
  if (Array.isArray(contextAttachments) && contextAttachments.length > 0) {
    const blocks = [];
    for (const att of contextAttachments.slice(0, 6)) {
      if (att.type === 'file' && att.path) {
        try {
          const { abs, rel } = await resolveSafePath(workspaceRoot, att.path);
          const content = (await fs.readFile(abs, 'utf8')).slice(0, 6000);
          blocks.push(`<attached_file path="${rel}">\n${content}\n</attached_file>`);
        } catch {
          // ignore inaccessible
        }
      } else if (att.type === 'terminal' && att.content) {
        blocks.push(`<attached_terminal>\n${String(att.content).slice(0, 4000)}\n</attached_terminal>`);
      }
    }
    if (blocks.length > 0) {
      sections.push(`<context_attachments>\n${blocks.join('\n')}\n</context_attachments>`);
    }
  }

  // Stage 6 & 7: Slash normalization & routing
  let normalizedPrompt = String(userPrompt || '').trim();
  if (normalizedPrompt.startsWith('/review')) {
    normalizedPrompt = `Perform a thorough engineering code review focusing on correctness, security, and tests. ${normalizedPrompt.slice(7).trim()}`;
  } else if (normalizedPrompt.startsWith('/compact')) {
    normalizedPrompt = `Summarize key decisions and current state concisely. ${normalizedPrompt.slice(8).trim()}`;
  }

  const route = normalizedPrompt.toLowerCase().startsWith('/swarm') ? 'parallel_swarm' : 'single_agent';

  return {
    systemPrompt: sections.join('\n\n'),
    userPrompt: normalizedPrompt,
    route,
    injectedMemories: memories.length,
    matchedSkills: matchedSkills.map((s) => s.name),
    instructionFiles,
  };
}

export function extractAccessibilityTree(html, url) {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : url;
  const elements = [];
  const tagRegex = /<(a|button|input|textarea|select|h1|h2|h3)\b([^>]*)>([\s\S]*?)<\/\1>|<(input)\b([^>]*)\/?>/gi;
  let match;
  let idx = 0;
  while ((match = tagRegex.exec(html)) !== null && elements.length < 60) {
    const tag = (match[1] || match[4] || 'element').toLowerCase();
    const attrs = match[2] || match[5] || '';
    const inner = (match[3] || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const attrName = (attrs.match(/(?:aria-label|placeholder|name)=["']([^"']+)["']/i) || [])[1] || '';
    const href = (attrs.match(/href=["']([^"']+)["']/i) || [])[1] || null;
    const role = tag === 'a' ? 'link' : tag === 'button' ? 'button' : tag === 'input' ? 'textbox' : tag.startsWith('h') ? 'heading' : tag;
    idx += 1;
    elements.push({ refId: `e${idx}`, role, tag, name: inner || attrName || tag, href });
  }
  const tree = elements.map((el) => `[ref=${el.refId}] ${el.role} "${el.name}"`).join('\n');
  return { url, title, elements, accessibilityTree: tree };
}

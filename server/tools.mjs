// Native tool registry. Every tool is workspace-relative, returns text meant
// for the model, and caps its own output so one hostile file cannot flood the
// context window.

import { spawn } from 'node:child_process';
import { WorkspaceError } from './workspace.mjs';

const MAX_OUTPUT_CHARS = 20000;
const MAX_COMMAND_OUTPUT = 12000;

function truncate(text, limit = MAX_OUTPUT_CHARS) {
  if (text.length <= limit) return { text, truncated: false };
  return {
    text: `${text.slice(0, limit)}\n\n[truncated ${text.length - limit} characters]`,
    truncated: true,
  };
}

/** Quote a snippet for human-readable output without letting it break blocks. */
const oneLine = (text) => text.replace(/\s+/g, ' ').slice(0, 160);

async function runShell(command, { cwd, timeoutMs, signal }) {
  return new Promise((resolve) => {
    let output = '';
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    let child;
    try {
      child = spawn(command, {
        cwd,
        shell: true,
        windowsHide: true,
        env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', SystemRoot: process.env.SystemRoot ?? '', PATHEXT: process.env.PATHEXT ?? '' },
      });
    } catch (error) {
      finish({ ok: false, output: `failed to start command: ${error.message}`, code: null });
      return;
    }

    const collect = (chunk) => {
      if (output.length > MAX_COMMAND_OUTPUT * 2) return;
      output += chunk.toString('utf8');
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish({ ok: false, output: `${output}\n[command timed out after ${timeoutMs}ms]`, code: null });
    }, timeoutMs);

    const onAbort = () => {
      child.kill('SIGKILL');
      finish({ ok: false, output: `${output}\n[command cancelled]`, code: null });
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    child.on('error', (error) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      finish({ ok: false, output: `failed to run command: ${error.message}`, code: null });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      finish({ ok: code === 0, output, code });
    });
  });
}

export const TOOLS = [
  {
    name: 'list_dir',
    description: 'List files and directories inside the workspace. Paths are workspace-relative.',
    mutating: false,
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative directory, defaults to the root.' },
        depth: { type: 'integer', description: 'Recursion depth, 1-4. Defaults to 2.' },
      },
      additionalProperties: false,
    },
    async run(input, { workspace }) {
      const { root, entries, truncated } = await workspace.list(input?.path ?? '.', { depth: input?.depth ?? 2 });
      if (!entries.length) return `Workspace ${root} is empty.`;
      const lines = entries.map((entry) => `${entry.type === 'dir' ? 'd' : '-'} ${entry.path}`);
      return `${root}:\n${lines.join('\n')}${truncated ? '\n[listing truncated]' : ''}`;
    },
  },
  {
    name: 'read_file',
    description: 'Read a UTF-8 text file from the workspace. Returns the full content with line numbers.',
    mutating: false,
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Workspace-relative file path.' } },
      required: ['path'],
      additionalProperties: false,
    },
    async run(input, { workspace }) {
      const { path, content } = await workspace.read(input?.path);
      const numbered = content.split('\n').map((line, index) => `${String(index + 1).padStart(4)}  ${line}`).join('\n');
      return truncate(`${path} (${content.split('\n').length} lines)\n${numbered}`).text;
    },
  },
  {
    name: 'glob',
    description: 'Find files by glob pattern, for example "**/*.ts" or "src/**/test_*.rs".',
    mutating: false,
    parameters: {
      type: 'object',
      properties: { pattern: { type: 'string', description: 'Glob pattern relative to the workspace root.' } },
      required: ['pattern'],
      additionalProperties: false,
    },
    async run(input, { workspace }) {
      const matches = await workspace.glob(input?.pattern);
      if (!matches.length) return `No files matched ${input?.pattern}.`;
      return truncate(matches.slice(0, 400).join('\n')).text;
    },
  },
  {
    name: 'grep',
    description: 'Search file contents with a JavaScript regular expression. Returns matching lines with file and line number.',
    mutating: false,
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regular expression source.' },
        glob: { type: 'string', description: 'Optional glob to restrict which files are searched.' },
        ignore_case: { type: 'boolean', description: 'Case-insensitive match.' },
      },
      required: ['pattern'],
      additionalProperties: false,
    },
    async run(input, { workspace }) {
      const { matches, filesSearched, truncated } = await workspace.grep(input?.pattern, {
        glob: input?.glob ?? null,
        ignoreCase: Boolean(input?.ignore_case),
      });
      if (!matches.length) return `No matches for /${input?.pattern}/ in ${filesSearched} files.`;
      const lines = matches.map((match) => `${match.path}:${match.line}: ${oneLine(match.text)}`);
      return `${lines.join('\n')}${truncated ? '\n[results truncated]' : ''}`;
    },
  },
  {
    name: 'write_file',
    description: 'Create or overwrite a workspace file with exact content. Parent directories are created.',
    mutating: true,
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative file path.' },
        content: { type: 'string', description: 'Full file content.' },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
    async run(input, { workspace, recorder }) {
      const result = await workspace.write(input?.path, input?.content ?? '');
      await recorder.record(result.path, result.before, input?.content ?? '');
      return {
        output: `${result.created ? 'Created' : 'Updated'} ${result.path} (${result.bytes} bytes).`,
        meta: { path: result.path, before: result.before, after: input?.content ?? '', created: result.created },
      };
    },
  },
  {
    name: 'edit_file',
    description: 'Replace exact existing text in a file. Fails if the text is missing or appears more than once, so include enough surrounding context.',
    mutating: true,
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative file path.' },
        old_text: { type: 'string', description: 'Exact text to replace, including indentation.' },
        new_text: { type: 'string', description: 'Replacement text.' },
        all: { type: 'boolean', description: 'Replace every occurrence instead of requiring uniqueness.' },
      },
      required: ['path', 'old_text', 'new_text'],
      additionalProperties: false,
    },
    async run(input, { workspace, recorder }) {
      const result = await workspace.edit(input?.path, input?.old_text, input?.new_text, { all: Boolean(input?.all) });
      const after = await workspace.read(result.path);
      await recorder.record(result.path, result.before, after.content);
      return {
        output: `Edited ${result.path} (${result.replacements} replacement${result.replacements === 1 ? '' : 's'}).`,
        meta: { path: result.path, before: result.before, after: after.content, created: false },
      };
    },
  },
  {
    name: 'run_command',
    description: 'Run a shell command in the workspace root and return combined stdout/stderr. Use for builds, tests, and git status. Requires approval.',
    mutating: true,
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Command line to execute.' },
        timeout_seconds: { type: 'integer', description: 'Timeout in seconds, 1-120. Defaults to 30.' },
      },
      required: ['command'],
      additionalProperties: false,
    },
    async run(input, { workspace, signal }) {
      const timeoutSeconds = Math.min(Math.max(Number(input?.timeout_seconds) || 30, 1), 120);
      const result = await runShell(input.command, { cwd: workspace.root, timeoutMs: timeoutSeconds * 1000, signal });
      const body = truncate(result.output.trim() || '(no output)', MAX_COMMAND_OUTPUT).text;
      return `${result.ok ? 'exit 0' : `failed${result.code === null ? '' : ` (exit ${result.code})`}`}\n${body}`;
    },
  },
];

export const TOOL_NAMES = TOOLS.map((tool) => tool.name);

/** Model-facing tool definitions (JSON schema, no implementations). */
export function toolDefinitions(enabled = TOOL_NAMES) {
  return TOOLS.filter((tool) => enabled.includes(tool.name)).map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));
}

export function findTool(name) {
  return TOOLS.find((tool) => tool.name === name) ?? null;
}

/** Execute a tool call, converting failures into model-readable text. */
export async function executeTool(name, input, ctx) {
  const tool = findTool(name);
  if (!tool) return { ok: false, output: `Unknown tool: ${name}`, mutating: false };
  if (input !== null && (typeof input !== 'object' || Array.isArray(input))) {
    return { ok: false, output: 'Tool input must be a JSON object.', mutating: tool.mutating };
  }
  try {
    const result = await tool.run(input ?? {}, ctx);
    if (typeof result === 'string') return { ok: true, output: result, mutating: tool.mutating };
    return { ok: true, output: result.output, meta: result.meta ?? null, mutating: tool.mutating };
  } catch (error) {
    if (error instanceof WorkspaceError) return { ok: false, output: error.message, mutating: tool.mutating, code: error.code };
    return { ok: false, output: `Tool failed: ${error.message}`, mutating: tool.mutating };
  }
}

export { runShell, truncate };

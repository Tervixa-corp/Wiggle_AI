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

/**
 * Build the child process for a shell command.
 * `shell` comes from Settings → Terminal and is limited to the supported shells.
 */
function shellSpawn(command, { cwd, shell, remote }) {
  const env = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', SystemRoot: process.env.SystemRoot ?? '', PATHEXT: process.env.PATHEXT ?? '' };
  const quote = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;
  if (remote?.kind === 'wsl') {
    const args = [...(remote.distro ? ['-d', remote.distro] : []), '--', 'bash', '-lc', command];
    return spawn('wsl.exe', args, { cwd, windowsHide: true, env });
  }
  if (remote?.kind === 'ssh' && remote.host) {
    const inner = remote.workdir ? `cd ${quote(remote.workdir)} && ${command}` : command;
    return spawn('ssh', ['-o', 'BatchMode=yes', remote.host, inner], { cwd, windowsHide: true, env });
  }
  const choice = ['powershell', 'cmd', 'bash'].includes(shell) ? shell : 'auto';
  if (choice === 'powershell') {
    return spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-Command', command], { cwd, windowsHide: true, env });
  }
  if (choice === 'cmd') {
    return spawn('cmd.exe', ['/d', '/s', '/c', command], { cwd, windowsHide: true, env });
  }
  if (choice === 'bash') {
    return spawn(process.platform === 'win32' ? 'bash.exe' : '/bin/bash', ['-lc', command], { cwd, windowsHide: true, env });
  }
  return spawn(command, { cwd, shell: true, windowsHide: true, env });
}

async function runShell(command, { cwd, timeoutMs, signal, shell = 'auto', remote = null }) {
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
      child = shellSpawn(command, { cwd, shell, remote });
    } catch (error) {
      finish({ ok: false, output: `failed to start command: ${error.message}`, code: null });
      return;
    }

    const collect = (chunk) => {
      if (output.length > MAX_COMMAND_OUTPUT * 2) return;
      // wsl.exe emits UTF-16LE, so a command's text reaches us as
      // "U\0b\0u\0n\0t\0u\0". Dropping the interleaved NUL bytes restores the
      // plain ASCII the terminal and the model expect, for local and remote runs.
      output += chunk.toString('utf8').replace(/\0/g, '');
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
    async run(input, { workspace, signal, remote }) {
      const timeoutSeconds = Math.min(Math.max(Number(input?.timeout_seconds) || 30, 1), 120);
      const result = await runShell(input.command, { cwd: workspace.root, timeoutMs: timeoutSeconds * 1000, signal, remote });
      const body = truncate(result.output.trim() || '(no output)', MAX_COMMAND_OUTPUT).text;
      return `${result.ok ? 'exit 0' : `failed${result.code === null ? '' : ` (exit ${result.code})`}`}\n${body}`;
    },
  },
  {
    name: 'add_skill',
    description:
      'Install a SKILL.md skill into this app so it stays available in every later session. Pass source_url for a raw SKILL.md (GitHub blob links are rewritten to raw) or markdown with contents the user pasted. The file is fetched and its frontmatter validated before it is written; nothing is installed when either step fails.',
    mutating: true,
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Optional skill id, lowercase letters, digits, dashes.' },
        source_url: { type: 'string', description: 'https URL of the SKILL.md file.' },
        markdown: { type: 'string', description: 'SKILL.md contents, when the user pasted them instead of a URL.' },
        overwrite: { type: 'boolean', description: 'Replace an installed skill with the same id. Defaults to true.' },
      },
      additionalProperties: false,
    },
    async run(input, { config }) {
      if (!config?.installSkill) throw new Error('Skill installation is not available in this runtime.');
      const result = await config.installSkill({
        name: input?.name ?? '',
        url: input?.source_url ?? '',
        markdown: input?.markdown ?? '',
        overwrite: input?.overwrite !== false,
      });
      return {
        output: `${result.replaced ? 'Replaced' : 'Installed'} skill ${result.id}: ${result.description}. It is enabled and will be available in the next turn.`,
        meta: { skill: result.id, path: result.path },
      };
    },
  },
  {
    name: 'add_mcp_server',
    description:
      'Register a remote MCP server in Settings -> Plugins so its tools become callable as mcp__<server>__<tool> on the next turn. Requires an https endpoint (http only on localhost) and, when the vendor needs auth, the name of an environment variable holding the token. Never guess an endpoint.',
    mutating: true,
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Display name for the server.' },
        url: { type: 'string', description: 'MCP endpoint URL (https, or http on localhost).' },
        transport: { type: 'string', enum: ['http', 'sse'], description: 'Streamable HTTP (default) or legacy SSE.' },
        token_env: { type: 'string', description: 'Environment variable name that holds the access token.' },
      },
      required: ['name', 'url'],
      additionalProperties: false,
    },
    async run(input, { config }) {
      if (!config?.registerMcp) throw new Error('Adding MCP servers is not available in this runtime.');
      const result = await config.registerMcp({
        name: input?.name ?? '',
        url: input?.url ?? '',
        transport: input?.transport ?? 'http',
        tokenEnv: input?.token_env ?? '',
      });
      return {
        output: `Added MCP server ${result.name} (${result.id}) at ${result.url}${result.tokenEnv ? ` using the ${result.tokenEnv} token` : ''}. Its tools are listed on the next turn, where they can be called as mcp__${result.id}__<tool>.`,
        meta: { server: result.id, url: result.url },
      };
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

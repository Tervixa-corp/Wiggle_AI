// Permission gate: the single choke point between a model's tool call and any
// side effect. Policy is deny-by-default for anything that mutates state, and
// commands are additionally screened so an approval prompt cannot be used to
// launder obviously destructive shell input.

export const DECISION = { ALLOW: 'allow', ASK: 'ask', DENY: 'deny' };

export const PRESETS = {
  readonly: {
    read_file: 'allow', list_dir: 'allow', glob: 'allow', grep: 'allow',
    write_file: 'deny', edit_file: 'deny', run_command: 'deny',
    add_skill: 'deny', add_mcp_server: 'deny', mcp: 'deny',
  },
  standard: {
    read_file: 'allow', list_dir: 'allow', glob: 'allow', grep: 'allow',
    write_file: 'ask', edit_file: 'ask', run_command: 'ask',
    add_skill: 'ask', add_mcp_server: 'ask', mcp: 'ask',
  },
  full: {
    read_file: 'allow', list_dir: 'allow', glob: 'allow', grep: 'allow',
    write_file: 'allow', edit_file: 'allow', run_command: 'allow',
    add_skill: 'allow', add_mcp_server: 'allow', mcp: 'allow',
  },
};

export const PRESET_NAMES = Object.keys(PRESETS);

// Shell patterns refused even when the user has enabled command execution.
const BLOCKED_COMMANDS = [
  { pattern: /\bsudo\b/i, reason: 'privilege escalation is not allowed' },
  { pattern: /\brm\s+(-[a-z]*\s+)*-?[a-z]*r[a-z]*f[a-z]*\s+\/(?:\s|$)/i, reason: 'recursive deletion of the filesystem root is not allowed' },
  { pattern: /\bmkfs\b|\bdd\b[^\n]*\bof=\/dev\//i, reason: 'disk formatting is not allowed' },
  { pattern: /\b(shutdown|reboot|halt|poweroff)\b/i, reason: 'host power control is not allowed' },
  { pattern: /\b(curl|wget)\b[^\n|]*\|\s*(sudo\s+)?(ba|z|k)?sh\b/i, reason: 'piping a download into a shell is not allowed' },
  { pattern: /:\s*\(\s*\)\s*\{.*\}\s*;\s*:/, reason: 'fork bomb pattern is not allowed' },
  { pattern: /\bchmod\s+(-R\s+)?777\s+\/[^\s]*/i, reason: 'world-writable root paths are not allowed' },
];

export function screenCommand(command) {
  if (typeof command !== 'string' || !command.trim()) return { ok: false, reason: 'command must be a non-empty string' };
  if (command.length > 4000) return { ok: false, reason: 'command is too long' };
  for (const rule of BLOCKED_COMMANDS) {
    if (rule.pattern.test(command)) return { ok: false, reason: rule.reason };
  }
  return { ok: true };
}

/**
 * Resolve a tool invocation against policy.
 * `onAsk` receives {id, tool, input, toolCallId} and must resolve to
 * 'allow' or 'deny'.
 * When no handler is registered, anything requiring approval is denied.
 */
export class PermissionGate {
  constructor({ rules = PRESETS.standard, onAsk = null, timeoutMs = 120000 } = {}) {
    this.rules = { ...PRESETS.standard, ...rules };
    this.onAsk = onAsk;
    this.timeoutMs = timeoutMs;
    this.pending = new Map();
  }

  rule(tool) {
    // MCP tools are named per server (mcp__<server>__<tool>); one "mcp" rule
    // covers all of them so the policy stays readable.
    if (String(tool ?? '').startsWith('mcp__')) return this.rules.mcp ?? DECISION.DENY;
    return this.rules[tool] ?? DECISION.DENY;
  }

  /** Describe policy without exposing internal state. */
  describe() {
    return Object.fromEntries(Object.entries(this.rules).sort(([a], [b]) => a.localeCompare(b)));
  }

  async request(tool, input, { toolCallId = null } = {}) {
    const rule = this.rule(tool);
    if (rule === DECISION.DENY) return { decision: 'deny', reason: `policy denies ${tool}` };
    if (tool === 'run_command') {
      const screen = screenCommand(input?.command);
      if (!screen.ok) return { decision: 'deny', reason: screen.reason };
    }
    if (rule === DECISION.ALLOW) return { decision: 'allow', reason: 'policy allows this tool' };
    if (!this.onAsk) return { decision: 'deny', reason: 'approval required but no approver is connected' };

    const id = `apr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    let timer;
    try {
      const decision = await Promise.race([
        Promise.resolve(this.onAsk({ id, tool, input, toolCallId })),
        new Promise((resolve) => {
          timer = setTimeout(() => resolve('deny'), this.timeoutMs);
        }),
      ]);
      if (decision === 'allow') return { decision: 'allow', reason: 'approved by user', approvalId: id };
      return { decision: 'deny', reason: 'denied or timed out' };
    } finally {
      clearTimeout(timer);
    }
  }
}

// Tool-using agent loop for OpenAI-compatible chat completions.
// Read tools run immediately inside the workspace. propose_edit creates a reviewable proposal; in
// "suggest" mode nothing is written until the user approves it. "auto-edit" applies proposals
// immediately, but every applied edit is still recorded for undo.
import { AGENT_IDENTITY, CHAT_IDENTITY } from './identity.mjs';
import { WorkspaceError } from './workspace.mjs';

export const MODES = ['suggest', 'auto-edit'];
export const MAX_STEPS = 8;
const MAX_TOOL_RESULT = 8 * 1024;
const MAX_MESSAGES = 100;

export const TOOLS = [
  { type: 'function', function: { name: 'list_dir', description: 'List files and folders in a workspace directory. Use "." for the root.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false } } },
  { type: 'function', function: { name: 'read_file', description: 'Read a UTF-8 text file inside the workspace.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false } } },
  { type: 'function', function: { name: 'search_text', description: 'Case-insensitive plain-text search across workspace files. Returns matching lines.', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false } } },
  { type: 'function', function: { name: 'propose_edit', description: 'Propose replacing the full content of an existing text file. The user must approve it before it is written.', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'], additionalProperties: false } } },
];

function clip(text) {
  if (text.length <= MAX_TOOL_RESULT) return text;
  return `${text.slice(0, MAX_TOOL_RESULT)}\n[truncated: ${text.length - MAX_TOOL_RESULT} more characters]`;
}

// Validate and normalise the conversation sent by the client. Only user and assistant text is accepted.
export function validateMessages(messages) {
  if (!Array.isArray(messages) || !messages.length || messages.length > MAX_MESSAGES) return null;
  for (const m of messages) {
    if (!m || !['user', 'assistant'].includes(m.role) || typeof m.content !== 'string' || !m.content.trim() || m.content.length > 50000) return null;
  }
  return messages.map(({ role, content }) => ({ role, content }));
}

async function runTool(name, args, { workspace, edits, mode }) {
  if (name === 'list_dir') {
    const listing = await workspace.list(args.path ?? '.');
    return { summary: `Listed ${listing.entries.length} entries in ${listing.path}`, result: JSON.stringify(listing.entries.map(e => `${e.type === 'dir' ? 'dir ' : ''}${e.path}`)) };
  }
  if (name === 'read_file') {
    const file = await workspace.read(args.path);
    return { summary: `Read ${file.path} (${file.size} bytes)`, result: file.content };
  }
  if (name === 'search_text') {
    const found = await workspace.search(args.query);
    return { summary: `${found.matches.length} match${found.matches.length === 1 ? '' : 'es'} for "${args.query}"`, result: JSON.stringify(found.matches) };
  }
  if (name === 'propose_edit') {
    if (!edits) throw new WorkspaceError('Edits are not available without a workspace.', 404);
    const proposal = await edits.propose(args.path, args.content);
    if (mode === 'auto-edit') {
      const applied = await edits.approve(proposal.id);
      return { summary: `Applied edit to ${proposal.path}`, proposalId: applied.id, result: `Edit to ${proposal.path} was applied (${proposal.stats.added} added, ${proposal.stats.removed} removed lines). The user can undo it.` };
    }
    return { summary: `Proposed edit to ${proposal.path}`, proposalId: proposal.id, result: `Edit to ${proposal.path} is awaiting user approval (${proposal.stats.added} added, ${proposal.stats.removed} removed lines). It has NOT been applied yet.` };
  }
  throw new WorkspaceError(`Unknown tool: ${name}`, 400);
}

// Run the agent loop. Returns the final text plus a step log for the UI. Never throws for tool errors:
// they are returned to the model as tool results so it can recover.
export async function runAgent({ messages, config, fetchImpl, workspace = null, edits = null, mode = 'suggest', maxSteps = MAX_STEPS, signal }) {
  if (!MODES.includes(mode)) throw new WorkspaceError('Unknown permission mode.');
  const tools = workspace ? TOOLS : [];
  const convo = [{ role: 'system', content: workspace ? AGENT_IDENTITY : CHAT_IDENTITY }, ...messages];
  const steps = [];
  for (let step = 0; step < maxSteps; step++) {
    const upstream = await fetchImpl(`${config.base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}) },
      body: JSON.stringify({ model: config.model, messages: convo, stream: false, ...(tools.length ? { tools, tool_choice: 'auto' } : {}) }),
      signal,
    });
    if (!upstream.ok) throw Object.assign(new Error(`Provider request failed (HTTP ${upstream.status}).`), { upstream: true });
    const data = await upstream.json();
    const message = data?.choices?.[0]?.message;
    if (!message) throw Object.assign(new Error('Provider returned an unsupported response.'), { upstream: true });
    const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    if (!calls.length) {
      const text = typeof message.content === 'string' ? message.content : '';
      if (!text.trim()) throw Object.assign(new Error('Provider returned an empty response.'), { upstream: true });
      return { text, steps };
    }
    convo.push({ role: 'assistant', content: message.content ?? null, tool_calls: calls });
    for (const call of calls) {
      const name = call?.function?.name;
      let args;
      try { args = JSON.parse(call?.function?.arguments || '{}'); } catch { args = null; }
      let outcome;
      if (!name || args === null || typeof args !== 'object') {
        outcome = { summary: 'Invalid tool call', result: 'Error: tool arguments were not valid JSON.' };
        steps.push({ name: name || 'unknown', args: {}, status: 'error', summary: outcome.summary });
      } else {
        try {
          const done = await runTool(name, args, { workspace, edits, mode });
          outcome = done;
          steps.push({ name, args, status: 'ok', summary: done.summary, ...(done.proposalId ? { proposalId: done.proposalId } : {}) });
        } catch (error) {
          const message = error?.name === 'WorkspaceError' ? error.message : 'Tool failed.';
          outcome = { summary: message, result: `Error: ${message}` };
          steps.push({ name, args, status: 'error', summary: message });
        }
      }
      convo.push({ role: 'tool', tool_call_id: call.id, content: clip(outcome.result) });
    }
  }
  return { text: `Stopped after ${maxSteps} tool steps. Ask again to continue.`, steps, limited: true };
}

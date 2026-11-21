// The agent loop.
//
// A bounded ReAct cycle: ask the model, execute any tool calls it requests
// through the permission gate, feed results back, repeat. It stops on a plain
// assistant message, on the step budget, or on cancellation — and it always
// commits whatever file changes it made so the turn stays undoable.

import { compilePrompt } from './prompt.mjs';
import { toolDefinitions, executeTool } from './tools.mjs';
import { estimateTokens } from './providers.mjs';

export const MAX_STEPS = 8;
const MAX_TOOL_CALLS_PER_STEP = 6;
const MAX_TOOL_RESULT_CHARS = 20000;

/** Cheap defence against a tool result flooding the next request. */
function clampResult(text) {
  const value = String(text ?? '');
  return value.length > MAX_TOOL_RESULT_CHARS ? `${value.slice(0, MAX_TOOL_RESULT_CHARS)}\n[truncated]` : value;
}

/**
 * @param {object} options
 * @param {object} options.provider       streaming provider adapter
 * @param {object} options.workspace      Workspace
 * @param {object} options.snapshots      SnapshotStore
 * @param {object} options.gate           PermissionGate
 * @param {object} [options.memory]       MemoryStore
 * @param {Array}  [options.skills]       loaded skills
 * @param {Function} options.onEvent      (event) => void
 * @param {AbortSignal} [options.signal]
 * @param {number} [options.maxSteps]
 */
export async function runAgent({
  provider,
  workspace,
  snapshots,
  gate,
  memory = null,
  skills = [],
  messages,
  customInstructions = '',
  onEvent = () => {},
  signal,
  remote = null,
  maxSteps = MAX_STEPS,
  mcp = null,
  config = {},
}) {
  const conversation = [...messages];
  const recorder = snapshots.begin('agent turn');
  const policy = gate.describe();
  const enabledNames = Object.keys(policy).filter((name) => policy[name] !== 'deny');
  const mcpAllowed = (policy.mcp ?? 'deny') !== 'deny';
  const tools = [
    ...toolDefinitions(enabledNames),
    ...(mcpAllowed ? (mcp?.tools ?? []) : []),
  ];

  const lastUser = [...conversation].reverse().find((message) => message.role === 'user');
  const { system, stages } = await compilePrompt({
    workspace,
    userPrompt: lastUser?.content ?? '',
    memory,
    skills,
    tools,
    policy,
    customInstructions,
    mcpServers: mcpAllowed ? (mcp?.servers ?? []) : [],
  });
  onEvent({ type: 'compile', stages });

  let usage = null;
  let steps = 0;
  let toolCallCount = 0;

  try {
    while (steps < maxSteps) {
      if (signal?.aborted) break;
      steps += 1;
      onEvent({ type: 'step', step: steps, maxSteps });

      const result = await provider.streamChat({
        messages: conversation,
        system,
        tools,
        signal,
        onDelta: (delta) => onEvent({ type: 'text', delta }),
        onReasoning: (delta) => onEvent({ type: 'thinking', delta }),
      });

      if (result.usage) usage = { ...usage, ...result.usage };

      const calls = (result.toolCalls ?? []).slice(0, MAX_TOOL_CALLS_PER_STEP);
      if (!calls.length) {
        conversation.push({ role: 'assistant', content: result.text });
        onEvent({ type: 'assistant_end', text: result.text, truncatedCalls: Math.max(0, (result.toolCalls?.length ?? 0) - calls.length) });
        break;
      }

      conversation.push({ role: 'assistant', content: result.text, toolCalls: calls });
      onEvent({ type: 'assistant_end', text: result.text, pendingTools: calls.length });

      for (const call of calls) {
        if (signal?.aborted) break;
        toolCallCount += 1;
        let input = {};
        let parseError = null;
        try {
          input = call.arguments ? JSON.parse(call.arguments) : {};
        } catch {
          parseError = 'Tool arguments were not valid JSON.';
        }

        onEvent({ type: 'tool_call', id: call.id, name: call.name, input, parseError });

        let output;
        let ok;
        let meta = null;
        const startedAt = Date.now();
        if (parseError) {
          ok = false;
          output = parseError;
        } else {
          const verdict = await gate.request(call.name, input, { toolCallId: call.id });
          if (verdict.decision !== 'allow') {
            ok = false;
            output = `Permission denied: ${verdict.reason}. The user did not authorise this call. Do not retry it; ask the user how to proceed.`;
          } else {
            const executed = String(call.name).startsWith('mcp__') && mcp
              ? await mcp.call(call.name, input, signal)
              : await executeTool(call.name, input, { workspace, recorder, signal, remote, config });
            ok = executed.ok;
            output = executed.output;
            if (executed.meta) meta = executed.meta;
          }
        }

        conversation.push({ role: 'tool', toolCallId: call.id, name: call.name, content: clampResult(output) });
        onEvent({ type: 'tool_result', id: call.id, name: call.name, ok, output: clampResult(output), meta, durationMs: Date.now() - startedAt });
      }
    }

    if (steps >= maxSteps && !signal?.aborted) {
      onEvent({ type: 'notice', text: `Stopped after ${maxSteps} steps. Send a follow-up to continue.` });
    }
    if (signal?.aborted) onEvent({ type: 'notice', text: 'Cancelled.' });

    const snapshotId = await recorder.commit();
    onEvent({
      type: 'done',
      steps,
      toolCalls: toolCallCount,
      usage,
      estimate: estimateTokens(conversation.map((m) => m.content ?? '').join(' ')),
      snapshotId,
      touched: recorder.touched,
      messages: conversation,
    });

    return { steps, toolCalls: toolCallCount, usage, snapshotId, messages: conversation };
  } catch (error) {
    // Keep the edits that already landed, so the user can inspect or undo them.
    const snapshotId = await recorder.commit().catch(() => null);
    if (error?.name === 'AbortError') {
      onEvent({ type: 'done', steps, toolCalls: toolCallCount, usage, snapshotId, touched: recorder.touched, cancelled: true });
      return { steps, toolCalls: toolCallCount, usage, snapshotId, cancelled: true, messages: conversation };
    }
    onEvent({ type: 'error', message: error?.message ?? 'Agent run failed', snapshotId });
    throw error;
  }
}

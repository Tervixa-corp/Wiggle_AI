import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Workspace } from '../server/workspace.mjs';
import { SnapshotStore } from '../server/snapshots.mjs';
import { PermissionGate, PRESETS } from '../server/permissions.mjs';
import { MemoryStore } from '../server/memory.mjs';
import { runAgent } from '../server/agent.mjs';
import { compilePrompt, IDENTITY } from '../server/prompt.mjs';

/** A provider that replays a script of turns. */
function scriptedProvider(steps) {
  let index = 0;
  return {
    id: 'scripted',
    model: 'scripted',
    calls: [],
    async streamChat({ messages, system, tools, onDelta }) {
      this.calls.push({ messages: structuredClone(messages), system, tools });
      const step = steps[Math.min(index, steps.length - 1)];
      index += 1;
      if (step.text) onDelta?.(step.text);
      return { text: step.text ?? '', toolCalls: step.toolCalls ?? [], usage: { input: 100, output: 20 }, stopReason: step.toolCalls?.length ? 'tool_calls' : 'stop' };
    },
  };
}

async function sandbox(fn) {
  const root = await mkdtemp(path.join(tmpdir(), 'wiggle-agent-'));
  try {
    await mkdir(path.join(root, 'src'), { recursive: true });
    await writeFile(path.join(root, 'src', 'app.js'), 'export const answer = 1;\n', 'utf8');
    await writeFile(path.join(root, 'WIGGLE.md'), 'Project rule: keep the UI flat.\n', 'utf8');
    await fn({ root, workspace: await Workspace.open(root), snapshots: new SnapshotStore(root) });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const exists = (file) => access(file).then(() => true, () => false);

test('agent executes a tool, streams text, and commits an undoable snapshot', async () => {
  await sandbox(async ({ root, workspace, snapshots }) => {
    const provider = scriptedProvider([
      { text: 'Writing the file.', toolCalls: [{ id: 'c1', name: 'write_file', arguments: JSON.stringify({ path: 'src/new.js', content: 'export const two = 2;\n' }) }] },
      { text: 'Done. I created src/new.js.' },
    ]);
    const events = [];
    let sawApproval = null;

    const result = await runAgent({
      provider,
      workspace,
      snapshots,
      gate: new PermissionGate({ rules: PRESETS.standard, onAsk: (request) => { sawApproval = request; return Promise.resolve('allow'); } }),
      messages: [{ role: 'user', content: 'Create src/new.js' }],
      onEvent: (event) => events.push(event),
    });

    assert.equal(await readFile(path.join(root, 'src', 'new.js'), 'utf8'), 'export const two = 2;\n');
    assert.equal(sawApproval.tool, 'write_file');
    assert.equal(result.steps, 2);
    assert.equal(result.toolCalls, 1);
    assert.ok(result.snapshotId);

    // The tool result must have been fed back to the model.
    const secondRequest = provider.calls[1].messages;
    assert.equal(secondRequest.at(-1).role, 'tool');
    assert.match(secondRequest.at(-1).content, /Created src\/new\.js/);

    assert.ok(events.some((event) => event.type === 'tool_call' && event.name === 'write_file'));
    assert.ok(events.some((event) => event.type === 'tool_result' && event.ok === true));

    // The UI needs before/after content to render a reviewable diff.
    const mutation = events.find((event) => event.type === 'tool_result' && event.ok === true);
    assert.equal(mutation.meta.path, 'src/new.js');
    assert.equal(mutation.meta.before, null);
    assert.equal(mutation.meta.after, 'export const two = 2;\n');
    assert.ok(events.some((event) => event.type === 'done'));
    assert.equal(events.filter((event) => event.type === 'text').length, 2);

    // Undo removes the file the turn created.
    await snapshots.undo(workspace);
    assert.equal(await exists(path.join(root, 'src', 'new.js')), false);
    assert.equal(await readFile(path.join(root, 'src', 'app.js'), 'utf8'), 'export const answer = 1;\n');
  });
});

test('a denied tool call changes nothing and tells the model so', async () => {
  await sandbox(async ({ root, workspace, snapshots }) => {
    const provider = scriptedProvider([
      { text: '', toolCalls: [{ id: 'c1', name: 'write_file', arguments: JSON.stringify({ path: 'src/blocked.js', content: 'nope\n' }) }] },
      { text: 'I could not write the file because permission was denied.' },
    ]);
    const events = [];
    await runAgent({
      provider,
      workspace,
      snapshots,
      gate: new PermissionGate({ rules: PRESETS.standard, onAsk: async () => 'deny' }),
      messages: [{ role: 'user', content: 'write a file' }],
      onEvent: (event) => events.push(event),
    });

    assert.equal(await exists(path.join(root, 'src', 'blocked.js')), false);
    const toolResult = events.find((event) => event.type === 'tool_result');
    assert.equal(toolResult.ok, false);
    assert.match(toolResult.output, /Permission denied/);
    assert.equal(provider.calls[1].messages.at(-1).role, 'tool');
    assert.match(provider.calls[1].messages.at(-1).content, /Permission denied/);
  });
});

test('malformed tool arguments are reported instead of crashing', async () => {
  await sandbox(async ({ workspace, snapshots }) => {
    const provider = scriptedProvider([
      { text: '', toolCalls: [{ id: 'c1', name: 'read_file', arguments: '{not json' }] },
      { text: 'That call was malformed.' },
    ]);
    const events = [];
    await runAgent({
      provider,
      workspace,
      snapshots,
      gate: new PermissionGate({ rules: PRESETS.full }),
      messages: [{ role: 'user', content: 'read something' }],
      onEvent: (event) => events.push(event),
    });
    const result = events.find((event) => event.type === 'tool_result');
    assert.equal(result.ok, false);
    assert.match(result.output, /not valid JSON/);
  });
});

test('the step budget stops a runaway loop', async () => {
  await sandbox(async ({ workspace, snapshots }) => {
    const loop = { text: '', toolCalls: [{ id: 'c', name: 'glob', arguments: '{"pattern":"**/*.js"}' }] };
    const provider = scriptedProvider([loop]);
    const events = [];
    const result = await runAgent({
      provider,
      workspace,
      snapshots,
      gate: new PermissionGate({ rules: PRESETS.full }),
      messages: [{ role: 'user', content: 'loop forever' }],
      maxSteps: 3,
      onEvent: (event) => events.push(event),
    });
    assert.equal(result.steps, 3);
    assert.ok(events.some((event) => event.type === 'notice' && /Stopped after 3 steps/.test(event.text)));
  });
});

test('the compiled prompt always leads with the identity and carries project rules', async () => {
  await sandbox(async ({ workspace }) => {
    const memory = await new MemoryStore(workspace.root).load();
    await memory.add('Prefers TypeScript and strict mode.', { pinned: true });
    const { system, stages } = await compilePrompt({
      workspace,
      userPrompt: 'help with the TypeScript code',
      memory,
      skills: [{ name: 'review', description: 'review TypeScript code carefully', body: 'Check types.' }],
      tools: [{ name: 'read_file', description: 'read', parameters: {} }, { name: 'run_command', description: 'shell', parameters: {} }],
      policy: { read_file: 'allow', run_command: 'deny' },
    });

    assert.ok(system.startsWith(IDENTITY));
    assert.match(system, /<project_instructions>/);
    assert.match(system, /keep the UI flat/);
    assert.match(system, /<personal_context>/);
    assert.match(system, /Prefers TypeScript/);
    assert.match(system, /<active_skills>/);
    assert.match(system, /Check types\./);
    assert.match(system, /read_file: read \(policy: allow\)/);
    assert.doesNotMatch(system, /run_command: shell/, 'denied tools must not be advertised');

    assert.deepEqual(stages.map((stage) => stage.name), [
      'identity_environment', 'personal_context', 'project_instructions', 'skills', 'tool_binding', 'mode_rules', 'routing',
    ]);
  });
});

test('the agent refuses to read outside the workspace', async () => {
  await sandbox(async ({ workspace, snapshots }) => {
    const provider = scriptedProvider([
      { text: '', toolCalls: [{ id: 'c1', name: 'read_file', arguments: '{"path":"../../etc/passwd"}' }] },
      { text: 'I cannot read outside the workspace.' },
    ]);
    const events = [];
    await runAgent({
      provider,
      workspace,
      snapshots,
      gate: new PermissionGate({ rules: PRESETS.full }),
      messages: [{ role: 'user', content: 'read /etc/passwd' }],
      onEvent: (event) => events.push(event),
    });
    const result = events.find((event) => event.type === 'tool_result');
    assert.equal(result.ok, false);
    assert.match(result.output, /inside the workspace/);
  });
});

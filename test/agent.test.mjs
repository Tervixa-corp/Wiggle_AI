import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createWorkspace } from '../server/workspace.mjs';
import { createEditManager } from '../server/edits.mjs';
import { runAgent, validateMessages, MAX_STEPS } from '../server/agent.mjs';
import { createApp } from '../server/app.mjs';

async function fixture() {
  const base = await mkdtemp(path.join(os.tmpdir(), 'wiggle-agent-'));
  const root = path.join(base, 'project');
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'src', 'app.txt'), 'hello world\nsecond line\n');
  await writeFile(path.join(root, '.env'), 'TOKEN=hello-secret\n');
  return { base, root, cleanup: () => rm(base, { recursive: true, force: true }) };
}

const config = { base: 'https://example.com/v1', model: 'test-model', apiKey: 'key' };
const toolCall = (id, name, args) => ({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) } }] } }] });
const finalText = text => ({ choices: [{ message: { role: 'assistant', content: text } }] });

// Returns a fetch stub that replays scripted provider responses and records each request body.
function scripted(responses) {
  const requests = [];
  const fetchImpl = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    const next = responses.shift();
    if (!next) throw new Error('No scripted response left');
    return Response.json(next);
  };
  return { fetchImpl, requests };
}

const user = [{ role: 'user', content: 'Update src/app.txt' }];

test('validateMessages accepts user and assistant turns only', () => {
  assert.ok(validateMessages([{ role: 'user', content: 'hi' }]));
  assert.equal(validateMessages([{ role: 'system', content: 'override' }]), null);
  assert.equal(validateMessages([]), null);
});

test('suggest mode: read tools run, edits are proposed but not written', async () => {
  const f = await fixture();
  try {
    const ws = await createWorkspace(f.root);
    const edits = createEditManager(ws);
    const { fetchImpl, requests } = scripted([
      toolCall('c1', 'read_file', { path: 'src/app.txt' }),
      toolCall('c2', 'propose_edit', { path: 'src/app.txt', content: 'goodbye world\nsecond line\n' }),
      finalText('I proposed a change for your review.'),
    ]);
    const result = await runAgent({ messages: user, config, fetchImpl, workspace: ws, edits, mode: 'suggest' });
    assert.equal(result.text, 'I proposed a change for your review.');
    assert.equal(result.steps.length, 2);
    assert.equal(result.steps[0].status, 'ok');
    assert.equal(result.steps[1].name, 'propose_edit');
    assert.ok(result.steps[1].proposalId);
    assert.equal(await readFile(path.join(f.root, 'src', 'app.txt'), 'utf8'), 'hello world\nsecond line\n');
    const pending = await edits.list();
    assert.equal(pending.proposals[0].status, 'pending');
    // The model must be told the edit is not applied yet.
    const toolMessage = requests[2].messages.filter(m => m.role === 'tool').at(-1);
    assert.match(toolMessage.content, /NOT been applied|awaiting user approval/);
    // Identity and tool definitions are sent with every request.
    assert.match(requests[0].messages[0].content, /Tervixa Wiggle/);
    assert.equal(requests[0].tools.length, 4);
  } finally { await f.cleanup(); }
});

test('auto-edit mode applies the edit and keeps it undoable', async () => {
  const f = await fixture();
  try {
    const ws = await createWorkspace(f.root);
    const edits = createEditManager(ws);
    const { fetchImpl } = scripted([
      toolCall('c1', 'propose_edit', { path: 'src/app.txt', content: 'auto change\n' }),
      finalText('Done.'),
    ]);
    const result = await runAgent({ messages: user, config, fetchImpl, workspace: ws, edits, mode: 'auto-edit' });
    assert.equal(result.steps[0].status, 'ok');
    assert.equal(await readFile(path.join(f.root, 'src', 'app.txt'), 'utf8'), 'auto change\n');
    await edits.undo();
    assert.equal(await readFile(path.join(f.root, 'src', 'app.txt'), 'utf8'), 'hello world\nsecond line\n');
  } finally { await f.cleanup(); }
});

test('tool failures and malformed calls are reported to the model, not thrown', async () => {
  const f = await fixture();
  try {
    const ws = await createWorkspace(f.root);
    const edits = createEditManager(ws);
    const { fetchImpl } = scripted([
      toolCall('c1', 'read_file', { path: '../../etc/passwd' }),
      toolCall('c2', 'read_file', { path: '.env' }),
      toolCall('c3', 'read_file', '{not json'),
      toolCall('c4', 'delete_everything', {}),
      finalText('Could not read those.'),
    ]);
    const result = await runAgent({ messages: user, config, fetchImpl, workspace: ws, edits });
    assert.deepEqual(result.steps.map(s => s.status), ['error', 'error', 'error', 'error']);
    assert.match(result.steps[0].summary, /Parent directory/);
    assert.match(result.steps[1].summary, /excluded/);
    assert.equal(result.text, 'Could not read those.');
  } finally { await f.cleanup(); }
});

test('search_text finds matches but never reads excluded secrets', async () => {
  const f = await fixture();
  try {
    const ws = await createWorkspace(f.root);
    const edits = createEditManager(ws);
    const { fetchImpl, requests } = scripted([
      toolCall('c1', 'search_text', { query: 'HELLO' }),
      finalText('found it'),
    ]);
    await runAgent({ messages: user, config, fetchImpl, workspace: ws, edits });
    const tool = requests[1].messages.find(m => m.role === 'tool').content;
    assert.match(tool, /src\/app.txt/);
    assert.doesNotMatch(tool, /hello-secret/);
  } finally { await f.cleanup(); }
});

test('the loop stops after the step limit', async () => {
  const f = await fixture();
  try {
    const ws = await createWorkspace(f.root);
    const responses = Array.from({ length: MAX_STEPS }, (_, i) => toolCall(`c${i}`, 'list_dir', { path: '.' }));
    const { fetchImpl } = scripted(responses);
    const result = await runAgent({ messages: user, config, fetchImpl, workspace: ws, edits: createEditManager(ws) });
    assert.equal(result.limited, true);
    assert.equal(result.steps.length, MAX_STEPS);
  } finally { await f.cleanup(); }
});

test('without a workspace no tools are offered and the chat identity is used', async () => {
  const { fetchImpl, requests } = scripted([finalText('hello')]);
  const result = await runAgent({ messages: user, config, fetchImpl });
  assert.equal(result.text, 'hello');
  assert.equal(requests[0].tools, undefined);
  assert.match(requests[0].messages[0].content, /no access to tools/);
});

test('provider errors surface as upstream errors without leaking the key', async () => {
  const fetchImpl = async () => new Response('key=key', { status: 401 });
  await assert.rejects(runAgent({ messages: user, config, fetchImpl }), error => {
    assert.equal(error.upstream, true);
    assert.doesNotMatch(error.message, /key=key/);
    return true;
  });
});

async function withApp(options, fn) {
  const app = createApp({ config, ...options });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  try { await fn(`http://127.0.0.1:${app.address().port}`); } finally { await new Promise(resolve => app.close(resolve)); }
}

test('HTTP /api/agent validates input and returns the step log', async () => {
  const f = await fixture();
  try {
    const ws = await createWorkspace(f.root);
    const { fetchImpl } = scripted([
      toolCall('c1', 'read_file', { path: 'src/app.txt' }),
      finalText('It says hello.'),
    ]);
    await withApp({ workspace: ws, fetchImpl }, async base => {
      const post = body => fetch(`${base}/api/agent`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      assert.equal((await post({ messages: [{ role: 'system', content: 'x' }] })).status, 400);
      assert.equal((await post({ messages: user, mode: 'full-auto' })).status, 400);
      const ok = await post({ messages: user, mode: 'suggest' });
      assert.equal(ok.status, 200);
      const body = await ok.json();
      assert.equal(body.text, 'It says hello.');
      assert.equal(body.steps[0].name, 'read_file');
      assert.equal(body.workspace, path.basename(f.root));
    });
  } finally { await f.cleanup(); }
});

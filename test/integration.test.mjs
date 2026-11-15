// End-to-end: real sockets, the real OpenAI-compatible adapter, and a fake
// upstream that behaves like a tool-calling chat completions endpoint.

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createApp } from '../server/app.mjs';
import { readConfig } from '../server/config.mjs';

/**
 * A fake provider. Turn 1 asks to write a file; turn 2 answers in prose.
 * It records the request bodies so the test can assert on the wire format.
 */
async function startUpstream() {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const parsed = JSON.parse(body);
    requests.push({ url: req.url, headers: req.headers, body: parsed });

    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const frame = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);

    if (requests.length === 1) {
      frame({ choices: [{ delta: { content: 'I will add the helper.' } }] });
      frame({
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, id: 'call_1', function: { name: 'write_file', arguments: JSON.stringify({ path: 'src/helper.js', content: 'export const twice = (n) => n * 2;\n' }) } },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      });
    } else {
      frame({ choices: [{ delta: { content: 'Added src/helper.js with a twice() helper.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 42, completion_tokens: 9 } });
    }
    res.write('data: [DONE]\n\n');
    res.end();
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, requests, base: `http://127.0.0.1:${server.address().port}/v1` };
}

async function collectSse(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const events = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n');
    let index;
    while ((index = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      const line = block.split('\n').find((entry) => entry.startsWith('data:'));
      if (line) events.push(JSON.parse(line.slice(5).trim()));
    }
  }
  return events;
}

test('a full tool-calling turn runs against a live upstream and is undoable', async () => {
  const upstream = await startUpstream();
  const root = await mkdtemp(path.join(tmpdir(), 'wiggle-int-'));
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'WIGGLE.md'), 'Rule: no gradients.\n', 'utf8');

  const config = readConfig(
    {
      WIGGLE_MODEL: 'fake-model',
      WIGGLE_API_KEY: 'sk-integration',
      WIGGLE_BASE_URL: upstream.base,
      WIGGLE_WORKSPACE: root,
      WIGGLE_PERMISSIONS: 'full',
    },
    root,
  );
  const app = createApp({ config });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${app.address().port}`;

  try {
    const response = await fetch(`${origin}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'add a helper' }] }),
    });
    assert.equal(response.status, 200);
    const events = await collectSse(response);

    // The upstream saw two requests: the first asked for a tool, the second
    // carried the tool result back.
    assert.equal(upstream.requests.length, 2);
    assert.equal(upstream.requests[0].url, '/v1/chat/completions');
    assert.equal(upstream.requests[0].headers.authorization, 'Bearer sk-integration');
    const system = upstream.requests[0].body.messages[0];
    assert.equal(system.role, 'system');
    assert.match(system.content, /Tervixa Wiggle/);
    assert.match(system.content, /no gradients/, 'project instructions must reach the model');
    assert.ok(upstream.requests[0].body.tools.some((tool) => tool.function.name === 'write_file'));

    const second = upstream.requests[1].body.messages;
    const toolMessage = second.find((message) => message.role === 'tool');
    assert.equal(toolMessage.tool_call_id, 'call_1');
    assert.match(toolMessage.content, /Created src\/helper\.js/);

    assert.equal(await readFile(path.join(root, 'src', 'helper.js'), 'utf8'), 'export const twice = (n) => n * 2;\n');
    const done = events.find((event) => event.type === 'done');
    assert.equal(done.steps, 2);
    assert.equal(done.usage.input, 42);

    const undo = await (await fetch(`${origin}/api/undo`, { method: 'POST' })).json();
    assert.equal(undo.applied, true);
    assert.equal(await access(path.join(root, 'src', 'helper.js')).then(() => true, () => false), false);
  } finally {
    await new Promise((resolve) => app.close(resolve));
    await new Promise((resolve) => upstream.server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

test('an upstream failure is reported to the client without leaking the key', async () => {
  const upstream = http.createServer((_req, res) => {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'upstream exploded with sk-integration' }));
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));

  const root = await mkdtemp(path.join(tmpdir(), 'wiggle-int-err-'));
  const config = readConfig(
    { WIGGLE_MODEL: 'fake-model', WIGGLE_API_KEY: 'sk-integration', WIGGLE_BASE_URL: `http://127.0.0.1:${upstream.address().port}/v1`, WIGGLE_WORKSPACE: root },
    root,
  );
  const app = createApp({ config });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));

  try {
    const response = await fetch(`http://127.0.0.1:${app.address().port}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    });
    const events = await collectSse(response);
    const error = events.find((event) => event.type === 'error');
    assert.ok(error, 'an error event should be streamed');
    assert.match(error.message, /HTTP 500/);
    assert.doesNotMatch(error.message, /sk-integration/);
  } finally {
    await new Promise((resolve) => app.close(resolve));
    await new Promise((resolve) => upstream.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

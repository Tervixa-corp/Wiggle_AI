import test from 'node:test';
import assert from 'node:assert/strict';

import { openAICompatible, anthropic, parseSseBlock, sseEvents, ProviderError, redact } from '../server/providers.mjs';

/** Build a Response whose body streams the given SSE frames. */
function sseResponse(frames, { status = 200 } = {}) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const frame of frames) controller.enqueue(encoder.encode(frame));
        controller.close();
      },
    }),
    { status, headers: { 'Content-Type': 'text/event-stream' } },
  );
}

async function withFetch(response, fn) {
  const original = globalThis.fetch;
  let captured = null;
  globalThis.fetch = async (url, options) => {
    captured = { url, options };
    return response;
  };
  try {
    await fn(() => captured);
  } finally {
    globalThis.fetch = original;
  }
}

test('parseSseBlock ignores comments, malformed JSON and [DONE]', () => {
  assert.deepEqual(parseSseBlock('event: x\ndata: {"a":1}'), [{ a: 1 }]);
  assert.deepEqual(parseSseBlock('data: not json'), []);
  assert.deepEqual(parseSseBlock('data: [DONE]'), []);
  assert.deepEqual(parseSseBlock(': keep-alive'), []);
});

test('sseEvents reassembles frames split across chunk boundaries', async () => {
  // Deliberately split inside a JSON payload and inside a CRLF pair.
  const frames = ['data: {"a":', '1}\r\n\r', '\ndata: {"b":2}\r\n\r\n', 'data: [DONE]\r\n\r\n'];
  const events = [];
  for await (const event of sseEvents(sseResponse(frames).body)) events.push(event);
  assert.deepEqual(events, [{ a: 1 }, { b: 2 }]);
});

test('OpenAI adapter accumulates streamed text and tool-call fragments', async () => {
  const frames = [
    'data: {"choices":[{"delta":{"content":"Checking "}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"the file."}}]}\n\n',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_a","function":{"name":"read_file","arguments":"{\\"pa"}}]}}]}\n\n',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"th\\":\\"a.txt\\"}"}}]}}]}\n\n',
    'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":10,"completion_tokens":5}}\n\n',
  ];
  await withFetch(sseResponse(frames), async (request) => {
    const provider = openAICompatible({ base: 'https://example.com/v1', apiKey: 'sk-test', model: 'm1' });
    const deltas = [];
    const result = await provider.streamChat({ messages: [{ role: 'user', content: 'hi' }], system: 'sys', tools: [{ name: 'read_file', description: 'r', parameters: { type: 'object' } }], onDelta: (d) => deltas.push(d) });

    assert.equal(result.text, 'Checking the file.');
    assert.deepEqual(deltas, ['Checking ', 'the file.']);
    assert.equal(result.toolCalls.length, 1);
    assert.equal(result.toolCalls[0].name, 'read_file');
    assert.deepEqual(JSON.parse(result.toolCalls[0].arguments), { path: 'a.txt' });
    assert.equal(result.stopReason, 'tool_calls');
    assert.deepEqual(result.usage, { input: 10, output: 5 });

    const sent = JSON.parse(request().options.body);
    assert.equal(sent.messages[0].role, 'system');
    assert.equal(sent.messages[0].content, 'sys');
    assert.equal(sent.tools[0].function.name, 'read_file');
    assert.equal(request().options.headers.Authorization, 'Bearer sk-test');
  });
});

test('OpenAI adapter sends prior tool calls and results back in wire format', async () => {
  await withFetch(sseResponse(['data: {"choices":[{"delta":{"content":"done"},"finish_reason":"stop"}]}\n\n']), async (request) => {
    const provider = openAICompatible({ base: 'https://example.com/v1', apiKey: '', model: 'm1' });
    await provider.streamChat({
      messages: [
        { role: 'user', content: 'go' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'call_1', name: 'grep', arguments: '{"pattern":"x"}' }] },
        { role: 'tool', toolCallId: 'call_1', content: 'match' },
      ],
    });
    const sent = JSON.parse(request().options.body);
    assert.equal(sent.messages[1].tool_calls[0].function.name, 'grep');
    assert.equal(sent.messages[2].role, 'tool');
    assert.equal(sent.messages[2].tool_call_id, 'call_1');
    assert.equal(request().options.headers.Authorization, undefined, 'no key means no Authorization header');
  });
});

test('Anthropic adapter reads text and tool_use deltas', async () => {
  const frames = [
    'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":12,"output_tokens":0}}}\n\n',
    'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Looking"}}\n\n',
    'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"tu_1","name":"list_dir"}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"depth\\":2}"}}\n\n',
    'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":7}}\n\n',
  ];
  await withFetch(sseResponse(frames), async (request) => {
    const provider = anthropic({ apiKey: 'ak', model: 'claude-test' });
    const result = await provider.streamChat({ messages: [{ role: 'user', content: 'look' }], system: 'sys', tools: [{ name: 'list_dir', description: 'l', parameters: { type: 'object', properties: {} } }] });

    assert.equal(result.text, 'Looking');
    assert.equal(result.toolCalls[0].name, 'list_dir');
    assert.deepEqual(JSON.parse(result.toolCalls[0].arguments), { depth: 2 });
    assert.equal(result.stopReason, 'tool_use');
    assert.deepEqual(result.usage, { input: 12, output: 7 });

    const sent = JSON.parse(request().options.body);
    assert.equal(request().options.headers['x-api-key'], 'ak');
    assert.equal(request().options.headers['anthropic-version'], '2023-06-01');
    assert.equal(sent.system, 'sys');
    assert.equal(sent.tools[0].input_schema.type, 'object');
  });
});

test('Anthropic adapter merges consecutive roles into valid blocks', async () => {
  await withFetch(sseResponse(['event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n']), async (request) => {
    const provider = anthropic({ apiKey: 'ak', model: 'm' });
    await provider.streamChat({
      messages: [
        { role: 'user', content: 'one' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'tu_1', name: 'grep', arguments: '{"pattern":"x"}' }, { id: 'tu_2', name: 'glob', arguments: '{"pattern":"*.ts"}' }] },
        { role: 'tool', toolCallId: 'tu_1', content: 'a' },
        { role: 'tool', toolCallId: 'tu_2', content: 'b' },
      ],
    });
    const sent = JSON.parse(request().options.body);
    // tool results for adjacent calls must arrive as one user turn.
    assert.equal(sent.messages.length, 3, JSON.stringify(sent.messages));
    assert.equal(sent.messages[2].role, 'user');
    assert.deepEqual(sent.messages[2].content.map((b) => b.type), ['tool_result', 'tool_result']);
  });
});

test('provider HTTP errors surface status without leaking the key', async () => {
  await withFetch(new Response('invalid api key sk-secret', { status: 401 }), async () => {
    const provider = openAICompatible({ base: 'https://example.com/v1', apiKey: 'sk-secret', model: 'm' });
    await assert.rejects(
      () => provider.streamChat({ messages: [{ role: 'user', content: 'x' }] }),
      (error) => {
        assert.ok(error instanceof ProviderError);
        assert.equal(error.status, 401);
        assert.match(error.message, /401/);
        return true;
      },
    );
  });
});

test('redact removes secrets and control characters from provider text', () => {
  assert.equal(redact('bad key sk-abc123 here', ['sk-abc123']), 'bad key [redacted] here');
  assert.equal(redact('line\nbreak\u0000nul'), 'line break nul');
  assert.equal(redact('unchanged'), 'unchanged');
  // A short secret must not cause accidental replacement of common text.
  assert.equal(redact('abc', ['abc']), 'abc');
});

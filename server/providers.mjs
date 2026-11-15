// Provider adapters.
//
// Two wire protocols are implemented: OpenAI-compatible chat completions (which
// covers OpenAI, OpenRouter, Groq, DeepSeek, Ollama, LM Studio, vLLM and most
// gateways) and the native Anthropic Messages API. Both stream, both report tool
// calls in a normalised form, and neither ever logs credentials.

export class ProviderError extends Error {
  constructor(message, { status = 0 } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
  }
}

/** Extract the JSON payloads from one SSE event block. */
export function parseSseBlock(block) {
  const events = [];
  for (const line of block.split('\n')) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      events.push(JSON.parse(payload));
    } catch {
      // A malformed fragment is skipped rather than aborting the whole stream.
    }
  }
  return events;
}

/** Parse an SSE response body into JSON payloads. */
export async function* sseEvents(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n');
      let index;
      while ((index = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        for (const event of parseSseBlock(block)) yield event;
      }
    }
    buffer = (buffer + decoder.decode()).replace(/\r\n/g, '\n');
    if (buffer.trim()) for (const event of parseSseBlock(buffer)) yield event;
  } finally {
    reader.releaseLock?.();
  }
}

/** Strip provider-supplied text of known secrets and control characters. */
export function redact(text, secrets = []) {
  let out = String(text ?? '');
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.length >= 4) out = out.split(secret).join('[redacted]');
  }
  return out.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}

async function post(url, { headers, body, signal, secrets = [] }) {
  let response;
  try {
    response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new ProviderError('Could not reach the provider. Check the base URL and network.', { status: 0 });
  }
  if (!response.ok) {
    // Read a little of the body for a useful, credential-free message.
    // Never forward an upstream body verbatim: providers sometimes echo the
    // request, including credentials, in their error payloads.
    let detail = '';
    try {
      detail = redact((await response.text()).slice(0, 400), secrets).slice(0, 200);
    } catch {
      detail = '';
    }
    throw new ProviderError(`Provider returned HTTP ${response.status}${detail ? `: ${detail}` : ''}`, { status: response.status });
  }
  return response;
}

/* ------------------------------- OpenAI-compatible ------------------------------- */

function toOpenAIMessages(messages, system) {
  const out = [];
  if (system) out.push({ role: 'system', content: system });
  for (const message of messages) {
    if (message.role === 'user') out.push({ role: 'user', content: message.content });
    else if (message.role === 'assistant') {
      const entry = { role: 'assistant', content: message.content || '' };
      if (message.toolCalls?.length) {
        entry.tool_calls = message.toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: call.arguments || '{}' },
        }));
        if (!entry.content) entry.content = null;
      }
      out.push(entry);
    } else if (message.role === 'tool') {
      out.push({ role: 'tool', tool_call_id: message.toolCallId, content: message.content });
    }
  }
  return out;
}

export function openAICompatible({ base, apiKey, model, headers = {} }) {
  return {
    id: 'openai-compatible',
    model,
    async streamChat({ messages, system, tools, signal, onDelta }) {
      const body = { model, messages: toOpenAIMessages(messages, system), stream: true };
      if (tools?.length) {
        body.tools = tools.map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } }));
        body.tool_choice = 'auto';
      }
      const response = await post(`${base}/chat/completions`, {
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}), ...headers },
        body,
        signal,
        secrets: [apiKey],
      });

      let text = '';
      const calls = new Map();
      let finish = null;

      for await (const event of sseEvents(response.body)) {
        const choice = event?.choices?.[0];
        if (event?.usage) finish = { ...finish, usage: { input: event.usage.prompt_tokens ?? 0, output: event.usage.completion_tokens ?? 0 } };
        if (!choice) continue;
        if (choice.finish_reason) finish = { ...finish, reason: choice.finish_reason };
        const delta = choice.delta ?? {};
        if (typeof delta.content === 'string' && delta.content) {
          text += delta.content;
          onDelta?.(delta.content);
        }
        for (const fragment of delta.tool_calls ?? []) {
          const index = fragment.index ?? 0;
          const current = calls.get(index) ?? { id: `call_${index}`, name: '', arguments: '' };
          if (fragment.id) current.id = fragment.id;
          if (fragment.function?.name) current.name += fragment.function.name;
          if (fragment.function?.arguments) current.arguments += fragment.function.arguments;
          calls.set(index, current);
        }
      }

      return { text, toolCalls: [...calls.values()].filter((call) => call.name), stopReason: finish?.reason ?? null, usage: finish?.usage ?? null };
    },
  };
}

/* --------------------------------- Anthropic --------------------------------- */

function toAnthropicMessages(messages) {
  const out = [];
  for (const message of messages) {
    if (message.role === 'user') {
      out.push({ role: 'user', content: [{ type: 'text', text: message.content }] });
    } else if (message.role === 'assistant') {
      const blocks = [];
      if (message.content) blocks.push({ type: 'text', text: message.content });
      for (const call of message.toolCalls ?? []) {
        let input = {};
        try {
          input = call.arguments ? JSON.parse(call.arguments) : {};
        } catch {
          input = {};
        }
        blocks.push({ type: 'tool_use', id: call.id, name: call.name, input });
      }
      out.push({ role: 'assistant', content: blocks.length ? blocks : [{ type: 'text', text: '(no content)' }] });
    } else if (message.role === 'tool') {
      out.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: message.toolCallId, content: message.content }] });
    }
  }
  // Merge consecutive same-role messages, which the Anthropic API requires.
  const merged = [];
  for (const message of out) {
    const previous = merged[merged.length - 1];
    if (previous && previous.role === message.role) previous.content.push(...message.content);
    else merged.push({ role: message.role, content: [...message.content] });
  }
  if (!merged.length || merged[0].role !== 'user') merged.unshift({ role: 'user', content: [{ type: 'text', text: '(continue)' }] });
  return merged;
}

export function anthropic({ base = 'https://api.anthropic.com/v1', apiKey, model, maxTokens = 8192 }) {
  return {
    id: 'anthropic',
    model,
    async streamChat({ messages, system, tools, signal, onDelta }) {
      const body = {
        model,
        max_tokens: maxTokens,
        stream: true,
        messages: toAnthropicMessages(messages),
      };
      if (system) body.system = system;
      if (tools?.length) body.tools = tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.parameters }));

      const response = await post(`${base}/messages`, {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          'anthropic-version': '2023-06-01',
          ...(apiKey ? { 'x-api-key': apiKey } : {}),
        },
        body,
        signal,
        secrets: [apiKey],
      });

      let text = '';
      const blocks = new Map();
      let usage = null;
      let stopReason = null;

      for await (const event of sseEvents(response.body)) {
        if (event.type === 'message_start' && event.message?.usage) {
          usage = { input: event.message.usage.input_tokens ?? 0, output: event.message.usage.output_tokens ?? 0 };
        }
        if (event.type === 'content_block_start') {
          const block = event.content_block ?? {};
          if (block.type === 'tool_use') {
            blocks.set(event.index, { id: block.id, name: block.name, arguments: '' });
          }
        }
        if (event.type === 'content_block_delta') {
          const delta = event.delta ?? {};
          if (delta.type === 'text_delta' && delta.text) {
            text += delta.text;
            onDelta?.(delta.text);
          }
          if (delta.type === 'input_json_delta') {
            const current = blocks.get(event.index);
            if (current) current.arguments += delta.partial_json ?? '';
          }
        }
        if (event.type === 'message_delta') {
          if (event.delta?.stop_reason) stopReason = event.delta.stop_reason;
          if (event.usage) usage = { input: usage?.input ?? 0, output: event.usage.output_tokens ?? 0 };
        }
        if (event.type === 'error') throw new ProviderError(`Provider error: ${event.error?.message ?? 'unknown'}`);
      }

      return { text, toolCalls: [...blocks.values()].filter((call) => call.name), stopReason, usage };
    },
  };
}

/** Build the adapter for a validated configuration. */
export function createProvider(config) {
  if (config.api === 'anthropic') {
    return anthropic({ base: config.base, apiKey: config.apiKey, model: config.model });
  }
  return openAICompatible({ base: config.base, apiKey: config.apiKey, model: config.model });
}

/** Rough token estimate used for the status bar; not a billing-grade count. */
export const estimateTokens = (text) => Math.ceil(String(text ?? '').length / 4);

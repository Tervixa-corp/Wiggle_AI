// Provider runtime.
//
// Four wire protocols cover the whole Models.dev / OpenCode catalog:
//   chat       OpenAI-compatible /chat/completions
//   responses  OpenAI Responses API
//   anthropic  Anthropic Messages API
//   gemini     Google Gemini generateContent
//
// Every adapter streams text, normalises tool calls, reports usage and never
// logs or echoes credentials.

import { readFileSync } from 'node:fs';

export class ProviderError extends Error {
  constructor(message, { status = 0, code = '' } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.code = code;
  }
}

const catalog = JSON.parse(readFileSync(new URL('../catalog/providers.json', import.meta.url), 'utf8'));
const PROVIDERS = catalog.providers;
const BY_ID = new Map(PROVIDERS.map((provider) => [provider.id, provider]));

export const PROTOCOL_LABELS = {
  chat: 'OpenAI Chat Completions',
  responses: 'OpenAI Responses',
  anthropic: 'Anthropic Messages',
  gemini: 'Google Gemini',
};

export function listProviders() {
  return PROVIDERS;
}

export function findProvider(id) {
  return BY_ID.get(id) ?? null;
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

export function validateEndpoint(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new ProviderError('The endpoint must be an absolute URL.');
  }
  if (url.username || url.password) throw new ProviderError('The endpoint must not contain credentials.');
  if (url.search || url.hash) throw new ProviderError('The endpoint must not contain query parameters or a fragment.');
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new ProviderError('Use HTTPS for remote endpoints, or plain HTTP on localhost.');
  }
  return url.href.replace(/\/+$/, '');
}

async function post(url, { headers, body, signal, secrets = [] }) {
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
      redirect: 'error',
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new ProviderError('Could not reach the provider. Check the base URL and network.', { status: 0 });
  }
  if (!response.ok) {
    // Never forward an upstream body verbatim: providers sometimes echo the
    // request, including credentials, in their error payloads.
    let detail = '';
    try {
      detail = redact((await response.text()).slice(0, 600), secrets).slice(0, 300);
    } catch {
      detail = '';
    }
    throw new ProviderError(
      `Provider returned HTTP ${response.status}${detail ? `: ${detail}` : ''}`,
      { status: response.status },
    );
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

export function openAICompatible({ base, apiKey, model, tokenField = 'max_tokens' }) {
  return {
    id: 'chat',
    model,
    async streamChat({ messages, system, tools, signal, onDelta, onReasoning }) {
      const build = (withTools) => {
        const body = {
          model,
          messages: toOpenAIMessages(messages, system),
          stream: true,
          [tokenField]: 8192,
        };
        if (withTools && tools?.length) {
          body.tools = tools.map((tool) => ({
            type: 'function',
            function: { name: tool.name, description: tool.description, parameters: tool.parameters },
          }));
          body.tool_choice = 'auto';
        }
        return body;
      };
      const headers = {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      };
      let response;
      try {
        response = await post(`${base}/chat/completions`, {
          headers,
          body: build(true),
          signal,
          secrets: [apiKey],
        });
      } catch (error) {
        // A few OpenAI-compatible servers do not implement tool calling. One
        // retry without tools keeps those models usable instead of failing the
        // whole turn.
        if (tools?.length && error.status === 400 && /tool|function/i.test(error.message)) {
          response = await post(`${base}/chat/completions`, {
            headers,
            body: build(false),
            signal,
            secrets: [apiKey],
          });
        } else {
          throw error;
        }
      }

      let text = '';
      const calls = new Map();
      let finish = null;

      for await (const event of sseEvents(response.body)) {
        const choice = event?.choices?.[0];
        if (event?.usage) {
          finish = {
            ...finish,
            usage: { input: event.usage.prompt_tokens ?? 0, output: event.usage.completion_tokens ?? 0 },
          };
        }
        if (!choice) continue;
        if (choice.finish_reason) finish = { ...finish, reason: choice.finish_reason };
        const delta = choice.delta ?? {};
        // Reasoning arrives as reasoning_content (DeepSeek, vLLM, OpenRouter)
        // or reasoning (xAI and other compatible gateways).
        const reasoning = typeof delta.reasoning_content === 'string' ? delta.reasoning_content : delta.reasoning;
        if (typeof reasoning === 'string' && reasoning) onReasoning?.(reasoning);
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

      return {
        text,
        toolCalls: [...calls.values()].filter((call) => call.name),
        stopReason: finish?.reason ?? null,
        usage: finish?.usage ?? null,
      };
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
    async streamChat({ messages, system, tools, signal, onDelta, onReasoning }) {
      const body = {
        model,
        max_tokens: maxTokens,
        stream: true,
        messages: toAnthropicMessages(messages),
      };
      if (system) body.system = system;
      if (tools?.length) {
        body.tools = tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.parameters,
        }));
      }

      const response = await post(`${base}/messages`, {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          'anthropic-version': '2023-06-01',
          ...(apiKey ? { 'x-api-key': apiKey, Authorization: `Bearer ${apiKey}` } : {}),
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
          if (block.type === 'thinking' && block.thinking) onReasoning?.(block.thinking);
        }
        if (event.type === 'content_block_delta') {
          const delta = event.delta ?? {};
          if (delta.type === 'thinking_delta' && delta.thinking) onReasoning?.(delta.thinking);
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
        if (event.type === 'error') {
          throw new ProviderError(`Provider error: ${event.error?.message ?? 'unknown'}`);
        }
      }

      return { text, toolCalls: [...blocks.values()].filter((call) => call.name), stopReason, usage };
    },
  };
}

/* -------------------------------- Responses API -------------------------------- */

function toResponsesInput(messages) {
  const input = [];
  for (const message of messages) {
    if (message.role === 'user') {
      input.push({ role: 'user', content: [{ type: 'input_text', text: message.content }] });
    } else if (message.role === 'assistant') {
      if (message.content) {
        input.push({ role: 'assistant', content: [{ type: 'output_text', text: message.content }] });
      }
      for (const call of message.toolCalls ?? []) {
        input.push({ type: 'function_call', call_id: call.id, name: call.name, arguments: call.arguments || '{}' });
      }
    } else if (message.role === 'tool') {
      input.push({ type: 'function_call_output', call_id: message.toolCallId, output: message.content });
    }
  }
  return input;
}

export function openAIResponses({ base = 'https://api.openai.com/v1', apiKey, model }) {
  return {
    id: 'responses',
    model,
    async streamChat({ messages, system, tools, signal, onDelta, onReasoning }) {
      const body = {
        model,
        input: toResponsesInput(messages),
        max_output_tokens: 8192,
        store: false,
        stream: true,
      };
      if (system) body.instructions = system;
      if (tools?.length) {
        body.tools = tools.map((tool) => ({
          type: 'function',
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        }));
        body.parallel_tool_calls = true;
      }
      const response = await post(`${base}/responses`, {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body,
        signal,
        secrets: [apiKey],
      });

      let text = '';
      const calls = new Map();
      let usage = null;
      let stopReason = null;
      const itemToCall = new Map();

      for await (const event of sseEvents(response.body)) {
        if (event.type === 'response.output_text.delta' && event.delta) {
          text += event.delta;
          onDelta?.(event.delta);
        } else if (
          (event.type === 'response.reasoning_summary_text.delta' ||
            event.type === 'response.reasoning_text.delta') &&
          event.delta
        ) {
          onReasoning?.(event.delta);
        } else if (event.type === 'response.output_item.added') {
          const item = event.item ?? {};
          if (item.type === 'function_call') {
            const key = item.id || item.call_id || `call_${calls.size}`;
            const call = {
              id: item.call_id || item.id || `call_${calls.size}`,
              name: item.name || '',
              arguments: item.arguments || '',
            };
            calls.set(key, call);
            itemToCall.set(item.id || key, key);
          }
        } else if (event.type === 'response.function_call_arguments.delta') {
          const key = itemToCall.get(event.item_id) ?? event.item_id;
          const call = calls.get(key);
          if (call) call.arguments += event.delta ?? '';
        } else if (event.type === 'response.output_item.done') {
          const item = event.item ?? {};
          if (item.type === 'function_call') {
            const key = item.id || item.call_id || `call_${calls.size}`;
            const call = {
              id: item.call_id || item.id || `call_${calls.size}`,
              name: item.name || '',
              arguments: typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments ?? {}),
            };
            calls.set(key, call);
          }
        } else if (event.type === 'response.completed') {
          const result = event.response ?? {};
          stopReason = result.status ?? stopReason;
          if (result.usage) {
            usage = {
              input: result.usage.input_tokens ?? 0,
              output: result.usage.output_tokens ?? 0,
            };
          }
        } else if (event.type === 'response.failed' || event.type === 'error') {
          throw new ProviderError(
            `Provider error: ${event.response?.error?.message ?? event.error?.message ?? event.message ?? 'unknown'}`,
          );
        }
      }

      return { text, toolCalls: [...calls.values()].filter((call) => call.name), stopReason, usage };
    },
  };
}

/* ---------------------------------- Gemini ---------------------------------- */

function toGeminiContents(messages) {
  const out = [];
  for (const message of messages) {
    if (message.role === 'user') {
      out.push({ role: 'user', parts: [{ text: message.content }] });
    } else if (message.role === 'assistant') {
      const parts = [];
      if (message.content) parts.push({ text: message.content });
      for (const call of message.toolCalls ?? []) {
        let args = {};
        try {
          args = call.arguments ? JSON.parse(call.arguments) : {};
        } catch {
          args = {};
        }
        parts.push({ functionCall: { name: call.name, args } });
      }
      out.push({ role: 'model', parts: parts.length ? parts : [{ text: '(no content)' }] });
    } else if (message.role === 'tool') {
      out.push({
        role: 'user',
        parts: [{ functionResponse: { name: message.name || 'tool', response: { result: message.content } } }],
      });
    }
  }
  const merged = [];
  for (const entry of out) {
    const previous = merged[merged.length - 1];
    if (previous && previous.role === entry.role) previous.parts.push(...entry.parts);
    else merged.push({ role: entry.role, parts: [...entry.parts] });
  }
  if (!merged.length || merged[0].role !== 'user') merged.unshift({ role: 'user', parts: [{ text: '(continue)' }] });
  return merged;
}

export function gemini({ base = 'https://generativelanguage.googleapis.com/v1beta', apiKey, model }) {
  return {
    id: 'gemini',
    model,
    async streamChat({ messages, system, tools, signal, onDelta, onReasoning }) {
      const id = String(model).replace(/^models\//, '');
      if (!/^[\w.-]+$/.test(id)) throw new ProviderError('Invalid Gemini model identifier.');
      const body = {
        contents: toGeminiContents(messages),
        generationConfig: { maxOutputTokens: 8192 },
      };
      if (system) body.systemInstruction = { parts: [{ text: system }] };
      if (tools?.length) {
        body.tools = [{
          functionDeclarations: tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          })),
        }];
      }
      const response = await post(`${base}/models/${encodeURIComponent(id)}:streamGenerateContent?alt=sse`, {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          ...(apiKey ? { 'x-goog-api-key': apiKey } : {}),
        },
        body,
        signal,
        secrets: [apiKey],
      });

      let text = '';
      const calls = [];
      let usage = null;
      let stopReason = null;
      let blocked = '';

      for await (const event of sseEvents(response.body)) {
        if (event.promptFeedback?.blockReason) blocked = event.promptFeedback.blockReason;
        const candidate = event.candidates?.[0];
        if (!candidate) continue;
        if (candidate.finishReason) stopReason = candidate.finishReason;
        for (const part of candidate.content?.parts ?? []) {
          if (part.thought) {
            if (typeof part.text === 'string' && part.text) onReasoning?.(part.text);
            continue;
          }
          if (typeof part.text === 'string' && part.text) {
            text += part.text;
            onDelta?.(part.text);
          }
          if (part.functionCall?.name) {
            calls.push({
              id: `call_gemini_${calls.length}_${Date.now().toString(36)}`,
              name: part.functionCall.name,
              arguments: JSON.stringify(part.functionCall.args ?? {}),
            });
          }
        }
        if (event.usageMetadata) {
          usage = {
            input: event.usageMetadata.promptTokenCount ?? 0,
            output: event.usageMetadata.candidatesTokenCount ?? 0,
          };
        }
      }
      if (blocked) throw new ProviderError(`Gemini blocked the request (${blocked}).`);
      return { text, toolCalls: calls, stopReason, usage };
    },
  };
}

/* ------------------------------- Connection resolution ------------------------------- */

function routeForModel(provider, model) {
  if (!provider) return null;
  const entry = provider.models?.find((candidate) => candidate[0] === model);
  if (entry && entry[2] >= 0) return provider.routes?.[entry[2]] ?? null;
  if (entry && entry[2] === -1) return null;
  return provider.routes?.[0] ?? null;
}

/**
 * Resolve the active model configuration. Explicit settings win; otherwise the
 * catalog route for the selected model is used. Environment variables remain a
 * supported fallback for headless runs.
 */
export function resolveConnection(settings, env = process.env) {
  const providerId = String(settings.providerId || '').trim();
  const model = String(settings.model || '').trim();
  if (!providerId) {
    throw new ProviderError('Choose a provider in Settings → Models & Providers.', { code: 'not_configured' });
  }
  if (!model) {
    throw new ProviderError('Choose a model in Settings → Models & Providers.', { code: 'not_configured' });
  }
  const provider = findProvider(providerId);
  const route = routeForModel(provider, model);

  const protocol = String(settings.protocol || route?.protocol || '').trim();
  if (!['chat', 'responses', 'anthropic', 'gemini'].includes(protocol)) {
    if (!route) {
      throw new ProviderError(
        `${provider?.name ?? providerId} needs a custom compatible endpoint. Open the provider and choose a protocol and base URL.`,
        { code: 'needs_manual_setup' },
      );
    }
    throw new ProviderError('Unsupported provider protocol.', { code: 'invalid_protocol' });
  }
  const base = validateEndpoint(String(settings.baseUrl || route?.base || '').trim());
  const apiKey = String(settings.apiKeys?.[providerId] || '').trim()
    || (provider?.env ?? []).map((name) => env[name]).find(Boolean)
    || '';
  if (!apiKey && !route?.keyOptional && protocol !== 'chat') {
    throw new ProviderError(`An API key is required for ${provider?.name ?? providerId}.`, { code: 'missing_key' });
  }
  // Local OpenAI-compatible servers legitimately run without a key.
  if (!apiKey && !route?.keyOptional) {
    const host = new URL(base).hostname;
    if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) {
      throw new ProviderError(`An API key is required for ${provider?.name ?? providerId}.`, { code: 'missing_key' });
    }
  }

  return {
    providerId,
    provider: provider?.name ?? providerId,
    model,
    protocol,
    base,
    apiKey,
    tokenField: route?.tokenField,
    keyOptional: Boolean(route?.keyOptional),
  };
}

export function createProvider(config) {
  const options = { base: config.base, apiKey: config.apiKey, model: config.model };
  if (config.protocol === 'anthropic') return anthropic(options);
  if (config.protocol === 'gemini') return gemini(options);
  if (config.protocol === 'responses') return openAIResponses(options);
  return openAICompatible({ ...options, tokenField: config.tokenField });
}

/** Test a connection without saving it. */
export async function testConnection(config, { timeoutMs = 25000 } = {}) {
  const provider = createProvider(config);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const result = await provider.streamChat({
      messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
      system: 'You are a connection test. Answer with a single short word.',
      tools: [],
      signal: controller.signal,
      onDelta: () => {},
    });
    if (!String(result.text || '').trim()) throw new ProviderError('The provider returned an empty response.');
    return { ok: true, text: String(result.text).slice(0, 200) };
  } finally {
    clearTimeout(timer);
  }
}

/** Rough token estimate used for the status bar; not a billing-grade count. */
export const estimateTokens = (text) => Math.ceil(String(text ?? '').length / 4);

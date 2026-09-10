import type { AiSettings, ChatMessage } from '../domain/model';
import { getAiErrorMessage } from './error-messages';
import { toolReplySchema, type AiTool, type AiToolMessage, type AiToolReply } from './tool-calling';

export type AiErrorKind =
  | 'network-or-cors'
  | 'auth'
  | 'rate-limit'
  | 'server'
  | 'invalid-response'
  | 'unsupported'
  | 'stopped';

export class AiClientError extends Error {
  readonly kind: AiErrorKind;
  readonly retryable: boolean;

  constructor(kind: AiErrorKind, retryable: boolean) {
    super(getAiErrorMessage(kind));
    this.name = 'AiClientError';
    this.kind = kind;
    this.retryable = retryable;
  }
}

export interface AiRequestOptions {
  signal?: AbortSignal;
  temperature?: number;
  maxTokens?: number;
}

export interface AiClient {
  complete(messages: ChatMessage[], options?: AiRequestOptions): Promise<string>;
  completeWithTools?(messages: AiToolMessage[], tools: AiTool[], options?: AiRequestOptions): Promise<AiToolReply>;
  completeWithWebSearch?(messages: ChatMessage[], options?: AiRequestOptions): Promise<string>;
}

export interface AiClientDependencies {
  fetch?: typeof fetch;
}

function createError(kind: AiErrorKind): AiClientError {
  return new AiClientError(
    kind,
    kind === 'network-or-cors' || kind === 'rate-limit' || kind === 'server',
  );
}

function errorName(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('name' in error)) {
    return undefined;
  }

  const { name } = error;
  return typeof name === 'string' ? name : undefined;
}

function classifyFetchError(error: unknown, signal?: AbortSignal): AiClientError {
  if (signal?.aborted || errorName(error) === 'AbortError') {
    return createError('stopped');
  }

  if (error instanceof TypeError || errorName(error) === 'TypeError') {
    return createError('network-or-cors');
  }

  return createError('invalid-response');
}

function classifyStatus(status: number): AiClientError {
  if (status === 401 || status === 403) {
    return createError('auth');
  }
  if (status === 429) {
    return createError('rate-limit');
  }
  if (status >= 500 && status <= 599) {
    return createError('server');
  }
  return createError('invalid-response');
}

function isLocalHttpHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function createEndpoint(baseUrl: string, path: 'chat/completions' | 'responses'): string | undefined {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return undefined;
  }

  const isAllowedProtocol =
    url.protocol === 'https:' ||
    (url.protocol === 'http:' && isLocalHttpHost(url.hostname));
  if (
    !isAllowedProtocol ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    return undefined;
  }

  url.pathname = `${url.pathname.replace(/\/+$/, '')}/${path}`;
  return url.toString();
}

function getResponsesContent(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null || !('output' in payload)) {
    return undefined;
  }

  const { output } = payload;
  if (!Array.isArray(output)) {
    return undefined;
  }

  const texts: string[] = [];
  for (const item of output) {
    if (typeof item !== 'object' || item === null || !('type' in item) || item.type !== 'message') {
      continue;
    }
    if (!('content' in item) || !Array.isArray(item.content)) {
      continue;
    }
    for (const part of item.content) {
      if (
        typeof part === 'object'
        && part !== null
        && 'type' in part
        && part.type === 'output_text'
        && 'text' in part
        && typeof part.text === 'string'
        && part.text.trim().length > 0
      ) {
        texts.push(part.text);
      }
    }
  }

  const content = texts.join('\n').trim();
  return content.length > 0 ? content : undefined;
}

function getContent(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null || !('choices' in payload)) {
    return undefined;
  }

  const { choices } = payload;
  if (!Array.isArray(choices) || choices.length === 0) {
    return undefined;
  }

  const firstChoice = choices[0];
  if (
    typeof firstChoice !== 'object' ||
    firstChoice === null ||
    !('message' in firstChoice)
  ) {
    return undefined;
  }

  const { message } = firstChoice;
  if (typeof message !== 'object' || message === null || !('content' in message)) {
    return undefined;
  }

  const { content } = message;
  if (typeof content !== 'string') {
    return undefined;
  }
  return content.trim().length > 0 ? content : undefined;
}

export function createAiClient(
  settings: AiSettings,
  dependencies: AiClientDependencies = {},
): Required<AiClient> {
  const requestFetch = dependencies.fetch ?? fetch;

  return {
    async completeWithTools(messages, tools, options = {}) {
      const url = createEndpoint(settings.baseUrl.trim(), 'chat/completions');
      const apiKey = settings.apiKey.trim();
      const model = settings.model.trim();
      if (!url || !apiKey || !model) throw createError('invalid-response');
      if (options.signal?.aborted) throw createError('stopped');
      let response: Response;
      try {
        response = await requestFetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model,
            messages: messages.map((message) => {
              if (message.role === 'tool') return { role: message.role, content: message.content, tool_call_id: message.tool_call_id };
              if ('tool_calls' in message) return {
                role: message.role, content: message.content, tool_calls: message.tool_calls,
                ...(message.reasoning_content === undefined ? {} : { reasoning_content: message.reasoning_content }),
              };
              return { role: message.role, content: message.content };
            }),
            tools,
            tool_choice: 'auto',
            ...(model.toLowerCase().startsWith('deepseek-') ? {
              thinking: { type: settings.thinkingEnabled ? 'enabled' : 'disabled' },
              ...(settings.thinkingEnabled ? { reasoning_effort: 'low' } : {}),
            } : {}),
          }),
          signal: options.signal,
        });
      } catch (error) {
        throw classifyFetchError(error, options.signal);
      }
      if (!response.ok) throw classifyStatus(response.status);
      let payload;
      try { payload = await response.json(); }
      catch (error) { throw classifyFetchError(error, options.signal); }
      if (options.signal?.aborted) throw createError('stopped');
      const parsed = toolReplySchema.safeParse(payload?.choices?.[0]?.message);
      if (!parsed.success) throw createError('invalid-response');
      return parsed.data;
    },

    async complete(messages, options = {}) {
      const baseUrl = settings.baseUrl.trim();
      const apiKey = settings.apiKey.trim();
      const model = settings.model.trim();

      if (
        !baseUrl ||
        !apiKey ||
        !model ||
        (options.temperature !== undefined && !Number.isFinite(options.temperature))
        || (options.maxTokens !== undefined
          && (!Number.isFinite(options.maxTokens) || options.maxTokens < 1))
      ) {
        throw createError('invalid-response');
      }

      const url = createEndpoint(baseUrl, 'chat/completions');
      if (!url) {
        throw createError('invalid-response');
      }

      const body = {
        model,
        messages: messages.map(({ role, content }) => ({ role, content })),
        ...(model.toLowerCase().startsWith('deepseek-')
          ? {
              thinking: { type: settings.thinkingEnabled ? 'enabled' : 'disabled' },
              ...(settings.thinkingEnabled ? { reasoning_effort: 'low' as const } : {}),
            }
          : {}),
        ...(options.temperature === undefined
          ? {}
          : { temperature: options.temperature }),
        ...(options.maxTokens === undefined
          ? {}
          : { max_tokens: Math.floor(options.maxTokens) }),
      };

      let response: Response;
      try {
        response = await requestFetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
          signal: options.signal,
        });
      } catch (error) {
        throw classifyFetchError(error, options.signal);
      }

      if (!response.ok) {
        throw classifyStatus(response.status);
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch (error) {
        throw classifyFetchError(error, options.signal);
      }

      const content = getContent(payload);
      if (content === undefined) {
        throw createError('invalid-response');
      }

      return content;
    },

    async completeWithWebSearch(messages, options = {}) {
      const baseUrl = settings.baseUrl.trim();
      const apiKey = settings.apiKey.trim();
      const model = settings.model.trim();

      if (!baseUrl || !apiKey || !model) {
        throw createError('invalid-response');
      }

      const url = createEndpoint(baseUrl, 'responses');
      if (!url) {
        throw createError('invalid-response');
      }

      const body = {
        model,
        input: messages.map(({ role, content }) => ({
          type: 'message',
          role,
          content,
        })),
        tools: [{ type: 'web_search' }],
        tool_choice: { type: 'web_search' },
        reasoning: { effort: settings.thinkingEnabled ? 'low' : 'none' },
      };

      let response: Response;
      try {
        response = await requestFetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
          signal: options.signal,
        });
      } catch (error) {
        throw classifyFetchError(error, options.signal);
      }

      if (!response.ok) {
        throw classifyStatus(response.status);
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch (error) {
        throw classifyFetchError(error, options.signal);
      }

      const content = getResponsesContent(payload);
      if (content === undefined) {
        throw createError('invalid-response');
      }

      return content;
    },
  };
}

import type { AiToolCall } from './tool-calling';

/** Read OpenAI-compatible SSE, including fragmented tool calls and UTF-8 chunks. */
export async function readChatStream(response: Response, onReasoning: (delta: string) => void, signal?: AbortSignal) {
  if (!response.body) throw new Error('Missing stream');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let reasoning = '';
  let finished = false;
  const calls = new Map<number, AiToolCall>();
  const consume = (line: string) => {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data) return;
    if (data === '[DONE]') { finished = true; return; }
    const payload = JSON.parse(data);
    if (payload.error) throw new Error('Stream error');
    const delta = payload.choices?.[0]?.delta;
    if (!delta) return;
    if (typeof delta.content === 'string') content += delta.content;
    if (typeof delta.reasoning_content === 'string') {
      reasoning += delta.reasoning_content;
      onReasoning(delta.reasoning_content);
    }
    for (const part of delta.tool_calls ?? []) {
      if (!Number.isInteger(part.index) || part.index < 0 || part.index >= 24) throw new Error('Invalid tool index');
      const call = calls.get(part.index) ?? { id: '', type: 'function', function: { name: '', arguments: '' } };
      if (part.id) call.id += part.id;
      if (part.function?.name) call.function.name += part.function.name;
      if (part.function?.arguments) call.function.arguments += part.function.arguments;
      calls.set(part.index, call);
    }
  };
  try {
    while (!finished) {
      signal?.throwIfAborted();
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let end: number;
      while (!finished && (end = buffer.indexOf('\n')) >= 0) {
        consume(buffer.slice(0, end).replace(/\r$/, ''));
        buffer = buffer.slice(end + 1);
      }
      if (done) {
        if (buffer.trim()) consume(buffer);
        break;
      }
    }
    signal?.throwIfAborted();
    if (!finished) throw new Error('Incomplete stream');
    return { content, reasoning_content: reasoning || undefined,
      tool_calls: calls.size ? [...calls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call) : undefined };
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

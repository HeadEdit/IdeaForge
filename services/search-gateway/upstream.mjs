export async function jsonRequest(url, options = {}, requestFetch = fetch) {
  const signal = AbortSignal.any([...(options.signal ? [options.signal] : []), AbortSignal.timeout(30_000)]);
  const response = await requestFetch(url, { ...options, signal, redirect: 'error' });
  if (!response.ok) throw new Error('upstream-failed');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2 * 1024 * 1024) throw new Error('upstream-too-large');
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function createUpstreams(env = process.env, requestFetch = fetch) {
  const modelBase = (env.SEARCH_MODEL_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/+$/, '');
  const embeddingBase = (env.SEARCH_EMBEDDING_BASE_URL || modelBase).replace(/\/+$/, '');
  const post = (url, key, body, signal) => jsonRequest(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify(body), signal,
  }, requestFetch);
  return {
    async model(messages, tools, signal) {
      if (!env.SEARCH_MODEL) throw new Error('model-not-configured');
      const payload = await post(`${modelBase}/chat/completions`, env.SEARCH_MODEL_API_KEY,
        { model: env.SEARCH_MODEL, messages, tools, tool_choice: 'auto', stream: false, max_tokens: 2048 }, signal);
      return payload.choices?.[0]?.message;
    },
    async search(query, signal) {
      const url = new URL('/search', env.SEARXNG_URL || 'http://127.0.0.1:8080');
      url.search = new URLSearchParams({ q: query, format: 'json', language: 'auto' }).toString();
      const payload = await jsonRequest(url, { signal }, requestFetch);
      if (!Array.isArray(payload.results)) throw new Error('invalid-search-response');
      return payload.results.slice(0, 30).flatMap((r) => {
        try {
          const u = new URL(r.url);
          if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || typeof r.title !== 'string') return [];
          u.hash = '';
          const content = typeof r.content === 'string' && r.content.trim() ? r.content : r.title;
          return [{ title: r.title.slice(0, 500), url: u.href, content: content.slice(0, 3000) }];
        } catch { return []; }
      });
    },
    embed: env.SEARCH_EMBEDDING_MODEL ? async (input, signal) => {
      const payload = await post(`${embeddingBase}/embeddings`, env.SEARCH_EMBEDDING_API_KEY || env.SEARCH_MODEL_API_KEY,
        { model: env.SEARCH_EMBEDDING_MODEL, input }, signal);
      if (!Array.isArray(payload.data) || payload.data.length !== input.length) throw new Error('invalid-embeddings');
      const rows = [...payload.data].sort((a, b) => a.index - b.index);
      if (rows.some((r, i) => r.index !== i || !Array.isArray(r.embedding) || !r.embedding.every(Number.isFinite))) throw new Error('invalid-embeddings');
      return rows.map((r) => r.embedding);
    } : undefined,
  };
}

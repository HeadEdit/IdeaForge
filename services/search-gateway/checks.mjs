import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { research } from './pipeline.mjs';
import { deduplicate, rankResults } from './vane-core.mjs';
import { createServer } from './server.mjs';
import { createUpstreams } from './upstream.mjs';
import { fetchPage } from './fetcher.mjs';

const source = (name = 'a') => ({ title: name, url: `https://example.com/${name}`, content: `${name} facts` });
const call = (name, args = {}) => ({ id: crypto.randomUUID(), type: 'function', function: { name, arguments: JSON.stringify(args) } });
const reply = (...tool_calls) => ({ content: null, tool_calls });
const signal = () => new AbortController().signal;

test('balanced uses new evidence for follow-up searches and deduplicates URLs', async () => {
  let round = 0;
  const queries = [];
  const result = await research({ query: 'new release?', mode: 'balanced' }, {
    model: async (messages) => {
      round++;
      if (round === 1) return reply(call('web_search', { queries: ['release', 'date'] }));
      assert.ok(messages.some((m) => m.role === 'tool' && m.content.includes('facts')));
      if (round === 2) return reply(call('web_search', { queries: ['details'] }));
      return reply(call('done'));
    }, search: async (q) => { queries.push(q); return [{ ...source(q), url: `https://${q}.example.com/`, content: `new release date details ${q} facts` }]; },
  }, signal());
  assert.equal(round, 3);
  assert.deepEqual(queries.sort(), ['date', 'details', 'release']);
  assert.equal(result.sources.length, 3);
  assert.ok(result.warnings.includes('embedding-not-configured'));
});

test('speed enforces one batch even if model asks for more', async () => {
  const queries = [];
  const result = await research({ query: 'question' }, {
    model: async () => reply(call('web_search', { queries: ['one'] }), call('web_search', { queries: ['two'] })),
    search: async (q) => { queries.push(q); return [source(`question ${q}`)]; },
  }, signal());
  assert.deepEqual(queries, ['one']);
  assert.equal(result.mode, 'speed');
});

test('planner failure falls back to original question; empty results fail explicitly', async () => {
  const queries = [];
  const deps = { model: async () => { throw new Error('bad model'); }, search: async (q) => { queries.push(q); return [source(q)]; } };
  const result = await research({ query: 'original' }, deps, signal());
  assert.deepEqual(queries, ['original']);
  assert.ok(result.warnings.includes('planner-unavailable'));
  await assert.rejects(research({ query: 'empty' }, { ...deps, search: async () => [] }, signal()), /search-unavailable|no-results/);
});

test('semantic relevance filter and deduplication; embeddings can fail safely', async () => {
  const results = [source('relevant'), source('same'), source('irrelevant')];
  const { ranked } = await rankResults('q', results, async () => [[1, 0], [1, 0], [1, 0], [0.99, 0.01], [0, 1]], signal());
  assert.equal(ranked.length, 2);
  assert.equal(deduplicate(ranked).length, 1);
  const fallback = await rankResults('relevant', results, async () => { throw new Error(); }, signal());
  assert.ok(fallback.ranked.some((r) => r.title === 'relevant'));
  assert.ok(!fallback.ranked.some((r) => r.title === 'same'));
  assert.ok(!fallback.ranked.some((r) => r.title === 'irrelevant'));
  assert.equal(fallback.degraded, true);
});

test('invalid tool arguments trigger bounded fallback; cancelled searches never fall back', async () => {
  const result = await research({ query: 'actual question' }, {
    model: async () => reply(call('web_search', { queries: ['a', 'b', 'c', 'd'] })),
    search: async (q) => { assert.equal(q, 'actual question'); return [source(q)]; },
  }, signal());
  assert.equal(result.sources.length, 1);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(research({ query: 'q' }, { model: async () => assert.fail('must not call') }, controller.signal), { name: 'AbortError' });
});

test('search adapter sanitizes URLs, strips fragments, bounds text, and sorts embedding indices', async () => {
  const deps = createUpstreams({ SEARXNG_URL: 'http://search:8080', SEARCH_EMBEDDING_MODEL: 'embed' }, async (url) => {
    if (String(url).endsWith('/embeddings')) return Response.json({ data: [{ index: 1, embedding: [0, 1] }, { index: 0, embedding: [1, 0] }] });
    return Response.json({ results: [source(), { ...source(), url: 'javascript:alert(1)' }, { ...source('b'), url: 'https://example.com/b#section' }] });
  });
  const result = await deps.search('query', signal());
  assert.equal(result.length, 2);
  assert.equal(result[1].url, 'https://example.com/b');
  assert.deepEqual(await deps.embed(['q', 'r'], signal()), [[1, 0], [0, 1]]);
});

test('HTTP supports authenticated JSON/SSE and rejects bad origin, quality and oversized input', async () => {
  const server = createServer({ env: { SEARCH_MODEL: 'fixture', SEARCH_GATEWAY_TOKEN: 'test-token' }, upstreams: {
    model: async () => reply(call('web_search', { queries: ['q'] }), call('done')),
    search: async () => [source('q')],
  } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api/search`;
  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' };
  try {
    assert.equal((await fetch(`${base}/health`)).status, 401);
    assert.equal((await fetch(`${base}/health`, { headers })).status, 200);
    assert.equal((await fetch(base, { headers: { ...headers, Origin: 'https://untrusted.example' } })).status, 403);
    const post = (body, extra = {}) => fetch(base, { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(body) });
    assert.equal((await post({ query: 'q', mode: 'quality' })).status, 400);
    assert.equal((await post({ query: 'q'.repeat(70_000) })).status, 413);
    assert.equal((await (await post({ query: 'q' })).json()).sources.length, 1);
    const stream = await post({ query: 'q' }, { Accept: 'text/event-stream' });
    const text = await stream.text();
    assert.match(text, /data: .*"type":"planning"/);
    assert.match(text, /data: .*"type":"result"/);
    assert.ok(!text.includes('test-token'));
  } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
});

test('closing SSE cancels an in-flight upstream model request', async () => {
  let cancelled;
  const observed = new Promise((resolve) => { cancelled = resolve; });
  const server = createServer({ env: { SEARCH_MODEL: 'fixture' }, upstreams: {
    model: async (_messages, _tools, sig) => new Promise((_resolve, reject) => {
      sig.addEventListener('abort', () => { cancelled(); reject(sig.reason); }, { once: true });
    }), search: async () => assert.fail('no fallback on cancellation'),
  } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/search`, {
      method: 'POST', headers: { Accept: 'text/event-stream' }, body: JSON.stringify({ query: 'q' }),
    });
    const reader = response.body.getReader();
    await reader.read();
    await reader.cancel();
    await observed;
  } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
});

test('page fetcher rejects private targets, follows safe redirects, and extracts bounded HTML', async () => {
  await assert.rejects(fetchPage('http://127.0.0.1/'), /unsafe-url/);
  const fakeFetch = async (url) => {
    if (String(url).endsWith('/start')) return new Response(null, { status: 302, headers: { location: '/page' } });
    return new Response('<html><script>bad()</script><main><h1>Title</h1><p>Useful article content that is long enough to be accepted by the extractor.</p></main></html>', { headers: { 'content-type': 'text/html' } });
  };
  const result = await fetchPage('https://example.com/start', fakeFetch);
  assert.equal(result.url, 'https://example.com/page');
  assert.match(result.content, /Useful article content/);
  assert.doesNotMatch(result.content, /bad\(\)/);
});

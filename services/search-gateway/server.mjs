import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { requestSchema, research } from './pipeline.mjs';
import { createUpstreams } from './upstream.mjs';

export function createServer({ env = process.env, upstreams = createUpstreams(env) } = {}) {
  let active = 0;
  const origins = new Set((env.SEARCH_ALLOWED_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173').split(',').map((s) => s.trim()));
  return http.createServer(async (req, res) => {
    const origin = req.headers.origin;
    const json = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (origin && !origins.has(origin)) return json(403, { error: 'origin-not-allowed' });
    if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' });
      return res.end();
    }
    if (env.SEARCH_GATEWAY_TOKEN && req.headers.authorization !== `Bearer ${env.SEARCH_GATEWAY_TOKEN}`) return json(401, { error: 'unauthorized' });
    const path = new URL(req.url, 'http://localhost').pathname;
    if (req.method === 'GET' && path === '/api/search/health') return json(env.SEARCH_MODEL ? 200 : 503, { ok: Boolean(env.SEARCH_MODEL), embedding: Boolean(env.SEARCH_EMBEDDING_MODEL), modes: ['speed', 'balanced'] });
    if (req.method !== 'POST' || path !== '/api/search') return json(404, { error: 'not-found' });
    if (active >= 4) return json(429, { error: 'busy' });
    active++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 180_000);
    res.on('close', () => controller.abort());
    req.setTimeout(15_000, () => { controller.abort(); req.destroy(); });
    let streaming = false;
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 64 * 1024) { json(413, { error: 'request-too-large' }); return; }
        chunks.push(chunk);
      }
      req.setTimeout(0);
      let input;
      try { input = requestSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { return json(400, { error: 'invalid-request' }); }
      streaming = req.headers.accept === 'text/event-stream';
      const emit = (event) => { if (streaming && !res.destroyed) res.write(`data: ${JSON.stringify(event)}\n\n`); };
      if (streaming) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' });
        res.flushHeaders();
      }
      const result = await research(input, upstreams, controller.signal, emit);
      if (streaming) { emit({ type: 'result', ...result }); res.end(); }
      else json(200, result);
    } catch (error) {
      const code = controller.signal.aborted ? 'search-timeout' : error.message === 'no-results' ? 'no-results' : 'search-unavailable';
      if (!res.destroyed) {
        if (streaming) { res.write(`data: ${JSON.stringify({ type: 'error', error: code })}\n\n`); res.end(); }
        else json(502, { error: code });
      }
    } finally { clearTimeout(timer); active--; }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createServer().listen(Number(process.env.SEARCH_PORT || 8788), process.env.SEARCH_HOST || '127.0.0.1', () => {
    console.log('IdeaForge search gateway started');
  });
}

import http from 'node:http';

const port = Number(process.env.PAGE_FETCH_PORT ?? 8787);
const maxBytes = 2 * 1024 * 1024;
const timeoutMs = 10_000;

function rejectLocalAddress(url) {
  const hostname = url.hostname.toLowerCase();
  return hostname === 'localhost'
    || hostname === '[::1]'
    || hostname === '::1'
    || hostname === '127.0.0.1'
    || hostname.startsWith('10.')
    || hostname.startsWith('192.168.')
    || hostname.startsWith('172.16.')
    || hostname.startsWith('172.17.')
    || hostname.startsWith('172.18.')
    || hostname.startsWith('172.19.')
    || hostname.startsWith('172.2');
}

function decodeEntities(value) {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function extractPage(html, fallbackUrl) {
  const title = decodeEntities((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  const withoutNoise = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<(nav|header|footer|aside)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  const body = withoutNoise.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1]
    ?? withoutNoise.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1]
    ?? withoutNoise.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1]
    ?? withoutNoise;
  const content = decodeEntities(body
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 8000);
  return { title: title || fallbackUrl, url: fallbackUrl, content };
}

async function readLimited(response) {
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > maxBytes) throw new Error('response-too-large');
  return buffer.toString('utf8');
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  response.end(JSON.stringify(body));
}

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  if (request.method === 'OPTIONS') {
    response.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' });
    response.end();
    return;
  }
  if (request.method !== 'GET' || requestUrl.pathname !== '/api/fetch-page') {
    sendJson(response, 404, { error: 'not-found' });
    return;
  }
  try {
    const target = new URL(requestUrl.searchParams.get('url') ?? '');
    if (!['http:', 'https:'].includes(target.protocol) || rejectLocalAddress(target)) {
      sendJson(response, 400, { error: 'unsupported-url' });
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const upstream = await fetch(target, {
      signal: controller.signal,
      headers: { 'User-Agent': 'IdeaForge-page-fetch/1.0' },
    });
    clearTimeout(timer);
    if (!upstream.ok) {
      sendJson(response, upstream.status, { error: 'upstream-failed' });
      return;
    }
    const html = await readLimited(upstream);
    sendJson(response, 200, extractPage(html, target.toString()));
  } catch {
    sendJson(response, 502, { error: 'page-fetch-failed' });
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Page fetch server listening on http://127.0.0.1:${port}`);
});

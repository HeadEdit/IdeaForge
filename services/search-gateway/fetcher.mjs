import dns from 'node:dns/promises';
import net from 'node:net';

const MAX_BYTES = 1_500_000;
// Keep the gateway contract bounded for the browser client and answer prompt.
const MAX_TEXT = 3_000;
const TIMEOUT = 8_000;

function privateIp(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  return net.isIPv6(address) && (address === '::1' || address.startsWith('fc') || address.startsWith('fd') || address.startsWith('fe80:'));
}

export async function validatePublicUrl(raw) {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) throw new Error('unsafe-url');
  const addresses = await dns.lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => privateIp(address))) throw new Error('unsafe-url');
  url.hash = '';
  return url;
}

function cleanHtml(html) {
  const selected = html.match(/<(?:article|main)\b[^>]*>([\s\S]*?)<\/(?:article|main)>/i)?.[1] ?? html;
  return selected
    .replace(/<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>|<noscript\b[\s\S]*?<\/noscript>|<svg\b[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(?:p|div|h[1-6]|li|tr|section|article|main)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&#39;|&apos;/gi, "'").replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ').replace(/(?:\s*\n\s*)+/g, '\n').trim().slice(0, MAX_TEXT);
}

export async function fetchPage(raw, requestFetch = fetch) {
  let url = await validatePublicUrl(raw);
  for (let redirects = 0; redirects <= 3; redirects++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT);
    try {
      const response = await requestFetch(url, { signal: controller.signal, redirect: 'manual', headers: { Accept: 'text/html,application/xhtml+xml' } });
      if (response.status >= 300 && response.status < 400 && response.headers.get('location')) { url = await validatePublicUrl(new URL(response.headers.get('location'), url).href); continue; }
      if (!response.ok) throw new Error('page-fetch-failed');
      const type = response.headers.get('content-type') || '';
      if (!type.includes('text/html') && !type.includes('application/xhtml+xml')) throw new Error('page-not-html');
      const reader = response.body?.getReader(); if (!reader) throw new Error('page-empty');
      const chunks = []; let size = 0;
      for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > MAX_BYTES) throw new Error('page-too-large'); chunks.push(Buffer.from(value)); }
      const text = cleanHtml(Buffer.concat(chunks).toString('utf8')); if (text.length < 80) throw new Error('page-no-content');
      return { url: url.href, content: text };
    } finally { clearTimeout(timer); }
  }
  throw new Error('too-many-redirects');
}

export async function enrichSources(sources, requestFetch = fetch) {
  return Promise.all(sources.slice(0, 3).map(async (source) => {
    try { const page = await fetchPage(source.url, requestFetch); return { ...source, content: page.content, fetched: true }; }
    catch { return { ...source, fetched: false }; }
  }));
}

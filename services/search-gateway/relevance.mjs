// Lightweight lexical fallback for short search snippets; no model or service required.
const stopWords = new Set('a an the is are was were in on at of to for and or with what how now please'.split(' '));
const genericChinese = /什么|怎么|如何|请问|帮我|搜索|查询|现在|精确到分钟|独立游戏|游戏|出处|含义|意思/g;

export function searchLanguage(query) {
  if (/\p{Script=Han}/u.test(query)) return 'zh-CN';
  return /^[\p{Script=Latin}\d\p{P}\p{Z}\s]+$/u.test(query) && /[a-z]/i.test(query) ? 'en-US' : 'auto';
}

function tokens(text) {
  const cleaned = text.toLowerCase().replace(genericChinese, ' ').trim();
  const normalized = cleaned || text.toLowerCase();
  const terms = normalized.match(/[a-z][a-z0-9-]*|[\p{Script=Han}]+/gu) || [];
  return [...new Set(terms.flatMap((term) => {
    if (stopWords.has(term)) return [];
    if (!/\p{Script=Han}/u.test(term) || term.length < 2) return [term];
    return Array.from({ length: term.length - 1 }, (_, i) => term.slice(i, i + 2));
  }))];
}

export function lexicalScore(query, result) {
  const terms = tokens(query);
  if (!terms.length) return 0;
  const title = result.title.toLowerCase();
  const body = result.content.toLowerCase();
  const titleWords = new Set(title.match(/[a-z][a-z0-9-]*/g) || []);
  const bodyWords = new Set(body.match(/[a-z][a-z0-9-]*/g) || []);
  const has = (text, words, term) => /[a-z]/.test(term) ? words.has(term) : text.includes(term);
  const hits = terms.filter((term) => has(title, titleWords, term) || has(body, bodyWords, term));
  // One generic fragment must not make a multiword entity look relevant.
  if (hits.length / terms.length < 0.5) return 0;
  return terms.reduce((sum, term) => sum + (has(title, titleWords, term) ? 1 : has(body, bodyWords, term) ? 0.65 : 0), 0) / terms.length;
}

export function matchesQuotedNames(query, result) {
  const phrases = [...query.matchAll(/["“「]([^"”」]+)["”」]/g)].map((m) => m[1].toLowerCase());
  const text = `${result.title} ${result.content}`.toLowerCase();
  return phrases.every((phrase) => text.includes(phrase));
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { searchLanguage, lexicalScore } from './relevance.mjs';
import { rankResults, deduplicate } from './vane-core.mjs';
import { research } from './pipeline.mjs';
import { createUpstreams } from './upstream.mjs';

const row = (title, url = 'https://example.com/') => ({ title, content: title, url });

test('search requests select language per query', async () => {
  for (const [query, lang] of [['北京时间', 'zh-CN'], ['Baba Booey meme origin', 'en-US'], ['赵云 Steam', 'zh-CN'], ['こんにちは', 'auto']]) {
    assert.equal(searchLanguage(query), lang);
    const upstream = createUpstreams({}, async (url) => {
      assert.equal(url.searchParams.get('q'), query);
      assert.equal(url.searchParams.get('language'), lang);
      return Response.json({ results: [] });
    });
    await upstream.search(query);
  }
});

test('local filter rejects unrelated snippets and keeps time and game evidence', async () => {
  const results = [row('豆包输入法'), row('国家税务总局'), row('现在的中国北京时间 - Time.is')];
  assert.deepEqual((await rankResults('北京时间现在时间', results)).ranked.map((r) => r.title), ['现在的中国北京时间 - Time.is']);
  assert.equal(lexicalScore('赵云与阿斗 游戏 独立游戏', row('赵姓介绍 独立游戏')), 0);
  assert.ok(lexicalScore('赵云与阿斗 游戏 独立游戏', row('赵云与阿斗 Steam 游戏介绍')) > 0);
  assert.equal(lexicalScore('Bababoey meme origin', row('国家税务总局')), 0);
});

test('original question and exact names prevent query drift, including embedding mode', async () => {
  assert.equal((await rankResults('豆包', [row('豆包输入法')], undefined, undefined, '北京时间')).ranked.length, 0);
  const ranked = await rankResults('赵云 游戏', [row('赵云传'), row('赵云与阿斗 游戏')], undefined, undefined, '“赵云与阿斗” 游戏');
  assert.equal(ranked.ranked.length, 1);
  assert.equal((await rankResults('game', [row('other game')], async () => { throw Error('must not call'); }, undefined, '"赵云与阿斗" 游戏')).ranked.length, 0);
});

test('embedding outage still filters noise; per-query, host and global limits hold', async () => {
  const rows = Array.from({ length: 20 }, (_, i) => row('北京时间', `https://host${i}.example.com/`));
  const fallback = await rankResults('北京时间', [...rows, row('Git install')], async () => { throw Error('offline'); });
  assert.equal(fallback.degraded, true);
  assert.equal(fallback.ranked.length, 5);
  assert.ok(fallback.ranked.every((r) => r.title === '北京时间'));
  const scored = rows.map((r) => ({ ...r, score: 1, embedding: [] }));
  assert.equal(deduplicate(scored).length, 10);
  assert.equal(deduplicate(scored.map((r, i) => ({ ...r, url: `https://example.com/${i}` }))).length, 2);
});

test('all irrelevant evidence fails instead of returning successful sources', async () => {
  await assert.rejects(research({ query: '北京时间' }, {
    model: async () => ({ tool_calls: [{ id: 'done', function: { name: 'done', arguments: '{}' } }] }),
    search: async () => [row('豆包输入法')],
  }, new AbortController().signal), /no-results/);
});

test('empty results with engine failures are distinguished from no matches', async () => {
  const upstream = createUpstreams({}, async () => Response.json({ results: [], unresponsive_engines: [['bing', 'timeout']] }));
  await assert.rejects(upstream.search('query'), /search-engines-unavailable/);
});

import { z } from 'zod';
import { deduplicate, rankResults, researcherPrompt, researchTools } from './vane-core.mjs';

export const requestSchema = z.object({
  query: z.string().trim().min(1).max(2000),
  mode: z.enum(['speed', 'balanced']).default('speed'),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(4000) }).strict()).max(10).default([]),
}).strict();

const queriesSchema = z.object({ queries: z.array(z.string().trim().min(1).max(500)).min(1).max(3) }).strict();

export async function research(input, { model, search, embed }, signal, emit = () => {}) {
  const { query, mode, history } = requestSchema.parse(input);
  const limit = mode === 'speed' ? 2 : 6;
  const messages = [...history, { role: 'user', content: query }];
  const findings = [];
  const seen = new Set();
  const warnings = new Set();
  let searchBatches = 0;
  let lastError;
  async function runQueries(queries) {
    const fresh = [...new Set(queries)].filter((q) => !seen.has(q)).slice(0, 3);
    if (!fresh.length) return [];
    fresh.forEach((q) => seen.add(q));
    searchBatches++;
    emit({ type: 'searching', queries: fresh });
    const batches = await Promise.all(fresh.map(async (q) => {
      try {
        const results = await search(q, signal);
        const { ranked, degraded } = await rankResults(q, results, embed, signal);
        if (degraded) warnings.add('embedding-unavailable');
        return ranked;
      } catch (error) {
        signal?.throwIfAborted();
        warnings.add('search-partially-failed');
        lastError = error;
        return [];
      }
    }));
    findings.push(...batches.flat());
    const sources = deduplicate(findings);
    emit({ type: 'sources', count: sources.length });
    return sources;
  }
  for (let round = 0; round < limit; round++) {
    signal?.throwIfAborted();
    emit({ type: 'planning', round: round + 1 });
    let reply;
    try {
      reply = await model([{ role: 'system', content: researcherPrompt(mode, round, limit) }, ...messages], researchTools, signal);
    } catch (error) {
      signal?.throwIfAborted();
      warnings.add('planner-unavailable');
      lastError = error;
      break;
    }
    const calls = reply?.tool_calls;
    if (!Array.isArray(calls) || !calls.length || calls.length > 4
      || calls.some((c) => typeof c.id !== 'string' || typeof c.function?.name !== 'string' || typeof c.function.arguments !== 'string')
      || new Set(calls.map((c) => c.id)).size !== calls.length) {
      warnings.add('planner-invalid-response');
      break;
    }
    messages.push({ role: 'assistant', content: reply.content ?? null, tool_calls: calls,
      ...(typeof reply.reasoning_content === 'string' ? { reasoning_content: reply.reasoning_content } : {}) });
    let done = false;
    for (const call of calls) {
      let result;
      if (call.function.name === 'done') {
        done = true;
        result = { done: true };
      } else if (call.function.name === 'web_search') {
        try {
          const args = queriesSchema.parse(JSON.parse(call.function.arguments));
          const budget = mode === 'speed' ? 1 : 6;
          result = searchBatches < budget ? { sources: await runQueries(args.queries) } : { error: 'search-budget-exhausted' };
        } catch (error) {
          signal?.throwIfAborted();
          result = { error: 'invalid-search-arguments' };
        }
      } else result = { error: 'unknown-tool' };
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
    }
    if (done) break;
  }
  // A failed planner never turns into an ungrounded answer. Search the actual query.
  if (!findings.length && !seen.has(query)) await runQueries([query]);
  signal?.throwIfAborted();
  const sources = deduplicate(findings);
  if (!sources.length) throw new Error(lastError ? 'search-unavailable' : 'no-results');
  if (!embed) warnings.add('embedding-not-configured');
  return { queries: [...seen], sources, warnings: [...warnings], mode };
}

import type { AiClient } from '../ai/client';
import { AiClientError } from '../ai/client';
import {
  buildIdeaScoreDescribeDimensionMessages,
  buildIdeaScoreDimensionMessages,
  buildIdeaScoreMessages,
} from '../ai/prompts';
import {
  parseIdeaScoreCardResults,
  parseIdeaScoreDimensionDescriptions,
  parseIdeaScoreDimensions,
} from '../ai/schemas';
import type { CandidateCard, CardScore } from '../domain/model';
import { requireCardVariableSource } from '../domain/require-card-variable-source';
import type {
  IdeaScoreConfig,
  IdeaScoreReport,
  ScoreDimension,
} from '../nodes/idea-score/config';
import {
  clampIdeaScoreBatchSize,
  defaultIdeaScoreSort,
  sortIdeaScoreReportCards,
} from '../nodes/idea-score/config';
import type { NodeRunner, NodeRunnerContext, NodeRunnerResult } from './runner-types';

const RETRYABLE = new Set(['network-or-cors', 'rate-limit', 'server', 'invalid-response']);
const RETRY_DELAYS_MS = [100, 200];
const SCORE_MAX_TOKENS = 4096;

const passthroughMetrics = {
  requested: 1,
  succeeded: 1,
  failed: 0,
  skipped: 0,
  failedBatchIndexes: [] as number[],
};

export interface IdeaScoreRunnerDependencies {
  getClient: () => AiClient | undefined;
  id: () => string;
  now: () => string;
  wait?: (ms: number) => Promise<void>;
  onConfigPatch: (nodeId: string, patch: Partial<IdeaScoreConfig>) => void;
  onCardsScored: (updates: { cardId: string; score: CardScore }[]) => void;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isAiClientError(error: unknown): error is AiClientError {
  return error instanceof AiClientError;
}

async function completeWithRetry(
  client: AiClient,
  context: NodeRunnerContext,
  temperature: number,
  messages: ReturnType<typeof buildIdeaScoreMessages>,
  wait: (ms: number) => Promise<void>,
): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    if (context.signal.aborted) {
      throw new AiClientError('stopped', false);
    }
    try {
      return await client.complete(messages, {
        signal: context.signal,
        temperature,
        maxTokens: SCORE_MAX_TOKENS,
      });
    } catch (error) {
      lastError = error;
      if (isAiClientError(error) && error.kind === 'stopped') {
        throw error;
      }
      const retryable = isAiClientError(error) && RETRYABLE.has(error.kind);
      if (!retryable || attempt === RETRY_DELAYS_MS.length) {
        throw error;
      }
      await wait(RETRY_DELAYS_MS[attempt] ?? 200);
    }
  }
  throw lastError;
}

type ParsedScoreRow = {
  cardId: string;
  scores: { dimensionId: string; score: number; reason: string }[];
};

async function scoreBatchWithRetry(
  client: AiClient,
  context: NodeRunnerContext,
  temperature: number,
  messages: ReturnType<typeof buildIdeaScoreMessages>,
  cardIds: readonly string[],
  dimensionIds: readonly string[],
  wait: (ms: number) => Promise<void>,
  log: {
    batchIndex: number;
    batchTotal: number;
    cards: { id: string; title: string }[];
  },
): Promise<{ rows: ParsedScoreRow[]; raw: string }> {
  let lastError: unknown;
  let lastRaw = '';

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    if (context.signal.aborted) {
      throw new AiClientError('stopped', false);
    }

    let raw: string;
    try {
      raw = await client.complete(messages, {
        signal: context.signal,
        temperature,
        maxTokens: SCORE_MAX_TOKENS,
      });
      lastRaw = raw;
    } catch (error) {
      lastError = error;
      if (isAiClientError(error) && error.kind === 'stopped') {
        throw error;
      }
      const retryable = isAiClientError(error) && RETRYABLE.has(error.kind);
      if (!retryable || attempt === RETRY_DELAYS_MS.length) {
        console.error('[ideaScore] batch fail', {
          ...log,
          stage: 'ai',
          errorKind: isAiClientError(error) ? error.kind : 'unknown',
        });
        throw error;
      }
      await wait(RETRY_DELAYS_MS[attempt] ?? 200);
      continue;
    }

    try {
      const rows = parseIdeaScoreCardResults(raw, cardIds, dimensionIds);
      return { rows, raw };
    } catch (error) {
      lastError = error;
      if (isAiClientError(error) && error.kind === 'stopped') {
        throw error;
      }
      const retryable = isAiClientError(error) && RETRYABLE.has(error.kind);
      if (!retryable || attempt === RETRY_DELAYS_MS.length) {
        console.error('[ideaScore] batch fail', {
          ...log,
          stage: 'parse',
          raw: lastRaw,
          errorKind: isAiClientError(error) ? error.kind : 'unknown',
        });
        throw error;
      }
      await wait(RETRY_DELAYS_MS[attempt] ?? 200);
    }
  }

  throw lastError;
}

async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));

  async function worker(): Promise<void> {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) {
        return;
      }
      results[index] = await mapper(items[index] as T, index);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

function resolveCards(
  cardIds: readonly string[],
  cards: readonly CandidateCard[],
): CandidateCard[] {
  const byId = new Map(cards.map((card) => [card.id, card]));
  return cardIds.flatMap((id) => {
    const card = byId.get(id);
    return card ? [card] : [];
  });
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

function toFailure(error: unknown): NodeRunnerResult {
  if (isAiClientError(error) && error.kind === 'stopped') {
    return { ok: false, errorKind: 'stopped' };
  }
  if (isAiClientError(error)) {
    return { ok: false, errorKind: error.kind };
  }
  return { ok: false, errorKind: 'invalid-response' };
}

function noCollectionSuccess(): NodeRunnerResult {
  return {
    ok: true,
    metrics: passthroughMetrics,
  };
}

export function createIdeaScoreRunner(
  deps: IdeaScoreRunnerDependencies,
): NodeRunner {
  const wait = deps.wait ?? delay;

  return {
    kind: 'ideaScore',
    requiresAi: true,
    async run(context: NodeRunnerContext): Promise<NodeRunnerResult> {
      const binding = requireCardVariableSource(context.workflow, context.node.id, 'cards');
      if (!binding.ok) {
        return { ok: false, errorKind: 'invalid-input' };
      }

      const cardsInput = context.inputs.cards;
      if (!cardsInput || cardsInput.type !== 'CardCollection' || cardsInput.cardIds.length === 0) {
        return { ok: false, errorKind: 'invalid-input' };
      }

      const cardIds = cardsInput.cardIds;
      const resolvedCards = resolveCards(cardIds, context.cards);
      if (resolvedCards.length === 0) {
        return { ok: false, errorKind: 'invalid-input' };
      }

      const contextInput = context.inputs.context;
      const contextText = contextInput?.type === 'Text' ? contextInput.value : '';
      const config = context.node.config as IdeaScoreConfig;
      const runMode = config.runMode ?? 'inferDimensions';
      const temperature = config.temperature ?? 0;

      const client = deps.getClient();
      if (!client) {
        return { ok: false, errorKind: 'invalid-response' };
      }

      if (context.signal.aborted) {
        return { ok: false, errorKind: 'stopped' };
      }

      try {
        if (runMode === 'inferDimensions') {
          context.reportProgress?.({ stage: '推断评分维度', percent: 25, estimated: true });
          const messages = buildIdeaScoreDimensionMessages(contextText, resolvedCards);
          const raw = await completeWithRetry(client, context, temperature, messages, wait);
          const parsed = parseIdeaScoreDimensions(raw);
          const dimensions: ScoreDimension[] = parsed.map((item) => ({
            id: deps.id(),
            name: item.name,
            description: item.description,
          }));
          deps.onConfigPatch(context.node.id, {
            dimensions,
            runMode: 'score',
          });
          return noCollectionSuccess();
        }

        if (runMode === 'describeDimensions') {
          context.reportProgress?.({ stage: '补全维度描述', percent: 25, estimated: true });
          const existing = config.dimensions ?? [];
          const named = existing.filter((dimension) => dimension.name.trim().length > 0);
          if (named.length === 0) {
            return { ok: false, errorKind: 'invalid-input' };
          }
          const messages = buildIdeaScoreDescribeDimensionMessages(contextText, resolvedCards, named);
          const raw = await completeWithRetry(client, context, temperature, messages, wait);
          const parsed = parseIdeaScoreDimensionDescriptions(raw, named);
          const descriptionById = new Map(parsed.map((item) => [item.id, item.description]));
          deps.onConfigPatch(context.node.id, {
            dimensions: existing.map((dimension) => {
              const description = descriptionById.get(dimension.id);
              return description ? { ...dimension, description } : dimension;
            }),
            runMode: 'score',
          });
          return noCollectionSuccess();
        }

        const dimensions = config.dimensions ?? [];
        if (dimensions.length === 0) {
          return { ok: false, errorKind: 'invalid-input' };
        }

        const dimensionIds = dimensions.map((dimension) => dimension.id);
        const batchSize = clampIdeaScoreBatchSize(config.batchSize);
        const concurrency = Math.max(1, config.concurrency ?? 2);
        const batches = chunk(resolvedCards, batchSize);
        const batchTotal = batches.length;
        let completedBatches = 0;
        const reportBatches = () => context.reportProgress?.({ stage: '卡片评分', percent: 20 + 70 * completedBatches / batchTotal, completed: completedBatches, total: batchTotal, estimated: true });
        reportBatches();
        console.info('[ideaScore] score start', {
          cardCount: resolvedCards.length,
          batchSize,
          concurrency,
          batchTotal,
        });

        type BatchOutcome =
          | { ok: true; rows: ParsedScoreRow[] }
          | { ok: false; errorKind: string; failedCount: number };

        const batchOutcomes: BatchOutcome[] = await mapPool(batches, concurrency, async (batch, batchIndex) => {
          const cards = batch.map((card) => ({ id: card.id, title: card.title }));
          console.info('[ideaScore] batch start', { batchIndex, batchTotal, cards });

          try {
            const messages = buildIdeaScoreMessages(contextText, dimensions, batch);
            const { rows: parsed, raw } = await scoreBatchWithRetry(
              client,
              context,
              temperature,
              messages,
              batch.map((card) => card.id),
              dimensionIds,
              wait,
              { batchIndex, batchTotal, cards },
            );
            console.info('[ideaScore] batch ok', {
              batchIndex,
              batchTotal,
              stage: 'parse',
              cards,
              parsedCardIds: parsed.map((row) => row.cardId),
              raw,
            });
            return { ok: true as const, rows: parsed };
          } catch (error) {
            if (isAiClientError(error) && error.kind === 'stopped') {
              throw error;
            }
            return {
              ok: false as const,
              errorKind: isAiClientError(error) ? error.kind : 'invalid-response',
              failedCount: batch.length,
            };
          } finally {
            completedBatches++;
            reportBatches();
          }
        });

        const succeededRows = batchOutcomes.flatMap((outcome) => (
          outcome.ok ? outcome.rows : []
        ));
        const failedBatchIndexes = batchOutcomes.flatMap((outcome, index) => (
          outcome.ok ? [] : [index]
        ));
        const failedCount = batchOutcomes.reduce(
          (sum, outcome) => sum + (outcome.ok ? 0 : outcome.failedCount),
          0,
        );
        const metrics = {
          requested: resolvedCards.length,
          succeeded: succeededRows.length,
          failed: failedCount,
          skipped: 0,
          failedBatchIndexes,
        };

        console.info('[ideaScore] score done', {
          batchTotal,
          cardCount: resolvedCards.length,
          succeeded: metrics.succeeded,
          failed: metrics.failed,
          failedBatchIndexes,
        });

        if (succeededRows.length === 0) {
          const firstFailed = batchOutcomes.find((outcome) => !outcome.ok);
          return {
            ok: false,
            errorKind: firstFailed && !firstFailed.ok
              ? firstFailed.errorKind
              : 'invalid-response',
            metrics,
          };
        }

        const titleById = new Map(resolvedCards.map((card) => [card.id, card.title]));
        const reportCards: IdeaScoreReport['cards'] = sortIdeaScoreReportCards(
          succeededRows.map((row) => {
            const sum = row.scores.reduce((total, entry) => total + entry.score, 0);
            return {
              cardId: row.cardId,
              title: titleById.get(row.cardId) ?? '',
              scores: row.scores,
              average: sum / row.scores.length,
            };
          }),
          defaultIdeaScoreSort,
        );

        const report: IdeaScoreReport = {
          scoredAt: deps.now(),
          contextUsed: contextText.trim(),
          dimensionSnapshot: [...dimensions],
          cards: reportCards,
        };
        const nameById = new Map(dimensions.map((dimension) => [dimension.id, dimension.name]));
        const scoreUpdates = reportCards.map((card) => ({
          cardId: card.cardId,
          score: {
            average: card.average,
            byDimension: card.scores.map((entry) => ({
              dimensionId: entry.dimensionId,
              name: nameById.get(entry.dimensionId) ?? '',
              score: entry.score,
              reason: entry.reason,
            })),
            scoredAt: deps.now(),
          } satisfies CardScore,
        }));
        deps.onCardsScored(scoreUpdates);
        deps.onConfigPatch(context.node.id, {
          report,
          sort: { ...defaultIdeaScoreSort },
        });
        return {
          ok: true,
          metrics,
        };
      } catch (error) {
        return toFailure(error);
      }
    },
  };
}

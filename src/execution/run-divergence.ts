import type { AiClient } from '../ai/client';
import { AiClientError } from '../ai/client';
import {
  buildDivergenceMessages,
  buildFeedbackEvaluationMessages,
  buildMethodInferenceMessages,
} from '../ai/prompts';
import { parseCandidateCards, parseMethodIds } from '../ai/schemas';
import { requireCardVariableSource } from '../domain/require-card-variable-source';
import type { CandidateCard, ChatMessage } from '../domain/model';
import type { DivergenceConfig } from '../nodes/divergence/config';
import { getSkill, listSkills } from '../skills';
import type { NodeRunner, NodeRunnerContext, NodeRunnerMetrics, NodeRunnerResult } from './runner-types';

export interface DivergenceRunnerDependencies {
  getClient: () => AiClient | undefined;
  id: () => string;
  now: () => string;
  wait?: (ms: number) => Promise<void>;
}

const RETRYABLE = new Set(['network-or-cors', 'rate-limit', 'server']);
const RETRY_DELAYS_MS = [100, 200];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isAiClientError(error: unknown): error is AiClientError {
  return error instanceof AiClientError;
}

function resolveDivergenceRequirement(
  configRequirement: string,
  promptInput: NodeRunnerContext['inputs'][string] | undefined,
): string {
  const local = configRequirement.trim();
  const incoming = promptInput?.type === 'Text' ? promptInput.value.trim() : '';
  if (incoming && local) {
    return `${incoming}\n\n${local}`;
  }
  return incoming || local;
}

async function completeWithRetry(
  client: AiClient,
  context: NodeRunnerContext,
  config: DivergenceConfig,
  messages: readonly ChatMessage[],
  wait: (ms: number) => Promise<void>,
): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    if (context.signal.aborted) {
      throw new AiClientError('stopped', false);
    }
    try {
      return await client.complete([...messages], {
        signal: context.signal,
        temperature: config.temperature,
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

async function evaluateFeedbackDirection(
  client: AiClient,
  context: NodeRunnerContext,
  config: DivergenceConfig,
  requirement: string,
  feedbackCards: readonly CandidateCard[],
  wait: (ms: number) => Promise<void>,
): Promise<string | undefined> {
  const feedbackMode = config.feedbackMode ?? 'balanced';
  if (feedbackMode === 'explore' || feedbackCards.length === 0) {
    return undefined;
  }
  try {
    const messages = buildFeedbackEvaluationMessages(
      requirement,
      feedbackCards,
      feedbackMode,
    );
    const raw = await completeWithRetry(client, context, config, messages, wait);
    const direction = raw.trim();
    return direction.length > 0 ? direction : undefined;
  } catch (error) {
    if (isAiClientError(error) && error.kind === 'stopped') {
      throw error;
    }
    return undefined;
  }
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

type MethodBatchResult =
  | { ok: true; cards: CandidateCard[]; skipped: number; failed: number }
  | { ok: false; errorKind: string; failed: number };

export function createDivergenceRunner(
  deps: DivergenceRunnerDependencies,
): NodeRunner {
  const wait = deps.wait ?? delay;

  return {
    kind: 'divergence',
    requiresAi: true,
    async run(context: NodeRunnerContext): Promise<NodeRunnerResult> {
      const client = deps.getClient();
      if (!client) {
        return { ok: false, errorKind: 'invalid-response' };
      }

      const config = context.node.config as DivergenceConfig;
      const requirement = resolveDivergenceRequirement(
        config.requirement,
        context.inputs.prompt,
      );
      if (!requirement) {
        return { ok: false, errorKind: 'invalid-response' };
      }

      const binding = requireCardVariableSource(context.workflow, context.node.id, 'pool');
      if (!binding.ok) {
        return { ok: false, errorKind: 'invalid-input' };
      }

      const runId = deps.id();
      const previousIds = binding.source.output?.type === 'CardCollection'
        ? binding.source.output.cardIds
        : [];
      const poolCards = context.cards.filter((card) => previousIds.includes(card.id));
      const feedbackCards = poolCards.filter(
        (card) => card.vote !== null
          || card.score !== undefined
          || (card.review?.trim().length ?? 0) > 0,
      );
      const dedupeCards = poolCards;
      const batchSize = config.batchSize;

      try {
        const directionPromise = evaluateFeedbackDirection(
          client,
          context,
          config,
          requirement,
          feedbackCards,
          wait,
        );

        let methodIds: string[];
        context.reportProgress?.({ stage: '分析反馈与推断方法', percent: 15, estimated: true });
        let direction: string | undefined;
        if (config.autoInferMethods ?? true) {
          const catalog = listSkills('method');
          const inferenceMessages = buildMethodInferenceMessages(requirement, catalog);
          const [evaluatedDirection, raw] = await Promise.all([
            directionPromise,
            completeWithRetry(client, context, config, inferenceMessages, wait),
          ]);
          direction = evaluatedDirection;
          methodIds = parseMethodIds(raw, catalog.map((skill) => skill.id));
        } else {
          direction = await directionPromise;
          methodIds = config.methodIds;
        }

        if (methodIds.length === 0) {
          return { ok: false, errorKind: 'invalid-response' };
        }
        const skills = methodIds.map((id) => getSkill(id));
        if (skills.some((skill) => skill === undefined || skill.category !== 'method')) {
          return { ok: false, errorKind: 'invalid-response' };
        }
        const requested = methodIds.length * batchSize;
        const concurrency = Math.min(config.concurrency, methodIds.length);
        let completedBatches = 0;
        const reportBatches = () => context.reportProgress?.({ stage: '生成创意批次', percent: 25 + 65 * completedBatches / methodIds.length, completed: completedBatches, total: methodIds.length, estimated: true });
        reportBatches();

        const batches = await mapPool(methodIds, concurrency, async (methodId, index) => {
          const skill = skills[index];
          if (!skill) {
            return { ok: false, errorKind: 'invalid-response', failed: batchSize } satisfies MethodBatchResult;
          }
          const messages = buildDivergenceMessages(skill, requirement, batchSize, {
            direction,
            dedupeCards,
            feedbackMode: config.feedbackMode ?? 'balanced',
          });
          try {
            const raw = await completeWithRetry(client, context, config, messages, wait);
            const parsed = parseCandidateCards(raw);
            const valid = parsed.valid.slice(0, batchSize);
            const shortfall = batchSize - valid.length;
            if (valid.length === 0) {
              return {
                ok: false,
                errorKind: 'invalid-response',
                failed: batchSize,
              } satisfies MethodBatchResult;
            }
            const cards: CandidateCard[] = valid.map((card) => ({
              id: deps.id(),
              workflowId: context.workflow.id,
              runId,
              method: methodId,
              title: card.title,
              concept: card.concept,
              content: card.content,
              tags: card.tags,
              vote: null,
              onCanvas: false,
              createdAt: deps.now(),
            }));
            return {
              ok: true,
              cards,
              skipped: parsed.skipped,
              failed: shortfall,
            } satisfies MethodBatchResult;
          } catch (error) {
            if (isAiClientError(error) && error.kind === 'stopped') {
              throw error;
            }
            return {
              ok: false,
              errorKind: isAiClientError(error) ? error.kind : 'invalid-response',
              failed: batchSize,
            } satisfies MethodBatchResult;
          } finally {
            completedBatches++;
            reportBatches();
          }
        });

        const producedCards = batches.flatMap((batch) => (batch.ok ? batch.cards : []));
        const failedBatchIndexes = batches.flatMap((batch, index) => (batch.ok ? [] : [index]));
        const metrics: NodeRunnerMetrics = {
          requested,
          succeeded: producedCards.length,
          failed: batches.reduce((sum, batch) => sum + batch.failed, 0),
          skipped: batches.reduce((sum, batch) => sum + (batch.ok ? batch.skipped : 0), 0),
          failedBatchIndexes,
        };

        if (producedCards.length === 0 && metrics.failed > 0) {
          const failedBatch = batches.find((batch) => !batch.ok);
          return {
            ok: false,
            errorKind: failedBatch && !failedBatch.ok ? failedBatch.errorKind : 'invalid-response',
            metrics,
          };
        }

        return {
          ok: true,
          metrics,
          producedCards,
          ...(direction ? { configPatch: { lastDirection: direction } } : {}),
        };
      } catch (error) {
        if (isAiClientError(error) && error.kind === 'stopped') {
          return { ok: false, errorKind: 'stopped' };
        }
        return { ok: false, errorKind: 'invalid-response' };
      }
    },
  };
}

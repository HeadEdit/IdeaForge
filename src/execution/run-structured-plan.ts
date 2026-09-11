import {
  AiClientError,
  type AiClient,
  type AiErrorKind,
} from '../ai/client';
import {
  buildStructuredPlanDraftMessages,
  buildStructuredPlanReviewMessages,
  buildStructuredPlanRevisionMessages,
  buildStructuredPlanTitleMessages,
  createStructuredPlanDraftData,
  createStructuredPlanReviewData,
  createStructuredPlanRevisionData,
  createStructuredPlanTitleData,
  serializeStructuredPlanStageData,
} from '../ai/prompts';
import {
  parseStructuredPlanCandidates,
  parseStructuredPlanModule,
  parseStructuredPlanReviews,
} from '../ai/schemas';
import { STRUCTURED_PLAN_MAX_STAGED_DATA_CONTEXT_CHARS } from '../ai/structured-plan-contract';
import {
  structuredPlanConfigSchema,
  type StructuredPlanConfig,
  type StructuredPlanDependencyGraph,
} from '../nodes/structured-plan/config';
import {
  applyModuleClassifications,
  createStructuredPlanModule,
  formatStructuredPlanOutput,
  type StructuredPlanModuleClassification,
} from '../nodes/structured-plan/format';
import { getSkill } from '../skills';
import type {
  NodeRunner,
  NodeRunnerMetrics,
  NodeRunnerResult,
} from './runner-types';
import { generateStructuredPlanDependencyGraph } from './run-structured-plan-graph';
import { AI_REQUEST_LIMITS } from '../ai/request-config';

export interface StructuredPlanRunnerDependencies {
  getClient(): AiClient | undefined;
  id(): string;
  now(): string;
  onConfigPatch(nodeId: string, patch: Partial<StructuredPlanConfig>): void;
}

const TEMPERATURE = 0.2;
const MODULE_CONCURRENCY = 2;

type StructuredPlanStage = 'title' | 'draft' | 'review' | 'revision' | 'graph';

class StructuredPlanRequestError extends Error {
  constructor(
    readonly stage: StructuredPlanStage,
    readonly requestIndex: number,
    readonly targetTitle: string | undefined,
    readonly errorKind: AiErrorKind,
    readonly raw: string | undefined,
  ) {
    super(`Structured plan ${stage} request failed`);
    this.name = 'StructuredPlanRequestError';
  }
}

function classifyRequestError(error: unknown): AiErrorKind {
  return error instanceof AiClientError ? error.kind : 'invalid-response';
}

function requestErrorRaw(error: unknown): string | undefined {
  if (
    typeof error === 'object'
    && error !== null
    && 'raw' in error
    && typeof error.raw === 'string'
  ) {
    return error.raw;
  }
  return undefined;
}

async function mapPoolAllOrNothing<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
  shouldStop: () => boolean,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  let firstError: unknown;
  let hasError = false;
  const normalizedConcurrency = Number.isFinite(concurrency)
    ? Math.max(1, Math.floor(concurrency))
    : 1;
  const workerCount = Math.min(normalizedConcurrency, items.length);

  // The first rejection observed is causal; assigned work drains, but no queued work starts.
  async function worker() {
    while (!hasError && !shouldStop()) {
      const index = nextIndex;
      if (index >= items.length) return;
      nextIndex += 1;

      try {
        results[index] = await mapper(items[index]!, index);
      } catch (error) {
        if (!hasError) {
          hasError = true;
          firstError = error;
        }
      }
    }
  }

  await Promise.all(
    Array.from({ length: workerCount }, () => worker()),
  );
  if (hasError) throw firstError;
  return results;
}

function createSuccessMetrics(moduleCount: number) {
  const requestCount = 3 + (2 * moduleCount);
  return {
    requested: requestCount,
    succeeded: requestCount,
    failed: 0,
    skipped: 0,
    failedBatchIndexes: [] as number[],
  };
}

function createFailureMetrics(
  requested: number,
  succeeded: number,
  failedRequestIndex: number,
): NodeRunnerMetrics {
  return {
    requested,
    succeeded,
    failed: 1,
    // Validated in-flight responses still succeed while the causal failure drains.
    skipped: Math.max(0, requested - succeeded - 1),
    failedBatchIndexes: [failedRequestIndex],
  };
}

export function createStructuredPlanRunner(
  deps: StructuredPlanRunnerDependencies,
): NodeRunner {
  return {
    kind: 'structuredPlan',
    requiresAi: true,
    async run(context): Promise<NodeRunnerResult> {
      const input = context.inputs.input;
      if (input?.type !== 'Text' || !input.value.trim()) {
        return { ok: false, errorKind: 'invalid-input' };
      }

      const configResult = structuredPlanConfigSchema.safeParse(context.node.config);
      if (!configResult.success) {
        return { ok: false, errorKind: 'invalid-input' };
      }
      const config = configResult.data;
      const skill = getSkill('system-designer');
      if (!skill) {
        return { ok: false, errorKind: 'invalid-input' };
      }
      const stagedSource = { content: input.value.trim() };

      const client = deps.getClient();
      if (!client) {
        return { ok: false, errorKind: 'invalid-response' };
      }
      if (context.signal.aborted) {
        return { ok: false, errorKind: 'stopped' };
      }

      let plannedRequestCount = 1;
      let succeededRequestCount = 0;
      const stageLabels: Record<string, string> = { title: '识别系统模块', draft: '生成模块初稿', review: '审查模块', revision: '修订模块', graph: '生成依赖图谱' };
      const stageRanges: Record<string, [number, number]> = { title: [10, 20], draft: [20, 50], review: [50, 60], revision: [60, 85], graph: [85, 95] };
      const stageCompleted: Record<string, number> = {};
      let moduleCount = 1;
      const reportStage = (stage: string) => {
        const completed = stageCompleted[stage] ?? 0;
        const total = stage === 'draft' || stage === 'revision' ? moduleCount : 1;
        const [start, end] = stageRanges[stage]!;
        context.reportProgress?.({ stage: stageLabels[stage]!, percent: start + (end - start) * completed / total, completed, total, estimated: true });
      };

      async function runRequest<T>(
        stage: StructuredPlanStage,
        requestIndex: number,
        targetTitle: string | undefined,
        request: () => Promise<string>,
        parse: (raw: string) => T,
      ): Promise<T> {
        reportStage(stage);
        let raw: string;
        try {
          raw = await request();
        } catch (error) {
          throw new StructuredPlanRequestError(
            stage,
            requestIndex,
            targetTitle,
            classifyRequestError(error),
            undefined,
          );
        }

        if (context.signal.aborted) {
          throw new StructuredPlanRequestError(
            stage,
            requestIndex,
            targetTitle,
            'stopped',
            undefined,
          );
        }
        if (typeof raw !== 'string' || raw.trim().length === 0) {
          throw new StructuredPlanRequestError(
            stage,
            requestIndex,
            targetTitle,
            'invalid-response',
            undefined,
          );
        }

        let parsed: T;
        try {
          parsed = parse(raw);
        } catch (error) {
          throw new StructuredPlanRequestError(
            stage,
            requestIndex,
            targetTitle,
            classifyRequestError(error),
            raw,
          );
        }
        succeededRequestCount += 1;
        stageCompleted[stage] = (stageCompleted[stage] ?? 0) + 1;
        reportStage(stage);
        return parsed;
      }

      function enforceStagedContextBudget(
        stage: StructuredPlanStage,
        requestIndex: number,
        targetTitle: string | undefined,
        stageData: object,
      ): void {
        if (
          serializeStructuredPlanStageData(stageData).length
          <= STRUCTURED_PLAN_MAX_STAGED_DATA_CONTEXT_CHARS
        ) return;
        throw new StructuredPlanRequestError(
          stage,
          requestIndex,
          targetTitle,
          'invalid-response',
          undefined,
        );
      }

      try {
        const titleData = createStructuredPlanTitleData(stagedSource);
        enforceStagedContextBudget('title', 0, undefined, titleData);
        const candidates = await runRequest(
          'title',
          0,
          undefined,
          () => client.complete(
            buildStructuredPlanTitleMessages(skill, titleData),
            { signal: context.signal, temperature: TEMPERATURE, maxTokens: AI_REQUEST_LIMITS.structuredPlan.title },
          ),
          (raw) => {
            const parsed = parseStructuredPlanCandidates(raw);
            if (parsed.length === 0) {
              throw new AiClientError('invalid-response', false);
            }
            return parsed;
          },
        );
        const titles = Object.freeze(candidates.map((candidate) => candidate.title));
        moduleCount = titles.length;
        plannedRequestCount = 3 + (2 * titles.length);
        const draftData = titles.map((title) => (
          createStructuredPlanDraftData(stagedSource, titles, title)
        ));
        draftData.forEach((stageData, index) => {
          enforceStagedContextBudget('draft', 1 + index, titles[index], stageData);
        });

        const drafts = await mapPoolAllOrNothing(
          draftData,
          MODULE_CONCURRENCY,
          async (stageData, index) => runRequest(
            'draft',
            1 + index,
            stageData.targetTitle,
            () => client.complete(
              buildStructuredPlanDraftMessages(skill, stageData),
              { signal: context.signal, temperature: TEMPERATURE, maxTokens: AI_REQUEST_LIMITS.structuredPlan.module },
            ),
            (raw) => parseStructuredPlanModule(raw, stageData.targetTitle),
          ),
          () => context.signal.aborted,
        );

        if (context.signal.aborted) {
          return { ok: false, errorKind: 'stopped' };
        }
        const reviewData = createStructuredPlanReviewData(stagedSource, titles, drafts);
        enforceStagedContextBudget('review', titles.length + 1, undefined, reviewData);
        const reviews = await runRequest(
          'review',
          titles.length + 1,
          undefined,
          () => client.complete(
            buildStructuredPlanReviewMessages(skill, reviewData),
            { signal: context.signal, temperature: TEMPERATURE, maxTokens: AI_REQUEST_LIMITS.structuredPlan.review },
          ),
          (raw) => parseStructuredPlanReviews(raw, titles),
        );

        const revisionData = titles.map((title) => createStructuredPlanRevisionData(
          stagedSource,
          titles,
          drafts,
          reviews,
          title,
        ));
        revisionData.forEach((stageData, index) => {
          enforceStagedContextBudget(
            'revision',
            titles.length + 2 + index,
            titles[index],
            stageData,
          );
        });

        const revisedModules = await mapPoolAllOrNothing(
          revisionData,
          MODULE_CONCURRENCY,
          async (stageData, index) => runRequest(
            'revision',
            titles.length + 2 + index,
            stageData.targetTitle,
            () => client.complete(
              buildStructuredPlanRevisionMessages(skill, stageData),
              { signal: context.signal, temperature: TEMPERATURE, maxTokens: AI_REQUEST_LIMITS.structuredPlan.module },
            ),
            (raw) => parseStructuredPlanModule(raw, stageData.targetTitle),
          ),
          () => context.signal.aborted,
        );
        if (context.signal.aborted) {
          return { ok: false, errorKind: 'stopped' };
        }

        const generatedAt = deps.now();
        const modules = revisedModules.map((fields) => createStructuredPlanModule(fields, {
          id: deps.id,
          now: () => generatedAt,
        }));
        const graphRequestIndex = (2 * titles.length) + 2;
        let dependencyGraph: StructuredPlanDependencyGraph;
        let classifications: StructuredPlanModuleClassification[];
        reportStage('graph');
        try {
          const generated = await generateStructuredPlanDependencyGraph({
            client,
            skill,
            modules,
            signal: context.signal,
            now: () => generatedAt,
          });
          dependencyGraph = generated.graph;
          classifications = generated.classifications;
        } catch (error) {
          throw new StructuredPlanRequestError(
            'graph',
            graphRequestIndex,
            undefined,
            classifyRequestError(error),
            requestErrorRaw(error),
          );
        }
        succeededRequestCount += 1;
        stageCompleted.graph = 1;
        reportStage('graph');

        const classifiedModules = applyModuleClassifications(modules, classifications);

        if (config.modules.length === 0) {
          const patch = {
            modules: classifiedModules,
            candidateModules: null,
            candidateGeneratedAt: null,
            dependencyGraph,
            candidateDependencyGraph: null,
          };
          if (!structuredPlanConfigSchema.safeParse({ ...config, ...patch }).success) {
            throw new AiClientError('invalid-response', false);
          }
          deps.onConfigPatch(context.node.id, patch);
          return {
            ok: true,
            outputDisposition: 'replace',
            output: formatStructuredPlanOutput(classifiedModules),
            metrics: createSuccessMetrics(titles.length),
          };
        }

        const patch = {
          candidateModules: classifiedModules,
          candidateGeneratedAt: generatedAt,
          candidateDependencyGraph: dependencyGraph,
        };
        if (!structuredPlanConfigSchema.safeParse({ ...config, ...patch }).success) {
          throw new AiClientError('invalid-response', false);
        }
        deps.onConfigPatch(context.node.id, patch);
        return {
          ok: true,
          outputDisposition: 'preserve',
          metrics: createSuccessMetrics(titles.length),
        };
      } catch (error) {
        if (
          context.signal.aborted
          || (error instanceof StructuredPlanRequestError && error.errorKind === 'stopped')
        ) {
          return { ok: false, errorKind: 'stopped' };
        }
        if (error instanceof StructuredPlanRequestError) {
          console.error('[structuredPlan] stage fail', {
            stage: error.stage,
            requestIndex: error.requestIndex,
            targetTitle: error.targetTitle,
            errorKind: error.errorKind,
            ...(error.raw === undefined ? {} : { raw: error.raw }),
          });
          return {
            ok: false,
            errorKind: error.errorKind,
            metrics: createFailureMetrics(
              plannedRequestCount,
              succeededRequestCount,
              error.requestIndex,
            ),
          };
        }
        return {
          ok: false,
          errorKind: error instanceof AiClientError
            ? error.kind
            : 'invalid-response',
        };
      }
    },
  };
}

import { AiClientError, type AiClient } from '../ai/client';
import {
  buildStructuredPlanGraphMessages,
  createStructuredPlanGraphData,
  serializeStructuredPlanStageData,
} from '../ai/prompts';
import {
  parseStructuredPlanGraph,
  type StructuredPlanModuleWire,
} from '../ai/schemas';
import {
  STRUCTURED_PLAN_MAX_STAGED_DATA_CONTEXT_CHARS,
  STRUCTURED_PLAN_MODULE_FIELDS,
  type StructuredPlanModuleField,
} from '../ai/structured-plan-contract';
import type {
  StructuredPlanDependencyGraph,
  StructuredPlanLayer,
  StructuredPlanModule,
  StructuredPlanPriority,
} from '../nodes/structured-plan/config';
import {
  type StructuredPlanModuleClassification,
} from '../nodes/structured-plan/format';
import type { Skill } from '../skills';
import { AI_REQUEST_LIMITS } from '../ai/request-config';

const GRAPH_TEMPERATURE = 0.2;

export interface StructuredPlanGraphGenerationResult {
  graph: StructuredPlanDependencyGraph;
  classifications: StructuredPlanModuleClassification[];
}

export async function generateStructuredPlanDependencyGraph(input: {
  client: AiClient;
  skill: Skill;
  modules: readonly StructuredPlanModule[];
  signal: AbortSignal;
  now(): string;
}): Promise<StructuredPlanGraphGenerationResult> {
  if (input.signal.aborted) {
    throw new AiClientError('stopped', false);
  }

  const modulesByTitle = new Map<string, StructuredPlanModule>();
  for (const module of input.modules) {
    if (modulesByTitle.has(module.title)) {
      throw new AiClientError('invalid-response', false);
    }
    modulesByTitle.set(module.title, module);
  }

  const stageData = createStructuredPlanGraphData(toGraphWireModules(input.modules));
  if (
    serializeStructuredPlanStageData(stageData).length
    > STRUCTURED_PLAN_MAX_STAGED_DATA_CONTEXT_CHARS
  ) {
    throw new AiClientError('invalid-response', false);
  }

  let raw: string;
  try {
    raw = await input.client.complete(
      buildStructuredPlanGraphMessages(input.skill, stageData),
      {
        signal: input.signal,
        temperature: GRAPH_TEMPERATURE,
        maxTokens: AI_REQUEST_LIMITS.structuredPlan.graph,
      },
    );
  } catch (error) {
    if (error instanceof AiClientError) throw error;
    throw new AiClientError(input.signal.aborted ? 'stopped' : 'invalid-response', false);
  }

  if (input.signal.aborted) {
    throw new AiClientError('stopped', false);
  }
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new AiClientError('invalid-response', false);
  }

  let wire: ReturnType<typeof parseStructuredPlanGraph>;
  try {
    wire = parseStructuredPlanGraph(raw);
  } catch {
    throw invalidGraphResponse(raw);
  }

  const classificationByTitle = new Map<string, { priority: StructuredPlanPriority; layer: StructuredPlanLayer }>();
  for (const wireModule of wire.modules) {
    if (classificationByTitle.has(wireModule.title)) {
      throw invalidGraphResponse(raw);
    }
    classificationByTitle.set(wireModule.title, {
      priority: wireModule.priority,
      layer: wireModule.layer,
    });
  }
  if (
    classificationByTitle.size !== input.modules.length
    || !input.modules.every((module) => classificationByTitle.has(module.title))
  ) {
    throw invalidGraphResponse(raw);
  }

  const edgesByKey = new Map<string, StructuredPlanDependencyGraph['edges'][number]>();

  for (const edge of wire.edges) {
    const provider = modulesByTitle.get(edge.providerTitle);
    const consumer = modulesByTitle.get(edge.consumerTitle);
    if (!provider || !consumer || provider.id === consumer.id) {
      throw invalidGraphResponse(raw);
    }
    const edgeKey = `${provider.id}->${consumer.id}`;
    const existing = edgesByKey.get(edgeKey);
    if (existing) {
      existing.description = `${existing.description}；${edge.description}`;
      continue;
    }
    edgesByKey.set(edgeKey, {
      sourceModuleId: provider.id,
      targetModuleId: consumer.id,
      description: edge.description,
    });
  }

  const edges = [...edgesByKey.values()];

  return {
    graph: {
      nodes: input.modules.map((module) => ({ moduleId: module.id })),
      edges,
      generatedAt: input.now(),
      stale: false,
    },
    classifications: input.modules.map((module) => ({
      moduleId: module.id,
      priority: classificationByTitle.get(module.title)!.priority,
      layer: classificationByTitle.get(module.title)!.layer,
    })),
  };
}

function invalidGraphResponse(raw: string): AiClientError {
  return Object.assign(new AiClientError('invalid-response', false), { raw });
}

function toGraphWireModules(
  modules: readonly StructuredPlanModule[],
): StructuredPlanModuleWire[] {
  return modules.map((module) => {
    const wire = {} as Record<StructuredPlanModuleField, string>;
    for (const field of STRUCTURED_PLAN_MODULE_FIELDS) {
      wire[field] = module[field];
    }
    return wire as StructuredPlanModuleWire;
  });
}

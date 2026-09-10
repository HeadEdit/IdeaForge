import { z } from 'zod';
import { candidateCardWireSchema } from '../schema/ai-wire';
import { AiClientError } from './client';
import {
  STRUCTURED_PLAN_LAYERS,
  STRUCTURED_PLAN_PRIORITIES,
} from '../nodes/structured-plan/config';
import {
  STRUCTURED_PLAN_ACCEPTED_CLASSIFICATIONS,
  STRUCTURED_PLAN_MAX_CANDIDATES,
  STRUCTURED_PLAN_MAX_MODULE_TITLES,
  STRUCTURED_PLAN_MAX_TITLE_LENGTH,
  STRUCTURED_PLAN_MODULE_FIELDS,
  type StructuredPlanCandidateWire,
  type StructuredPlanGraphEdgeWire,
  type StructuredPlanGraphModuleWire,
  type StructuredPlanModuleField,
} from './structured-plan-contract';

export { STRUCTURED_PLAN_MODULE_FIELDS } from './structured-plan-contract';

const structuredPlanCandidateClassificationSchema = z.enum([
  'explicit-system',
  'essential-implicit-system',
  'document-section',
]);

const structuredPlanCandidateWireSchema = z.object({
  title: z.string().trim().min(1).max(STRUCTURED_PLAN_MAX_TITLE_LENGTH),
  classification: structuredPlanCandidateClassificationSchema,
  responsibility: z.string().trim().min(1),
  basis: z.string().trim().min(1),
}).strict();

const structuredPlanCandidatesWireSchema = z.object({
  candidates: z.array(structuredPlanCandidateWireSchema)
    .min(1)
    .max(STRUCTURED_PLAN_MAX_CANDIDATES),
}).strict().superRefine((payload, context) => {
  const acceptedTitles = new Set<string>();
  let acceptedCount = 0;

  payload.candidates.forEach((candidate, index) => {
    if (!STRUCTURED_PLAN_ACCEPTED_CLASSIFICATIONS.includes(
      candidate.classification as (typeof STRUCTURED_PLAN_ACCEPTED_CLASSIFICATIONS)[number],
    )) {
      return;
    }

    acceptedCount += 1;
    if (acceptedTitles.has(candidate.title)) {
      context.addIssue({
        code: 'custom',
        message: 'Accepted module titles must be unique after trimming',
        path: ['candidates', index, 'title'],
      });
    }
    acceptedTitles.add(candidate.title);
  });

  if (acceptedCount > STRUCTURED_PLAN_MAX_MODULE_TITLES) {
    context.addIssue({
      code: 'custom',
      message: `At most ${STRUCTURED_PLAN_MAX_MODULE_TITLES} accepted modules are allowed`,
      path: ['candidates'],
    });
  }
});

const structuredPlanGraphEdgeWireSchema = z.object({
  providerTitle: z.string().trim().min(1),
  consumerTitle: z.string().trim().min(1),
  description: z.string().trim().min(1),
}).strict();

const structuredPlanGraphModuleWireSchema = z.object({
  title: z.string().trim().min(1),
  priority: z.enum(STRUCTURED_PLAN_PRIORITIES),
  layer: z.enum(STRUCTURED_PLAN_LAYERS),
}).strict();

const structuredPlanGraphWireSchema = z.object({
  modules: z.array(structuredPlanGraphModuleWireSchema),
  edges: z.array(structuredPlanGraphEdgeWireSchema),
}).strict();

const structuredPlanModuleWireShape = Object.fromEntries(
  STRUCTURED_PLAN_MODULE_FIELDS.map((field) => [
    field,
    field === 'title' ? z.string().trim().min(1) : z.string().trim(),
  ]),
) as Record<StructuredPlanModuleField, z.ZodString>;

const structuredPlanModuleWireSchema = z.object(structuredPlanModuleWireShape).strict();

export type StructuredPlanModuleWire = z.infer<typeof structuredPlanModuleWireSchema>;

const structuredPlanTitlesWireSchema = z.object({
  titles: z.array(
    z.string().trim().min(1).max(STRUCTURED_PLAN_MAX_TITLE_LENGTH),
  ).min(1).max(STRUCTURED_PLAN_MAX_MODULE_TITLES),
}).strict().superRefine((payload, context) => {
  const titles = new Set<string>();
  payload.titles.forEach((title, index) => {
    if (titles.has(title)) {
      context.addIssue({
        code: 'custom',
        message: 'Module titles must be unique after trimming',
        path: ['titles', index],
      });
    }
    titles.add(title);
  });
});

const structuredPlanReviewWireSchema = z.object({
  title: z.string().trim().min(1),
  instructions: z.array(z.string().trim().min(1)),
}).strict();

const structuredPlanReviewsWireSchema = z.object({
  reviews: z.array(structuredPlanReviewWireSchema),
}).strict();

export type StructuredPlanReviewWire = z.infer<typeof structuredPlanReviewWireSchema>;

export function parseStructuredPlanTitles(raw: string): string[] {
  const parsed = extractStrictJsonObject(raw);
  const result = structuredPlanTitlesWireSchema.safeParse(parsed);
  if (!result.success) {
    throw new AiClientError('invalid-response', false);
  }
  return result.data.titles;
}

export function parseStructuredPlanCandidates(raw: string): StructuredPlanCandidateWire[] {
  const parsed = extractStrictJsonObject(raw);
  const result = structuredPlanCandidatesWireSchema.safeParse(parsed);
  if (!result.success) {
    throw new AiClientError('invalid-response', false);
  }
  return result.data.candidates.filter((candidate) =>
    STRUCTURED_PLAN_ACCEPTED_CLASSIFICATIONS.includes(
      candidate.classification as (typeof STRUCTURED_PLAN_ACCEPTED_CLASSIFICATIONS)[number],
    ));
}

export function parseStructuredPlanGraph(raw: string): {
  modules: StructuredPlanGraphModuleWire[];
  edges: StructuredPlanGraphEdgeWire[];
} {
  const parsed = extractStrictJsonObject(raw);
  const result = structuredPlanGraphWireSchema.safeParse(parsed);
  if (!result.success) {
    throw new AiClientError('invalid-response', false);
  }
  return result.data;
}

export function parseStructuredPlanModule(
  raw: string,
  expectedTitle: string,
): StructuredPlanModuleWire {
  const parsed = extractStrictJsonObject(raw);
  const result = structuredPlanModuleWireSchema.safeParse(parsed);
  if (!result.success || result.data.title !== expectedTitle) {
    throw new AiClientError('invalid-response', false);
  }
  return result.data;
}

export function parseStructuredPlanReviews(
  raw: string,
  expectedTitles: readonly string[],
): StructuredPlanReviewWire[] {
  const parsed = extractStrictJsonObject(raw);
  const result = structuredPlanReviewsWireSchema.safeParse(parsed);
  if (
    !result.success
    || result.data.reviews.length !== expectedTitles.length
    || result.data.reviews.some((review, index) => review.title !== expectedTitles[index])
  ) {
    throw new AiClientError('invalid-response', false);
  }
  return result.data.reviews;
}

const briefFieldsWireSchema = z.object({
  title: z.string().optional(),
  background: z.string().optional(),
  targetPlayers: z.string().optional(),
  designGoals: z.string().optional(),
  constraints: z.string().optional(),
  successMetrics: z.string().optional(),
  outOfScope: z.string().optional(),
});

export function parseBriefFields(raw: string): {
  title: string;
  background: string;
  targetPlayers: string;
  designGoals: string;
  constraints: string;
  successMetrics: string;
  outOfScope: string;
} {
  const parsed = extractJson(raw, '{');
  const result = briefFieldsWireSchema.safeParse(parsed);
  if (!result.success || Array.isArray(parsed)) {
    throw new AiClientError('invalid-response', false);
  }
  return {
    title: (result.data.title ?? '').trim(),
    background: (result.data.background ?? '').trim(),
    targetPlayers: (result.data.targetPlayers ?? '').trim(),
    designGoals: (result.data.designGoals ?? '').trim(),
    constraints: (result.data.constraints ?? '').trim(),
    successMetrics: (result.data.successMetrics ?? '').trim(),
    outOfScope: (result.data.outOfScope ?? '').trim(),
  };
}

export interface ParsedCandidateCard {
  title: string;
  concept: string;
  content: string;
  tags: string[];
}

export function parseCandidateCards(raw: string): {
  valid: ParsedCandidateCard[];
  skipped: number;
} {
  const parsed = extractJson(raw, '[');
  if (!Array.isArray(parsed)) {
    throw new AiClientError('invalid-response', false);
  }

  const valid: ParsedCandidateCard[] = [];
  let skipped = 0;
  for (const item of parsed) {
    const result = candidateCardWireSchema.safeParse(item);
    if (result.success) {
      valid.push(result.data);
    } else {
      skipped += 1;
    }
  }
  return { valid, skipped };
}

const methodInferenceWireSchema = z.object({
  methodIds: z.array(z.string()),
});

export function parseMethodIds(
  raw: string,
  availableIds: readonly string[],
): string[] {
  const parsed = extractJson(raw, '{');
  const result = methodInferenceWireSchema.safeParse(parsed);
  if (!result.success) {
    throw new AiClientError('invalid-response', false);
  }
  const available = new Set(availableIds);
  return [...new Set(result.data.methodIds.filter((id) => available.has(id)))];
}

const ideaScoreDimensionsWireSchema = z.object({
  dimensions: z.array(z.object({
    name: z.string(),
    description: z.string().optional(),
  })),
});

export function parseIdeaScoreDimensions(
  raw: string,
): { name: string; description: string }[] {
  const parsed = extractJson(raw, '{');
  const result = ideaScoreDimensionsWireSchema.safeParse(parsed);
  if (!result.success) {
    throw new AiClientError('invalid-response', false);
  }
  const cleaned = result.data.dimensions
    .map((item) => ({
      name: item.name.trim(),
      description: (item.description ?? '').trim(),
    }))
    .filter((item) => item.name.length > 0);
  if (cleaned.length < 3) {
    throw new AiClientError('invalid-response', false);
  }
  return cleaned.slice(0, 7);
}

const ideaScoreDimensionDescriptionsWireSchema = z.object({
  dimensions: z.array(z.object({
    id: z.string().optional(),
    name: z.string().optional(),
    description: z.string().optional(),
  })),
});

export function parseIdeaScoreDimensionDescriptions(
  raw: string,
  expected: readonly { id: string; name: string }[],
): { id: string; description: string }[] {
  const parsed = extractJson(raw, '{');
  const result = ideaScoreDimensionDescriptionsWireSchema.safeParse(parsed);
  if (!result.success || expected.length === 0) {
    throw new AiClientError('invalid-response', false);
  }

  const unused = result.data.dimensions.map((item) => ({
    id: item.id?.trim() ?? '',
    name: (item.name ?? '').trim(),
    description: (item.description ?? '').trim(),
  }));

  const matched: { id: string; description: string }[] = [];
  for (const dimension of expected) {
    const byId = unused.findIndex((item) => item.id === dimension.id && item.description.length > 0);
    const byName = unused.findIndex((item) => (
      item.name === dimension.name.trim()
      && item.description.length > 0
    ));
    const index = byId >= 0 ? byId : byName;
    if (index < 0) {
      throw new AiClientError('invalid-response', false);
    }
    const found = unused[index]!;
    unused.splice(index, 1);
    matched.push({ id: dimension.id, description: found.description });
  }
  return matched;
}

const ideaScoreResultsWireSchema = z.object({
  cards: z.array(z.object({
    cardId: z.string(),
    scores: z.array(z.object({
      dimensionId: z.string(),
      score: z.number(),
      reason: z.string().optional(),
    })),
  })),
});

const IDEA_SCORE_REASON_MAX_LENGTH = 30;

function normalizeIdeaScoreReason(raw: string | undefined): string {
  const text = (raw ?? '').trim();
  if (!text) {
    throw new AiClientError('invalid-response', false);
  }
  return text.length > IDEA_SCORE_REASON_MAX_LENGTH
    ? text.slice(0, IDEA_SCORE_REASON_MAX_LENGTH)
    : text;
}

function clampScore(score: number): number {
  if (!Number.isFinite(score)) {
    throw new AiClientError('invalid-response', false);
  }
  return Math.min(10, Math.max(1, score));
}

type IdeaScoreWirePayload = z.infer<typeof ideaScoreResultsWireSchema>;

function extractAllBalancedObjects(raw: string): unknown[] {
  const objects: unknown[] = [];
  let searchFrom = 0;

  while (searchFrom < raw.length) {
    const slice = raw.slice(searchFrom);
    const piece = extractBalanced(slice, '{');
    if (!piece) {
      break;
    }
    try {
      objects.push(JSON.parse(piece));
    } catch {
      break;
    }
    const absoluteStart = raw.indexOf(piece, searchFrom);
    if (absoluteStart === -1) {
      break;
    }
    searchFrom = absoluteStart + piece.length;
    while (searchFrom < raw.length && /[\s,]/.test(raw[searchFrom] ?? '')) {
      searchFrom += 1;
    }
  }

  return objects;
}

function mergeConcatenatedIdeaScorePayloads(raw: string): IdeaScoreWirePayload | null {
  const objects = extractAllBalancedObjects(raw);
  if (objects.length === 0) {
    return null;
  }

  const cards: IdeaScoreWirePayload['cards'] = [];
  for (const object of objects) {
    const result = ideaScoreResultsWireSchema.safeParse(object);
    if (!result.success) {
      return null;
    }
    cards.push(...result.data.cards);
  }

  return cards.length > 0 ? { cards } : null;
}

function parseIdeaScoreWirePayload(raw: string): IdeaScoreWirePayload {
  const merged = mergeConcatenatedIdeaScorePayloads(raw);
  if (merged) {
    return merged;
  }

  const parsed = extractJson(raw, '{');
  const result = ideaScoreResultsWireSchema.safeParse(parsed);
  if (!result.success) {
    throw new AiClientError('invalid-response', false);
  }
  return result.data;
}

export function parseIdeaScoreCardResults(
  raw: string,
  expectedCardIds: readonly string[],
  dimensionIds: readonly string[],
): {
  cardId: string;
  scores: { dimensionId: string; score: number; reason: string }[];
}[] {
  const payload = parseIdeaScoreWirePayload(raw);
  const byId = new Map(payload.cards.map((card) => [card.cardId, card]));
  const dimensionSet = new Set(dimensionIds);
  return expectedCardIds.map((cardId) => {
    const card = byId.get(cardId);
    if (!card) {
      throw new AiClientError('invalid-response', false);
    }
    const scoreByDim = new Map<string, { score: number; reason: string }>();
    for (const entry of card.scores) {
      if (!dimensionSet.has(entry.dimensionId)) continue;
      scoreByDim.set(entry.dimensionId, {
        score: clampScore(entry.score),
        reason: normalizeIdeaScoreReason(entry.reason),
      });
    }
    const scores = dimensionIds.map((dimensionId) => {
      const entry = scoreByDim.get(dimensionId);
      if (!entry) {
        throw new AiClientError('invalid-response', false);
      }
      return { dimensionId, score: entry.score, reason: entry.reason };
    });
    return { cardId, scores };
  });
}

function invalidResponse(): never {
  throw new AiClientError('invalid-response', false);
}

function extractStrictJsonObject(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  const fence = /^```json[\t ]*\r?\n([\s\S]*?)\r?\n```$/i.exec(trimmed);
  const candidate = fence?.[1] ?? trimmed;

  try {
    const parsed: unknown = JSON.parse(candidate);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return invalidResponse();
    }
    return parsed as Record<string, unknown>;
  } catch {
    return invalidResponse();
  }
}

function extractBalanced(raw: string, opening: '{' | '['): string | undefined {
  const closing = opening === '{' ? '}' : ']';
  let start = -1;
  let searchingString = false;
  let searchingEscape = false;

  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];
    if (searchingString) {
      if (searchingEscape) {
        searchingEscape = false;
      } else if (character === '\\') {
        searchingEscape = true;
      } else if (character === '"') {
        searchingString = false;
      }
    } else if (character === '"') {
      searchingString = true;
    } else if (character === opening) {
      start = index;
      break;
    }
  }

  if (start === -1) {
    return undefined;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < raw.length; index += 1) {
    const character = raw[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
    } else if (character === opening) {
      depth += 1;
    } else if (character === closing) {
      depth -= 1;
      if (depth === 0) {
        return raw.slice(start, index + 1);
      }
    }
  }

  return undefined;
}

export function extractJson(raw: string, opening: '{' | '['): unknown {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // A model may surround otherwise valid JSON with prose or a code fence.
  }

  const fenced = /```json\s*([\s\S]*?)\s*```/i.exec(raw);
  const candidate = fenced ? fenced[1].trim() : extractBalanced(raw, opening);
  if (!candidate) {
    return invalidResponse();
  }

  try {
    return JSON.parse(candidate);
  } catch {
    return invalidResponse();
  }
}

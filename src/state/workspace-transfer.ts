import { z } from 'zod';

import type { WorkspaceSnapshot } from '../db/repository';
import type {
  ChatSession,
  NodeOutput,
  ReferenceDocument,
  TextStructItem,
  WorkflowNode,
} from '../domain/model';
import { builtinNodePlatform } from '../nodes/builtins';

export const LEGACY_WORKSPACE_EXPORT_FORMAT = 'design-canvas-workspace' as const;
export const WORKSPACE_EXPORT_FORMAT = 'idea-forge-workspace' as const;
export const WORKSPACE_EXPORT_VERSION = 1 as const;
export const WORKSPACE_EXPORT_MAX_BYTES = 50 * 1024 * 1024;

export interface WorkspaceExportFileV1 {
  format: typeof WORKSPACE_EXPORT_FORMAT;
  version: typeof WORKSPACE_EXPORT_VERSION;
  exportedAt: string;
  snapshot: WorkspaceSnapshot;
}

export type WorkspaceTransferErrorReason =
  | 'invalid-file'
  | 'unsupported-version'
  | 'unsupported-node-kind'
  | 'invalid-reference';

export class WorkspaceTransferError extends Error {
  readonly reason: WorkspaceTransferErrorReason;

  constructor(reason: WorkspaceTransferErrorReason) {
    super('工作区文件无效');
    this.name = 'WorkspaceTransferError';
    this.reason = reason;
  }
}

const id = z.string().min(1);
const timestamp = z.string().min(1);
const textStructItemSchema = z.object({
  id,
  title: z.string(),
  content: z.string(),
  turnId: id,
  conversationId: id.optional(),
  createdAt: timestamp,
  titleSource: z.enum(['auto', 'fallback', 'user']),
  titleUpdatedAt: timestamp,
}).strict();
const nodeOutputSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('Text'), value: z.string() }).strict(),
  z.object({ type: z.literal('Text[]'), values: z.array(z.string()) }).strict(),
  z.object({ type: z.literal('CardCollection'), cardIds: z.array(id) }).strict(),
  z.object({ type: z.literal('TextStruct'), items: z.array(textStructItemSchema) }).strict(),
]);
const nodeSchema = z.object({
  id,
  kind: id,
  position: z.object({ x: z.number(), y: z.number() }).strict(),
  config: z.unknown(),
  status: z.enum(['running', 'succeeded', 'partial', 'failed', 'stopped', 'idle', 'stale']),
  currentRunId: id.optional(),
  output: nodeOutputSchema.optional(),
}).strict();
const workflowSchema = z.object({
  id,
  name: z.string(),
  nodes: z.array(nodeSchema),
  edges: z.array(z.object({
    id,
    sourceNodeId: id,
    sourcePortId: id,
    targetNodeId: id,
    targetPortId: id,
  }).strict()),
  containmentEdges: z.array(z.object({ id, parentNodeId: id, childNodeId: id }).strict()),
  viewport: z.object({ x: z.number(), y: z.number(), zoom: z.number() }).strict(),
  createdAt: timestamp,
  updatedAt: timestamp,
}).strict();
const runSchema = z.object({
  id,
  workflowId: id,
  nodeId: id,
  status: z.enum(['running', 'succeeded', 'partial', 'failed', 'stopped']),
  requested: z.number(),
  succeeded: z.number(),
  failed: z.number(),
  skipped: z.number(),
  failedBatchIndexes: z.array(z.number()),
  startedAt: timestamp,
  finishedAt: timestamp.optional(),
  errorKind: z.string().optional(),
}).strict();
const scoreSchema = z.object({
  average: z.number(),
  byDimension: z.array(z.object({
    dimensionId: id,
    name: z.string(),
    score: z.number(),
    reason: z.string(),
  }).strict()),
  scoredAt: timestamp,
}).strict();
const cardSchema = z.object({
  id,
  workflowId: id,
  runId: id,
  method: z.string(),
  title: z.string(),
  concept: z.string(),
  content: z.string(),
  tags: z.array(z.string()),
  vote: z.enum(['up', 'down']).nullable(),
  score: scoreSchema.optional(),
  review: z.string().max(100).optional(),
  onCanvas: z.boolean(),
  createdAt: timestamp,
}).strict();
const messageSchema = z.object({
  reasoningContent: z.string().optional(),
  webSearch: z.boolean().optional(),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  agentEvents: z.array(z.object({
    id: z.string(), round: z.number().int().min(1).max(8),
    kind: z.enum(['request', 'response', 'tool']), title: z.string(),
    status: z.enum(['running', 'succeeded', 'failed', 'stopped']),
    startedAt: z.string(), finishedAt: z.string().optional(),
    input: z.string().max(65000).optional(), output: z.string().max(65000).optional(),
  }).strict()).max(40).optional(),
  skillSuggestion: z.object({
    currentSkillId: z.string(),
    suggestedSkillId: z.string().min(1),
    confidence: z.number().min(0).max(1),
    reason: z.string().min(1).max(160),
  }).strict().optional(),
}).strict();
const conversationSchema = z.object({
  id,
  name: z.string(),
  messages: z.array(messageSchema),
  itemIds: z.array(id),
  createdAt: timestamp,
  source: z.object({
    conversationId: id,
    itemId: id,
    mode: z.enum(['full-context', 'single-turn']),
  }).strict().optional(),
}).strict();
const sessionSchema = z.object({
  id,
  workflowId: id,
  nodeId: id,
  skillId: z.string(),
  referencedCardIds: z.array(id),
  activeConversationId: id,
  conversations: z.array(conversationSchema),
  items: z.array(textStructItemSchema),
  createdAt: timestamp,
  updatedAt: timestamp,
}).strict();
const documentSchema = z.object({
  id,
  workflowId: id,
  title: z.string(),
  content: z.string(),
  format: z.enum(['manual', 'md', 'txt']),
  sourceName: z.string().optional(),
  createdAt: timestamp,
  updatedAt: timestamp,
}).strict();
const snapshotSchema = z.object({
  workflow: workflowSchema,
  runs: z.array(runSchema),
  cards: z.array(cardSchema),
  sessions: z.array(sessionSchema),
  documents: z.array(documentSchema),
}).strict();
const exportSchema = z.object({
  format: z.union([
    z.literal(WORKSPACE_EXPORT_FORMAT),
    z.literal(LEGACY_WORKSPACE_EXPORT_FORMAT),
  ]),
  version: z.literal(WORKSPACE_EXPORT_VERSION),
  exportedAt: timestamp,
  snapshot: snapshotSchema,
}).strict();

function fail(reason: WorkspaceTransferErrorReason = 'invalid-reference'): never {
  throw new WorkspaceTransferError(reason);
}

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function allTextItems(snapshot: WorkspaceSnapshot): TextStructItem[] {
  return [
    ...snapshot.workflow.nodes.flatMap((node) => (
      node.output?.type === 'TextStruct' ? node.output.items : []
    )),
    ...snapshot.sessions.flatMap((session) => session.items),
  ];
}

function validateConfigReferences(
  node: WorkflowNode,
  cardIds: Set<string>,
  itemIds: Set<string>,
  documentIds: Set<string>,
): void {
  const config = node.config as Record<string, unknown>;
  const requireOptional = (value: unknown, values: Set<string>) => {
    if (typeof value === 'string' && value !== '' && !values.has(value)) fail();
  };
  if (node.kind === 'cardContent') requireOptional(config.sourceCardId, cardIds);
  if (node.kind === 'textSelect') requireOptional(config.sourceItemId, itemIds);
  if (node.kind === 'ideaScore') {
    const report = config.report as { cards?: Array<{ cardId?: unknown }> } | null;
    for (const entry of report?.cards ?? []) requireOptional(entry.cardId, cardIds);
  }
  if (node.kind === 'reference') {
    for (const value of (config.documentIds as string[] | undefined) ?? []) {
      requireOptional(value, documentIds);
    }
  }
}

function validateWorkspaceSnapshot(value: WorkspaceSnapshot): WorkspaceSnapshot {
  const workflowId = value.workflow.id;
  const nodeIdList = value.workflow.nodes.map((node) => node.id);
  const runIdList = value.runs.map((run) => run.id);
  const cardIdList = value.cards.map((card) => card.id);
  const sessionIdList = value.sessions.map((session) => session.id);
  const conversationIdList = value.sessions.flatMap((session) => (
    session.conversations.map((conversation) => conversation.id)
  ));
  const nodeIds = new Set(nodeIdList);
  const cardIds = new Set(cardIdList);
  const itemIds = new Set(allTextItems(value).map((item) => item.id));
  const documentIds = new Set(value.documents.map((doc) => doc.id));
  if (!unique(nodeIdList)
    || !unique(value.workflow.edges.map((edge) => edge.id))
    || !unique(value.workflow.containmentEdges.map((edge) => edge.id))
    || !unique(runIdList)
    || !unique(cardIdList)
    || !unique(sessionIdList)
    || !unique(conversationIdList)
    || !unique(value.documents.map((doc) => doc.id))) fail();

  for (const node of value.workflow.nodes) {
    const plugin = builtinNodePlatform.lookup(node.kind);
    if (!plugin) fail('unsupported-node-kind');
    if (!plugin.configSchema.safeParse(node.config).success) fail('invalid-file');
    if (node.currentRunId) {
      const currentRun = value.runs.find((run) => run.id === node.currentRunId);
      if (!currentRun || currentRun.nodeId !== node.id) fail();
    }
    if (node.output?.type === 'CardCollection'
      && node.output.cardIds.some((cardId) => !cardIds.has(cardId))) fail();
    if (node.output?.type === 'TextStruct') {
      for (const item of node.output.items) {
        if (item.conversationId && !conversationIdList.includes(item.conversationId)) fail();
      }
    }
    validateConfigReferences(node, cardIds, itemIds, documentIds);
  }
  for (const edge of value.workflow.edges) {
    const source = value.workflow.nodes.find((node) => node.id === edge.sourceNodeId);
    const target = value.workflow.nodes.find((node) => node.id === edge.targetNodeId);
    const sourceDefinition = source && builtinNodePlatform.getDefinition(source.kind);
    const targetDefinition = target && builtinNodePlatform.getDefinition(target.kind);
    if (!source || !target
      || !sourceDefinition?.outputs.some((port) => port.id === edge.sourcePortId)
      || !targetDefinition?.inputs.some((port) => port.id === edge.targetPortId)) fail();
  }
  for (const edge of value.workflow.containmentEdges) {
    if (!nodeIds.has(edge.parentNodeId) || !nodeIds.has(edge.childNodeId)) fail();
  }
  for (const run of value.runs) {
    if (run.workflowId !== workflowId || !nodeIds.has(run.nodeId)) fail();
  }
  for (const card of value.cards) {
    // Cards may outlive producing runs after divergence deletion (owned by cardVariable).
    if (card.workflowId !== workflowId) fail();
  }
  for (const doc of value.documents) {
    if (doc.workflowId !== workflowId) fail();
  }
  for (const session of value.sessions) validateSession(session, workflowId, nodeIds, cardIds);
  return value;
}

function validateSession(
  session: ChatSession,
  workflowId: string,
  nodeIds: Set<string>,
  cardIds: Set<string>,
): void {
  const conversationIds = new Set(session.conversations.map((conversation) => conversation.id));
  const itemIds = new Set(session.items.map((item) => item.id));
  const turnIds = new Set(session.conversations.flatMap((conversation) => conversation.itemIds));
  if (session.workflowId !== workflowId || !nodeIds.has(session.nodeId)
    || session.referencedCardIds.some((cardId) => !cardIds.has(cardId))
    || !unique([...conversationIds]) || !unique([...itemIds])
    || !conversationIds.has(session.activeConversationId)) fail();
  for (const conversation of session.conversations) {
    if (!unique(conversation.itemIds)) fail();
    if (conversation.source && (
      !conversationIds.has(conversation.source.conversationId)
      || !(session.conversations.find((entry) => entry.id === conversation.source!.conversationId)
        ?.itemIds.includes(conversation.source.itemId))
    )) fail();
  }
  for (const item of session.items) {
    if (item.conversationId && !conversationIds.has(item.conversationId)) fail();
    if (item.conversationId) {
      const conversation = session.conversations.find((entry) => entry.id === item.conversationId);
      if (!conversation?.itemIds.includes(item.turnId)) fail();
    } else if (!turnIds.has(item.turnId) && !conversationIds.has(item.turnId)) {
      // Legacy conversation-level exports use turnId === conversation.id.
      fail();
    }
  }
}

export function createWorkspaceExport(
  snapshot: WorkspaceSnapshot,
  exportedAt: string,
): WorkspaceExportFileV1 {
  return {
    format: WORKSPACE_EXPORT_FORMAT,
    version: WORKSPACE_EXPORT_VERSION,
    exportedAt,
    snapshot: structuredClone(snapshot),
  };
}

export function parseWorkspaceExport(value: unknown): WorkspaceExportFileV1 {
  if (typeof value === 'object' && value !== null
    && 'format' in value
    && (value.format === WORKSPACE_EXPORT_FORMAT || value.format === LEGACY_WORKSPACE_EXPORT_FORMAT)
    && 'version' in value && value.version !== WORKSPACE_EXPORT_VERSION) {
    fail('unsupported-version');
  }
  const parsed = exportSchema.safeParse(value);
  if (!parsed.success) fail('invalid-file');
  validateWorkspaceSnapshot(parsed.data.snapshot);
  return {
    ...parsed.data,
    format: WORKSPACE_EXPORT_FORMAT,
  };
}

interface CloneDependencies {
  id: () => string;
  now: () => string;
  existingNames: readonly string[];
}

type IdMap = Map<string, string>;

function allocate(values: readonly string[], nextId: () => string): IdMap {
  const map = new Map<string, string>();
  for (const value of values) {
    if (!map.has(value)) map.set(value, nextId());
  }
  return map;
}

function required(map: ReadonlyMap<string, string>, value: string): string {
  return map.get(value) ?? fail();
}

function optional(map: ReadonlyMap<string, string>, value: string | null): string | null {
  return value === null || value === '' ? value : required(map, value);
}

function importedName(name: string, existingNames: readonly string[]): string {
  const names = new Set(existingNames);
  let sequence = 1;
  while (true) {
    const suffix = sequence === 1 ? '（导入副本）' : `（导入副本 ${sequence}）`;
    const candidate = `${name}${suffix}`;
    if (!names.has(candidate)) return candidate;
    sequence += 1;
  }
}

function remapItem(
  item: TextStructItem,
  items: IdMap,
  turns: IdMap,
  conversations: IdMap,
): TextStructItem {
  return {
    ...item,
    id: required(items, item.id),
    turnId: required(turns, item.turnId),
    ...(item.conversationId
      ? { conversationId: required(conversations, item.conversationId) }
      : {}),
  };
}

function remapOutput(
  output: NodeOutput | undefined,
  cards: IdMap,
  items: IdMap,
  turns: IdMap,
  conversations: IdMap,
): NodeOutput | undefined {
  if (!output) return undefined;
  if (output.type === 'CardCollection') {
    return { ...output, cardIds: output.cardIds.map((value) => required(cards, value)) };
  }
  if (output.type === 'TextStruct') {
    return { ...output, items: output.items.map((item) => remapItem(item, items, turns, conversations)) };
  }
  return structuredClone(output);
}

function remapConfig(
  node: WorkflowNode,
  cards: IdMap,
  items: IdMap,
  modules: IdMap,
  documents: IdMap,
): unknown {
  const config = structuredClone(node.config) as Record<string, unknown>;
  if (node.kind === 'cardContent' && typeof config.sourceCardId === 'string') {
    config.sourceCardId = optional(cards, config.sourceCardId);
  }
  if (node.kind === 'textSelect' && typeof config.sourceItemId === 'string') {
    config.sourceItemId = optional(items, config.sourceItemId);
  }
  if (node.kind === 'ideaScore' && config.report && typeof config.report === 'object') {
    const report = config.report as { cards?: Array<{ cardId: string }> };
    report.cards = report.cards?.map((entry) => ({ ...entry, cardId: required(cards, entry.cardId) }));
  }
  if (node.kind === 'reference' && Array.isArray(config.documentIds)) {
    config.documentIds = config.documentIds.map((value) => required(documents, String(value)));
  }
  if (node.kind === 'structuredPlan') {
    for (const key of ['modules', 'candidateModules'] as const) {
      if (!Array.isArray(config[key])) continue;
      config[key] = config[key].map((module: Record<string, unknown>) => ({
        ...module,
        id: required(modules, String(module.id)),
      }));
    }
  }
  return config;
}

export function cloneWorkspaceForImport(
  source: WorkspaceSnapshot,
  dependencies: CloneDependencies,
): WorkspaceSnapshot {
  validateWorkspaceSnapshot(source);
  const workflow = allocate([source.workflow.id], dependencies.id);
  const nodes = allocate(source.workflow.nodes.map((node) => node.id), dependencies.id);
  const edges = allocate(source.workflow.edges.map((edge) => edge.id), dependencies.id);
  const containmentEdges = allocate(source.workflow.containmentEdges.map((edge) => edge.id), dependencies.id);
  // Include orphaned card.runId values so deleted-divergence history still remaps.
  const runs = allocate([
    ...source.runs.map((run) => run.id),
    ...source.cards.map((card) => card.runId),
  ], dependencies.id);
  const cards = allocate(source.cards.map((card) => card.id), dependencies.id);
  const sessions = allocate(source.sessions.map((session) => session.id), dependencies.id);
  const conversations = allocate(
    source.sessions.flatMap((session) => session.conversations.map((conversation) => conversation.id)),
    dependencies.id,
  );
  const modules = allocate(source.workflow.nodes.flatMap((node) => {
    if (node.kind !== 'structuredPlan' || !node.config || typeof node.config !== 'object') return [];
    const config = node.config as { modules?: Array<{ id: string }>; candidateModules?: Array<{ id: string }> | null };
    return [...(config.modules ?? []), ...(config.candidateModules ?? [])].map((module) => module.id);
  }), dependencies.id);
  const documents = allocate(source.documents.map((doc) => doc.id), dependencies.id);
  const sourceItems = allTextItems(source);
  const items = new Map<string, string>(modules);
  for (const item of sourceItems) {
    if (!items.has(item.id)) items.set(item.id, dependencies.id());
  }
  const turns = allocate([
    ...sourceItems.map((item) => item.turnId),
    ...source.sessions.flatMap((session) => session.conversations.flatMap((conversation) => [
      ...conversation.itemIds,
      ...(conversation.source ? [conversation.source.itemId] : []),
    ])),
  ], dependencies.id);
  const importedAt = dependencies.now();
  const workflowId = required(workflow, source.workflow.id);

  const clone: WorkspaceSnapshot = {
    workflow: {
      ...source.workflow,
      id: workflowId,
      name: importedName(source.workflow.name, dependencies.existingNames),
      createdAt: importedAt,
      updatedAt: importedAt,
      nodes: source.workflow.nodes.map((node) => ({
        ...node,
        id: required(nodes, node.id),
        config: remapConfig(node, cards, items, modules, documents),
        ...(node.currentRunId ? { currentRunId: required(runs, node.currentRunId) } : {}),
        ...(node.output
          ? { output: remapOutput(node.output, cards, items, turns, conversations) }
          : {}),
      })),
      edges: source.workflow.edges.map((edge) => ({
        ...edge,
        id: required(edges, edge.id),
        sourceNodeId: required(nodes, edge.sourceNodeId),
        targetNodeId: required(nodes, edge.targetNodeId),
      })),
      containmentEdges: source.workflow.containmentEdges.map((edge) => ({
        ...edge,
        id: required(containmentEdges, edge.id),
        parentNodeId: required(nodes, edge.parentNodeId),
        childNodeId: required(nodes, edge.childNodeId),
      })),
    },
    runs: source.runs.map((run) => ({
      ...run,
      id: required(runs, run.id),
      workflowId,
      nodeId: required(nodes, run.nodeId),
    })),
    cards: source.cards.map((card) => ({
      ...card,
      id: required(cards, card.id),
      workflowId,
      runId: required(runs, card.runId),
    })),
    sessions: source.sessions.map((session) => ({
      ...session,
      id: required(sessions, session.id),
      workflowId,
      nodeId: required(nodes, session.nodeId),
      referencedCardIds: session.referencedCardIds.map((value) => required(cards, value)),
      activeConversationId: required(conversations, session.activeConversationId),
      conversations: session.conversations.map((conversation) => ({
        ...conversation,
        id: required(conversations, conversation.id),
        itemIds: conversation.itemIds.map((value) => required(turns, value)),
        ...(conversation.source ? {
          source: {
            ...conversation.source,
            conversationId: required(conversations, conversation.source.conversationId),
            itemId: required(turns, conversation.source.itemId),
          },
        } : {}),
      })),
      items: session.items.map((item) => remapItem(item, items, turns, conversations)),
    })),
    documents: source.documents.map((doc) => ({
      ...doc,
      id: required(documents, doc.id),
      workflowId,
    })),
  };
  return validateWorkspaceSnapshot(snapshotSchema.parse(clone));
}

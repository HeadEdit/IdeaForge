import { createStore, type StoreApi } from 'zustand/vanilla';

import type {
  AiSettings,
  CandidateCard,
  CardScore,
  ChatSession,
  NodeKind,
  NodeOutput,
  NodeRun,
  ReferenceDocument,
  Viewport,
  Workflow,
  WorkflowEdge,
  WorkflowNode,
} from '../domain/model';
import { createDefaultWorkflow } from '../domain/default-workflow';
import type { NodeDefinition, PortDirection } from '../domain/node-definitions';
import { resolveNodeInput } from '../domain/workflow-io';
import { syncIdeaScoreReportTitlesInWorkflow } from '../domain/idea-score-report';
import { removeCardFromPoolWorkflow, applyCardVote, applyCardPatch, dropOrphanedCardReferences } from '../domain/card-pool-ops';
import { requireCardVariableSource } from '../domain/require-card-variable-source';
import { applyDerivedNodeOutputs } from '../nodes/apply-derived-outputs';
import { builtinNodePlatform } from '../nodes/builtins';
import { NO_CHAT_SKILL } from '../domain/chat-turns';
import { ensureChatSessionShape } from '../domain/chat-session-migrate';
import {
  activeConversationMessages,
  openingContextTurnOffset,
  withChatTextStructOutputs,
} from '../domain/chat-conversations';
import { chatOperationKey, type ChatActivity, type ExecutionProgress } from '../domain/execution-progress';
import { createChatAgentLibrary } from '../nodes/chat/agent-library';
import type { ChatSendOptions, ConfigPatchOptions, ConfigPatchResult, NodeHostCapabilities } from '../nodes/types';
import { createNodeHostCapabilities } from './create-node-host-capabilities';
import { isRecord } from '../schema/common';
import { canonicalizeNodeOutput, nodeOutputsEqual } from '../domain/node-output';
import {
  markDescendantsStale,
  deletionImpact,
  dropCardsOutsideVariablePools,
  dropRetiredContentExtractOutputEdges,
  migrateLegacyCardVariableGraph,
  stripRetiredCardBrowserNodes,
  rewriteRetiredChatSelectionEdges,
  validateConnection,
  type ConnectionValidation,
} from '../domain/graph';
import type { WorkspaceRepository, WorkspaceSnapshot } from '../db/repository';
import { AiClientError, type AiClient } from '../ai/client';
import { generateStructuredPlanDependencyGraph } from '../execution/run-structured-plan-graph';
import { getNodeExecution as productionGetNodeExecution } from '../execution/runners';
import { getSkill } from '../skills';
import { structuredPlanConfigSchema } from '../nodes/structured-plan/config';
import { runStandardNode } from '../execution/run-standard-node';
import { createControlFlowCoordinator, type ControlFlowCoordinator } from '../execution/control-flow-coordinator';
import type { NodeExecutionRegistration } from '../execution/runner-types';
import type { RunChatInput, RunChatResult } from '../execution/run-chat';
import { createAutosaveScheduler } from './autosave';
import {
  WorkspaceTransferError,
  cloneWorkspaceForImport,
  createWorkspaceExport,
  parseWorkspaceExport,
  type WorkspaceExportFileV1,
} from './workspace-transfer';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'failed';
export interface NavigationError {
  kind: 'storage' | 'not-found';
  retryable: true;
}

export type AiConnectionCheckId = 'model' | 'tavily' | 'vane';
export interface AiConnectionCheck {
  id: AiConnectionCheckId;
  status: 'passed' | 'failed' | 'skipped';
  message: string;
}
export interface AiConnectionReport {
  checks: AiConnectionCheck[];
  ok: boolean;
}

export interface AppStoreDependencies {
  repository: WorkspaceRepository;
  id: () => string;
  now: () => string;
  createAbortController: () => AbortController;
  isExecutionAvailable(): boolean;
  configureAiSettings?: (settings: AiSettings) => void;
  getAiClient?: () => AiClient | undefined;
  getNodeExecution?: (kind: NodeKind) => NodeExecutionRegistration | undefined;
  getNodeDefinition?: (kind: string) => NodeDefinition | undefined;
  runChat?: (input: RunChatInput) => Promise<RunChatResult>;
  fetch?: typeof fetch;
}

export interface AppState {
  chatActivities: Record<string, ChatActivity>;
  nodeProgress: Record<string, ExecutionProgress>;
  workflow?: Workflow;
  workflows: Workflow[];
  runs: NodeRun[];
  cards: CandidateCard[];
  sessions: ChatSession[];
  documents: ReferenceDocument[];
  saveStatus: SaveStatus;
  navigationError?: NavigationError;
  runtimeError?: NavigationError;
  settings: AiSettings;
  initialized: boolean;
  isExecutionAvailable(): boolean;
  initialize(): Promise<void>;
  loadSettings(): Promise<AiSettings | undefined>;
  saveSettings(settings: AiSettings): Promise<void>;
  clearApiKey(): Promise<void>;
  testAiConnection(settings: AiSettings): Promise<AiConnectionReport>;
  createWorkflow(name?: string): Promise<string>;
  deleteWorkflow(id?: string): Promise<void>;
  renameWorkflow(id: string, name: string): Promise<void>;
  deleteNode(nodeId: string): Promise<void>;
  openWorkflow(id: string): Promise<void>;
  addNode(kind: NodeKind, position: { x: number; y: number }): void;
  connect(edge: WorkflowEdge): ConnectionValidation;
  disconnect(edgeId: string): void;
  disconnectPort(nodeId: string, portId: string, direction: PortDirection): void;
  moveNode(nodeId: string, position: { x: number; y: number }): void;
  moveNodes(updates: ReadonlyArray<{ id: string; position: { x: number; y: number } }>): void;
  setViewport(viewport: Viewport): void;
  validateNodeConfigPatch(nodeId: string, patch: unknown): ConfigPatchResult;
  patchNodeConfig(nodeId: string, patch: unknown, options?: ConfigPatchOptions): ConfigPatchResult;
  commitNodeConfigAndOutput(nodeId: string, config: unknown, output?: NodeOutput): ConfigPatchResult;
  publishNodeConfigAndOutput(nodeId: string, config: unknown, output: NodeOutput): ConfigPatchResult;
  reorderBoundCollection(
    consumerNodeId: string,
    inputPortId: string,
    cardIds: readonly string[],
  ): void;
  rerunNode(nodeId: string): Promise<void>;
  regenerateStructuredPlanGraph(
    nodeId: string,
    version: 'current' | 'candidate',
  ): Promise<{ ok: true } | { ok: false; errorKind: string }>;
  runControlChain(selectedNodeId?: string): Promise<void>;
  stopNode(nodeId: string): void;
  getHostCapabilities(): NodeHostCapabilities;
  addDocument(input: { title: string; content: string; format: ReferenceDocument['format']; sourceName?: string }): string;
  updateDocument(id: string, patch: { title?: string; content?: string }): void;
  deleteDocument(id: string): void;
  saveNow(): Promise<void>;
  exportCurrentWorkspace(): Promise<
    | { ok: true; file: WorkspaceExportFileV1 }
    | { ok: false; reason: 'busy' | 'save-failed' | 'missing-workspace' }
  >;
  importWorkspaceExport(value: unknown): Promise<
    | { ok: true; workflowId: string }
    | { ok: false; reason: 'busy' | 'invalid-file' | 'storage' }
  >;
}

export type AppStore = StoreApi<AppState>;

function ensureContainment(workflow: Workflow, id: () => string): Workflow {
  return stripRetiredCardBrowserNodes(migrateLegacyCardVariableGraph(dropRetiredContentExtractOutputEdges(
    rewriteRetiredChatSelectionEdges({
      ...workflow,
      containmentEdges: workflow.containmentEdges ?? [],
    }),
  ), { id }));
}

function migrateLoadedSessions(sessions: readonly ChatSession[]): ChatSession[] {
  return sessions.map((session) => ensureChatSessionShape(session));
}

function migrateLoadedWorkflow(
  workflow: Workflow,
  cards: readonly CandidateCard[],
  sessions: readonly ChatSession[],
  documents: readonly ReferenceDocument[],
  id: () => string,
): { workflow: Workflow; cards: CandidateCard[] } {
  const nextWorkflow = applyDerivedNodeOutputs(
    withChatTextStructOutputs(ensureContainment(workflow, id), sessions),
    cards,
    documents,
  );
  return {
    workflow: nextWorkflow,
    cards: dropCardsOutsideVariablePools(nextWorkflow, cards),
  };
}

function checkMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

async function testTavilyEndpoint(
  requestFetch: typeof fetch,
  apiKey: string,
): Promise<AiConnectionCheck> {
  const key = apiKey.trim();
  if (!key) return { id: 'tavily', status: 'skipped', message: '未配置 API Key' };
  try {
    const response = await requestFetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ query: 'test', search_depth: 'basic', max_results: 1 }),
    });
    if (!response.ok) return { id: 'tavily', status: 'failed', message: `HTTP ${response.status}` };
    const payload = await response.json() as { results?: unknown };
    return Array.isArray(payload.results)
      ? { id: 'tavily', status: 'passed', message: `可用，返回 ${payload.results.length} 条结果` }
      : { id: 'tavily', status: 'failed', message: '返回格式无效' };
  } catch (error) {
    return { id: 'tavily', status: 'failed', message: checkMessage(error, '请求失败') };
  }
}

export function createAppStore(dependencies: AppStoreDependencies): AppStore {
  const revisions = new Map<string, number>();
  let navigationGeneration = 0;
  let workflowActivationGeneration = 0;
  let persistenceGeneration = 0;
  let persistenceTail = Promise.resolve();
  let store!: AppStore;

  const revisionOf = (workflowId: string) => revisions.get(workflowId) ?? 0;
  const bumpRevision = (workflowId: string) => {
    revisions.set(workflowId, revisionOf(workflowId) + 1);
  };

  const currentSnapshot = (): WorkspaceSnapshot | undefined => {
    const state = store.getState();
    if (!state.workflow) {
      return undefined;
    }
    const workflow = {
      ...state.workflow,
      nodes: state.workflow.nodes.map((node) => node.status === 'running'
        ? { ...node, status: 'stale' as const }
        : node),
    };
    return {
      workflow,
      runs: state.runs,
      cards: state.cards,
      sessions: state.sessions,
      documents: state.documents,
    };
  };

  const persistSnapshot = (
    snapshot: WorkspaceSnapshot,
    isCurrent: () => boolean = () => true,
  ): Promise<void> => {
    persistenceGeneration += 1;
    const generation = persistenceGeneration;
    store.setState({ saveStatus: 'saving' });
    const operation = persistenceTail.then(
      () => dependencies.repository.saveWorkspaceSnapshot(snapshot),
      () => dependencies.repository.saveWorkspaceSnapshot(snapshot),
    );
    const tracked = operation.then(
      () => {
        if (generation === persistenceGeneration && isCurrent()) {
          store.setState({ saveStatus: 'saved' });
        }
      },
      (error: unknown) => {
        if (generation === persistenceGeneration && isCurrent()) {
          store.setState({ saveStatus: 'failed' });
        }
        throw error;
      },
    );
    persistenceTail = tracked.catch(() => undefined);
    return tracked;
  };

  const scheduler = createAutosaveScheduler(async () => {
    const snapshot = currentSnapshot();
    if (!snapshot) {
      return;
    }
    await persistSnapshot(snapshot);
  });

  const markDirty = () => scheduler.schedule();

  const beginNavigation = (): number => {
    navigationGeneration += 1;
    return navigationGeneration;
  };

  const ownsNavigation = (generation: number): boolean => generation === navigationGeneration;

  const commitWorkflow = (workflow: Workflow, cards = store.getState().cards, documents = store.getState().documents): Workflow => (
    applyDerivedNodeOutputs({ ...workflow, updatedAt: dependencies.now() }, cards, documents)
  );

  const updateWorkflow = (
    updater: (workflow: Workflow) => Workflow,
  ): void => {
    const current = store.getState().workflow;
    if (!current) {
      return;
    }
    const workflow = commitWorkflow(updater(current));
    store.setState((state) => ({
      workflow,
      workflows: state.workflows.map((item) => item.id === workflow.id ? workflow : item),
    }));
    markDirty();
  };

  const resolveExecution = dependencies.getNodeExecution ?? productionGetNodeExecution;
  const resolveDefinition = dependencies.getNodeDefinition ?? builtinNodePlatform.getDefinition;

  type ActiveOperation = {
    token: symbol;
    controller: AbortController;
    workflowId: string;
    nodeId: string;
    workflowActivationGeneration: number;
  };
  const nodeOps = new Map<string, ActiveOperation>();
  const chatOps = new Map<string, AbortController>();
  let pendingCardReplacement: { removed: readonly string[]; installed: readonly CandidateCard[] } | undefined;
  let controlFlow!: ControlFlowCoordinator;

  const validateNodeConfig = (nodeId: string, config: unknown) => {
    const workflow = store.getState().workflow;
    const node = workflow?.nodes.find((item) => item.id === nodeId);
    if (!workflow || !node) {
      return { ok: false as const, error: 'node-not-found' as const, message: '节点不存在' };
    }
    const plugin = builtinNodePlatform.lookup(node.kind);
    if (!plugin) {
      return { ok: false as const, error: 'plugin-unavailable' as const, message: '节点插件不可用' };
    }
    const parsed = plugin.configSchema.safeParse(config);
    if (!parsed.success) {
      return { ok: false as const, error: 'invalid-config' as const, message: '节点配置无效' };
    }
    return { ok: true as const, plugin, config: parsed.data };
  };

  const validateNodeConfigPatch = (nodeId: string, patch: unknown): ConfigPatchResult => {
    const workflow = store.getState().workflow;
    const node = workflow?.nodes.find((item) => item.id === nodeId);
    if (!workflow || !node) {
      return { ok: false, error: 'node-not-found', message: '节点不存在' };
    }
    const current = isRecord(node.config) ? node.config : {};
    const merged = isRecord(patch) ? { ...current, ...patch } : current;
    const validated = validateNodeConfig(nodeId, merged);
    return validated.ok
      ? { ok: true, config: validated.config }
      : validated;
  };

  const sessionRuntime: { runChat(input: RunChatInput): Promise<RunChatResult>; id(): string; now(): string } = {
    runChat: dependencies.runChat ? (input) => {
      const activation = workflowActivationGeneration;
      return dependencies.runChat!({
        ...input,
        agentLibrary: input.agentMode ? createChatAgentLibrary(input,
          () => store.getState().workflow,
          () => activation === workflowActivationGeneration,
          {
            list: () => store.getState().documents,
            add: (value) => store.getState().addDocument(value),
            update: (id, patch) => store.getState().updateDocument(id, patch),
            delete: (id) => store.getState().deleteDocument(id),
          }) : undefined,
      });
    } : (async () => ({
      status: 'failed',
      startedAt: dependencies.now(),
      finishedAt: dependencies.now(),
      errorKind: 'invalid-response',
    })),
    id: dependencies.id,
    now: dependencies.now,
  };
  const sessionScopes = new Map([...builtinNodePlatform.plugins].map(([kind, plugin]) => [
    kind, plugin.effects?.createSessionScope?.(sessionRuntime) ?? plugin.effects,
  ]));

  const toggleCardVote = (cardId: string, vote: 'up' | 'down'): void => {
    store.setState((state) => ({
      cards: applyCardVote(state.cards, cardId, vote),
    }));
    const current = store.getState().workflow;
    if (current) {
      const workflow = applyDerivedNodeOutputs(
        { ...current, updatedAt: dependencies.now() },
        store.getState().cards,
        store.getState().documents,
      );
      store.setState((state) => ({
        workflow,
        workflows: state.workflows.map((item) => item.id === workflow.id ? workflow : item),
      }));
    }
    markDirty();
  };

  const updateCandidateCard = (
    cardId: string,
    patch: Partial<Pick<CandidateCard, 'title' | 'concept' | 'content' | 'tags' | 'review'>>,
  ): void => {
    store.setState((state) => ({
      cards: applyCardPatch(state.cards, cardId, patch),
    }));
    const current = store.getState().workflow;
    if (current) {
      const now = dependencies.now();
      let workflow = applyDerivedNodeOutputs(
        { ...current, updatedAt: now },
        store.getState().cards,
        store.getState().documents,
      );
      if (typeof patch.title === 'string') {
        workflow = syncIdeaScoreReportTitlesInWorkflow(workflow, cardId, patch.title);
      }
      store.setState((state) => ({
        workflow,
        workflows: state.workflows.map((item) => item.id === workflow.id ? workflow : item),
      }));
    }
    markDirty();
  };

  const deleteCandidateCard = (variableNodeId: string, cardId: string): void => {
    const current = store.getState().workflow;
    if (!current) return;
    const variable = current.nodes.find((item) => item.id === variableNodeId);
    if (!variable || variable.kind !== 'cardVariable') return;
    if (variable.output?.type !== 'CardCollection') return;
    if (!variable.output.cardIds.includes(cardId)) return;

    const now = dependencies.now();
    let workflow = removeCardFromPoolWorkflow(current, variableNodeId, cardId);
    workflow = { ...workflow, updatedAt: now };

    const { cards: nextCards, sessions: nextSessions } = dropOrphanedCardReferences(
      workflow,
      store.getState().cards,
      store.getState().sessions,
      cardId,
    );

    workflow = applyDerivedNodeOutputs(workflow, nextCards, store.getState().documents);
    store.setState((state) => ({
      workflow,
      workflows: state.workflows.map((item) => item.id === workflow.id ? workflow : item),
      cards: nextCards,
      sessions: nextSessions,
    }));
    markDirty();
  };

  const applyCardScores = (updates: { cardId: string; score: CardScore }[]): void => {
    const byId = new Map(updates.map((item) => [item.cardId, item.score]));
    store.setState((state) => ({
      cards: state.cards.map((card) => {
        const score = byId.get(card.id);
        return score ? { ...card, score } : card;
      }),
    }));
    markDirty();
  };

  const startChat = async (nodeId: string, text: string, options?: ChatSendOptions): Promise<void> => {
    const node = store.getState().workflow?.nodes.find((item) => item.id === nodeId);
    const session = node ? sessionScopes.get(node.kind)?.session : undefined;
    if (!session) return;
    await session.send(nodeId, text, hostCapabilities(), options);
  };

  const stopChat = (nodeId: string): void => {
    const node = store.getState().workflow?.nodes.find((item) => item.id === nodeId);
    sessionScopes.get(node?.kind ?? '')?.session?.stop(nodeId, hostCapabilities());
  };

  const setChatSkill = (nodeId: string, skillId: string): void => {
    const nextSkillId = skillId === NO_CHAT_SKILL ? '' : skillId;
    store.getState().patchNodeConfig(nodeId, { skillId: nextSkillId });
  };

  const removeChatTurns = (nodeId: string, turnIndexes: readonly number[]): void => {
    const node = store.getState().workflow?.nodes.find((item) => item.id === nodeId);
    sessionScopes.get(node?.kind ?? '')?.session?.removeTurns(
      nodeId,
      turnIndexes,
      hostCapabilities(),
    );
  };

  const editChatLastMessage = async (nodeId: string, turnIndex: number, text: string, options?: ChatSendOptions): Promise<void> => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const workflow = store.getState().workflow;
    const session = store.getState().sessions.find((item) => (
      item.workflowId === workflow?.id && item.nodeId === nodeId
    ));
    if (!session) return;
    if (chatOps.has(chatOperationKey(nodeId, session.activeConversationId))) return;
    const offset = openingContextTurnOffset(activeConversationMessages(session));
    removeChatTurns(nodeId, [turnIndex + offset]);
    await startChat(nodeId, trimmed, options);
  };

  const hostCapabilities = (): NodeHostCapabilities => createNodeHostCapabilities({
    getChatActivities: () => store.getState().chatActivities,
    setChatActivity: (key, activity) => store.setState((state) => {
      const chatActivities = { ...state.chatActivities };
      if (activity) chatActivities[key] = activity;
      else delete chatActivities[key];
      return { chatActivities };
    }),
    getWorkflow: () => store.getState().workflow,
    getCards: () => store.getState().cards,
    getRuns: () => store.getState().runs,
    getSessions: () => store.getState().sessions,
    setSessions: (sessions) => store.setState({ sessions }),
    validateConfigPatch: (nodeId, patch) => store.getState().validateNodeConfigPatch(nodeId, patch),
    patchConfig: (nodeId, patch, options) => store.getState().patchNodeConfig(nodeId, patch, options),
    updateWorkflow,
    rerunNode: (nodeId) => store.getState().rerunNode(nodeId),
    stopNode: (nodeId) => store.getState().stopNode(nodeId),
    toggleVote: (cardId, vote) => toggleCardVote(cardId, vote),
    updateCard: (cardId, patch) => updateCandidateCard(cardId, patch),
    deleteCard: (variableNodeId, cardId) => deleteCandidateCard(variableNodeId, cardId),
    applyScores: (updates) => applyCardScores(updates),
    sendChat: (nodeId, text, options) => startChat(nodeId, text, options),
    stopChat: (nodeId) => stopChat(nodeId),
    setChatSkill: (nodeId, skillId) => setChatSkill(nodeId, skillId),
    editChatLastMessage: (nodeId, turnIndex, text, options) => editChatLastMessage(nodeId, turnIndex, text, options),
    isExecutionAvailable: () => dependencies.isExecutionAvailable(),
    getAiClient: () => dependencies.getAiClient?.(),
    createAbortController: () => dependencies.createAbortController(),
    id: dependencies.id,
    now: dependencies.now,
    markDirty,
    chatOps,
    setPendingCardReplacement: (value) => {
      pendingCardReplacement = value;
    },
  });

  const startNodeOp = (workflowId: string, nodeId: string): ActiveOperation => {
    nodeOps.get(nodeId)?.controller.abort();
    const operation: ActiveOperation = {
      token: Symbol('op'),
      controller: dependencies.createAbortController(),
      workflowId,
      nodeId,
      workflowActivationGeneration,
    };
    nodeOps.set(nodeId, operation);
    return operation;
  };

  const isOwned = (operation: ActiveOperation): boolean => (
    nodeOps.get(operation.nodeId) === operation
    && store.getState().workflow?.id === operation.workflowId
    && operation.workflowActivationGeneration === workflowActivationGeneration
  );

  const reportNodeProgress = (operation: ActiveOperation, progress: ExecutionProgress) => {
    if (!isOwned(operation) || operation.controller.signal.aborted) return;
    store.setState((state) => ({ nodeProgress: { ...state.nodeProgress, [operation.nodeId]: progress } }));
  };
  const clearNodeProgress = (nodeId: string) => store.setState((state) => {
    const nodeProgress = { ...state.nodeProgress }; delete nodeProgress[nodeId]; return { nodeProgress };
  });

  const regenerateStructuredPlanGraph = async (
    nodeId: string,
    version: 'current' | 'candidate',
  ): Promise<{ ok: true } | { ok: false; errorKind: string }> => {
    const workflow = store.getState().workflow;
    const node = workflow?.nodes.find((item) => item.id === nodeId);
    if (!workflow || !node || node.kind !== 'structuredPlan') {
      return { ok: false, errorKind: 'invalid-input' };
    }

    const parsed = structuredPlanConfigSchema.safeParse(node.config);
    if (!parsed.success) {
      return { ok: false, errorKind: 'invalid-input' };
    }

    const modules = version === 'current' ? parsed.data.modules : parsed.data.candidateModules;
    if (!modules) {
      return { ok: false, errorKind: 'invalid-input' };
    }

    const client = dependencies.getAiClient?.();
    if (!client) {
      return { ok: false, errorKind: 'missing-client' };
    }

    const skill = getSkill('system-designer');
    if (!skill) {
      return { ok: false, errorKind: 'invalid-input' };
    }

    const operation = startNodeOp(workflow.id, nodeId);
    const capturedModules = [...modules];
    const capturedSignature = JSON.stringify(capturedModules);
    const graphKey = version === 'current' ? 'dependencyGraph' : 'candidateDependencyGraph';

    try {
      const { graph } = await generateStructuredPlanDependencyGraph({
        client,
        skill,
        modules: capturedModules,
        signal: operation.controller.signal,
        now: dependencies.now,
      });

      if (!isOwned(operation)) {
        return { ok: false, errorKind: 'stopped' };
      }

      const liveNode = store.getState().workflow?.nodes.find((item) => item.id === nodeId);
      const liveParsed = liveNode
        ? structuredPlanConfigSchema.safeParse(liveNode.config)
        : undefined;
      const liveModules = liveParsed?.success
        ? (version === 'current' ? liveParsed.data.modules : liveParsed.data.candidateModules)
        : undefined;
      if (
        !liveNode
        || liveNode.kind !== 'structuredPlan'
        || !liveModules
        || JSON.stringify(liveModules) !== capturedSignature
      ) {
        return { ok: false, errorKind: 'invalid-input' };
      }

      if (!isOwned(operation)) {
        return { ok: false, errorKind: 'stopped' };
      }

      const patched = store.getState().patchNodeConfig(
        nodeId,
        { [graphKey]: graph },
        { invalidateDescendants: false },
      );
      return patched.ok ? { ok: true } : { ok: false, errorKind: 'invalid-config' };
    } catch (error) {
      if (!isOwned(operation) || operation.controller.signal.aborted) {
        return { ok: false, errorKind: 'stopped' };
      }
      return {
        ok: false,
        errorKind: error instanceof AiClientError ? error.kind : 'invalid-response',
      };
    } finally {
      if (nodeOps.get(nodeId) === operation) {
        nodeOps.delete(nodeId);
      }
    }
  };

  const emptyMetrics = () => ({
    requested: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    failedBatchIndexes: [] as number[],
  });

  const appendRun = (
    workflow: Workflow,
    nodeId: string,
    status: NodeRun['status'],
    startedAt: string,
    metrics = emptyMetrics(),
    errorKind?: string,
  ): NodeRun => ({
    id: dependencies.id(),
    workflowId: workflow.id,
    nodeId,
    status,
    requested: metrics.requested,
    succeeded: metrics.succeeded,
    failed: metrics.failed,
    skipped: metrics.skipped,
    failedBatchIndexes: metrics.failedBatchIndexes ?? [],
    startedAt,
    finishedAt: dependencies.now(),
    ...(errorKind ? { errorKind } : {}),
  });

  const runStandardExecutable = async (
    workflow: Workflow,
    node: WorkflowNode,
    registration: NodeExecutionRegistration,
  ): Promise<void> => {
    if (registration.runner.requiresAi && !dependencies.isExecutionAvailable()) {
      const run = appendRun(workflow, node.id, 'failed', dependencies.now(), emptyMetrics(), 'invalid-response');
      store.setState((current) => {
        if (current.workflow?.id !== workflow.id) return current;
        const nextWorkflow = {
          ...current.workflow,
          updatedAt: run.finishedAt!,
          nodes: current.workflow.nodes.map((item) => item.id === node.id
            ? { ...item, status: 'failed' as const }
            : item),
        };
        return {
          workflow: nextWorkflow,
          workflows: current.workflows.map((item) => item.id === workflow.id ? nextWorkflow : item),
          runs: [...current.runs, run],
        };
      });
      markDirty();
      return;
    }

    const operation = startNodeOp(workflow.id, node.id);
    const startedAt = dependencies.now();
    updateWorkflow((current) => {
      const running = {
        ...current,
        nodes: current.nodes.map((item) => item.id === node.id
          ? { ...item, status: 'running' as const }
          : item),
      };
      return registration.descendantInvalidation === 'on-run-start'
        ? markDescendantsStale(running, node.id)
        : running;
    });

    try {
      const latest = store.getState();
      const liveNode = latest.workflow?.nodes.find((item) => item.id === node.id);
      if (!latest.workflow || !liveNode) {
        return;
      }
      const result = await runStandardNode({
        workflow: latest.workflow,
        node: liveNode,
        cards: latest.cards,
        signal: operation.controller.signal,
        runner: registration.runner,
        reportProgress: (progress) => reportNodeProgress(operation, progress),
        runtime: {
          getAiClient: () => dependencies.getAiClient?.(),
          id: dependencies.id,
          now: dependencies.now,
        },
      }, {
        getNodeDefinition: resolveDefinition,
        resolveNodeInput,
      });
      if (!isOwned(operation)) {
        return;
      }
      const current = store.getState();
      if (!current.workflow || current.workflow.id !== workflow.id) {
        return;
      }

      if (result.ok) {
        const replacesOutput = (result.outputDisposition ?? 'replace') === 'replace';
        let cardReplacement: { removed: readonly string[]; installed: readonly CandidateCard[] } | undefined;
        const plugin = builtinNodePlatform.lookup(node.kind);
        const parsed = plugin?.configSchema.safeParse(node.config);
        const capabilities = hostCapabilities();
        let configPatchConsumed = false;
        let effectResult: ConfigPatchResult | void = undefined;
        pendingCardReplacement = undefined;
        if (plugin?.effects?.executionEffects && parsed?.success) {
          effectResult = plugin.effects.executionEffects({
            nodeId: node.id,
            node,
            config: parsed.data,
            output: result.output,
            producedCards: result.producedCards,
            consumeConfigPatch: () => {
              if (result.configPatch === undefined) return undefined;
              if (configPatchConsumed) return undefined;
              configPatchConsumed = true;
              return result.configPatch;
            },
            capabilities,
          });
          cardReplacement = pendingCardReplacement;
          pendingCardReplacement = undefined;
        }
        const rejectedPatch = effectResult?.ok === false
          || (configPatchConsumed && effectResult?.ok !== true);
        const unconsumedPatch = result.configPatch !== undefined && !configPatchConsumed;
        if (rejectedPatch || unconsumedPatch) {
          pendingCardReplacement = undefined;
          const failedRun = appendRun(
            workflow,
            node.id,
            'failed',
            startedAt,
            result.metrics,
            'invalid-config',
          );
          const failedWorkflow = {
            ...current.workflow,
            updatedAt: failedRun.finishedAt!,
            nodes: current.workflow.nodes.map((item) => item.id === node.id
              ? { ...item, status: 'failed' as const }
              : item),
          };
          store.setState({
            workflow: failedWorkflow,
            workflows: current.workflows.map((item) => item.id === workflow.id ? failedWorkflow : item),
            runs: [...current.runs, failedRun],
            cards: current.cards,
          });
          markDirty();
          return;
        }
        const run = appendRun(workflow, node.id, 'succeeded', startedAt, result.metrics);
        const afterEffects = store.getState();
        const workflowAfterEffects = afterEffects.workflow ?? current.workflow;
        const removed = new Set(cardReplacement?.removed ?? []);
        const installed = [...(cardReplacement?.installed ?? [])];
        const nextCards = [
          ...afterEffects.cards.filter((card) => !removed.has(card.id)),
          ...installed,
        ];
        let nextWorkflow = applyDerivedNodeOutputs({
          ...workflowAfterEffects,
          updatedAt: run.finishedAt!,
          nodes: workflowAfterEffects.nodes.map((item) => item.id === node.id
            ? {
                ...item,
                status: 'succeeded' as const,
                currentRunId: run.id,
                ...(configPatchConsumed && effectResult?.ok
                  ? { config: effectResult.config }
                  : {}),
                ...(replacesOutput ? { output: result.output } : {}),
              } as WorkflowNode
            : item),
        }, nextCards, afterEffects.documents);
        if (registration.descendantInvalidation === 'on-output-commit' && replacesOutput) {
          nextWorkflow = markDescendantsStale(nextWorkflow, node.id);
        }
        store.setState({
          workflow: nextWorkflow,
          workflows: afterEffects.workflows.map((item) => item.id === workflow.id ? nextWorkflow : item),
          runs: [...afterEffects.runs, run],
          cards: nextCards,
        });
        markDirty();
        return;
      }

      const stopped = result.errorKind === 'stopped' || operation.controller.signal.aborted;
      const run = appendRun(
        workflow,
        node.id,
        stopped ? 'stopped' : 'failed',
        startedAt,
        result.metrics ?? emptyMetrics(),
        stopped ? undefined : result.errorKind,
      );
      const nextWorkflow = {
        ...current.workflow,
        updatedAt: run.finishedAt!,
        nodes: current.workflow.nodes.map((item) => item.id === node.id
          ? { ...item, status: run.status }
          : item),
      };
      store.setState({
        workflow: nextWorkflow,
        workflows: current.workflows.map((item) => item.id === workflow.id ? nextWorkflow : item),
        runs: [...current.runs, run],
      });
      markDirty();
    } finally {
      if (nodeOps.get(node.id) === operation) {
        nodeOps.delete(node.id);
        clearNodeProgress(node.id);
      }
    }
  };

  store = createStore<AppState>((set, get) => ({
    chatActivities: {},
    nodeProgress: {},
    workflows: [],
    runs: [],
    cards: [],
    sessions: [],
    documents: [],
    saveStatus: 'idle',
    initialized: false,
    settings: { baseUrl: '', apiKey: '', tavilyApiKey: '', searchProvider: 'vane', model: '', thinkingEnabled: false },

    isExecutionAvailable() {
      return dependencies.isExecutionAvailable();
    },

    async loadSettings() {
      try {
        const loaded = await dependencies.repository.loadSettings();
        if (loaded) {
          dependencies.configureAiSettings?.(loaded);
          set({ settings: loaded, runtimeError: undefined });
        } else {
          set({ runtimeError: undefined });
        }
        return loaded;
      } catch {
        set({ runtimeError: { kind: 'storage', retryable: true } });
        return undefined;
      }
    },

    async saveSettings(settings) {
      try {
        await dependencies.repository.saveSettings(settings);
        dependencies.configureAiSettings?.(settings);
        set({ settings, runtimeError: undefined });
      } catch {
        set({ runtimeError: { kind: 'storage', retryable: true } });
        throw new Error('settings-save-failed');
      }
    },

    async clearApiKey() {
      try {
        await dependencies.repository.clearApiKey();
        const settings = { ...get().settings, apiKey: '' };
        dependencies.configureAiSettings?.(settings);
        set({ settings, runtimeError: undefined });
      } catch {
        set({ runtimeError: { kind: 'storage', retryable: true } });
        throw new Error('settings-clear-failed');
      }
    },

    async testAiConnection(settings) {
      dependencies.configureAiSettings?.(settings);
      const client = dependencies.getAiClient?.();
      const requestFetch = dependencies.fetch ?? fetch;
      const checks: AiConnectionCheck[] = [];
      if (!client) {
        checks.push({ id: 'model', status: 'failed', message: '模型配置不完整' });
      } else {
        try {
          await client.complete([{ role: 'user', content: '请仅回复：连接成功' }]);
          checks.push({ id: 'model', status: 'passed', message: '可用' });
        } catch (error) {
          checks.push({ id: 'model', status: 'failed', message: checkMessage(error, '请求失败') });
        }
      }
      if (settings.searchProvider === 'vane') {
        try {
          const base = (settings.searchGatewayUrl?.trim() || '/api/search').replace(/\/+$/, '');
          const response = await requestFetch(`${base}/health`, { signal: AbortSignal.timeout(10_000),
            headers: settings.searchGatewayToken?.trim() ? { Authorization: `Bearer ${settings.searchGatewayToken.trim()}` } : {} });
          const health = await response.json();
          checks.push({ id: 'vane', status: response.ok && health.ok === true ? 'passed' : 'failed',
            message: response.ok && health.ok === true ? '服务已启动、规划模型已配置（未执行付费检索）' : '服务未就绪，请检查地址、访问令牌和后端模型配置' });
        } catch { checks.push({ id: 'vane', status: 'failed', message: '无法连接搜索服务' }); }
      } else if (settings.searchProvider === 'tavily') {
        checks.push(await testTavilyEndpoint(requestFetch, settings.tavilyApiKey));
      }
      return { checks, ok: checks.every((check) => check.status !== 'failed') };
    },

    async initialize() {
      const navigation = beginNavigation();
      let workflows: Workflow[];
      try {
        workflows = await dependencies.repository.listWorkflows();
      } catch {
        if (ownsNavigation(navigation)) {
          set({ initialized: true, navigationError: { kind: 'storage', retryable: true } });
        }
        return;
      }
      if (!ownsNavigation(navigation)) {
        return;
      }
      if (workflows.length === 0) {
        const workflow = createDefaultWorkflow(dependencies);
        const empty: WorkspaceSnapshot = { workflow, runs: [], cards: [], sessions: [], documents: [] };
        bumpRevision(workflow.id);
        workflowActivationGeneration += 1;
        set({
          workflow,
          workflows: [workflow],
          runs: [],
          cards: [],
          sessions: [],
          documents: [],
          initialized: true,
          saveStatus: 'saving',
          navigationError: undefined,
        });
        try {
          await persistSnapshot(empty, () => ownsNavigation(navigation));
        } catch {
          if (ownsNavigation(navigation)) {
            markDirty();
          }
        }
        return;
      }
      let loaded: WorkspaceSnapshot | undefined;
      try {
        loaded = await dependencies.repository.loadWorkspaceSnapshot(workflows[0].id);
      } catch {
        if (ownsNavigation(navigation)) {
          set({ workflows, initialized: true, navigationError: { kind: 'storage', retryable: true } });
        }
        return;
      }
      if (!ownsNavigation(navigation)) {
        return;
      }
      if (loaded) {
        bumpRevision(loaded.workflow.id);
        const sessions = migrateLoadedSessions(loaded.sessions);
        const { workflow, cards } = migrateLoadedWorkflow(
          loaded.workflow,
          loaded.cards,
          sessions,
          loaded.documents,
          dependencies.id,
        );
        workflowActivationGeneration += 1;
        set({
          ...loaded,
          workflow,
          cards,
          sessions,
          workflows: workflows.map((item) => item.id === workflow.id ? workflow : item),
          initialized: true,
          saveStatus: 'idle',
          navigationError: undefined,
        });
      } else {
        set({ workflows, initialized: true, navigationError: { kind: 'not-found', retryable: true } });
      }
    },

    async createWorkflow(name) {
      const navigation = beginNavigation();
      await get().saveNow();
      if (!ownsNavigation(navigation) || get().saveStatus === 'failed') {
        return get().workflow?.id ?? '';
      }
      let workflow = createDefaultWorkflow(dependencies);
      if (name?.trim()) {
        workflow = { ...workflow, name: name.trim() };
      }
      const empty: WorkspaceSnapshot = { workflow, runs: [], cards: [], sessions: [], documents: [] };
      bumpRevision(workflow.id);
      workflowActivationGeneration += 1;
      set({
        workflow,
        workflows: [...get().workflows, workflow],
        runs: [],
        cards: [],
        sessions: [],
        documents: [],
        navigationError: undefined,
        saveStatus: 'saving',
      });
      try {
        await persistSnapshot(empty, () => ownsNavigation(navigation));
      } catch { /* persistence status already set */ }
      return workflow.id;
    },

    async deleteWorkflow(id) {
      const targetId = id ?? get().workflow?.id;
      if (!targetId) return;
      bumpRevision(targetId);
      try {
        await dependencies.repository.deleteWorkflow(targetId);
      } catch {
        set({ saveStatus: 'failed' });
        return;
      }
      const remaining = get().workflows.filter((item) => item.id !== targetId);
      if (get().workflow?.id !== targetId) {
        set({ workflows: remaining });
        return;
      }
      const next = remaining[0];
      if (!next) {
        const fresh = createDefaultWorkflow(dependencies);
        bumpRevision(fresh.id);
        const empty: WorkspaceSnapshot = { workflow: fresh, runs: [], cards: [], sessions: [], documents: [] };
        workflowActivationGeneration += 1;
        set({
          workflow: fresh,
          workflows: [fresh],
          runs: [],
          cards: [],
          sessions: [],
          documents: [],
          navigationError: undefined,
          saveStatus: 'saving',
        });
        try { await persistSnapshot(empty); } catch { /* status is already failed */ }
      } else {
        await get().openWorkflow(next.id);
      }
    },

    async renameWorkflow(id, name) {
      const trimmed = name.trim();
      if (!trimmed) {
        return;
      }
      const current = get().workflow;
      if (current?.id === id) {
        if (current.name === trimmed) {
          return;
        }
        updateWorkflow((workflow) => ({ ...workflow, name: trimmed }));
        await get().saveNow();
        return;
      }
      try {
        const loaded = await dependencies.repository.loadWorkspaceSnapshot(id);
        if (!loaded) {
          return;
        }
        const workflow = { ...loaded.workflow, name: trimmed, updatedAt: dependencies.now() };
        await dependencies.repository.saveWorkspaceSnapshot({ ...loaded, workflow });
        set({
          workflows: get().workflows.map((item) => item.id === id ? { ...item, name: trimmed, updatedAt: workflow.updatedAt } : item),
        });
      } catch {
        set({ saveStatus: 'failed' });
      }
    },

    async deleteNode(nodeId) {
      const current = get().workflow;
      if (!current || !current.nodes.some((node) => node.id === nodeId)) return;
      const impact = deletionImpact(current, nodeId);
      const removed = new Set(impact.nodeIds);
      bumpRevision(current.id);
      const removedCardIds = new Set(
        hostCapabilities().cards.collectOrphanedCardIds(impact.nodeIds),
      );
      const nextWorkflow = {
        ...current,
        updatedAt: dependencies.now(),
        nodes: current.nodes.filter((node) => !removed.has(node.id)),
        edges: current.edges.filter((edge) => !impact.edgeIds.includes(edge.id)),
        containmentEdges: current.containmentEdges.filter((edge) => !impact.containmentEdgeIds.includes(edge.id)),
      };
      const nextRuns = get().runs.filter((run) => !removed.has(run.nodeId));
      const nextCards = get().cards.filter((card) => !removedCardIds.has(card.id));
      const nextSessions = get().sessions.filter((session) => (
        !removed.has(session.nodeId)
        && !session.referencedCardIds.some((cardId) => removedCardIds.has(cardId))
      ));
      const nextSnapshot: WorkspaceSnapshot = {
        workflow: nextWorkflow,
        runs: nextRuns,
        cards: nextCards,
        sessions: nextSessions,
        documents: get().documents,
      };
      set((state) => ({
        workflow: nextWorkflow,
        workflows: state.workflows.map((item) => item.id === current.id ? nextWorkflow : item),
        runs: nextRuns,
        cards: nextCards,
        sessions: nextSessions,
      }));
      try {
        await persistSnapshot(nextSnapshot, () => get().workflow?.id === current.id);
      } catch { /* saveStatus is set by persistence */ }
    },

    async openWorkflow(id) {
      const navigation = beginNavigation();
      await get().saveNow();
      if (!ownsNavigation(navigation) || get().saveStatus === 'failed') {
        return;
      }
      if (get().workflow?.id === id) {
        set({ navigationError: undefined });
        return;
      }
      let loaded: WorkspaceSnapshot | undefined;
      try {
        loaded = await dependencies.repository.loadWorkspaceSnapshot(id);
      } catch {
        if (ownsNavigation(navigation)) {
          set({ navigationError: { kind: 'storage', retryable: true } });
        }
        return;
      }
      if (!ownsNavigation(navigation)) {
        return;
      }
      if (loaded) {
        bumpRevision(loaded.workflow.id);
        const sessions = migrateLoadedSessions(loaded.sessions);
        const { workflow, cards } = migrateLoadedWorkflow(
          loaded.workflow,
          loaded.cards,
          sessions,
          loaded.documents,
          dependencies.id,
        );
        workflowActivationGeneration += 1;
        set({
          ...loaded,
          workflow,
          cards,
          sessions,
          workflows: get().workflows.map((item) => item.id === workflow.id ? workflow : item),
          navigationError: undefined,
        });
      } else {
        set({ navigationError: { kind: 'not-found', retryable: true } });
      }
    },

    addNode(kind, position) {
      const config = builtinNodePlatform.cloneDefaultConfig(kind);
      const parsed = builtinNodePlatform.parseConfig(kind, config);
      if (!parsed.ok) {
        return;
      }
      updateWorkflow((workflow) => ({
        ...workflow,
        nodes: [...workflow.nodes, {
          id: dependencies.id(),
          kind,
          position: { ...position },
          config: parsed.config,
          status: 'idle',
        }],
      }));
    },

    connect(edge) {
      const workflow = get().workflow;
      if (!workflow) {
        return { ok: false, reason: 'No active workflow.' };
      }
      const validation = validateConnection(workflow, edge);
      if (!validation.ok) {
        return validation;
      }
      updateWorkflow((current) => {
        const withEdge = { ...current, edges: [...current.edges, { ...edge }] };
        const stale = markDescendantsStale(withEdge, edge.targetNodeId);
        return {
          ...stale,
          nodes: stale.nodes.map((node) => node.id === edge.targetNodeId ? { ...node, status: 'stale' as const } : node),
        };
      });
      return validation;
    },

    disconnect(edgeId) {
      const workflow = get().workflow;
      const edge = workflow?.edges.find((item) => item.id === edgeId);
      if (!edge) {
        return;
      }
      updateWorkflow((current) => {
        const disconnected = { ...current, edges: current.edges.filter((item) => item.id !== edgeId) };
        const stale = markDescendantsStale(disconnected, edge.targetNodeId);
        return {
          ...stale,
          nodes: stale.nodes.map((node) => node.id === edge.targetNodeId ? { ...node, status: 'stale' as const } : node),
        };
      });
    },

    disconnectPort(nodeId, portId, direction) {
      const workflow = get().workflow;
      if (!workflow) {
        return;
      }
      const removed = workflow.edges.filter((edge) => (
        direction === 'input'
          ? edge.targetNodeId === nodeId && edge.targetPortId === portId
          : edge.sourceNodeId === nodeId && edge.sourcePortId === portId
      ));
      if (removed.length === 0) {
        return;
      }
      const removedIds = new Set(removed.map((edge) => edge.id));
      const targets = [...new Set(removed.map((edge) => edge.targetNodeId))];
      updateWorkflow((current) => {
        let next = { ...current, edges: current.edges.filter((edge) => !removedIds.has(edge.id)) };
        for (const targetId of targets) {
          next = markDescendantsStale(next, targetId);
          next = {
            ...next,
            nodes: next.nodes.map((node) => node.id === targetId ? { ...node, status: 'stale' as const } : node),
          };
        }
        return next;
      });
    },

    moveNodes(updates) {
      if (updates.length === 0) {
        return;
      }
      const positions = new Map(updates.map((item) => [item.id, item.position]));
      updateWorkflow((workflow) => ({
        ...workflow,
        nodes: workflow.nodes.map((node) => {
          const position = positions.get(node.id);
          return position ? { ...node, position: { ...position } } : node;
        }),
      }));
    },

    moveNode(nodeId, position) {
      store.getState().moveNodes([{ id: nodeId, position }]);
    },

    setViewport(viewport) {
      updateWorkflow((workflow) => ({ ...workflow, viewport: { ...viewport } }));
    },

    validateNodeConfigPatch(nodeId, patch) {
      return validateNodeConfigPatch(nodeId, patch);
    },

    patchNodeConfig(nodeId, patch, options) {
      const validated = validateNodeConfigPatch(nodeId, patch);
      if (!validated.ok) return validated;
      updateWorkflow((currentWorkflow) => {
        if (options?.invalidateDescendants === false) {
          return {
            ...currentWorkflow,
            nodes: currentWorkflow.nodes.map((item) => item.id === nodeId
              ? { ...item, config: validated.config }
              : item),
          };
        }
        const stale = markDescendantsStale(currentWorkflow, nodeId);
        return {
          ...stale,
          nodes: stale.nodes.map((item) => item.id === nodeId
            ? { ...item, config: validated.config, status: 'stale' as const }
            : item),
        };
      });
      return validated;
    },

    commitNodeConfigAndOutput(nodeId, config, output) {
      const validated = validateNodeConfig(nodeId, config);
      if (!validated.ok) return validated;
      updateWorkflow((currentWorkflow) => ({
        ...currentWorkflow,
        nodes: currentWorkflow.nodes.map((item) => item.id === nodeId
          ? { ...item, config: validated.config, ...(output !== undefined ? { output } : {}) }
          : item),
      }));
      return { ok: true, config: validated.config };
    },

    publishNodeConfigAndOutput(nodeId, config, output) {
      const validated = validateNodeConfig(nodeId, config);
      if (!validated.ok) return validated;
      const requestedOutput = canonicalizeNodeOutput(validated.plugin.definition, output);
      if (!requestedOutput) {
        return { ok: false, error: 'invalid-output', message: '节点输出无效' };
      }
      let canonicalOutput = requestedOutput;
      if (validated.plugin.publication) {
        let derivedOutput: NodeOutput | undefined;
        try {
          derivedOutput = canonicalizeNodeOutput(
            validated.plugin.definition,
            validated.plugin.publication.deriveOutput(validated.config),
          );
        } catch {
          derivedOutput = undefined;
        }
        if (!derivedOutput || !nodeOutputsEqual(requestedOutput, derivedOutput)) {
          return { ok: false, error: 'invalid-output', message: '节点输出与配置不一致' };
        }
        canonicalOutput = derivedOutput;
      }
      const operation = nodeOps.get(nodeId);
      nodeOps.delete(nodeId);
      operation?.controller.abort();
      clearNodeProgress(nodeId);
      updateWorkflow((currentWorkflow) => markDescendantsStale({
        ...currentWorkflow,
        nodes: currentWorkflow.nodes.map((item) => item.id === nodeId
          ? { ...item, config: validated.config, output: canonicalOutput, status: 'succeeded' as const }
          : item),
      }, nodeId));
      return { ok: true, config: validated.config };
    },

    reorderBoundCollection(consumerNodeId, inputPortId, cardIds) {
      hostCapabilities().cards.reorderBoundCollection(consumerNodeId, inputPortId, cardIds);
    },

    async rerunNode(nodeId) {
      const workflow = get().workflow;
      const node = workflow?.nodes.find((item) => item.id === nodeId);
      if (!workflow || !node) {
        return;
      }
      if (builtinNodePlatform.inspectNode(node.kind, node.config).status !== 'available') {
        return;
      }
      const registration = resolveExecution(node.kind);
      if (!registration || registration.mode !== 'standard') {
        return;
      }
      await runStandardExecutable(workflow, node, registration);
    },

    regenerateStructuredPlanGraph,

    async runControlChain(selectedNodeId) {
      await controlFlow.run(selectedNodeId);
    },

    stopNode(nodeId) {
      const capabilities = hostCapabilities();
      const scope = sessionScopes.get(capabilities.workflow.getNode(nodeId)?.kind ?? '');
      for (const conversation of capabilities.sessions.getSession(nodeId)?.conversations ?? []) {
        scope?.session?.stop(nodeId, capabilities, conversation.id);
      }
      clearNodeProgress(nodeId);
      controlFlow.stop(nodeId);
    },

    getHostCapabilities(): NodeHostCapabilities {
      return hostCapabilities();
    },

    addDocument(input) {
      const now = dependencies.now();
      const doc: ReferenceDocument = {
        id: dependencies.id(),
        workflowId: get().workflow?.id ?? '',
        title: input.title,
        content: input.content,
        format: input.format,
        ...(input.sourceName ? { sourceName: input.sourceName } : {}),
        createdAt: now,
        updatedAt: now,
      };
      set((state) => ({ documents: [...state.documents, doc] }));
      markDirty();
      return doc.id;
    },

    updateDocument(id, patch) {
      const now = dependencies.now();
      set((state) => ({
        documents: state.documents.map((doc) => doc.id === id
          ? { ...doc, ...patch, updatedAt: now }
          : doc),
      }));
      markDirty();
    },

    deleteDocument(id) {
      set((state) => ({ documents: state.documents.filter((doc) => doc.id !== id) }));
      const workflow = get().workflow;
      if (workflow) {
        for (const node of workflow.nodes) {
          if (node.kind !== 'reference') continue;
          const config = node.config as { documentIds?: string[] };
          const ids = Array.isArray(config.documentIds) ? config.documentIds : [];
          if (ids.includes(id)) {
            get().patchNodeConfig(node.id, { documentIds: ids.filter((item) => item !== id) });
          }
        }
      }
      markDirty();
    },

    async saveNow() {
      const snapshot = currentSnapshot();
      if (!snapshot) {
        return;
      }
      await persistSnapshot(snapshot);
    },

    async exportCurrentWorkspace() {
      const workflow = get().workflow;
      if (!workflow) {
        return { ok: false as const, reason: 'missing-workspace' as const };
      }
      if (workflow.nodes.some((node) => node.status === 'running')) {
        return { ok: false as const, reason: 'busy' as const };
      }
      try {
        await get().saveNow();
      } catch {
        return { ok: false as const, reason: 'save-failed' as const };
      }
      if (get().saveStatus === 'failed') {
        return { ok: false as const, reason: 'save-failed' as const };
      }
      const snapshot = currentSnapshot();
      if (!snapshot) {
        return { ok: false as const, reason: 'missing-workspace' as const };
      }
      return {
        ok: true as const,
        file: createWorkspaceExport(snapshot, dependencies.now()),
      };
    },

    async importWorkspaceExport(value) {
      if (get().workflow?.nodes.some((node) => node.status === 'running')) {
        return { ok: false as const, reason: 'busy' as const };
      }
      let imported: WorkspaceSnapshot;
      try {
        imported = cloneWorkspaceForImport(parseWorkspaceExport(value).snapshot, {
          id: dependencies.id,
          now: dependencies.now,
          existingNames: get().workflows.map((workflow) => workflow.name),
        });
      } catch (error) {
        if (error instanceof WorkspaceTransferError) {
          return { ok: false as const, reason: 'invalid-file' as const };
        }
        return { ok: false as const, reason: 'invalid-file' as const };
      }
      try {
        await dependencies.repository.saveWorkspaceSnapshot(imported);
      } catch {
        return { ok: false as const, reason: 'storage' as const };
      }
      bumpRevision(imported.workflow.id);
      workflowActivationGeneration += 1;
      navigationGeneration += 1;
      set((state) => ({
        workflow: imported.workflow,
        workflows: [...state.workflows, imported.workflow],
        runs: imported.runs,
        cards: imported.cards,
        sessions: imported.sessions,
        documents: imported.documents,
        saveStatus: 'saved',
        navigationError: undefined,
      }));
      return { ok: true as const, workflowId: imported.workflow.id };
    },
  }));

  controlFlow = createControlFlowCoordinator({
    getWorkflow: () => store.getState().workflow,
    rerunNode: (nodeId) => store.getState().rerunNode(nodeId),
    stopNode: (nodeId) => nodeOps.get(nodeId)?.controller.abort(),
  });

  let observedActivation = workflowActivationGeneration;
  store.subscribe((state, previous) => {
    if (state.workflow === previous.workflow && observedActivation === workflowActivationGeneration) return;
    const switched = state.workflow?.id !== previous.workflow?.id || observedActivation !== workflowActivationGeneration;
    observedActivation = workflowActivationGeneration;
    if (switched) {
      sessionScopes.forEach((scope) => scope?.cancelAll?.());
      chatOps.forEach((controller) => controller.abort());
      chatOps.clear();
      nodeOps.forEach((operation) => operation.controller.abort());
      nodeOps.clear();
      store.setState({ chatActivities: {}, nodeProgress: {} });
    } else {
      for (const node of previous.workflow?.nodes ?? []) {
        if (state.workflow?.nodes.some((item) => item.id === node.id)) continue;
        sessionScopes.get(node.kind)?.cancelAll?.(node.id);
        for (const [key, controller] of chatOps) {
          if (JSON.parse(key)[0] === node.id) { controller.abort(); chatOps.delete(key); }
        }
        nodeOps.get(node.id)?.controller.abort();
        nodeOps.delete(node.id);
        const chatActivities = Object.fromEntries(Object.entries(store.getState().chatActivities).filter(([, activity]) => activity.nodeId !== node.id));
        store.setState({ chatActivities });
        clearNodeProgress(node.id);
      }
    }
  });
  return store;
}

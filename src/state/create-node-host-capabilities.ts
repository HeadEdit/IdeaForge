import type { AiClient } from '../ai/client';
import { chatOperationKey, type ChatActivity } from '../domain/execution-progress';
import {
  activeConversationMessages,
  buildChatTextStructOutput,
  createChatSession,
  deleteConversation as deleteChatConversation,
  exportConversationTurn,
  forkFullContextConversation,
  forkSingleTurnConversation,
  omitConversationTurns,
  renameConversation as renameChatConversation,
  setActiveConversation as setActiveChatConversation,
  startNewConversation,
  unexportConversationItem,
  updateItemTitle as updateChatItemTitle,
  withActiveConversationMessages,
} from '../domain/chat-conversations';
import { ensureChatSessionShape } from '../domain/chat-session-migrate';
import type {
  CandidateCard,
  CardScore,
  ChatBranchMode,
  ChatSession,
  NodeDisplayStatus,
  NodeOutput,
  NodeRun,
  Workflow,
  WorkflowNode,
} from '../domain/model';
import { markDescendantsStale } from '../domain/graph';
import { cardCollectionInputIds } from '../domain/workflow-io';
import type { ChatSendOptions, ConfigPatchOptions, ConfigPatchResult, NodeHostCapabilities } from '../nodes/types';

export interface NodeHostCapabilityAdapters {
  getChatActivities?(): Record<string, ChatActivity>;
  setChatActivity?(key: string, activity: ChatActivity | undefined): void;
  getWorkflow(): Workflow | undefined;
  getCards(): readonly CandidateCard[];
  getRuns(): readonly NodeRun[];
  getSessions(): readonly ChatSession[];
  setSessions(sessions: ChatSession[]): void;
  validateConfigPatch(nodeId: string, patch: unknown): ConfigPatchResult;
  patchConfig(nodeId: string, patch: unknown, options?: ConfigPatchOptions): ConfigPatchResult;
  updateWorkflow(updater: (workflow: Workflow) => Workflow): void;
  rerunNode(nodeId: string): Promise<void>;
  stopNode(nodeId: string): void;
  toggleVote(cardId: string, vote: 'up' | 'down'): void;
  updateCard(
    cardId: string,
    patch: Partial<Pick<CandidateCard, 'title' | 'concept' | 'content' | 'tags' | 'review'>>,
  ): void;
  deleteCard(variableNodeId: string, cardId: string): void;
  applyScores(updates: { cardId: string; score: CardScore }[]): void;
  sendChat(nodeId: string, text: string, options?: ChatSendOptions): Promise<void>;
  stopChat(nodeId: string): void;
  setChatSkill(nodeId: string, skillId: string): void;
  editChatLastMessage(nodeId: string, turnIndex: number, text: string, options?: ChatSendOptions): Promise<void>;
  isExecutionAvailable(): boolean;
  getAiClient(): AiClient | undefined;
  createAbortController(): AbortController;
  id(): string;
  now(): string;
  markDirty(): void;
  chatOps: Map<string, AbortController>;
  setPendingCardReplacement(value: {
    removed: readonly string[];
    installed: readonly CandidateCard[];
  }): void;
}

function boundCardCollectionSource(
  workflow: Workflow | undefined,
  consumerNodeId: string,
  inputPortId: string,
): WorkflowNode | undefined {
  const edge = workflow?.edges.find((item) => (
    item.targetNodeId === consumerNodeId && item.targetPortId === inputPortId
  ));
  if (!edge) return undefined;
  const source = workflow?.nodes.find((item) => item.id === edge.sourceNodeId);
  if (!source || source.output?.type !== 'CardCollection') return undefined;
  return source;
}

function chatSkillId(node: WorkflowNode): string {
  const skillId = node.config && typeof node.config === 'object' && 'skillId' in node.config
    ? node.config.skillId
    : undefined;
  return typeof skillId === 'string' ? skillId : '';
}

function appendUnique(existing: readonly string[], incoming: readonly string[]): string[] {
  const next = [...existing];
  const seen = new Set(existing);
  for (const id of incoming) {
    if (seen.has(id)) continue;
    seen.add(id);
    next.push(id);
  }
  return next;
}

function pooledCardIds(workflow: Workflow | undefined, removedNodeIds: readonly string[]): Set<string> {
  const removed = new Set(removedNodeIds);
  const pooled = new Set<string>();
  for (const node of workflow?.nodes ?? []) {
    if (removed.has(node.id) || node.kind !== 'cardVariable') continue;
    if (node.output?.type !== 'CardCollection') continue;
    for (const id of node.output.cardIds) pooled.add(id);
  }
  return pooled;
}

function commitBoundCollection(
  adapters: NodeHostCapabilityAdapters,
  consumerNodeId: string,
  inputPortId: string,
  nextCardIds: (current: readonly string[]) => string[],
): void {
  const source = boundCardCollectionSource(
    adapters.getWorkflow(),
    consumerNodeId,
    inputPortId,
  );
  if (!source || source.output?.type !== 'CardCollection') return;
  const cardIds = nextCardIds(source.output.cardIds);
  adapters.updateWorkflow((current) => markDescendantsStale({
    ...current,
    nodes: current.nodes.map((item) => item.id === source.id
      ? { ...item, output: { type: 'CardCollection', cardIds } }
      : item),
  }, source.id));
}

export function createNodeHostCapabilities(
  adapters: NodeHostCapabilityAdapters,
): NodeHostCapabilities {
  return {
    workflow: {
      getWorkflow: () => adapters.getWorkflow(),
      getNode: (nodeId) => adapters.getWorkflow()?.nodes.find((item) => item.id === nodeId),
      validateConfigPatch: (nodeId, patch) => adapters.validateConfigPatch(nodeId, patch),
      patchConfig: (nodeId, patch, options) => adapters.patchConfig(nodeId, patch, options),
      commitNodeOutput: (nodeId, output: NodeOutput, status?: NodeDisplayStatus) => {
        adapters.updateWorkflow((current) => ({
          ...current,
          nodes: current.nodes.map((item) => item.id === nodeId
            ? { ...item, output, ...(status ? { status } : {}) }
            : item),
        }));
      },
    },
    execution: {
      isAvailable: () => adapters.isExecutionAvailable(),
      rerunNode: (nodeId) => adapters.rerunNode(nodeId),
      stopNode: (nodeId) => adapters.stopNode(nodeId),
      rerunUpstream: async (nodeId, inputPortId) => {
        const workflow = adapters.getWorkflow();
        const edge = workflow?.edges.find((item) => (
          item.targetNodeId === nodeId && item.targetPortId === inputPortId
        ));
        if (edge) await adapters.rerunNode(edge.sourceNodeId);
      },
    },
    cards: {
      listCards: () => adapters.getCards(),
      getCard: (cardId) => adapters.getCards().find((card) => card.id === cardId),
      isCardAllowed: (nodeId, portId, cardId) => (
        cardCollectionInputIds(adapters.getWorkflow(), nodeId, portId).includes(cardId)
      ),
      replaceProducedCards: (_producerNodeId, removedCardIds, installed) => {
        adapters.setPendingCardReplacement({ removed: removedCardIds, installed });
      },
      toggleVote: (cardId, vote) => adapters.toggleVote(cardId, vote),
      updateCard: (cardId, patch) => adapters.updateCard(cardId, patch),
      deleteCard: (variableNodeId, cardId) => adapters.deleteCard(variableNodeId, cardId),
      applyScores: (updates) => adapters.applyScores(updates),
      collectOrphanedCardIds: (removedNodeIds) => {
        const pooled = pooledCardIds(adapters.getWorkflow(), removedNodeIds);
        return adapters.getCards().filter((card) => !pooled.has(card.id)).map((card) => card.id);
      },
      appendToBoundCollection: (consumerNodeId, inputPortId, cardIds) => {
        commitBoundCollection(adapters, consumerNodeId, inputPortId, (current) => (
          appendUnique(current, cardIds)
        ));
      },
      reorderBoundCollection: (consumerNodeId, inputPortId, cardIds) => {
        commitBoundCollection(adapters, consumerNodeId, inputPortId, () => [...cardIds]);
      },
    },
    sessions: {
      getActivity: (nodeId, conversationId) => adapters.getChatActivities?.()[chatOperationKey(nodeId, conversationId)],
      setActivity: (key, activity) => adapters.setChatActivity?.(key, activity),
      getSession: (nodeId) => {
        const workflow = adapters.getWorkflow();
        const found = adapters.getSessions().find((session) => (
          session.workflowId === workflow?.id && session.nodeId === nodeId
        ));
        return found ? ensureChatSessionShape(found) : undefined;
      },
      send: (nodeId, text, options) => adapters.sendChat(nodeId, text, options),
      stop: (nodeId) => adapters.stopChat(nodeId),
      setSkill: (nodeId, skillId) => adapters.setChatSkill(nodeId, skillId),
      editLastMessage: (nodeId, turnIndex, text, options) => adapters.editChatLastMessage(nodeId, turnIndex, text, options),
      beginTurn: (nodeId, question, skillId) => {
        const controller = adapters.createAbortController();
        const workflow = adapters.getWorkflow();
        if (!workflow) return controller;
        adapters.updateWorkflow((current) => ({
          ...current,
          nodes: current.nodes.map((item): WorkflowNode => item.id === nodeId
            ? { ...item, status: 'running' }
            : item),
        }));
        const existing = adapters.getSessions().find((session) => (
          session.workflowId === workflow.id && session.nodeId === nodeId
        ));
        const optimisticAt = adapters.now();
        const shaped = existing
          ? ensureChatSessionShape(existing)
          : createChatSession({
            id: adapters.id(),
            workflowId: workflow.id,
            nodeId,
            skillId,
            createdAt: optimisticAt,
            updatedAt: optimisticAt,
            conversationId: adapters.id(),
          });
        const history = activeConversationMessages(shaped).filter((message) => message.role !== 'system');
        const key = chatOperationKey(nodeId, shaped.activeConversationId);
        adapters.chatOps.get(key)?.abort();
        adapters.chatOps.set(key, controller);
        const optimisticSession: ChatSession = {
          ...withActiveConversationMessages(
            shaped,
            [...history, { role: 'user', content: question.trim() }],
            optimisticAt,
          ),
          skillId,
        };
        adapters.setSessions([
          ...adapters.getSessions().filter((item) => !(item.workflowId === workflow.id && item.nodeId === nodeId)),
          optimisticSession,
        ]);
        adapters.markDirty();
        return controller;
      },
      completeTurn: (nodeId, session) => {
        const workflow = adapters.getWorkflow();
        if (!workflow) return;
        const live = adapters.getSessions().find((item) => item.workflowId === workflow.id && item.nodeId === nodeId);
        if (!live) return;
        const target = session.conversations.find((item) => item.id === session.activeConversationId);
        if (!target || !live.conversations.some((item) => item.id === target.id)) return;
        const merged = { ...live, updatedAt: session.updatedAt, conversations: live.conversations.map((item) => (
          item.id === target.id ? { ...item, messages: target.messages, itemIds: target.itemIds,
            name: /^对话 \d+$/.test(item.name) ? target.name : item.name } : item
        )) };
        adapters.chatOps.delete(chatOperationKey(nodeId, target.id));
        adapters.setSessions([
          ...adapters.getSessions().filter((item) => !(item.workflowId === workflow.id && item.nodeId === nodeId)),
          merged,
        ]);
        adapters.markDirty();
      },
      failTurn: (nodeId, status, conversationId) => {
        if (conversationId) adapters.chatOps.delete(chatOperationKey(nodeId, conversationId));
        const stillRunning = [...adapters.chatOps.keys()].some((key) => JSON.parse(key)[0] === nodeId);
        adapters.updateWorkflow((current) => ({
          ...current,
          nodes: current.nodes.map((item) => item.id === nodeId
            ? { ...item, status: stillRunning ? 'running' : status }
            : item),
        }));
      },
      removeTurns: (nodeId, turnIndexes) => {
        const workflow = adapters.getWorkflow();
        if (!workflow) return;
        const existing = adapters.getSessions().find((session) => (
          session.workflowId === workflow.id && session.nodeId === nodeId
        ));
        if (!existing) return;
        const shaped = ensureChatSessionShape(existing);
        if (adapters.chatOps.has(chatOperationKey(nodeId, shaped.activeConversationId))) return;
        const nextSession = omitConversationTurns(
          shaped,
          shaped.activeConversationId,
          turnIndexes,
          adapters.now(),
        );
        adapters.setSessions([
          ...adapters.getSessions().filter((item) => !(item.workflowId === workflow.id && item.nodeId === nodeId)),
          nextSession,
        ]);
        adapters.updateWorkflow((current) => ({
          ...current,
          nodes: current.nodes.map((item) => (
            item.id === nodeId
              ? { ...item, output: buildChatTextStructOutput(nextSession) }
              : item
          )),
        }));
        adapters.markDirty();
      },
      purgeSessions: (removedNodeIds, removedCardIds) => {
        const removed = new Set(removedNodeIds);
        const removedCards = new Set(removedCardIds);
        return adapters.getSessions().filter((session) => (
          !removed.has(session.nodeId)
          && !session.referencedCardIds.some((cardId) => removedCards.has(cardId))
        ));
      },
      createConversation: (nodeId) => {
        const workflow = adapters.getWorkflow();
        if (!workflow) return;
        const node = workflow.nodes.find((item) => item.id === nodeId);
        if (!node) return;
        const existing = adapters.getSessions().find((session) => (
          session.workflowId === workflow.id && session.nodeId === nodeId
        ));
        const createdAt = adapters.now();
        const shaped = existing ? ensureChatSessionShape(existing) : undefined;
        const next = shaped
          ? startNewConversation(shaped, { id: () => adapters.id(), now: () => createdAt })
          : createChatSession({
            id: adapters.id(),
            workflowId: workflow.id,
            nodeId,
            skillId: chatSkillId(node),
            createdAt,
            updatedAt: createdAt,
            conversationId: adapters.id(),
          });
        if (next === shaped) return;
        adapters.setSessions([
          ...adapters.getSessions().filter((item) => !(item.workflowId === workflow.id && item.nodeId === nodeId)),
          next,
        ]);
        adapters.markDirty();
      },
      setActiveConversation: (nodeId, conversationId) => {
        const workflow = adapters.getWorkflow();
        if (!workflow) return;
        const existing = adapters.getSessions().find((session) => (
          session.workflowId === workflow.id && session.nodeId === nodeId
        ));
        if (!existing) return;
        const next = setActiveChatConversation(
          ensureChatSessionShape(existing),
          conversationId,
          adapters.now(),
        );
        adapters.setSessions([
          ...adapters.getSessions().filter((item) => !(item.workflowId === workflow.id && item.nodeId === nodeId)),
          next,
        ]);
        adapters.markDirty();
      },
      renameConversation: (nodeId, conversationId, name) => {
        const workflow = adapters.getWorkflow();
        if (!workflow) return;
        const existing = adapters.getSessions().find((session) => (
          session.workflowId === workflow.id && session.nodeId === nodeId
        ));
        if (!existing) return;
        const next = renameChatConversation(
          ensureChatSessionShape(existing),
          conversationId,
          name,
          adapters.now(),
        );
        adapters.setSessions([
          ...adapters.getSessions().filter((item) => !(item.workflowId === workflow.id && item.nodeId === nodeId)),
          next,
        ]);
        adapters.updateWorkflow((current) => ({
          ...current,
          nodes: current.nodes.map((item) => (
            item.id === nodeId
              ? { ...item, output: buildChatTextStructOutput(next) }
              : item
          )),
        }));
        adapters.markDirty();
      },
      deleteConversation: (nodeId, conversationId) => {
        if (adapters.chatOps.has(chatOperationKey(nodeId, conversationId))) return;
        const workflow = adapters.getWorkflow();
        if (!workflow) return;
        const existing = adapters.getSessions().find((session) => (
          session.workflowId === workflow.id && session.nodeId === nodeId
        ));
        if (!existing) return;
        const next = deleteChatConversation(
          ensureChatSessionShape(existing),
          conversationId,
          adapters.now(),
        );
        adapters.setSessions([
          ...adapters.getSessions().filter((item) => !(item.workflowId === workflow.id && item.nodeId === nodeId)),
          next,
        ]);
        adapters.updateWorkflow((current) => ({
          ...current,
          nodes: current.nodes.map((item) => (
            item.id === nodeId
              ? { ...item, output: buildChatTextStructOutput(next) }
              : item
          )),
        }));
        adapters.markDirty();
      },
      forkConversation: (nodeId, mode: ChatBranchMode, conversationId, itemId) => {
        const workflow = adapters.getWorkflow();
        if (!workflow) return { error: 'missing-workflow' };
        const node = workflow.nodes.find((item) => item.id === nodeId);
        if (!node) return { error: 'missing-node' };
        if (mode === 'single-turn' && adapters.chatOps.has(chatOperationKey(nodeId, conversationId))) {
          return { error: 'busy' };
        }
        const existing = adapters.getSessions().find((session) => (
          session.workflowId === workflow.id && session.nodeId === nodeId
        ));
        if (!existing) return { error: 'missing-session' };
        const shaped = ensureChatSessionShape(existing);
        const clock = { id: () => adapters.id(), now: () => adapters.now() };
        if (mode === 'full-context') {
          const next = forkFullContextConversation(shaped, conversationId, itemId, clock);
          adapters.setSessions([
            ...adapters.getSessions().filter((item) => !(item.workflowId === workflow.id && item.nodeId === nodeId)),
            next,
          ]);
          adapters.updateWorkflow((current) => ({
            ...current,
            nodes: current.nodes.map((item) => (
              item.id === nodeId
                ? { ...item, output: buildChatTextStructOutput(next) }
                : item
            )),
          }));
          adapters.markDirty();
          return { conversationId: next.activeConversationId };
        }
        const forked = forkSingleTurnConversation(shaped, conversationId, itemId, clock);
        if (!forked.seedUserText) return { error: 'missing-item' };
        adapters.setSessions([
          ...adapters.getSessions().filter((item) => !(item.workflowId === workflow.id && item.nodeId === nodeId)),
          forked.session,
        ]);
        adapters.updateWorkflow((current) => ({
          ...current,
          nodes: current.nodes.map((item) => (
            item.id === nodeId
              ? { ...item, output: buildChatTextStructOutput(forked.session) }
              : item
          )),
        }));
        adapters.markDirty();
        return { conversationId: forked.session.activeConversationId };
      },
      exportTurn: (nodeId, conversationId, itemId) => {
        const workflow = adapters.getWorkflow();
        if (!workflow) return;
        const existing = adapters.getSessions().find((session) => (
          session.workflowId === workflow.id && session.nodeId === nodeId
        ));
        if (!existing) return;
        const next = exportConversationTurn(
          ensureChatSessionShape(existing),
          conversationId,
          itemId,
          adapters.now(),
        );
        adapters.setSessions([
          ...adapters.getSessions().filter((item) => !(item.workflowId === workflow.id && item.nodeId === nodeId)),
          next,
        ]);
        adapters.updateWorkflow((current) => ({
          ...current,
          nodes: current.nodes.map((item) => (
            item.id === nodeId
              ? { ...item, output: buildChatTextStructOutput(next) }
              : item
          )),
        }));
        adapters.markDirty();
      },
      unexportItem: (nodeId, itemId) => {
        const workflow = adapters.getWorkflow();
        if (!workflow) return;
        const existing = adapters.getSessions().find((session) => (
          session.workflowId === workflow.id && session.nodeId === nodeId
        ));
        if (!existing) return;
        const next = unexportConversationItem(
          ensureChatSessionShape(existing),
          itemId,
          adapters.now(),
        );
        adapters.setSessions([
          ...adapters.getSessions().filter((item) => !(item.workflowId === workflow.id && item.nodeId === nodeId)),
          next,
        ]);
        adapters.updateWorkflow((current) => ({
          ...current,
          nodes: current.nodes.map((item) => (
            item.id === nodeId
              ? { ...item, output: buildChatTextStructOutput(next) }
              : item
          )),
        }));
        adapters.markDirty();
      },
      updateItemTitle: (nodeId, itemId, title) => {
        const workflow = adapters.getWorkflow();
        if (!workflow) return;
        const existing = adapters.getSessions().find((session) => (
          session.workflowId === workflow.id && session.nodeId === nodeId
        ));
        if (!existing) return;
        const next = updateChatItemTitle(
          ensureChatSessionShape(existing),
          itemId,
          title,
          adapters.now(),
        );
        adapters.setSessions([
          ...adapters.getSessions().filter((item) => !(item.workflowId === workflow.id && item.nodeId === nodeId)),
          next,
        ]);
        adapters.updateWorkflow((current) => ({
          ...current,
          nodes: current.nodes.map((item) => (
            item.id === nodeId
              ? { ...item, output: buildChatTextStructOutput(next) }
              : item
          )),
        }));
        adapters.markDirty();
      },
    },
    ai: {
      isConfigured: () => adapters.isExecutionAvailable(),
      getClient: () => adapters.getAiClient(),
    },
  };
}

import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { z } from 'zod';

import type { AiClient } from '../ai/client';
import type { NodeDefinition } from '../domain/node-definitions';
import type {
  CandidateCard,
  CardScore,
  ChatBranchMode,
  ChatSession,
  NodeDisplayStatus,
  NodeOutput,
  ReferenceDocument,
  Workflow,
  WorkflowNode,
} from '../domain/model';
import type {
  DescendantInvalidationPolicy,
  NodeRunnerRuntime,
  NodeRunnerResult,
} from '../execution/runner-types';

export type HostCapabilityKey = 'workflow' | 'execution' | 'cards' | 'sessions' | 'ai';

export type ConfigPatchResult =
  | { ok: true; config: unknown }
  | { ok: false; error: 'node-not-found' | 'invalid-config' | 'invalid-output' | 'plugin-unavailable'; message: string };

export interface ConfigPatchOptions {
  invalidateDescendants?: boolean;
}

export type NodeAvailability =
  | { status: 'available'; kind: string }
  | { status: 'plugin-unavailable'; kind: string }
  | { status: 'invalid-config'; kind: string; message: string };

export interface WorkflowCapability {
  getWorkflow(): Workflow | undefined;
  getNode(nodeId: string): WorkflowNode | undefined;
  validateConfigPatch(nodeId: string, patch: unknown): ConfigPatchResult;
  patchConfig(nodeId: string, patch: unknown, options?: ConfigPatchOptions): ConfigPatchResult;
  commitNodeOutput(nodeId: string, output: NodeOutput, status?: NodeDisplayStatus): void;
}

export interface ExecutionCapability {
  isAvailable(): boolean;
  rerunNode(nodeId: string): Promise<void>;
  stopNode(nodeId: string): void;
  rerunUpstream(nodeId: string, inputPortId: string): Promise<void>;
}

export interface CardCapability {
  listCards(): readonly CandidateCard[];
  getCard(cardId: string): CandidateCard | undefined;
  isCardAllowed(nodeId: string, portId: string, cardId: string): boolean;
  replaceProducedCards(
    producerNodeId: string,
    removedCardIds: readonly string[],
    installed: readonly CandidateCard[],
  ): void;
  toggleVote(cardId: string, vote: 'up' | 'down'): void;
  updateCard(
    cardId: string,
    patch: Partial<Pick<CandidateCard, 'title' | 'concept' | 'content' | 'tags' | 'review'>>,
  ): void;
  deleteCard(variableNodeId: string, cardId: string): void;
  applyScores(updates: { cardId: string; score: CardScore }[]): void;
  collectOrphanedCardIds(removedNodeIds: readonly string[]): string[];
  appendToBoundCollection(
    consumerNodeId: string,
    inputPortId: string,
    cardIds: readonly string[],
  ): void;
  reorderBoundCollection(
    consumerNodeId: string,
    inputPortId: string,
    cardIds: readonly string[],
  ): void;
}

export interface ChatSendOptions {
  skipSkillRecommendation?: boolean;
}

export interface SessionCapability {
  getActivity?(nodeId: string, conversationId: string): import('../domain/execution-progress').ChatActivity | undefined;
  setActivity?(key: string, activity: import('../domain/execution-progress').ChatActivity | undefined): void;
  getSession(nodeId: string): ChatSession | undefined;
  send(nodeId: string, text: string, options?: ChatSendOptions): Promise<void>;
  stop(nodeId: string): void;
  setSkill(nodeId: string, skillId: string): void;
  editLastMessage(nodeId: string, turnIndex: number, text: string, options?: ChatSendOptions): Promise<void>;
  beginTurn(nodeId: string, question: string, skillId: string): AbortController;
  completeTurn(nodeId: string, session: ChatSession): void;
  failTurn(nodeId: string, status: 'failed' | 'stopped', conversationId?: string): void;
  removeTurns(nodeId: string, turnIndexes: readonly number[]): void;
  purgeSessions(removedNodeIds: readonly string[], removedCardIds: readonly string[]): ChatSession[];
  setActiveConversation(nodeId: string, conversationId: string): void;
  createConversation(nodeId: string): void;
  renameConversation(nodeId: string, conversationId: string, name: string): void;
  deleteConversation(nodeId: string, conversationId: string): void;
  forkConversation(
    nodeId: string,
    mode: ChatBranchMode,
    conversationId: string,
    itemId: string,
  ): { conversationId: string; autoRunText?: string } | { error: string };
  exportTurn(nodeId: string, conversationId: string, itemId: string): void;
  unexportItem(nodeId: string, itemId: string): void;
  updateItemTitle(nodeId: string, itemId: string, title: string): void;
}

export interface AiCapability {
  isConfigured(): boolean;
  getClient(): AiClient | undefined;
}

export interface NodeHostCapabilities {
  readonly workflow: WorkflowCapability;
  readonly execution: ExecutionCapability;
  readonly cards: CardCapability;
  readonly sessions: SessionCapability;
  readonly ai: AiCapability;
}

export interface TypedNodeRunnerContext<Config> {
  reportProgress?: (progress: import('../domain/execution-progress').ExecutionProgress) => void;
  workflow: Workflow;
  node: WorkflowNode;
  config: Config;
  inputs: Readonly<Record<string, NodeOutput>>;
  cards: readonly CandidateCard[];
  signal: AbortSignal;
  runtime?: NodeRunnerRuntime;
}

export interface StandardExecutionContribution<Config> {
  readonly mode: 'standard';
  readonly requiresAi: boolean;
  readonly descendantInvalidation?: DescendantInvalidationPolicy;
  run(context: TypedNodeRunnerContext<Config>): Promise<NodeRunnerResult>;
}

export interface DerivedOutputContext<Config> {
  readonly node: WorkflowNode;
  readonly config: Config;
  readonly workflow: Workflow;
  readonly cards: readonly CandidateCard[];
  readonly documents: readonly ReferenceDocument[];
}

export interface ExecutionEffectContext<Config> {
  readonly nodeId: string;
  readonly node: WorkflowNode;
  readonly config: Config;
  readonly output?: NodeOutput;
  readonly producedCards?: readonly CandidateCard[];
  consumeConfigPatch?(): unknown;
  readonly capabilities: NodeHostCapabilities;
}

export interface DeleteEffectContext {
  readonly nodeId: string;
  readonly removedNodeIds: readonly string[];
  readonly capabilities: NodeHostCapabilities;
}

export interface NodeEffectContribution<Config> {
  createSessionScope?(runtime: {
    runChat(input: import('../execution/run-chat').RunChatInput): Promise<import('../execution/run-chat').RunChatResult>;
    id(): string;
    now(): string;
  }): NodeEffectContribution<Config>;
  cancelAll?(nodeId?: string): void;
  derivedOutput?(context: DerivedOutputContext<Config>): NodeOutput | undefined;
  executionEffects?(context: ExecutionEffectContext<Config>): ConfigPatchResult | void;
  deleteEffects?(context: DeleteEffectContext): void;
  session?: {
    send(nodeId: string, text: string, capabilities: NodeHostCapabilities, options?: ChatSendOptions): Promise<void>;
    stop(nodeId: string, capabilities: NodeHostCapabilities, conversationId?: string): void;
    removeTurns(nodeId: string, turnIndexes: readonly number[], capabilities: NodeHostCapabilities): void;
  };
}

export interface NodePublicationContribution<Config> {
  deriveOutput(config: Config): NodeOutput;
}

export interface NodeThemeTokens {
  readonly headerBackground: string;
  readonly glyphColor: string;
}

export interface NodeInspectorContext<Config> {
  node: WorkflowNode;
  config: Config;
  workflow?: Workflow;
  cards?: readonly CandidateCard[];
  documents?: readonly ReferenceDocument[];
  patchConfig(patch: unknown): ConfigPatchResult;
}

export interface NodeCanvasContext<Config> {
  node: WorkflowNode;
  config: Config;
  workflow?: Workflow;
  cards?: readonly CandidateCard[];
  documents?: readonly ReferenceDocument[];
}

export interface NodeDialogContext<Config> {
  open: boolean;
  nodeId: string;
  node: WorkflowNode;
  config: Config;
  workflow?: Workflow;
  cards: readonly CandidateCard[];
  sessions: readonly ChatSession[];
  capabilities: NodeHostCapabilities;
  onClose: () => void;
}

export interface HostDialogProps {
  open: boolean;
  nodeId: string;
  onClose: () => void;
  store: unknown;
}

export interface NodeUiContribution<Config> {
  readonly label: string;
  readonly icon: LucideIcon;
  readonly theme: NodeThemeTokens;
  readonly Inspector?: ComponentType<NodeInspectorContext<Config>>;
  readonly CanvasBody?: ComponentType<NodeCanvasContext<Config>>;
  readonly Dialog?: ComponentType<HostDialogProps>;
  readonly showRunAction?: boolean;
}

export interface NodePlugin<Config = unknown> {
  readonly kind: string;
  readonly configSchema: z.ZodType<Config>;
  readonly definition: NodeDefinition;
  readonly execution?: StandardExecutionContribution<Config>;
  readonly effects?: NodeEffectContribution<Config>;
  readonly publication?: NodePublicationContribution<Config>;
  readonly ui: NodeUiContribution<Config>;
  readonly requiredCapabilities?: readonly HostCapabilityKey[];
}

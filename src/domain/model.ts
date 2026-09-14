import type { AgentEvent } from './execution-progress';

export type NodeKind = string;

export type PortDataType = 'Text' | 'Text[]' | 'CardCollection' | 'TextStruct' | 'Control';

export type RunStatus = 'running' | 'succeeded' | 'partial' | 'failed' | 'stopped';
export type NodeDisplayStatus = RunStatus | 'idle' | 'stale';

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface WorkflowEdge {
  id: string;
  sourceNodeId: string;
  sourcePortId: string;
  targetNodeId: string;
  targetPortId: string;
}

export interface ContainmentEdge {
  id: string;
  parentNodeId: string;
  childNodeId: string;
}

export interface Workflow {
  id: string;
  name: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  containmentEdges: ContainmentEdge[];
  viewport: Viewport;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowNode {
  id: string;
  kind: NodeKind;
  position: { x: number; y: number };
  config: unknown;
  status: NodeDisplayStatus;
  currentRunId?: string;
  output?: NodeOutput;
}

export interface ChatMessage {
  reasoningContent?: string;
  webSearch?: boolean;
  role: 'user' | 'assistant' | 'system';
  content: string;
  agentEvents?: AgentEvent[];
  skillSuggestion?: {
    currentSkillId: string;
    suggestedSkillId: string;
    confidence: number;
    reason: string;
  };
}

export type TextStructTitleSource = 'auto' | 'fallback' | 'user';

export interface TextStructItem {
  id: string;
  title: string;
  content: string;
  turnId: string;
  conversationId?: string;
  createdAt: string;
  titleSource: TextStructTitleSource;
  titleUpdatedAt: string;
}

export type NodeOutput =
  | { type: 'Text'; value: string }
  | { type: 'Text[]'; values: string[] }
  | { type: 'CardCollection'; cardIds: string[] }
  | { type: 'TextStruct'; items: TextStructItem[] };

export interface CardScoreDimension {
  dimensionId: string;
  name: string;
  score: number;
  reason: string;
}

export interface CardScore {
  average: number;
  byDimension: CardScoreDimension[];
  scoredAt: string;
}

export interface CandidateCard {
  id: string;
  workflowId: string;
  runId: string;
  method: string;
  title: string;
  concept: string;
  content: string;
  tags: string[];
  vote: 'up' | 'down' | null;
  score?: CardScore;
  review?: string;
  onCanvas: boolean;
  createdAt: string;
}

export interface NodeRun {
  id: string;
  workflowId: string;
  nodeId: string;
  status: RunStatus;
  requested: number;
  succeeded: number;
  failed: number;
  skipped: number;
  failedBatchIndexes: number[];
  startedAt: string;
  finishedAt?: string;
  errorKind?: string;
}

export type ChatBranchMode = 'full-context' | 'single-turn';

export interface ChatConversationSource {
  conversationId: string;
  itemId: string;
  mode: ChatBranchMode;
}

export interface ChatConversation {
  id: string;
  name: string;
  messages: ChatMessage[];
  itemIds: string[];
  createdAt: string;
  source?: ChatConversationSource;
}

export interface ChatSession {
  id: string;
  workflowId: string;
  nodeId: string;
  skillId: string;
  referencedCardIds: string[];
  activeConversationId: string;
  conversations: ChatConversation[];
  items: TextStructItem[];
  createdAt: string;
  updatedAt: string;
}

export interface AiSettings {
  baseUrl: string;
  apiKey: string;
  tavilyApiKey: string;
  searchProvider?: 'tavily' | 'vane';
  searchGatewayUrl?: string;
  searchGatewayToken?: string;
  searchMode?: 'speed' | 'balanced';
  model: string;
  thinkingEnabled: boolean;
}

export type ReferenceDocumentFormat = 'manual' | 'md' | 'txt';

export interface ReferenceDocument {
  id: string;
  workflowId: string;
  title: string;
  content: string;
  format: ReferenceDocumentFormat;
  sourceName?: string;
  createdAt: string;
  updatedAt: string;
}

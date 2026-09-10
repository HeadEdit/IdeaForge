export interface ExecutionProgress {
  stage: string;
  percent: number;
  completed?: number;
  total?: number;
  estimated?: boolean;
}

export interface AgentEvent {
  id: string;
  round: number;
  kind: 'request' | 'response' | 'tool';
  title: string;
  status: 'running' | 'succeeded' | 'failed' | 'stopped';
  startedAt: string;
  finishedAt?: string;
  input?: string;
  output?: string;
}

export interface ChatActivity {
  nodeId: string;
  conversationId: string;
  question: string;
  progress: ExecutionProgress;
  events: AgentEvent[];
}

export function chatOperationKey(nodeId: string, conversationId: string): string {
  return JSON.stringify([nodeId, conversationId]);
}

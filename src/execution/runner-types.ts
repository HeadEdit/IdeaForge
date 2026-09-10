import type {
  CandidateCard,
  NodeKind,
  NodeOutput,
  Workflow,
  WorkflowNode,
} from '../domain/model';
import type { AiClient } from '../ai/client';

export interface NodeRunnerRuntime {
  getAiClient(): AiClient | undefined;
  id(): string;
  now(): string;
}

export interface NodeRunnerMetrics {
  requested: number;
  succeeded: number;
  failed: number;
  skipped: number;
  failedBatchIndexes: number[];
}

export type OutputDisposition = 'replace' | 'preserve';
export type DescendantInvalidationPolicy = 'on-run-start' | 'on-output-commit';

export type NodeRunnerResult =
  | {
      ok: true;
      output?: NodeOutput;
      outputDisposition?: OutputDisposition;
      metrics: NodeRunnerMetrics;
      producedCards?: CandidateCard[];
      configPatch?: unknown;
    }
  | {
      ok: false;
      errorKind: string;
      metrics?: NodeRunnerMetrics;
    };

export interface NodeRunnerContext<
  Node extends WorkflowNode = WorkflowNode,
> {
  reportProgress?: (progress: import('../domain/execution-progress').ExecutionProgress) => void;
  workflow: Workflow;
  node: Node;
  inputs: Readonly<Record<string, NodeOutput>>;
  cards: readonly CandidateCard[];
  signal: AbortSignal;
  runtime?: NodeRunnerRuntime;
}

export interface NodeRunner<
  Node extends WorkflowNode = WorkflowNode,
> {
  kind: Node['kind'];
  requiresAi: boolean;
  run(context: NodeRunnerContext<Node>): Promise<NodeRunnerResult>;
}

export type NodeExecutionRegistration = {
  mode: 'standard';
  runner: NodeRunner;
  descendantInvalidation: DescendantInvalidationPolicy;
};

export type { NodeKind };

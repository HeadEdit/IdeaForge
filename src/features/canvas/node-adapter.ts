import type { Edge, Node } from '@xyflow/react';
import { MarkerType } from '@xyflow/react';

import { isControlEdge } from '../../domain/control-flow';
import type { CandidateCard, ReferenceDocument, Workflow, WorkflowNode } from '../../domain/model';
import type { PortDirection } from '../../domain/node-definitions';

export interface WorkflowNodeCallbacks {
  onOpen?: (nodeId: string) => void;
  onDelete?: (nodeId: string) => void;
  onDisconnectPort?: (nodeId: string, portId: string, direction: PortDirection) => void;
  onRun?: (nodeId: string) => void;
}

export type WorkflowFlowNode = Node<{
  progress?: import('../../domain/execution-progress').ExecutionProgress;
  domainNode: WorkflowNode;
  callbacks: WorkflowNodeCallbacks;
  workflow?: Workflow;
  cards?: readonly CandidateCard[];
  documents?: readonly ReferenceDocument[];
  preview?: { title: string; concept: string };
}, 'workflow'>;

export function toFlowNodes(
  workflow: Workflow,
  callbacks: WorkflowNodeCallbacks = {},
  selectedNodeIds: readonly string[] = [],
  cards: readonly CandidateCard[] = [],
  documents: readonly ReferenceDocument[] = [],
  progress: Record<string, import('../../domain/execution-progress').ExecutionProgress> = {},
): WorkflowFlowNode[] {
  const selected = new Set(selectedNodeIds);
  return workflow.nodes.map((node) => ({
    id: node.id,
    type: 'workflow' as const,
    position: { ...node.position },
    selected: selected.has(node.id),
    deletable: false,
    data: {
      progress: progress[node.id],
      domainNode: node,
      callbacks,
      workflow,
      cards,
      documents,
    },
  }));
}

export function toFlowEdges(workflow: Workflow): Edge[] {
  return workflow.edges.map((edge) => {
    const control = isControlEdge(workflow, edge);
    return {
      id: edge.id,
      source: edge.sourceNodeId,
      sourceHandle: edge.sourcePortId,
      target: edge.targetNodeId,
      targetHandle: edge.targetPortId,
      type: 'default',
      deletable: false,
      ...(control
        ? {
            markerEnd: {
              type: MarkerType.ArrowClosed,
              width: 16,
              height: 16,
            },
          }
        : {}),
    };
  });
}

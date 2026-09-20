import type { Workflow, WorkflowNode } from './model';
import { builtinNodePlatform } from '../nodes/builtins';

export interface DefaultWorkflowDependencies {
  id: () => string;
  now: () => string;
}

/** 参考创意发散管线拓扑：卡片池 → 发散/评分，卡片内容 → 对话 */
const TEMPLATE_LAYOUT = {
  cardVariable: { x: 86, y: 273 },
  divergence: { x: 378, y: 461 },
  ideaScore: { x: 728, y: 359 },
  cardContent: { x: 416, y: 138 },
  chat: { x: 842, y: 95 },
} as const;

function createTemplateNode(
  id: string,
  kind: string,
  position: { x: number; y: number },
): WorkflowNode {
  const config = builtinNodePlatform.cloneDefaultConfig(kind);
  if (config === undefined) {
    throw new Error(`Missing default config for template node: ${kind}`);
  }
  return {
    id,
    kind,
    position: { ...position },
    config,
    status: 'idle',
  };
}

export function createDefaultWorkflow(
  dependencies: DefaultWorkflowDependencies,
): Workflow {
  const createdAt = dependencies.now();
  const cardVariableId = dependencies.id();
  const divergenceId = dependencies.id();
  const ideaScoreId = dependencies.id();
  const cardContentId = dependencies.id();
  const chatId = dependencies.id();

  return {
    id: dependencies.id(),
    name: '未命名工作流',
    nodes: [
      createTemplateNode(cardVariableId, 'cardVariable', TEMPLATE_LAYOUT.cardVariable),
      createTemplateNode(divergenceId, 'divergence', TEMPLATE_LAYOUT.divergence),
      createTemplateNode(ideaScoreId, 'ideaScore', TEMPLATE_LAYOUT.ideaScore),
      createTemplateNode(cardContentId, 'cardContent', TEMPLATE_LAYOUT.cardContent),
      createTemplateNode(chatId, 'chat', TEMPLATE_LAYOUT.chat),
    ],
    edges: [
      {
        id: dependencies.id(),
        sourceNodeId: cardVariableId,
        sourcePortId: 'cards',
        targetNodeId: divergenceId,
        targetPortId: 'pool',
      },
      {
        id: dependencies.id(),
        sourceNodeId: divergenceId,
        sourcePortId: 'execOut',
        targetNodeId: ideaScoreId,
        targetPortId: 'exec',
      },
      {
        id: dependencies.id(),
        sourceNodeId: cardVariableId,
        sourcePortId: 'cards',
        targetNodeId: ideaScoreId,
        targetPortId: 'cards',
      },
      {
        id: dependencies.id(),
        sourceNodeId: cardVariableId,
        sourcePortId: 'cards',
        targetNodeId: cardContentId,
        targetPortId: 'cards',
      },
      {
        id: dependencies.id(),
        sourceNodeId: cardContentId,
        sourcePortId: 'content',
        targetNodeId: chatId,
        targetPortId: 'text',
      },
    ],
    containmentEdges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    createdAt,
    updatedAt: createdAt,
  };
}

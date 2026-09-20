import { annotationDefinition } from '../nodes/annotation/definition';
import { briefDefinition } from '../nodes/brief/definition';
import { cardContentDefinition } from '../nodes/card-content/definition';
import { cardVariableDefinition } from '../nodes/card-variable/definition';
import { chatDefinition } from '../nodes/chat/definition';
import { contentExtractDefinition } from '../nodes/content-extract/definition';
import { divergenceDefinition } from '../nodes/divergence/definition';
import { ideaScoreDefinition } from '../nodes/idea-score/definition';
import { referenceDefinition } from '../nodes/reference/definition';
import { structuredPlanDefinition } from '../nodes/structured-plan/definition';
import { textSelectDefinition } from '../nodes/text-select/definition';
import type { NodeKind, PortDataType } from './model';
export type NodeCategory = 'variable' | 'generate' | 'select' | 'annotate';
export type PortDirection = 'input' | 'output';

export interface NodePort {
  readonly id: string;
  readonly label: string;
  readonly type: PortDataType;
  readonly optional?: boolean;
}

export interface NodeDefinition {
  readonly kind: string;
  readonly category: NodeCategory;
  readonly label: string;
  readonly inputs: readonly NodePort[];
  readonly outputs: readonly NodePort[];
  readonly defaultConfig: unknown;
  readonly autoRun: boolean;
  /** 为 true 时不出现在节点库，已有画布节点仍可加载与运行 */
  readonly hiddenFromLibrary?: boolean;
}

export const nodeDefinitions: readonly NodeDefinition[] = Object.freeze([
  cardVariableDefinition,
  briefDefinition,
  divergenceDefinition,
  ideaScoreDefinition,
  chatDefinition,
  cardContentDefinition,
  textSelectDefinition,
  referenceDefinition,
  contentExtractDefinition,
  structuredPlanDefinition,
  annotationDefinition,
]);

export function lookupNodeDefinition(kind: string): NodeDefinition | undefined {
  return nodeDefinitions.find((entry) => entry.kind === kind);
}
export function getNodeDefinition(kind: NodeKind): NodeDefinition {
  const definition = lookupNodeDefinition(kind);

  if (!definition) {
    throw new Error(`Unknown node kind: ${kind}`);
  }

  return definition;
}

export function getPort(
  kind: NodeKind,
  direction: PortDirection,
  portId: string,
): NodePort | undefined {
  const definition = lookupNodeDefinition(kind);
  return definition?.[`${direction}s`].find((port) => port.id === portId);
}

export function canConnectPortTypes(
  source: PortDataType,
  target: PortDataType,
): boolean {
  if (source === 'Control' || target === 'Control') {
    return source === 'Control' && target === 'Control';
  }
  if (target === 'TextStruct') {
    return source === 'TextStruct';
  }
  if (source === 'TextStruct') {
    return target === 'Text' || target === 'Text[]';
  }
  return source === target
    || target === 'Text'
    || target === 'Text[]';
}

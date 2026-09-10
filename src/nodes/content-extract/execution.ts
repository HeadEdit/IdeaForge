import { createContentExtractRunner, type ContentExtractRunnerDependencies } from '../../execution/run-content-extract';
import type { StandardExecutionContribution } from '../types';
import type { ContentExtractConfig } from './config';

let productionDeps: ContentExtractRunnerDependencies | undefined;
const pendingPatches = new Map<string, Partial<ContentExtractConfig>>();

export function bindContentExtractRunner(deps: ContentExtractRunnerDependencies): void {
  productionDeps = deps;
}

export function takeContentExtractConfigPatch(
  nodeId: string,
): Partial<ContentExtractConfig> | undefined {
  const patch = pendingPatches.get(nodeId);
  pendingPatches.delete(nodeId);
  return patch;
}

export const contentExtractExecution: StandardExecutionContribution<ContentExtractConfig> = {
  mode: 'standard',
  requiresAi: true,
  run(context) {
    const runner = createContentExtractRunner({
      getClient: () => productionDeps?.getClient(),
      onConfigPatch: (nodeId, patch) => {
        productionDeps?.onConfigPatch(nodeId, patch);
        pendingPatches.set(nodeId, {
          ...(pendingPatches.get(nodeId) ?? {}),
          ...patch,
        });
      },
    });
    return runner.run({
      workflow: context.workflow,
      node: { ...context.node, config: context.config },
      inputs: context.inputs,
      cards: context.cards,
      signal: context.signal,
      reportProgress: context.reportProgress,
    });
  },
};

import { createIdeaScoreRunner, type IdeaScoreRunnerDependencies } from '../../execution/run-idea-score';
import type { StandardExecutionContribution } from '../types';
import type { IdeaScoreConfig } from './config';

let productionDeps: IdeaScoreRunnerDependencies | undefined;
const pendingPatches = new Map<string, Partial<IdeaScoreConfig>>();

export function bindIdeaScoreRunner(deps: IdeaScoreRunnerDependencies): void {
  productionDeps = deps;
}

export function rememberIdeaScoreConfigPatch(
  nodeId: string,
  patch: Partial<IdeaScoreConfig>,
): void {
  pendingPatches.set(nodeId, {
    ...(pendingPatches.get(nodeId) ?? {}),
    ...patch,
  });
}

export function takeIdeaScoreConfigPatch(
  nodeId: string,
): Partial<IdeaScoreConfig> | undefined {
  const patch = pendingPatches.get(nodeId);
  pendingPatches.delete(nodeId);
  return patch;
}

export const ideaScoreExecution: StandardExecutionContribution<IdeaScoreConfig> = {
  mode: 'standard',
  requiresAi: true,
  run(context) {
    const runner = createIdeaScoreRunner({
      getClient: () => productionDeps?.getClient(),
      id: () => productionDeps?.id() ?? crypto.randomUUID(),
      now: () => productionDeps?.now() ?? new Date().toISOString(),
      wait: productionDeps?.wait,
      onConfigPatch: (nodeId, patch) => {
        productionDeps?.onConfigPatch(nodeId, patch);
        rememberIdeaScoreConfigPatch(nodeId, patch);
      },
      onCardsScored: (updates) => {
        productionDeps?.onCardsScored(updates);
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

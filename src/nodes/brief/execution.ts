import {
  createBriefRunner,
  type BriefRunnerDependencies,
} from '../../execution/run-brief';
import type { StandardExecutionContribution } from '../types';
import type { BriefConfig } from './config';

let productionDeps: BriefRunnerDependencies | undefined;
const pendingPatches = new Map<string, Partial<BriefConfig>>();

export function bindBriefRunner(deps: BriefRunnerDependencies): void {
  productionDeps = deps;
}

export function takeBriefConfigPatch(
  nodeId: string,
): Partial<BriefConfig> | undefined {
  const patch = pendingPatches.get(nodeId);
  pendingPatches.delete(nodeId);
  return patch;
}

export const briefExecution: StandardExecutionContribution<BriefConfig> = {
  mode: 'standard',
  requiresAi: true,
  run(context) {
    const runner = createBriefRunner({
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

import { createDivergenceRunner, type DivergenceRunnerDependencies } from '../../execution/run-divergence';
import type { StandardExecutionContribution } from '../types';
import type { DivergenceConfig } from './config';

let productionDeps: DivergenceRunnerDependencies | undefined;

export function bindDivergenceRunner(deps: DivergenceRunnerDependencies): void {
  productionDeps = deps;
}

export const divergenceExecution: StandardExecutionContribution<DivergenceConfig> = {
  mode: 'standard',
  requiresAi: true,
  run(context) {
    const runner = createDivergenceRunner({
      getClient: () => productionDeps?.getClient(),
      id: () => (productionDeps?.id ?? (() => crypto.randomUUID()))(),
      now: () => (productionDeps?.now ?? (() => new Date().toISOString()))(),
      wait: productionDeps?.wait,
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

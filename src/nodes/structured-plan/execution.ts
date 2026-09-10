import {
  createStructuredPlanRunner,
} from '../../execution/run-structured-plan';
import type { StandardExecutionContribution } from '../types';
import type { StructuredPlanConfig } from './config';

export const structuredPlanExecution: StandardExecutionContribution<StructuredPlanConfig> = {
  mode: 'standard',
  requiresAi: true,
  descendantInvalidation: 'on-output-commit',
  async run(context) {
    let configPatch: Partial<StructuredPlanConfig> | undefined;
    const runtime = context.runtime;
    const runner = createStructuredPlanRunner({
      getClient: () => runtime?.getAiClient(),
      id: () => (runtime?.id ?? (() => crypto.randomUUID()))(),
      now: () => (runtime?.now ?? (() => new Date().toISOString()))(),
      onConfigPatch: (_nodeId, patch) => {
        configPatch = {
          ...configPatch,
          ...patch,
        };
      },
    });
    const result = await runner.run({
      workflow: context.workflow,
      node: { ...context.node, config: context.config },
      inputs: context.inputs,
      cards: context.cards,
      signal: context.signal,
      reportProgress: context.reportProgress,
    });
    return result.ok && configPatch
      ? { ...result, configPatch }
      : result;
  },
};

import { freezeDefinition } from '../freeze-definition';
import { defaultStructuredPlanConfig } from './config';

export const structuredPlanDefinition = freezeDefinition({
  kind: 'structuredPlan',
  category: 'generate',
  label: '结构化策划案',
  inputs: [
    { id: 'exec', label: '执行', type: 'Control', optional: true },
    { id: 'input', label: '文本', type: 'Text' },
  ],
  outputs: [
    { id: 'execOut', label: '执行', type: 'Control', optional: true },
    { id: 'modules', label: '策划模块', type: 'TextStruct' },
  ],
  autoRun: false,
  hiddenFromLibrary: true,
  defaultConfig: defaultStructuredPlanConfig,
});

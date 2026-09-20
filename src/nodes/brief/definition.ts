import { freezeDefinition } from '../freeze-definition';
import { defaultBriefConfig } from './config';

export const briefDefinition = freezeDefinition({
  kind: 'brief',
  category: 'generate',
  label: 'Brief',
  inputs: [
    { id: 'exec', label: '执行', type: 'Control', optional: true },
    { id: 'source', label: '上游文本', type: 'Text', optional: true },
  ],
  outputs: [
    { id: 'execOut', label: '执行', type: 'Control', optional: true },
    { id: 'text', label: 'Brief 文本', type: 'Text' },
  ],
  autoRun: false,
  hiddenFromLibrary: true,
  defaultConfig: defaultBriefConfig,
});

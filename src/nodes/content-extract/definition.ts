import { freezeDefinition } from '../freeze-definition';
import { defaultContentExtractConfig } from './config';

export const contentExtractDefinition = freezeDefinition({
  kind: 'contentExtract',
  category: 'generate',
  label: '内容提炼',
  inputs: [
    { id: 'exec', label: '执行', type: 'Control', optional: true },
    { id: 'input', label: '文本', type: 'Text' },
  ],
  outputs: [
    { id: 'execOut', label: '执行', type: 'Control', optional: true },
  ],
  autoRun: false,
  hiddenFromLibrary: true,
  defaultConfig: defaultContentExtractConfig,
});

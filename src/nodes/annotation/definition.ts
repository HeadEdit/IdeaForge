import { freezeDefinition } from '../freeze-definition';
import { defaultAnnotationConfig } from './config';

export const annotationDefinition = freezeDefinition({
  kind: 'annotation',
  category: 'annotate',
  label: '注释',
  inputs: [],
  outputs: [],
  autoRun: false,
  hiddenFromLibrary: true,
  defaultConfig: defaultAnnotationConfig,
});

import type { NodePlugin } from '../types';
import { annotationConfigSchema, type AnnotationConfig } from './config';
import { annotationDefinition } from './definition';
import { annotationUi } from './ui';

export const annotationPlugin: NodePlugin<AnnotationConfig> = {
  kind: 'annotation',
  configSchema: annotationConfigSchema,
  definition: annotationDefinition,
  ui: annotationUi,
  requiredCapabilities: ['workflow'],
};

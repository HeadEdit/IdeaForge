import { annotationPlugin } from './annotation';
import { briefPlugin } from './brief';
import { cardContentPlugin } from './card-content';
import { cardVariablePlugin } from './card-variable';
import { chatPlugin } from './chat';
import { contentExtractPlugin } from './content-extract';
import { createNodePlatform } from './create-node-platform';
import { divergencePlugin } from './divergence';
import { ideaScorePlugin } from './idea-score';
import { referencePlugin } from './reference';
import { structuredPlanPlugin } from './structured-plan';
import { textSelectPlugin } from './text-select';

export const builtinNodePlugins = [
  cardVariablePlugin,
  briefPlugin,
  divergencePlugin,
  ideaScorePlugin,
  chatPlugin,
  cardContentPlugin,
  textSelectPlugin,
  referencePlugin,
  contentExtractPlugin,
  structuredPlanPlugin,
  annotationPlugin,
] as const;

export const builtinNodePlatform = createNodePlatform(builtinNodePlugins);

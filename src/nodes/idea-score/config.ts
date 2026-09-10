import { z } from 'zod';
import {
  defaultIdeaScoreSort,
  ideaScoreReportSchema,
  ideaScoreSortSchema,
  scoreDimensionSchema,
} from '../../domain/idea-score-report';

export {
  defaultIdeaScoreSort,
  ideaScoreCardResultSchema,
  ideaScoreReportSchema,
  ideaScoreSortSchema,
  isIdeaScoreReportStale,
  nextIdeaScoreSort,
  scoreDimensionSchema,
  sortIdeaScoreReportCards,
  sortedIdeaScoreOutputCardIds,
  type IdeaScoreReport,
  type IdeaScoreSort,
  type ScoreDimension,
} from '../../domain/idea-score-report';

export const IDEA_SCORE_MAX_BATCH_SIZE = 3;
export const IDEA_SCORE_REASON_MAX_LENGTH = 30;

export function clampIdeaScoreBatchSize(batchSize: number | undefined): number {
  return Math.min(
    IDEA_SCORE_MAX_BATCH_SIZE,
    Math.max(1, batchSize ?? IDEA_SCORE_MAX_BATCH_SIZE),
  );
}

export const ideaScoreConfigSchema = z.object({
  runMode: z.enum(['inferDimensions', 'describeDimensions', 'score']).default('inferDimensions'),
  dimensions: z.array(scoreDimensionSchema).default([]),
  report: ideaScoreReportSchema.nullable().default(null),
  temperature: z.number().default(0),
  batchSize: z.number().default(IDEA_SCORE_MAX_BATCH_SIZE),
  concurrency: z.number().default(2),
  sort: ideaScoreSortSchema.default(defaultIdeaScoreSort),
});

export type IdeaScoreConfig = z.infer<typeof ideaScoreConfigSchema>;

export const defaultIdeaScoreConfig: IdeaScoreConfig = {
  runMode: 'inferDimensions',
  dimensions: [],
  report: null,
  temperature: 0,
  batchSize: IDEA_SCORE_MAX_BATCH_SIZE,
  concurrency: 2,
  sort: { ...defaultIdeaScoreSort },
};

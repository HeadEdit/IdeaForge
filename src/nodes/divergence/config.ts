import { z } from 'zod';

export const divergenceFeedbackModeSchema = z.enum(['explore', 'balanced', 'exploit']);
export type DivergenceFeedbackMode = z.infer<typeof divergenceFeedbackModeSchema>;

export const divergenceConfigSchema = z.object({
  requirement: z.string(),
  methodIds: z.array(z.string()),
  autoInferMethods: z.boolean().default(true),
  batchSize: z.number(),
  concurrency: z.number(),
  temperature: z.number(),
  feedbackMode: divergenceFeedbackModeSchema.default('balanced'),
  lastDirection: z.string().optional(),
});

export type DivergenceConfig = z.infer<typeof divergenceConfigSchema>;

export const defaultDivergenceConfig: DivergenceConfig = {
  requirement: '',
  methodIds: [],
  autoInferMethods: true,
  batchSize: 3,
  concurrency: 2,
  temperature: 0.85,
  feedbackMode: 'balanced',
};

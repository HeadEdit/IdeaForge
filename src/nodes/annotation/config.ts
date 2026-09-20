import { z } from 'zod';

export const annotationConfigSchema = z.object({
  text: z.string().default(''),
});

export type AnnotationConfig = z.infer<typeof annotationConfigSchema>;

export const defaultAnnotationConfig: AnnotationConfig = annotationConfigSchema.parse({});

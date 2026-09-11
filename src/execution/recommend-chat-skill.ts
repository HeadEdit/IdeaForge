import { z } from 'zod';
import type { AiClient } from '../ai/client';
import type { ChatMessage } from '../domain/model';
import { chatSkillRouterPrompts } from '../prompts';
import { AI_REQUEST_LIMITS } from '../ai/request-config';
import { listChatSkills } from '../skills';

const recommendationSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('stay') }).strict(),
  z.object({
    action: z.literal('suggest'),
    skillId: z.string().min(1),
    currentSkillFit: z.number().min(0).max(1),
    suggestedSkillConfidence: z.number().min(0).max(1),
    reason: z.string().trim().min(1).max(160),
  }).strict(),
]);

const HIGH_CONFIDENCE_THRESHOLD = 0.8;
const LOW_CURRENT_SKILL_FIT_THRESHOLD = 0.4;
const MODERATE_CONFIDENCE_THRESHOLD = 0.6;
const MINIMUM_FIT_ADVANTAGE = 0.2;

export interface ChatSkillRecommendation {
  skillId: string;
  confidence: number;
  reason: string;
}

export async function recommendChatSkill(input: {
  client: AiClient;
  currentSkillId: string;
  recentMessages: readonly ChatMessage[];
  question: string;
  signal: AbortSignal;
}): Promise<ChatSkillRecommendation | undefined> {
  const skills = listChatSkills();
  let raw: string;
  try {
    raw = await input.client.complete([
      { role: 'system', content: chatSkillRouterPrompts.system },
      { role: 'user', content: [
        chatSkillRouterPrompts.catalog(skills),
        chatSkillRouterPrompts.user(input.currentSkillId, input.recentMessages, input.question),
      ].join('\n\n') },
    ], { signal: input.signal, temperature: 0, maxTokens: AI_REQUEST_LIMITS.skillRecommendation });
  } catch {
    return undefined;
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const parsed = recommendationSchema.safeParse(value);
  if (!parsed.success || parsed.data.action === 'stay') return undefined;
  const recommendation = parsed.data;
  const currentFitScore = Math.round(recommendation.currentSkillFit * 100);
  const suggestedConfidenceScore = Math.round(recommendation.suggestedSkillConfidence * 100);
  const hasHighConfidence = recommendation.suggestedSkillConfidence >= HIGH_CONFIDENCE_THRESHOLD;
  const escapesMismatchedSkill = (
    recommendation.currentSkillFit <= LOW_CURRENT_SKILL_FIT_THRESHOLD
    && recommendation.suggestedSkillConfidence >= MODERATE_CONFIDENCE_THRESHOLD
    && suggestedConfidenceScore - currentFitScore >= MINIMUM_FIT_ADVANTAGE * 100
  );
  if ((!hasHighConfidence && !escapesMismatchedSkill) || recommendation.skillId === input.currentSkillId) return undefined;
  if (!skills.some((skill) => skill.id === recommendation.skillId)) return undefined;
  return {
    skillId: recommendation.skillId,
    confidence: recommendation.suggestedSkillConfidence,
    reason: recommendation.reason,
  };
}

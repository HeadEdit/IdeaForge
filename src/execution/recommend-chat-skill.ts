import { z } from 'zod';
import type { AiClient } from '../ai/client';
import type { ChatMessage } from '../domain/model';
import { chatSkillRouterPrompts } from '../prompts';
import { listChatSkills } from '../skills';

const recommendationSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('stay') }).strict(),
  z.object({
    action: z.literal('suggest'),
    skillId: z.string().min(1),
    confidence: z.number().min(0).max(1),
    reason: z.string().trim().min(1).max(160),
  }).strict(),
]);

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
    ], { signal: input.signal, temperature: 0, maxTokens: 200 });
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
  if (recommendation.confidence < 0.8 || recommendation.skillId === input.currentSkillId) return undefined;
  if (!skills.some((skill) => skill.id === recommendation.skillId)) return undefined;
  return {
    skillId: recommendation.skillId,
    confidence: recommendation.confidence,
    reason: recommendation.reason,
  };
}

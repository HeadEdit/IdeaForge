/** Centralized model request limits. Keep these internal defaults out of user settings. */
export const AI_REQUEST_LIMITS = {
  default: 4096,
  thinkingMultiplier: 2,
  thinkingCap: 32768,
  planner: 512,
  tools: 8192,
  skillRecommendation: 200,
  ideaScore: 4096,
  structuredPlan: {
    title: 8192,
    module: 24000,
    review: 24000,
    graph: 8192,
  },
} as const;

export function resolveAiMaxTokens(base: number, thinkingEnabled: boolean): number {
  const scaled = thinkingEnabled
    ? Math.ceil(base * AI_REQUEST_LIMITS.thinkingMultiplier)
    : base;
  return Math.min(scaled, AI_REQUEST_LIMITS.thinkingCap);
}

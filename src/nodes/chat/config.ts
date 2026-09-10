import { z } from 'zod';

export const chatConfigSchema = z.object({
  skillId: z.string(),
  webSearch: z.boolean().default(false),
  agentMode: z.boolean().default(false),
});

export type ChatConfig = z.infer<typeof chatConfigSchema>;
export const defaultChatConfig: ChatConfig = { skillId: 'brainstorm', webSearch: false, agentMode: false };

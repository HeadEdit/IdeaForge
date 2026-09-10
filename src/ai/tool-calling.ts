import { z } from 'zod';
import type { ChatMessage } from '../domain/model';

export interface AiTool {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

const toolCallSchema = z.object({
  id: z.string().min(1),
  type: z.literal('function'),
  function: z.object({ name: z.string().min(1), arguments: z.string() }),
});

export type AiToolCall = z.infer<typeof toolCallSchema>;
export type AiToolMessage = ChatMessage
  | { role: 'assistant'; content: string | null; tool_calls: AiToolCall[]; reasoning_content?: string }
  | { role: 'tool'; tool_call_id: string; content: string };

export const toolReplySchema = z.object({
  content: z.string().nullable().optional(),
  reasoning_content: z.string().nullish().transform((value) => value ?? undefined),
  tool_calls: z.array(toolCallSchema).max(24).nullish().transform((value) => value?.length ? value : undefined),
}).refine((reply) => !!reply.content?.trim() || !!reply.tool_calls?.length)
  .refine((reply) => !reply.tool_calls || new Set(reply.tool_calls.map((call) => call.id)).size === reply.tool_calls.length);

export type AiToolReply = z.infer<typeof toolReplySchema>;

import type { AiClient } from '../ai/client';
import type { AgentEvent } from '../domain/execution-progress';
import { AiClientError } from '../ai/client';
import { buildChatMessages } from '../ai/prompts';
import type { CandidateCard, ChatSession } from '../domain/model';
import {
  activeConversationMessages,
  createChatSession,
  withActiveConversationMessages,
} from '../domain/chat-conversations';
import { ensureChatSessionShape } from '../domain/chat-session-migrate';
import { getSkill } from '../skills';
import { NO_CHAT_SKILL } from '../domain/chat-turns';
import { runChatAgent, type AgentLibrary, type AgentResult } from './chat-agent';
import type { ChatSkillRecommendation } from './recommend-chat-skill';

export interface RunChatInput {
  onReasoningDelta?: (delta: string) => void;
  onAgentEvent?: (event: AgentEvent) => void;
  workflowId: string;
  nodeId: string;
  skillId: string;
  session?: ChatSession;
  question: string;
  referencedCards: readonly CandidateCard[];
  referencedText?: string;
  webSearch?: boolean;
  agentMode?: boolean;
  agentLibrary?: AgentLibrary;
  signal: AbortSignal;
  skipSkillRecommendation?: boolean;
}

export interface RunChatResult {
  status: 'succeeded' | 'failed' | 'stopped';
  startedAt: string;
  finishedAt: string;
  errorKind?: string;
  session?: ChatSession;
}

export interface RunChatDependencies {
  getClient: () => AiClient | undefined;
  recommendSkill?: (input: {
    client: AiClient;
    currentSkillId: string;
    recentMessages: readonly import('../domain/model').ChatMessage[];
    question: string;
    signal: AbortSignal;
  }) => Promise<ChatSkillRecommendation | undefined>;
  id: () => string;
  now: () => string;
}

async function searchThenComplete(
  client: AiClient,
  messages: Parameters<AiClient['complete']>[0],
  signal: AbortSignal,
  onSearchProgress?: (event: import('../ai/search-gateway').SearchProgress) => void,
  onReasoningDelta?: (delta: string) => void,
): Promise<string> {
  if (!client.completeWithWebSearch) {
    throw new AiClientError('unsupported', false);
  }
  return client.completeWithWebSearch(messages, { signal, onSearchProgress, onReasoningDelta });
}

function failed(
  startedAt: string,
  finishedAt: string,
  errorKind: string,
): RunChatResult {
  return { status: 'failed', startedAt, finishedAt, errorKind };
}

export async function runChat(
  input: RunChatInput,
  deps: RunChatDependencies,
): Promise<RunChatResult> {
  const startedAt = deps.now();
  const question = input.question.trim();

  if (input.signal.aborted) {
    return { status: 'stopped', startedAt, finishedAt: deps.now() };
  }

  if (!question) {
    return failed(startedAt, deps.now(), 'invalid-response');
  }

  const skillId = input.skillId.trim() === NO_CHAT_SKILL ? '' : input.skillId.trim();
  const skill = skillId ? getSkill(skillId) : undefined;
  if (skillId && (!skill || (skill.category !== 'role' && skill.category !== 'assistant'))) {
    return failed(startedAt, deps.now(), 'invalid-response');
  }

  const client = deps.getClient();
  if (!client) {
    return failed(startedAt, deps.now(), 'invalid-response');
  }

  const shaped = input.session ? ensureChatSessionShape(input.session) : undefined;
  const history = shaped ? activeConversationMessages(shaped) : [];
  const messages = buildChatMessages(
    skill,
    input.referencedCards,
    input.referencedText,
    history,
    question,
    Boolean(input.webSearch),
  );

  try {
    if (!input.skipSkillRecommendation && deps.recommendSkill) {
      const recommendation = await deps.recommendSkill({
        client,
        currentSkillId: skillId,
        recentMessages: history,
        question,
        signal: input.signal,
      });
      if (input.signal.aborted) {
        return { status: 'stopped', startedAt, finishedAt: deps.now() };
      }
      if (recommendation) {
        const finishedAt = deps.now();
        const referencedCardIds = input.referencedCards.map((card) => card.id);
        const suggestionMessage = {
          role: 'assistant' as const,
          content: '',
          skillSuggestion: {
            currentSkillId: skillId,
            suggestedSkillId: recommendation.skillId,
            confidence: recommendation.confidence,
            reason: recommendation.reason,
          },
        };
        const suggestionMessages = [
          ...messages.filter((message) => message.role !== 'system'),
          suggestionMessage,
        ];
        const session: ChatSession = shaped
          ? {
            ...withActiveConversationMessages(shaped, suggestionMessages, finishedAt),
            skillId,
            referencedCardIds,
          }
          : createChatSession({
            id: deps.id(), workflowId: input.workflowId, nodeId: input.nodeId,
            skillId, referencedCardIds, createdAt: finishedAt, updatedAt: finishedAt,
            conversationId: deps.id(), messages: suggestionMessages,
          });
        return { status: 'succeeded', startedAt, finishedAt, session };
      }
    }
    let agent: AgentResult | undefined;
    let reasoningContent = '';
    const onReasoningDelta = (delta: string) => {
      if (input.signal.aborted) return;
      reasoningContent += delta;
      input.onReasoningDelta?.(delta);
    };
    if (input.agentMode) {
      if (!input.agentLibrary) throw new AiClientError('unsupported', false);
      agent = await runChatAgent(client, messages, input.agentLibrary, input.signal, input.webSearch, input.onAgentEvent, onReasoningDelta);
    }
    const searchEvents: AgentEvent[] = [];
    const reportSearch = (event: import('../ai/search-gateway').SearchProgress) => {
      const item: AgentEvent = { id: `search-${searchEvents.length}`, round: searchEvents.length + 1, kind: 'tool',
        title: event.stage, status: 'succeeded', startedAt: deps.now(), finishedAt: deps.now(), output: event.detail };
      searchEvents.push(item);
      input.onAgentEvent?.(item);
    };
    const reply = agent ? agent.reply : input.webSearch
      ? await searchThenComplete(client, messages.map(({ role, content }) => ({ role, content })), input.signal, reportSearch, onReasoningDelta)
      : await client.complete(messages.map(({ role, content }) => ({ role, content })), { signal: input.signal, onReasoningDelta });
    if (!agent && input.signal.aborted) {
      return { status: 'stopped', startedAt, finishedAt: deps.now() };
    }
    const finishedAt = deps.now();
    const referencedCardIds = input.referencedCards.map((card) => card.id);
    const session: ChatSession = shaped
      ? {
        ...withActiveConversationMessages(shaped, [
          ...messages.filter((message) => message.role !== 'system'),
          { role: 'assistant', content: reply, reasoningContent: reasoningContent || undefined, webSearch: !!input.webSearch, ...(agent ? { agentEvents: agent.events } : searchEvents.length ? { agentEvents: searchEvents } : {}) },
        ], finishedAt),
        skillId,
        referencedCardIds,
      }
      : createChatSession({
        id: deps.id(),
        workflowId: input.workflowId,
        nodeId: input.nodeId,
        skillId,
        referencedCardIds,
        createdAt: finishedAt,
        updatedAt: finishedAt,
        conversationId: deps.id(),
        messages: [
          ...messages.filter((message) => message.role !== 'system'),
          { role: 'assistant', content: reply, reasoningContent: reasoningContent || undefined, webSearch: !!input.webSearch, ...(agent ? { agentEvents: agent.events } : searchEvents.length ? { agentEvents: searchEvents } : {}) },
        ],
      });
    return { status: agent?.status ?? 'succeeded', startedAt, finishedAt, session, ...(agent?.errorKind ? { errorKind: agent.errorKind } : {}) };
  } catch (error) {
    const finishedAt = deps.now();
    if (
      (error instanceof AiClientError && error.kind === 'stopped')
      || input.signal.aborted
    ) {
      return { status: 'stopped', startedAt, finishedAt };
    }
    return failed(
      startedAt,
      finishedAt,
      error instanceof AiClientError ? error.kind : 'invalid-response',
    );
  }
}

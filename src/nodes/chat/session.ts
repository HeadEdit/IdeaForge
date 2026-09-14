import { message } from 'antd';
import { getAiErrorMessage } from '../../ai/error-messages';
import type { AiErrorKind } from '../../ai/client';
import { activeConversation, appendCompletedQa, buildChatTextStructOutput, completeQaTurns } from '../../domain/chat-conversations';
import { chatOperationKey, type ChatActivity } from '../../domain/execution-progress';
import { NO_CHAT_SKILL } from '../../domain/chat-turns';
import { textInputValues } from '../../domain/workflow-io';
import type { RunChatInput, RunChatResult } from '../../execution/run-chat';
import type { NodeEffectContribution } from '../types';
import { chatConfigSchema, type ChatConfig } from './config';

export interface ChatRuntime {
  runChat(input: RunChatInput): Promise<RunChatResult>;
  id(): string;
  now(): string;
}

export function createChatEffects(runtime: ChatRuntime): NodeEffectContribution<ChatConfig> & { cancelAll(nodeId?: string): void } {
  const operations = new Map<string, { controller: AbortController; agentMode: boolean }>();
  return {
    cancelAll(nodeId) {
      for (const [key, operation] of operations) {
        if (nodeId && JSON.parse(key)[0] !== nodeId) continue;
        operations.delete(key);
        operation.controller.abort();
      }
    },
    session: {
      async send(nodeId, text, capabilities, options) {
        const workflow = capabilities.workflow.getWorkflow();
        const node = capabilities.workflow.getNode(nodeId);
        const parsed = chatConfigSchema.safeParse(node?.config);
        if (!workflow || node?.kind !== 'chat' || !parsed.success || !text.trim()) return;
        const existing = capabilities.sessions.getSession(nodeId);
        if (existing && operations.has(chatOperationKey(nodeId, existing.activeConversationId))) return;
        const skillId = parsed.data.skillId === NO_CHAT_SKILL ? '' : parsed.data.skillId;
        const controller = capabilities.sessions.beginTurn(nodeId, text, skillId);
        const optimistic = capabilities.sessions.getSession(nodeId)!;
        const conversationId = optimistic.activeConversationId;
        const key = chatOperationKey(nodeId, conversationId);
        const operation = { controller, agentMode: parsed.data.agentMode };
        operations.set(key, operation);
        const owns = () => operations.get(key) === operation
          && capabilities.workflow.getWorkflow()?.id === workflow.id
          && !!capabilities.workflow.getNode(nodeId)
          && !!capabilities.sessions.getSession(nodeId)?.conversations.some((c) => c.id === conversationId);
        let activity: ChatActivity = {
          nodeId, conversationId, question: text,
          progress: { stage: '请求 AI', percent: 20, estimated: true }, events: [],
        };
        capabilities.sessions.setActivity?.(key, activity);
        const texts = textInputValues(workflow, nodeId, 'text', { cards: capabilities.cards.listCards() });
        try {
          const result = await runtime.runChat({
            workflowId: workflow.id, nodeId, skillId,
            session: existing ?? { ...optimistic, conversations: optimistic.conversations.map((c) => ({ ...c, messages: [] })) },
            question: text, referencedCards: [],
            referencedText: texts.length ? texts.join('\n\n') : undefined,
            webSearch: parsed.data.webSearch, agentMode: parsed.data.agentMode, signal: controller.signal,
            onAgentEvent: (event) => {
              if (!owns()) return;
              const events = activity.events.some((item) => item.id === event.id)
                ? activity.events.map((item) => item.id === event.id ? event : item)
                : [...activity.events, event];
              activity = { ...activity, events, progress: {
                stage: event.kind === 'tool' ? event.title : `第 ${event.round} 轮请求`,
                percent: Math.min(90, 10 + event.round * 10), estimated: true,
              } };
              capabilities.sessions.setActivity?.(key, activity);
            },
            skipSkillRecommendation: options?.skipSkillRecommendation,
          });
          if (!owns()) return;
          if (result.status === 'failed' && result.errorKind) {
            const kinds = ['auth', 'network-or-cors', 'rate-limit', 'server', 'invalid-response', 'unsupported', 'search-unavailable', 'search-no-results'];
            void message.error(kinds.includes(result.errorKind)
              ? getAiErrorMessage(result.errorKind as AiErrorKind) : '对话请求失败，请重试');
          }
          if (result.session) {
            let next = result.session;
            const conversation = activeConversation(next);
            if (conversation) {
              for (const turn of completeQaTurns(conversation.messages).slice(conversation.itemIds.length)) {
                next = appendCompletedQa(next, conversation.id, turn[0]!.content, turn[1]!.content, runtime);
              }
            }
            capabilities.sessions.completeTurn(nodeId, next);
            const live = capabilities.sessions.getSession(nodeId)!;
            const stillRunning = [...operations.keys()].some((id) => id !== key && JSON.parse(id)[0] === nodeId);
            capabilities.workflow.commitNodeOutput(nodeId, buildChatTextStructOutput(live), stillRunning ? 'running' : result.status);
          } else {
            capabilities.sessions.failTurn(nodeId, result.status === 'stopped' ? 'stopped' : 'failed', conversationId);
          }
        } catch {
          if (owns()) capabilities.sessions.failTurn(nodeId, controller.signal.aborted ? 'stopped' : 'failed', conversationId);
        } finally {
          if (operations.get(key) === operation) {
            operations.delete(key);
            capabilities.sessions.setActivity?.(key, undefined);
          }
        }
      },
      stop(nodeId, capabilities, targetConversationId) {
        const conversationId = targetConversationId ?? capabilities.sessions.getSession(nodeId)?.activeConversationId;
        if (!conversationId) return;
        const key = chatOperationKey(nodeId, conversationId);
        const operation = operations.get(key);
        operation?.controller.abort();
        if (!operation?.agentMode) {
          operations.delete(key);
          capabilities.sessions.setActivity?.(key, undefined);
          capabilities.sessions.failTurn(nodeId, 'stopped', conversationId);
        }
      },
      removeTurns(nodeId, turnIndexes, capabilities) {
        capabilities.sessions.removeTurns(nodeId, turnIndexes);
      },
    },
  };
}

export const chatEffects: NodeEffectContribution<ChatConfig> = {
  createSessionScope: createChatEffects,
  ...createChatEffects({
    runChat: async () => ({ status: 'failed', startedAt: '', finishedAt: '', errorKind: 'unsupported' }),
    id: () => crypto.randomUUID(), now: () => new Date().toISOString(),
  }),
};

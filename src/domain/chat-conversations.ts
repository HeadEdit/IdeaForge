import type {
  ChatBranchMode,
  ChatConversation,
  ChatMessage,
  ChatSession,
  NodeOutput,
  TextStructItem,
  Workflow,
} from './model';
import { groupChatTurns } from './chat-turns';
import {
  aggregateTextStructItems,
  createTextStructItem,
  fallbackTitle,
  formatConversationContent,
  formatQaContent,
} from './text-struct';

export interface ChatClock {
  id: () => string;
  now: () => string;
}

const DEFAULT_CONVERSATION_NAME = /^对话 \d+$/;

export function activeConversation(session: ChatSession): ChatConversation | undefined {
  const conversations = session.conversations ?? [];
  return conversations.find((item) => item.id === session.activeConversationId)
    ?? conversations[0];
}

export function activeConversationMessages(session: ChatSession): ChatMessage[] {
  return activeConversation(session)?.messages ?? [];
}

export function isOpeningContextMessage(message: ChatMessage): boolean {
  return message.role === 'user' && message.content.startsWith('【节点上下文】');
}

export function openingContextTurnOffset(messages: readonly ChatMessage[]): number {
  return messages.length > 0 && isOpeningContextMessage(messages[0]) ? 1 : 0;
}

export function createEmptyConversation(
  input: {
    id: string;
    createdAt: string;
    name?: string;
    messages?: ChatMessage[];
    itemIds?: string[];
    source?: ChatConversation['source'];
  },
  index = 0,
): ChatConversation {
  return {
    id: input.id,
    name: input.name ?? `对话 ${index + 1}`,
    messages: input.messages ?? [],
    itemIds: input.itemIds ?? [],
    createdAt: input.createdAt,
    ...(input.source ? { source: input.source } : {}),
  };
}

export function createChatSession(input: {
  id: string;
  workflowId: string;
  nodeId: string;
  skillId: string;
  referencedCardIds?: string[];
  createdAt: string;
  updatedAt: string;
  conversationId?: string;
  conversationName?: string;
  messages?: ChatMessage[];
  items?: TextStructItem[];
  itemIds?: string[];
}): ChatSession {
  const conversationId = input.conversationId ?? input.id;
  const conversation = createEmptyConversation({
    id: conversationId,
    createdAt: input.createdAt,
    name: input.conversationName,
    messages: input.messages,
    itemIds: input.itemIds,
  });
  return syncExportedItems({
    id: input.id,
    workflowId: input.workflowId,
    nodeId: input.nodeId,
    skillId: input.skillId,
    referencedCardIds: input.referencedCardIds ?? [],
    activeConversationId: conversation.id,
    conversations: [conversation],
    items: input.items ?? [],
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  });
}

function mapConversation(
  session: ChatSession,
  conversationId: string,
  mapper: (conversation: ChatConversation) => ChatConversation,
): ChatSession {
  return {
    ...session,
    conversations: session.conversations.map((conversation) => (
      conversation.id === conversationId ? mapper(conversation) : conversation
    )),
  };
}

export function completeQaTurns(messages: readonly ChatMessage[]): ChatMessage[][] {
  return groupChatTurns(messages).filter((turn) => (
    turn.length === 2
    && turn[0]?.role === 'user'
    && turn[1]?.role === 'assistant'
    && !turn[1]?.skillSuggestion
  ));
}

function locateConversationTurn(
  session: ChatSession,
  conversationId: string,
  itemId: string,
): { conversation: ChatConversation; turn: ChatMessage[] } | undefined {
  const conversation = conversationById(session, conversationId);
  if (!conversation) return undefined;
  const index = conversation.itemIds.indexOf(itemId);
  if (index < 0) return undefined;
  const turn = completeQaTurns(conversation.messages)[index];
  if (!turn) return undefined;
  return { conversation, turn };
}

function conversationItem(conversation: ChatConversation): TextStructItem | undefined {
  const turns = completeQaTurns(conversation.messages);
  if (turns.length === 0) return undefined;
  const firstQuestion = turns[0]![0]!.content;
  const defaultName = DEFAULT_CONVERSATION_NAME.test(conversation.name);
  const fallback = fallbackTitle(firstQuestion);
  return createTextStructItem({
    id: conversation.id,
    turnId: conversation.id,
    createdAt: conversation.createdAt,
    title: conversation.name,
    titleSource: defaultName || conversation.name === fallback ? 'fallback' : 'user',
    content: formatConversationContent(turns.map((turn) => ({
      question: turn[0]!.content,
      answer: turn[1]!.content,
    }))),
  });
}

function conversationOutputItems(session: ChatSession): TextStructItem[] {
  return session.conversations.flatMap((conversation) => {
    const item = conversationItem(conversation);
    return item ? [item] : [];
  });
}

function isLegacyConversationExport(session: ChatSession, item: TextStructItem): boolean {
  const conversation = conversationById(session, item.id);
  return Boolean(conversation && item.turnId === conversation.id);
}

function resolveExportConversationId(session: ChatSession, item: TextStructItem): string | undefined {
  if (item.conversationId) {
    return conversationById(session, item.conversationId) ? item.conversationId : undefined;
  }
  return session.conversations.find((conversation) => conversation.itemIds.includes(item.turnId))?.id;
}

export function syncExportedItems(session: ChatSession): ChatSession {
  const items = session.items.flatMap((item) => {
    if (isLegacyConversationExport(session, item)) return [];
    const conversationId = resolveExportConversationId(session, item);
    if (!conversationId) return [];
    const located = locateConversationTurn(session, conversationId, item.turnId);
    if (!located) return [];
    const question = located.turn[0]!.content;
    const answer = located.turn[1]!.content;
    return [{
      ...item,
      conversationId,
      content: formatQaContent(question, answer),
      title: item.titleSource === 'user' ? item.title : fallbackTitle(question),
    }];
  });
  return { ...session, items: aggregateTextStructItems(items) };
}

export function syncConversationItems(session: ChatSession): ChatSession {
  return syncExportedItems(session);
}

export function exportedTurnId(conversationId: string, itemId: string): string {
  return `${conversationId}:${itemId}`;
}

export function exportConversationTurn(
  session: ChatSession,
  conversationId: string,
  itemId: string,
  updatedAt: string,
): ChatSession {
  const located = locateConversationTurn(session, conversationId, itemId);
  if (!located) return session;
  const id = exportedTurnId(conversationId, itemId);
  if (session.items.some((item) => item.id === id)) {
    return syncExportedItems({ ...session, updatedAt });
  }
  const item = createTextStructItem({
    id,
    turnId: itemId,
    createdAt: updatedAt,
    conversationId,
    question: located.turn[0]!.content,
    answer: located.turn[1]!.content,
  });
  return syncExportedItems({
    ...session,
    items: [...session.items, item],
    updatedAt,
  });
}

export function unexportConversationItem(
  session: ChatSession,
  itemId: string,
  updatedAt: string,
): ChatSession {
  return syncExportedItems({
    ...session,
    items: session.items.filter((item) => item.id !== itemId),
    updatedAt,
  });
}

function conversationById(session: ChatSession, conversationId: string): ChatConversation | undefined {
  return session.conversations.find((conversation) => conversation.id === conversationId);
}

function messagesThroughItem(
  conversation: ChatConversation,
  itemId: string,
): ChatMessage[] | undefined {
  const index = conversation.itemIds.indexOf(itemId);
  if (index < 0) return undefined;
  return completeQaTurns(conversation.messages).slice(0, index + 1).flat();
}

function conversationHasUserContent(conversation: ChatConversation | undefined): boolean {
  return (conversation?.messages ?? []).some((message) => (
    message.role !== 'system' && !isOpeningContextMessage(message)
  ));
}

export function startNewConversation(
  session: ChatSession,
  clock: ChatClock,
): ChatSession {
  const active = activeConversation(session);
  if (active && !conversationHasUserContent(active)) {
    return session.activeConversationId === active.id
      ? session
      : { ...session, activeConversationId: active.id, updatedAt: clock.now() };
  }
  const createdAt = clock.now();
  const conversation = createEmptyConversation({
    id: clock.id(),
    createdAt,
  }, session.conversations.length);
  return {
    ...session,
    conversations: [...session.conversations, conversation],
    activeConversationId: conversation.id,
    updatedAt: createdAt,
  };
}

export function setActiveConversation(
  session: ChatSession,
  conversationId: string,
  updatedAt: string,
): ChatSession {
  if (!conversationById(session, conversationId)) return session;
  return { ...session, activeConversationId: conversationId, updatedAt };
}

export function renameConversation(
  session: ChatSession,
  conversationId: string,
  name: string,
  updatedAt: string,
): ChatSession {
  const trimmed = name.trim();
  if (!trimmed) return session;
  return syncConversationItems({
    ...mapConversation(session, conversationId, (conversation) => ({
      ...conversation,
      name: trimmed,
    })),
    updatedAt,
  });
}

export function withActiveConversationMessages(
  session: ChatSession,
  messages: ChatMessage[],
  updatedAt: string,
): ChatSession {
  const conversation = activeConversation(session);
  if (!conversation) return session;
  return syncConversationItems({
    ...mapConversation(session, conversation.id, (current) => ({
      ...current,
      messages,
    })),
    updatedAt,
  });
}

export function appendCompletedQa(
  session: ChatSession,
  conversationId: string,
  question: string,
  answer: string,
  clock: ChatClock,
  title?: string,
): ChatSession {
  const conversation = conversationById(session, conversationId);
  if (!conversation) return session;
  const createdAt = clock.now();
  const turnId = clock.id();
  const lastUser = conversation.messages[conversation.messages.length - 2];
  const lastAssistant = conversation.messages[conversation.messages.length - 1];
  const alreadyRecorded = lastUser?.role === 'user'
    && lastUser.content === question
    && lastAssistant?.role === 'assistant'
    && lastAssistant.content === answer;
  const nextName = conversation.itemIds.length === 0 && DEFAULT_CONVERSATION_NAME.test(conversation.name)
    ? (title?.trim() || fallbackTitle(question))
    : conversation.name;
  return syncConversationItems({
    ...mapConversation(session, conversationId, (current) => ({
      ...current,
      name: nextName,
      messages: alreadyRecorded
        ? current.messages
        : [
          ...current.messages.filter((message) => message.role !== 'system'),
          { role: 'user', content: question },
          { role: 'assistant', content: answer },
        ],
      itemIds: [...current.itemIds, turnId],
    })),
    updatedAt: createdAt,
  });
}

export function omitConversationTurns(
  session: ChatSession,
  conversationId: string,
  turnIndexes: readonly number[],
  updatedAt: string,
): ChatSession {
  const conversation = conversationById(session, conversationId);
  if (!conversation) return session;
  const drop = new Set(turnIndexes);
  const turns = groupChatTurns(conversation.messages);
  const keptTurns: ChatMessage[][] = [];
  const nextItemIds: string[] = [];
  let completeIndex = -1;
  for (const [index, turn] of turns.entries()) {
    const complete = turn.length === 2
      && turn[0]?.role === 'user'
      && turn[1]?.role === 'assistant'
      && !turn[1]?.skillSuggestion;
    if (complete) completeIndex += 1;
    if (drop.has(index)) continue;
    keptTurns.push(turn);
    if (complete) {
      const itemId = conversation.itemIds[completeIndex];
      if (itemId) nextItemIds.push(itemId);
    }
  }
  return syncConversationItems({
    ...mapConversation(session, conversationId, (current) => ({
      ...current,
      messages: keptTurns.flat(),
      itemIds: nextItemIds,
    })),
    updatedAt,
  });
}

export function forkFullContextConversation(
  session: ChatSession,
  conversationId: string,
  itemId: string,
  clock: ChatClock,
): ChatSession {
  const source = conversationById(session, conversationId);
  if (!source) return session;
  const index = source.itemIds.indexOf(itemId);
  const messages = messagesThroughItem(source, itemId);
  if (index < 0 || !messages) return session;
  const createdAt = clock.now();
  const conversation = createEmptyConversation({
    id: clock.id(),
    createdAt,
    name: `对话 ${session.conversations.length + 1}`,
    messages,
    itemIds: source.itemIds.slice(0, index + 1),
    source: { conversationId: source.id, itemId, mode: 'full-context' },
  }, session.conversations.length);
  return syncConversationItems({
    ...session,
    conversations: [...session.conversations, conversation],
    activeConversationId: conversation.id,
    updatedAt: createdAt,
  });
}

export function forkSingleTurnConversation(
  session: ChatSession,
  conversationId: string,
  itemId: string,
  clock: ChatClock,
): { session: ChatSession; seedUserText: string } {
  const source = conversationById(session, conversationId);
  const index = source?.itemIds.indexOf(itemId) ?? -1;
  const turn = source ? completeQaTurns(source.messages)[index] : undefined;
  const seedUserText = turn?.[1]?.content ?? '';
  if (!source || index < 0 || !turn) {
    return { session, seedUserText: '' };
  }
  const createdAt = clock.now();
  const conversation = createEmptyConversation({
    id: clock.id(),
    createdAt,
    name: `对话 ${session.conversations.length + 1}`,
    messages: [{
      role: 'user',
      content: `【节点上下文】\n引用文本：\n${formatQaContent(turn[0]!.content, turn[1]!.content)}`,
    }],
    source: { conversationId: source.id, itemId, mode: 'single-turn' },
  }, session.conversations.length);
  return {
    session: syncConversationItems({
      ...session,
      conversations: [...session.conversations, conversation],
      activeConversationId: conversation.id,
      updatedAt: createdAt,
    }),
    seedUserText,
  };
}

export function deleteConversation(
  session: ChatSession,
  conversationId: string,
  updatedAt: string,
): ChatSession {
  if (session.conversations.length <= 1) {
    const only = session.conversations[0];
    if (!only) return session;
    return syncConversationItems({
      ...session,
      conversations: [{ ...only, messages: [], itemIds: [] }],
      updatedAt,
    });
  }
  const conversations = session.conversations.filter((conversation) => conversation.id !== conversationId);
  const activeConversationId = session.activeConversationId === conversationId
    ? conversations[0]!.id
    : session.activeConversationId;
  return syncConversationItems({
    ...session,
    conversations,
    activeConversationId,
    updatedAt,
  });
}

export function updateItemTitle(
  session: ChatSession,
  itemId: string,
  title: string,
  updatedAt: string,
): ChatSession {
  const trimmed = title.trim();
  if (!trimmed) return session;
  if (!session.items.some((item) => item.id === itemId)) {
    return renameConversation(session, itemId, trimmed, updatedAt);
  }
  return syncExportedItems({
    ...session,
    items: session.items.map((item) => (
      item.id === itemId
        ? { ...item, title: trimmed, titleSource: 'user', titleUpdatedAt: updatedAt }
        : item
    )),
    updatedAt,
  });
}

export function buildChatTextStructOutput(session: ChatSession): NodeOutput {
  const synced = syncExportedItems(session);
  return {
    type: 'TextStruct',
    items: [...conversationOutputItems(synced), ...synced.items],
  };
}

export function withChatTextStructOutputs(
  workflow: Workflow,
  sessions: readonly ChatSession[],
): Workflow {
  const byNodeId = new Map(
    sessions
      .filter((session) => session.workflowId === workflow.id)
      .map((session) => [session.nodeId, session]),
  );
  return {
    ...workflow,
    nodes: workflow.nodes.map((node) => {
      const session = byNodeId.get(node.id);
      return session
        ? { ...node, output: buildChatTextStructOutput(session) }
        : node;
    }),
  };
}

export type { ChatBranchMode };

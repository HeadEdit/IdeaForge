import { Button, Cascader, Checkbox, Dropdown, Switch } from 'antd';
import { ArrowUp, Copy, Download, MessageSquareText, Pencil, Plus, Send, Square, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';

import type { ChatMessage } from '../../domain/model';
import { chatOperationKey } from '../../domain/execution-progress';
import { AgentTimeline } from '../../features/chat/AgentTimeline';
import { ExecutionProgressView } from '../../components/ExecutionProgressView';
import { activeConversationMessages, completeQaTurns, exportedTurnId, isOpeningContextMessage } from '../../domain/chat-conversations';
import { ensureChatSessionShape } from '../../domain/chat-session-migrate';
import { groupChatTurns, NO_CHAT_SKILL } from '../../domain/chat-turns';
import { textInputValues } from '../../domain/workflow-io';
import { formatNodeContext } from '../../ai/prompts';
import type { AppStore } from '../../state/use-app-store';
import { AppDialog } from '../../components/AppDialog';
import { SafeMarkdown } from '../../features/chat/SafeMarkdown';
import type { NodeUiContribution } from '../types';
import { getSkill } from '../../skills';
import { chatConfigSchema, type ChatConfig } from './config';
import {
  chatSkillIdToMenuPath,
  chatSkillMenuPathToId,
  listChatSkillMenuOptions,
} from './skill-menu';

export function ChatDialog({
  open,
  store,
  nodeId,
  onClose,
}: {
  open: boolean;
  store: AppStore;
  nodeId: string;
  onClose: () => void;
}) {
  const workflow = useStore(store, (state) => state.workflow);
  const sessions = useStore(store, (state) => state.sessions);
  const activities = useStore(store, (state) => state.chatActivities);
  const cards = useStore(store, (state) => state.cards ?? []);
  const executionAvailable = store.getState().isExecutionAvailable();
  const capabilities = useMemo(() => store.getState().getHostCapabilities(), [store]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [editText, setEditText] = useState('');
  const [editingTurnIndex, setEditingTurnIndex] = useState<number>();
  const [pendingByConversation, setPending] = useState<Record<string, { text: string; token: symbol }>>({});
  const [copiedIndex, setCopiedIndex] = useState<number>();
  const [highlightedTurnId, setHighlightedTurnId] = useState<string>();
  const [deleting, setDeleting] = useState(false);
  const [selectedTurns, setSelectedTurns] = useState<Set<number>>(new Set());
  const scrollerRef = useRef<HTMLDivElement>(null);
  const node = workflow?.nodes.find((item) => item.id === nodeId);
  const parsed = chatConfigSchema.safeParse(node?.config);
  const rawSession = sessions.find((item) => item.workflowId === workflow?.id && item.nodeId === nodeId);
  const session = useMemo(
    () => (rawSession ? ensureChatSessionShape(rawSession) : undefined),
    [rawSession],
  );
  const storedMessages = useMemo(
    () => (session ? activeConversationMessages(session) : []),
    [session],
  );
  const conversationKey = chatOperationKey(nodeId, session?.activeConversationId ?? 'new');
  const activity = activities?.[conversationKey];
  const pending = pendingByConversation[conversationKey];
  const text = drafts[conversationKey] ?? '';
  const setText = (value: string) => setDrafts((current) => ({ ...current, [conversationKey]: value }));
  const storedOpening = storedMessages.find(isOpeningContextMessage);
  const openingTurnOffset = storedMessages[0] && isOpeningContextMessage(storedMessages[0]) ? 1 : 0;
  const hasTranscript = storedMessages.some((message) => (
    message.role !== 'system' && !isOpeningContextMessage(message)
  ));
  const liveOpening = useMemo(() => {
    if (storedOpening || hasTranscript || !workflow) return undefined;
    const texts = textInputValues(workflow, nodeId, 'text', { cards });
    if (texts.length === 0) return undefined;
    return formatNodeContext([], texts.join('\n\n'));
  }, [storedOpening, hasTranscript, workflow, nodeId, cards]);
  const openingContent = storedOpening?.content ?? liveOpening;
  const busy = !!activity || !!pending || (activities === undefined && node?.status === 'running');
  const nodeBusy = node?.status === 'running';
  const messages = useMemo(() => {
    const visible = storedMessages.filter((message) => (
      message.role !== 'system' && !isOpeningContextMessage(message)
    ));
    const last = visible[visible.length - 1];
    if (pending?.text && !(last?.role === 'user' && last.content === pending.text)) {
      return [...visible, { role: 'user' as const, content: pending.text }];
    }
    return visible;
  }, [storedMessages, pending, nodeId]);
  const hasPendingSkillSuggestion = messages.some((message) => message.skillSuggestion !== undefined);
  const turns = useMemo(() => groupChatTurns(messages), [messages]);
  const skillOptions = listChatSkillMenuOptions();

  useEffect(() => {
    setEditText('');
    setEditingTurnIndex(undefined);
    setDeleting(false);
    setSelectedTurns(new Set());
    setCopiedIndex(undefined);
  }, [nodeId]);

  useEffect(() => {
    setEditText('');
    setEditingTurnIndex(undefined);
    setDeleting(false);
    setSelectedTurns(new Set());
  }, [session?.activeConversationId]);

  useEffect(() => {
    if (busy) {
      setEditingTurnIndex(undefined);
      setEditText('');
    }
  }, [busy]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || highlightedTurnId) return;
    scroller.scrollTop = scroller.scrollHeight;
  }, [messages, busy, highlightedTurnId]);

  useEffect(() => {
    if (!highlightedTurnId) return;
    const scroller = scrollerRef.current;
    const turn = scroller?.querySelector(`[data-turn-id="${highlightedTurnId}"]`);
    if (turn && 'scrollIntoView' in turn && typeof turn.scrollIntoView === 'function') {
      turn.scrollIntoView({ block: 'center' });
    }
    const timer = window.setTimeout(() => setHighlightedTurnId(undefined), 900);
    return () => window.clearTimeout(timer);
  }, [highlightedTurnId, messages]);

  const send = async () => {
    if (!node || !text.trim() || busy || !executionAvailable || deleting || editingTurnIndex !== undefined) {
      return;
    }
    const question = text.trim();
    const token = Symbol('pending');
    const key = conversationKey;
    setPending((current) => ({ ...current, [key]: { text: question, token } }));
    setText('');
    try {
      await capabilities.sessions.send(node.id, question);
    } finally {
      setPending((current) => {
        if (current[key]?.token !== token) return current;
        const next = { ...current }; delete next[key]; return next;
      });
    }
  };

  const startEditLastMessage = (turnIndex: number, content: string) => {
    if (busy || deleting || editingTurnIndex !== undefined) return;
    setEditingTurnIndex(turnIndex);
    setEditText(content);
  };

  const cancelEdit = () => {
    setEditingTurnIndex(undefined);
    setEditText('');
  };

  const commitEdit = async () => {
    if (!node || !editText.trim() || busy || editingTurnIndex === undefined || !executionAvailable) {
      return;
    }
    const question = editText.trim();
    const turnIndex = editingTurnIndex;
    setEditingTurnIndex(undefined);
    setEditText('');
    await capabilities.sessions.editLastMessage(node.id, turnIndex, question);
  };

  const copyMessage = async (content: string, index: number) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedIndex(index);
      window.setTimeout(() => setCopiedIndex((current) => (current === index ? undefined : current)), 1500);
    } catch {
      /* clipboard may be unavailable in tests */
    }
  };

  const toggleTurn = (index: number, checked: boolean) => {
    setSelectedTurns((current) => {
      const next = new Set(current);
      if (checked) next.add(index);
      else next.delete(index);
      return next;
    });
  };

  const exitDeleteMode = () => {
    setDeleting(false);
    setSelectedTurns(new Set());
  };

  const confirmDelete = () => {
    if (!selectedTurns.size) return;
    capabilities.sessions.removeTurns(
      nodeId,
      [...selectedTurns].map((index) => index + openingTurnOffset),
    );
    exitDeleteMode();
  };

  const itemIdForTurn = (turn: ChatMessage[]): string | undefined => {
    if (!session) return undefined;
    const complete = completeQaTurns(messages);
    const match = complete.findIndex((candidate) => (
      candidate[0]?.content === turn[0]?.content
      && candidate[1]?.content === turn[1]?.content
    ));
    if (match < 0) return undefined;
    return session.conversations.find((item) => item.id === session.activeConversationId)
      ?.itemIds[match];
  };

  const allSelected = turns.length > 0 && selectedTurns.size === turns.length;
  const skillId = parsed.success && parsed.data.skillId ? parsed.data.skillId : NO_CHAT_SKILL;
  const conversations = session?.conversations ?? [];
  const exportedItems = session?.items ?? [];
  const editing = editingTurnIndex !== undefined;
  const lastTurnIndex = turns.length > 0 ? turns.length - 1 : -1;

  return (
    <AppDialog open={open && !!node} title="聊天" onClose={onClose}>
      <div className={`chat-dialog${editing ? ' is-editing' : ''}${busy ? ' is-busy' : ''}`}>
        <aside className="chat-dialog__sidebar" aria-label="聊天侧栏">
          <nav className="chat-dialog__sidebar-section chat-dialog__sidebar-section--conversations" aria-label="对话列表">
          <div className="chat-dialog__sidebar-heading">
            <span>对话</span>
            <button
              type="button"
              className="chat-dialog__new-conversation"
              aria-label="创建新对话"
              onClick={() => capabilities.sessions.createConversation(nodeId)}
            >
              <Plus size={14} />
              新对话
            </button>
          </div>
          {conversations.length === 0 ? (
            <p className="chat-dialog__sidebar-empty">暂无对话</p>
          ) : conversations.map((conversation) => (
            <div
              key={conversation.id}
              className={
                conversation.id === session?.activeConversationId
                  ? 'chat-dialog__conversation chat-dialog__conversation--active'
                  : 'chat-dialog__conversation'
              }
            >
              <button
                type="button"
                className="chat-dialog__conversation-name"
                aria-current={conversation.id === session?.activeConversationId ? 'true' : undefined}
                title={conversation.name}
                onClick={() => capabilities.sessions.setActiveConversation(nodeId, conversation.id)}
                onDoubleClick={() => {
                  const next = window.prompt('重命名对话', conversation.name)?.trim();
                  if (next) capabilities.sessions.renameConversation(nodeId, conversation.id, next);
                }}
              >
                {conversation.name}
                {activities?.[chatOperationKey(nodeId, conversation.id)] && <small> · 运行中</small>}
              </button>
              <button
                type="button"
                className="chat-dialog__conversation-delete"
                aria-label={`删除对话 ${conversation.name}`}
                disabled={!!activities?.[chatOperationKey(nodeId, conversation.id)]}
                onClick={() => capabilities.sessions.deleteConversation(nodeId, conversation.id)}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          </nav>
          <section className="chat-dialog__sidebar-section chat-dialog__sidebar-section--exports" aria-label="导出列表">
            <div className="chat-dialog__sidebar-heading">
              <span>导出</span>
              <span>{exportedItems.length}</span>
            </div>
            {exportedItems.length === 0 ? (
              <p className="chat-dialog__sidebar-empty">暂无导出</p>
            ) : (
              <div className="chat-dialog__export-list">
                {exportedItems.map((item) => {
                  const conversation = conversations.find((entry) => entry.id === item.conversationId);
                  const turnIndex = conversation?.itemIds.indexOf(item.turnId) ?? -1;
                  return (
                    <div
                      key={item.id}
                      className={
                        highlightedTurnId === item.turnId && conversation?.id === session?.activeConversationId
                          ? 'chat-dialog__export-item chat-dialog__export-item--active'
                          : 'chat-dialog__export-item'
                      }
                    >
                      <button
                        type="button"
                        className="chat-dialog__export-link"
                        aria-label={`跳转到导出 ${item.title}`}
                        onClick={() => {
                          if (item.conversationId) {
                            capabilities.sessions.setActiveConversation(nodeId, item.conversationId);
                          }
                          setHighlightedTurnId(item.turnId);
                        }}
                        onDoubleClick={() => {
                          const next = window.prompt('重命名导出', item.title)?.trim();
                          if (next) capabilities.sessions.updateItemTitle(nodeId, item.id, next);
                        }}
                      >
                        <span className="chat-dialog__export-title">{item.title}</span>
                        <span className="chat-dialog__export-meta">
                          {conversation?.name ?? '未知对话'}
                          {turnIndex >= 0 ? ` · 第 ${turnIndex + 1} 轮` : ''}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="chat-dialog__export-remove"
                        aria-label={`取消导出 ${item.title}`}
                        onClick={() => capabilities.sessions.unexportItem(nodeId, item.id)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </aside>
        <div className="chat-dialog__main">
        <div className="chat-dialog__pane">
          <Dropdown
            trigger={['contextMenu']}
            menu={{
              items: [{
                key: 'delete',
                label: '删除',
                disabled: busy || turns.length === 0,
                onClick: () => {
                  setDeleting(true);
                  setSelectedTurns(new Set());
                },
              }],
            }}
          >
          <div ref={scrollerRef} className="chat-dialog__messages" aria-live="polite">
            {openingContent && (
              <aside className="chat-dialog__opening" aria-label="开场上下文">
                <p className="chat-dialog__opening-label">开场上下文</p>
                <div className="chat-dialog__opening-body">{openingContextBody(openingContent)}</div>
              </aside>
            )}
            {turns.map((turn, turnIndex) => {
              const complete = turn.length === 2
                && turn[0]?.role === 'user'
                && turn[1]?.role === 'assistant'
                && !turn[1]?.skillSuggestion;
              const itemId = complete ? itemIdForTurn(turn) : undefined;
              const isEditingTurn = editing && turnIndex === editingTurnIndex;
              const isLastTurn = turnIndex === lastTurnIndex;
              return (
                <div
                  key={turnIndex}
                  data-turn-id={itemId}
                  className={`chat-dialog__turn${isEditingTurn ? ' is-stale' : ''}${
                    itemId && highlightedTurnId === itemId ? ' is-highlight' : ''
                  }`}
                >
                  {deleting && (
                    <Checkbox
                      aria-label={`选择第 ${turnIndex + 1} 组对话`}
                      checked={selectedTurns.has(turnIndex)}
                      onChange={(event) => toggleTurn(turnIndex, event.target.checked)}
                    />
                  )}
                  <div className="chat-dialog__turn-body">
                    {turn.map((message, messageIndex) => (
                      <div key={`${message.role}-${messageIndex}`}>
                      <ChatBubble
                        key={`${message.role}-${messageIndex}`}
                        message={message}
                        copied={copiedIndex === turnIndex * 10 + messageIndex}
                        onCopy={() => void copyMessage(message.content, turnIndex * 10 + messageIndex)}
                        onEdit={message.role === 'user' && isLastTurn && !deleting ? () => {
                          startEditLastMessage(turnIndex, message.content);
                        } : undefined}
                        showUserActions={message.role === 'user' && isLastTurn && !deleting}
                        editDisabled={busy || editing}
                        onBranch={complete && itemId && message.role === 'assistant' ? () => {
                          if (!session) return;
                          capabilities.sessions.forkConversation(
                            nodeId,
                            'full-context',
                            session.activeConversationId,
                            itemId,
                          );
                        } : undefined}
                        onExport={complete && itemId && message.role === 'assistant' ? () => {
                          if (!session) return;
                          const exportId = exportedTurnId(session.activeConversationId, itemId);
                          const exported = exportedItems.some((item) => item.id === exportId);
                          if (exported) {
                            capabilities.sessions.unexportItem(nodeId, exportId);
                            return;
                          }
                          capabilities.sessions.exportTurn(
                            nodeId,
                            session.activeConversationId,
                            itemId,
                          );
                        } : undefined}
                        exported={Boolean(
                          itemId
                          && session
                          && exportedItems.some((item) => (
                            item.id === exportedTurnId(session.activeConversationId, itemId)
                          )),
                        )}
                        branchDisabled={busy || !session}
                        suggestionDisabled={busy || !executionAvailable}
                        onAcceptSuggestion={message.skillSuggestion ? () => {
                          if (busy || !executionAvailable) return;
                          capabilities.sessions.setSkill(nodeId, message.skillSuggestion!.suggestedSkillId);
                          void capabilities.sessions.editLastMessage(nodeId, turnIndex, turn[0]?.content ?? '');
                        } : undefined}
                        onDeclineSuggestion={message.skillSuggestion ? () => {
                          if (busy || !executionAvailable) return;
                          void capabilities.sessions.editLastMessage(
                            nodeId, turnIndex, turn[0]?.content ?? '', { skipSkillRecommendation: true },
                          );
                        } : undefined}
                      />
                      {message.agentEvents && <AgentTimeline events={message.agentEvents} />}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
            {busy && (
              <div className="chat-dialog__assistant-wrap">
                <p className="chat-dialog__thinking">正在思考</p>
                {activity && <ExecutionProgressView progress={activity.progress} />}
                {activity && <AgentTimeline events={activity.events} />}
                <div className="chat-dialog__typing" aria-label="正在生成">
                  <span /><span /><span />
                </div>
              </div>
            )}
            {!messages.length && !busy && !openingContent && (
              <p className="chat-dialog__empty">开始提问，围绕节点上下文继续讨论。</p>
            )}
          </div>
          </Dropdown>
        </div>
        {deleting ? (
          <div className="chat-dialog__delete-bar">
            <Checkbox
              aria-label="全选"
              checked={allSelected}
              onChange={(event) => {
                setSelectedTurns(event.target.checked
                  ? new Set(turns.map((_, index) => index))
                  : new Set());
              }}
            >
              全选
            </Checkbox>
            <Button
              type="text"
              aria-label="删除所选对话"
              icon={<Trash2 size={18} />}
              disabled={!selectedTurns.size}
              onClick={confirmDelete}
            >
              删除
            </Button>
            <Button type="text" aria-label="退出删除" icon={<X size={18} />} onClick={exitDeleteMode} />
          </div>
        ) : (
          <>
            {!editing ? (
              <div className="chat-dialog__composer">
                <div className="chat-dialog__composer-tools">
                  <label className="chat-dialog__skill">
                    技能
                    <Cascader
                      disabled={nodeBusy}
                      allowClear={false}
                      aria-label="对话技能"
                      value={chatSkillIdToMenuPath(skillId)}
                      options={skillOptions}
                      displayRender={(labels) => labels[labels.length - 1]}
                      onChange={(path) => {
                        if (!path?.length) return;
                        capabilities.sessions.setSkill(nodeId, chatSkillMenuPathToId(path));
                      }}
                      style={{ width: '100%' }}
                    />
                  </label>
                  <Checkbox
                    aria-label="联网搜索"
                    title="仅支持 DeepSeek 模型"
                    checked={parsed.success && parsed.data.webSearch}
                    disabled={nodeBusy}
                    onChange={(event) => {
                      capabilities.workflow.patchConfig(nodeId, { webSearch: event.target.checked });
                    }}
                  >
                    联网搜索
                  </Checkbox>
                  <label className="chat-dialog__agent-toggle">
                    <Switch
                      aria-label="Agent 模式"
                      checked={parsed.success && parsed.data.agentMode}
                      disabled={nodeBusy}
                      onChange={(agentMode) => capabilities.workflow.patchConfig(nodeId, { agentMode })}
                      size="small"
                    />
                    Agent 模式
                  </label>
                </div>
                {parsed.success && parsed.data.agentMode && (
                  <div className="chat-dialog__agent-hint">可查询、新建、修改和删除当前资料库文档；操作会自动保存。</div>
                )}
                <div className="chat-dialog__input-row">
                  <textarea
                    aria-label="输入消息"
                    value={text}
                    placeholder="输入消息，Enter 发送，Shift+Enter 换行"
                    onChange={(event) => setText(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        void send();
                      }
                    }}
                    disabled={busy || hasPendingSkillSuggestion}
                  />
                  <Button
                    type="primary"
                    shape="circle"
                    aria-label={busy ? '停止生成' : '发送'}
                    icon={busy ? <Square size={15} /> : <Send size={15} />}
                    onClick={() => {
                      if (!busy) { void send(); return; }
                      capabilities.sessions.stop(nodeId);
                      setPending((current) => { const next = { ...current }; delete next[conversationKey]; return next; });
                    }}
                    disabled={!busy && (!executionAvailable || !text.trim() || hasPendingSkillSuggestion)}
                  />
                </div>
              </div>
            ) : (
              <div className="chat-dialog__edit-composer is-visible">
                <div className="chat-dialog__edit-label">
                  <span>正在编辑 <strong>最后一条消息</strong></span>
                  <span>发送后将重新生成回复</span>
                </div>
                <div className="chat-dialog__edit-shell">
                  <textarea
                    aria-label="编辑消息"
                    value={editText}
                    placeholder="编辑你的问题…"
                    onChange={(event) => setEditText(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        void commitEdit();
                      }
                      if (event.key === 'Escape') {
                        event.preventDefault();
                        cancelEdit();
                      }
                    }}
                    disabled={busy}
                  />
                  <div className="chat-dialog__edit-toolbar">
                    <span className="chat-dialog__edit-hint">Enter 发送 · Shift+Enter 换行 · Esc 取消</span>
                    <div className="chat-dialog__edit-actions">
                      <button type="button" className="chat-dialog__edit-cancel" onClick={cancelEdit}>
                        取消
                      </button>
                      <button
                        type="button"
                        className="chat-dialog__edit-send"
                        aria-label="重新发送"
                        disabled={busy || !editText.trim() || !executionAvailable}
                        onClick={() => void commitEdit()}
                      >
                        <ArrowUp size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
        </div>
      </div>
    </AppDialog>
  );
}

function openingContextBody(content: string): string {
  return content
    .replace(/^【节点上下文】\n?/, '')
    .replace(/^引用文本：\n?/, '')
    .trim();
}

function ChatBubble({
  message,
  copied,
  onCopy,
  onEdit,
  showUserActions,
  editDisabled,
  onBranch,
  onExport,
  exported,
  branchDisabled,
  onAcceptSuggestion,
  onDeclineSuggestion,
  suggestionDisabled,
}: {
  message: ChatMessage;
  copied: boolean;
  onCopy: () => void;
  onEdit?: () => void;
  showUserActions?: boolean;
  editDisabled?: boolean;
  onBranch?: () => void;
  onExport?: () => void;
  exported?: boolean;
  branchDisabled?: boolean;
  onAcceptSuggestion?: () => void;
  onDeclineSuggestion?: () => void;
  suggestionDisabled?: boolean;
}) {
  if (message.role === 'user') {
    return (
      <div className="chat-dialog__message chat-dialog__message--user">
        <div className="chat-dialog__user-wrap">
          <div className="chat-dialog__bubble">{message.content}</div>
          {showUserActions ? (
            <div className="chat-dialog__user-actions">
              <button
                type="button"
                className="chat-dialog__icon-btn"
                aria-label="编辑消息"
                disabled={editDisabled}
                onClick={onEdit}
              >
                <Pencil size={15} />
              </button>
              <button
                type="button"
                className="chat-dialog__icon-btn"
                aria-label="复制消息"
                onClick={onCopy}
              >
                <Copy size={15} />
              </button>
            </div>
          ) : null}
        </div>
      </div>
    );
  }
  if (message.skillSuggestion) {
    const skillName = getSkill(message.skillSuggestion.suggestedSkillId)?.name
      ?? message.skillSuggestion.suggestedSkillId;
    return (
      <div className="chat-dialog__skill-suggestion" role="status">
        <strong>建议切换到「{skillName}」</strong>
        <p>{message.skillSuggestion.reason}</p>
        <div className="chat-dialog__skill-suggestion-actions">
          <Button type="primary" size="small" disabled={suggestionDisabled} onClick={onAcceptSuggestion}>切换并重新回答</Button>
          <Button size="small" disabled={suggestionDisabled} onClick={onDeclineSuggestion}>继续当前技能</Button>
        </div>
      </div>
    );
  }
  return (
    <div className="chat-dialog__message chat-dialog__message--assistant">
      <div className="chat-dialog__assistant-wrap">
        <SafeMarkdown content={message.content} />
        <div className="chat-dialog__actions">
          <button type="button" className="chat-dialog__copy" onClick={onCopy} aria-label="复制回复">
            <Copy size={14} />
            {copied ? '已复制' : '复制'}
          </button>
          {onBranch && (
            <button
              type="button"
              className="chat-dialog__copy"
              onClick={onBranch}
              aria-label="分支"
              disabled={branchDisabled}
            >
              分支
            </button>
          )}
          {onExport && (
            <button
              type="button"
              className={`chat-dialog__copy${exported ? ' is-exported' : ''}`}
              onClick={onExport}
              aria-label={exported ? '已导出' : '设为导出'}
              disabled={branchDisabled}
            >
              <Download size={14} />
              {exported ? '已导出' : '设为导出'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export const chatUi: NodeUiContribution<ChatConfig> = {
  label: '聊天',
  icon: MessageSquareText,
  theme: { headerBackground: '#eefaf6', glyphColor: '#0f8a6a' },
  Dialog: ChatDialog as never,
};

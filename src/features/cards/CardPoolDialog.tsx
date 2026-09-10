import { Button, Modal, Popconfirm } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useStore } from 'zustand';

import {
  defaultIdeaScoreSort,
  isIdeaScoreReportStale,
  nextIdeaScoreSort,
  readIdeaScoreReportState,
  sortIdeaScoreReportCards,
  sortedIdeaScoreOutputCardIds,
} from '../../domain/idea-score-report';
import type { CandidateCard } from '../../domain/model';
import { requireCardVariableSource } from '../../domain/require-card-variable-source';
import {
  findIdeaScoreNodeForVariable,
  variablePoolCardIds,
} from '../../domain/workflow-io';
import type { AppStore } from '../../state/use-app-store';
import { AppDialog } from '../../components/AppDialog';
import { CardDetail } from './CardDetail';
import { CardEditForm, type CandidateCardEditValues } from './CardEditForm';
import { IdeaCard } from './IdeaCard';
import { ScoreReportMatrix } from './ScoreReportMatrix';
import { formatMethodLabel } from '../../skills';
import { ideaScoreConfigSchema } from '../../nodes/idea-score/config';
import { cardVariableConfigSchema } from '../../nodes/card-variable/config';

function poolTitle(config: unknown, fallback: string): string {
  const parsed = cardVariableConfigSchema.safeParse(config);
  const name = parsed.success ? parsed.data.name.trim() : '';
  return name || fallback;
}

export function CardPoolDialog({
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
  const cards = useStore(store, (state) => state.cards);
  const workflow = useStore(store, (state) => state.workflow);
  const variableNode = workflow?.nodes.find((item) => item.id === nodeId);
  const dialogTitle = variableNode
    ? poolTitle(variableNode.config, '卡片池')
    : '卡片池';

  const [tab, setTab] = useState<'browse' | 'report'>('browse');
  const [query, setQuery] = useState('');
  const [method, setMethod] = useState('');
  const [tag, setTag] = useState('');
  const [vote, setVote] = useState('');
  const [deleteMode, setDeleteMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [detailCardId, setDetailCardId] = useState<string | null>(null);
  const [detailEditing, setDetailEditing] = useState(false);

  useEffect(() => {
    if (!open) {
      setDeleteMode(false);
      setSelectedIds(new Set());
    }
  }, [open]);
  const detailCard = detailCardId
    ? cards.find((item) => item.id === detailCardId) ?? null
    : null;

  const openDetail = (card: CandidateCard, editing = false) => {
    setDetailCardId(card.id);
    setDetailEditing(editing);
  };

  const closeDetail = () => {
    setDetailCardId(null);
    setDetailEditing(false);
  };

  const saveDetail = (values: CandidateCardEditValues) => {
    if (!detailCardId) return;
    store.getState().getHostCapabilities().cards.updateCard(detailCardId, values);
    setDetailEditing(false);
  };

  const deleteCard = (cardId: string) => {
    store.getState().getHostCapabilities().cards.deleteCard(nodeId, cardId);
    if (detailCardId === cardId) {
      closeDetail();
    }
  };

  const exitDeleteMode = () => {
    setDeleteMode(false);
    setSelectedIds(new Set());
  };

  const toggleSelected = (cardId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(cardId)) next.delete(cardId);
      else next.add(cardId);
      return next;
    });
  };

  const deleteSelected = () => {
    for (const cardId of selectedIds) {
      deleteCard(cardId);
    }
    exitDeleteMode();
  };

  const ids = variablePoolCardIds(workflow, nodeId);
  const workflowCards = workflow ? cards.filter((card) => card.workflowId === workflow.id) : [];
  const sourceCards = ids
    .map((id) => workflowCards.find((card) => card.id === id))
    .filter((card): card is CandidateCard => !!card);
  const visible = useMemo(() => sourceCards.filter((card) => {
    const methodLabel = formatMethodLabel(card.method);
    const haystack = [card.method, methodLabel, card.title, card.concept, card.content, ...card.tags].join(' ').toLowerCase();
    const matchesQuery = !query || haystack.includes(query.toLowerCase());
    const matchesMethod = !method || card.method === method;
    const matchesTag = !tag || card.tags.includes(tag);
    const matchesVote = !vote || card.vote === vote;
    return matchesQuery && matchesMethod && matchesTag && matchesVote;
  }), [sourceCards, query, method, tag, vote]);
  const selectAllVisible = () => {
    setSelectedIds(new Set(visible.map((card) => card.id)));
  };
  const methods = [...new Set(sourceCards.map((card) => card.method))];
  const tags = [...new Set(sourceCards.flatMap((card) => card.tags))].sort((left, right) => (
    left.localeCompare(right, 'zh-CN')
  ));

  const scoreNode = findIdeaScoreNodeForVariable(workflow, nodeId);
  const scoreState = scoreNode ? readIdeaScoreReportState(scoreNode.config) : null;
  const report = scoreState?.report ?? null;
  const sort = scoreState?.sort ?? defaultIdeaScoreSort;
  const stale = scoreState
    ? isIdeaScoreReportStale(scoreState.dimensions, scoreState.report)
    : false;

  const applySort = (key: string) => {
    if (!scoreNode) return;
    const live = workflow?.nodes.find((n) => n.id === scoreNode.id);
    if (!live) return;
    const parsed = ideaScoreConfigSchema.safeParse(live.config);
    if (!parsed.success) return;
    const config = parsed.data;
    const report = config.report;
    if (!report) return;
    const nextSort = nextIdeaScoreSort(config.sort, key);
    const sortedCards = sortIdeaScoreReportCards(report.cards, nextSort);
    const binding = workflow
      ? requireCardVariableSource(workflow, live.id, 'cards')
      : { ok: false as const };
    const currentIds = binding.ok && binding.source.output?.type === 'CardCollection'
      ? binding.source.output.cardIds
      : sortedCards.map((card) => card.cardId);
    store.getState().commitNodeConfigAndOutput(
      live.id,
      {
        ...config,
        sort: nextSort,
        report: { ...report, cards: sortedCards },
      },
    );
    store.getState().reorderBoundCollection(
      live.id,
      'cards',
      sortedIdeaScoreOutputCardIds(currentIds, sortedCards),
    );
  };

  return (
    <AppDialog open={open} title={dialogTitle} onClose={onClose}>
      <div className="card-browser-tabs" role="tablist" aria-label="卡片池视图">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'browse'}
          className={`card-browser-tabs__tab${tab === 'browse' ? ' is-active' : ''}`}
          onClick={() => setTab('browse')}
        >
          卡片浏览
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'report'}
          className={`card-browser-tabs__tab${tab === 'report' ? ' is-active' : ''}`}
          onClick={() => setTab('report')}
        >
          评分报告
        </button>
      </div>
      {tab === 'browse' ? (
        <>
          <div className="card-browser-controls">
            <label>搜索卡片<input type="search" aria-label="搜索卡片" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
            <label>方法筛选
              <select aria-label="方法筛选" value={method} onChange={(event) => setMethod(event.target.value)}>
                <option value="">全部方法</option>
                {methods.map((value) => (
                  <option key={value} value={value}>{formatMethodLabel(value)}</option>
                ))}
              </select>
            </label>
            <label>标签筛选
              <select aria-label="标签筛选" value={tag} onChange={(event) => setTag(event.target.value)}>
                <option value="">全部标签</option>
                {tags.map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </label>
            <label>投票筛选
              <select aria-label="投票筛选" value={vote} onChange={(event) => setVote(event.target.value)}>
                <option value="">全部投票</option>
                <option value="up">赞</option>
                <option value="down">踩</option>
              </select>
            </label>
            <div className="card-browser-controls__actions">
              {!deleteMode ? (
                <Button
                  danger
                  disabled={sourceCards.length === 0}
                  aria-label="删除卡片"
                  onClick={() => setDeleteMode(true)}
                >
                  删除
                </Button>
              ) : (
                <>
                  <Button aria-label="取消删除" onClick={exitDeleteMode}>取消</Button>
                  <Button
                    aria-label="全选可见卡片"
                    disabled={visible.length === 0}
                    onClick={selectAllVisible}
                  >
                    全选
                  </Button>
                  <Popconfirm
                    title={`删除 ${selectedIds.size} 张卡片？`}
                    description="将从卡片池中永久移除，无法撤销。"
                    okText="删除"
                    cancelText="取消"
                    okButtonProps={{ danger: true }}
                    disabled={selectedIds.size === 0}
                    onConfirm={deleteSelected}
                  >
                    <Button
                      danger
                      disabled={selectedIds.size === 0}
                      aria-label={`删除选中 ${selectedIds.size} 张卡片`}
                    >
                      删除选中 ({selectedIds.size})
                    </Button>
                  </Popconfirm>
                </>
              )}
            </div>
          </div>
          {deleteMode ? (
            <p className="selection-hint">勾选要删除的卡片，然后点击「删除选中」。</p>
          ) : null}
          {visible.length === 0 ? (
            <p>{sourceCards.length === 0 ? '暂无候选卡' : '没有符合筛选的卡片'}</p>
          ) : (
            <div className="idea-card-grid">
              {visible.map((card) => (
                <IdeaCard
                  key={card.id}
                  card={card}
                  selected={deleteMode && selectedIds.has(card.id)}
                  onSelect={deleteMode ? () => toggleSelected(card.id) : undefined}
                  onOpen={deleteMode ? undefined : () => openDetail(card)}
                  onEdit={deleteMode ? undefined : () => openDetail(card, true)}
                  onVote={(nextVote) => store.getState().getHostCapabilities().cards.toggleVote(card.id, nextVote)}
                  onReviewChange={(review) => store.getState().getHostCapabilities().cards.updateCard(card.id, { review })}
                />
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="card-browser-report">
          {!scoreNode ? (
            <div className="card-browser-report__empty">
              <p>暂无评分报告</p>
              <p>同池未连接创意评分节点</p>
            </div>
          ) : !report ? (
            <div className="card-browser-report__empty">
              <p>暂无评分报告</p>
              <p>同池创意评分节点尚未完成评分。</p>
            </div>
          ) : (
            <>
              <p className="card-browser-report__source">
                来源：创意评分 · {report.cards.length} 张 · {report.scoredAt}
              </p>
              {stale ? (
                <p className="card-browser-report__banner">
                  维度已变，报告可能过期，建议在评分节点重新评分。
                </p>
              ) : null}
              <ScoreReportMatrix
                report={report}
                sort={sort}
                onSort={applySort}
                onOpenCard={(cardId) => {
                  const card = cards.find((item) => item.id === cardId) ?? null;
                  if (card) openDetail(card);
                }}
              />
            </>
          )}
        </div>
      )}
      <Modal
        open={detailCard !== null}
        title={detailEditing ? '编辑卡片' : (detailCard?.title || '卡片详情')}
        footer={detailCard && !detailEditing ? (
          <div className="card-detail-modal__footer">
            <Popconfirm
              title="删除这张卡片？"
              description="将从卡片池中永久移除，无法撤销。"
              okText="删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              onConfirm={() => deleteCard(detailCard.id)}
            >
              <Button danger aria-label="删除卡片">删除</Button>
            </Popconfirm>
            <Button aria-label="编辑卡片内容" onClick={() => setDetailEditing(true)}>编辑</Button>
            <Button type="primary" onClick={closeDetail}>关闭</Button>
          </div>
        ) : null}
        onCancel={closeDetail}
      >
        {detailCard ? (
          detailEditing ? (
            <CardEditForm
              card={detailCard}
              onSave={saveDetail}
              onCancel={() => setDetailEditing(false)}
            />
          ) : (
            <CardDetail
              card={detailCard}
              onReviewChange={(review) => store.getState().getHostCapabilities().cards.updateCard(detailCard.id, { review })}
            />
          )
        ) : null}
      </Modal>
    </AppDialog>
  );
}

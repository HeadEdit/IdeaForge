import { markDescendantsStale } from './graph';
import { readIdeaScoreReportState } from './idea-score-report';
import type { CandidateCard, ChatSession, Workflow } from './model';

function filterCardCollectionOutput(
  cardIds: readonly string[],
  cardId: string,
): string[] | undefined {
  const next = cardIds.filter((id) => id !== cardId);
  return next.length === cardIds.length ? undefined : next;
}

function pooledCardIds(workflow: Workflow): Set<string> {
  const pooled = new Set<string>();
  for (const node of workflow.nodes) {
    if (node.kind !== 'cardVariable' || node.output?.type !== 'CardCollection') continue;
    for (const id of node.output.cardIds) pooled.add(id);
  }
  return pooled;
}

export function isCardInAnyPool(workflow: Workflow, cardId: string): boolean {
  return pooledCardIds(workflow).has(cardId);
}

export function applyCardVote(
  cards: readonly CandidateCard[],
  cardId: string,
  vote: 'up' | 'down',
): CandidateCard[] {
  return cards.map((card) => (
    card.id !== cardId ? card : { ...card, vote: card.vote === vote ? null : vote }
  ));
}

export const CARD_REVIEW_MAX_LENGTH = 100;

export function normalizeCardReview(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  return [...trimmed].slice(0, CARD_REVIEW_MAX_LENGTH).join('');
}

export function applyCardPatch(
  cards: readonly CandidateCard[],
  cardId: string,
  patch: Partial<Pick<CandidateCard, 'title' | 'concept' | 'content' | 'tags' | 'review'>>,
): CandidateCard[] {
  return cards.map((card) => {
    if (card.id !== cardId) return card;
    const next: CandidateCard = { ...card, ...patch };
    if ('review' in patch) {
      const normalized = normalizeCardReview(patch.review ?? '');
      if (normalized === undefined) {
        delete next.review;
      } else {
        next.review = normalized;
      }
    }
    return next;
  });
}

export function dropOrphanedCardReferences(
  workflow: Workflow,
  cards: readonly CandidateCard[],
  sessions: readonly ChatSession[],
  cardId: string,
): { cards: CandidateCard[]; sessions: ChatSession[] } {
  if (isCardInAnyPool(workflow, cardId)) {
    return { cards: [...cards], sessions: [...sessions] };
  }
  return {
    cards: cards.filter((card) => card.id !== cardId),
    sessions: sessions.filter((session) => !session.referencedCardIds.includes(cardId)),
  };
}

export function removeCardFromPoolWorkflow(
  workflow: Workflow,
  variableNodeId: string,
  cardId: string,
): Workflow {
  let changed = false;
  const nodes = workflow.nodes.map((node) => {
    if (node.id === variableNodeId && node.output?.type === 'CardCollection') {
      const cardIds = filterCardCollectionOutput(node.output.cardIds, cardId);
      if (!cardIds) return node;
      changed = true;
      return { ...node, output: { type: 'CardCollection' as const, cardIds } };
    }

    if (node.kind === 'ideaScore') {
      const state = readIdeaScoreReportState(node.config);
      if (!state?.report) return node;
      const cards = state.report.cards.filter((entry) => entry.cardId !== cardId);
      if (cards.length === state.report.cards.length) return node;
      changed = true;
      return {
        ...node,
        config: {
          ...(typeof node.config === 'object' && node.config !== null
            ? node.config as Record<string, unknown>
            : {}),
          report: { ...state.report, cards },
        },
        output: node.output?.type === 'CardCollection'
          ? (() => {
            const cardIds = filterCardCollectionOutput(node.output.cardIds, cardId);
            return cardIds ? { type: 'CardCollection' as const, cardIds } : node.output;
          })()
          : node.output,
      };
    }

    if (node.output?.type === 'CardCollection') {
      const cardIds = filterCardCollectionOutput(node.output.cardIds, cardId);
      if (!cardIds) return node;
      changed = true;
      return { ...node, output: { type: 'CardCollection' as const, cardIds } };
    }

    return node;
  });

  if (!changed) return workflow;
  return markDescendantsStale({ ...workflow, nodes }, variableNodeId);
}

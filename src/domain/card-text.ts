import type { CandidateCard } from './model';

const REASONING_MARK = '【思路】';
const BODY_MARK = '【正文】';

export function splitCardContent(content: string): {
  reasoning: string | null;
  body: string;
} {
  const trimmed = content.trim();
  const reasoningIndex = trimmed.indexOf(REASONING_MARK);
  const bodyIndex = trimmed.indexOf(BODY_MARK);

  if (reasoningIndex < 0) {
    return { reasoning: null, body: content };
  }

  // Reversed or malformed markers → keep legacy whole-content body.
  if (bodyIndex >= 0 && bodyIndex < reasoningIndex) {
    return { reasoning: null, body: content };
  }

  if (bodyIndex > reasoningIndex) {
    const reasoning = trimmed
      .slice(reasoningIndex + REASONING_MARK.length, bodyIndex)
      .trim();
    const body = trimmed.slice(bodyIndex + BODY_MARK.length).trim();
    return { reasoning: reasoning || null, body };
  }

  const reasoning = trimmed.slice(reasoningIndex + REASONING_MARK.length).trim();
  return { reasoning: reasoning || null, body: '' };
}

export function formatCandidateCardText(card: CandidateCard): string {
  const tags = card.tags.join('、');
  return [
    `标题：${card.title}`,
    `概念：${card.concept}`,
    `方法：${card.method}`,
    `标签：${tags}`,
    '',
    card.content,
  ].join('\n');
}

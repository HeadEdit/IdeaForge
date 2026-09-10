import { Button, Checkbox, Input } from 'antd';
import { Pencil, ThumbsDown, ThumbsUp } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { CandidateCard } from '../../domain/model';
import { formatMethodLabel } from '../../skills';

export function IdeaCard({
  card,
  selected = false,
  onOpen,
  onEdit,
  onSelect,
  onVote,
  onReviewChange,
}: {
  card: CandidateCard;
  selected?: boolean;
  onOpen?: () => void;
  onEdit?: () => void;
  onSelect?: () => void;
  onVote: (vote: 'up' | 'down') => void;
  onReviewChange?: (review: string) => void;
}) {
  const title = card.title || `卡片 ${card.id}`;
  const methodLabel = formatMethodLabel(card.method);
  const [draft, setDraft] = useState(card.review ?? '');

  useEffect(() => {
    setDraft(card.review ?? '');
  }, [card.review]);

  return (
    <article
      className={`idea-card${selected ? ' is-selected' : ''}`}
      data-testid="idea-card"
      onDoubleClick={onOpen}
    >
      <div className="idea-card__head">
        {onSelect ? <Checkbox checked={selected} onChange={onSelect} aria-label={`选择 ${title}`} /> : null}
        <strong title={title}>{title}</strong>
        {onOpen ? (
          <Button
            size="small"
            className="idea-card__detail"
            aria-label={`详情 ${title}`}
            onClick={(event) => {
              event.stopPropagation();
              onOpen();
            }}
          >
            详情
          </Button>
        ) : null}
        {onEdit ? (
          <Button
            size="small"
            className="idea-card__detail"
            aria-label={`编辑 ${title}`}
            icon={<Pencil size={12} />}
            onClick={(event) => {
              event.stopPropagation();
              onEdit();
            }}
          />
        ) : null}
      </div>
      <div className="idea-card__meta">
        <span className="idea-card__method">{methodLabel}</span>
        {card.tags.map((tag) => <span key={tag} className="idea-card__tag">{tag}</span>)}
      </div>
      <div className="idea-card__body">
        <div className="idea-card__label">概念</div>
        <p className="idea-card__concept">{card.concept}</p>
        <div className="idea-card__label">正文</div>
        <p className="idea-card__content">{card.content}</p>
      </div>
      <div className="idea-card__votes">
        <Button
          size="small"
          type={card.vote === 'up' ? 'primary' : 'default'}
          aria-label={`赞 ${title}`}
          icon={<ThumbsUp size={14} />}
          onClick={(event) => { event.stopPropagation(); onVote('up'); }}
        />
        <Button
          size="small"
          type={card.vote === 'down' ? 'primary' : 'default'}
          aria-label={`踩 ${title}`}
          icon={<ThumbsDown size={14} />}
          onClick={(event) => { event.stopPropagation(); onVote('down'); }}
        />
      </div>
      {onReviewChange ? (
        <Input
          className="idea-card__review"
          size="small"
          aria-label={`评价 ${title}`}
          maxLength={100}
          placeholder="一句话评价（辅助再生成）"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onClick={(event) => event.stopPropagation()}
          onBlur={() => {
            if ((card.review ?? '') === draft) return;
            onReviewChange(draft);
          }}
        />
      ) : null}
    </article>
  );
}

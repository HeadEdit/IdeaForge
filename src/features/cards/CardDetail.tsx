import { Input, Tooltip } from 'antd';
import { useEffect, useState } from 'react';
import { splitCardContent } from '../../domain/card-text';
import type { CandidateCard } from '../../domain/model';
import { formatMethodLabel } from '../../skills';

export function CardDetail({
  card,
  onReviewChange,
}: {
  card: CandidateCard;
  onReviewChange?: (review: string) => void;
}) {
  const score = card.score;
  const { reasoning, body } = splitCardContent(card.content);
  const [draft, setDraft] = useState(card.review ?? '');

  useEffect(() => {
    setDraft(card.review ?? '');
  }, [card.review]);

  return (
    <dl className="card-content-detail">
      <div><dt>方法</dt><dd>{formatMethodLabel(card.method)}</dd></div>
      <div><dt>概念</dt><dd>{card.concept}</dd></div>
      <div><dt>标签</dt><dd>{card.tags.join('、') || '无'}</dd></div>
      {score ? (
        <div>
          <dt>评分</dt>
          <dd>
            <ul className="card-score-list">
              <li className="card-score-list__average">均分 {score.average.toFixed(1)}</li>
              {score.byDimension.map((entry) => (
                <li key={entry.dimensionId} className="card-score-list__item">
                  <span className="card-score-list__name">{entry.name}</span>
                  <Tooltip title={entry.reason} mouseEnterDelay={0}>
                    <span
                      className="card-score-list__value"
                      aria-label={`${entry.name}：${entry.score}（${entry.reason}）`}
                    >
                      {entry.score}
                    </span>
                  </Tooltip>
                  <span className="card-score-list__reason">{entry.reason}</span>
                </li>
              ))}
            </ul>
          </dd>
        </div>
      ) : null}
      {reasoning ? <div><dt>思路</dt><dd>{reasoning}</dd></div> : null}
      <div><dt>正文</dt><dd>{body}</dd></div>
      {onReviewChange ? (
        <div>
          <dt>评价</dt>
          <dd>
            <Input
              aria-label={`评价 ${card.title || card.id}`}
              maxLength={100}
              placeholder="一句话评价（辅助再生成）"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={() => {
                if ((card.review ?? '') === draft) return;
                onReviewChange(draft);
              }}
            />
          </dd>
        </div>
      ) : card.review ? (
        <div><dt>评价</dt><dd>{card.review}</dd></div>
      ) : null}
    </dl>
  );
}

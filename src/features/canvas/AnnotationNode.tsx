import { type NodeProps } from '@xyflow/react';
import { useEffect, useRef } from 'react';

import { annotationConfigSchema } from '../../nodes/annotation/config';
import type { AnnotationFlowNode } from './node-adapter';

export function AnnotationNodeView({ id, data, selected }: NodeProps<AnnotationFlowNode>) {
  const { domainNode, callbacks, autoFocus } = data;
  const parsed = annotationConfigSchema.safeParse(domainNode.config);
  const text = parsed.success ? parsed.data.text : '';
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!autoFocus) return;
    const frame = requestAnimationFrame(() => {
      textareaRef.current?.focus();
      callbacks.onClearAutoFocus?.(id);
    });
    return () => cancelAnimationFrame(frame);
  }, [autoFocus, callbacks, id]);

  return (
    <article
      className={`canvas-annotation${selected ? ' is-selected' : ''}`}
      data-testid="canvas-annotation"
      aria-label="注释"
    >
      <header className="canvas-annotation__header">
        <span className="canvas-annotation__title">注释</span>
        <button
          type="button"
          className="canvas-annotation__delete nodrag nopan"
          aria-label="删除注释"
          title="删除"
          onClick={(event) => {
            event.stopPropagation();
            callbacks.onDelete?.(id);
          }}
        >
          ×
        </button>
      </header>
      <textarea
        ref={textareaRef}
        className="canvas-annotation__body nodrag nopan nowheel"
        aria-label="注释内容"
        placeholder="输入注释内容…"
        value={text}
        rows={4}
        onChange={(event) => callbacks.onPatchConfig?.(id, { text: event.target.value })}
        onPointerDown={(event) => event.stopPropagation()}
      />
    </article>
  );
}

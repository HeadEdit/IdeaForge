import { Input } from 'antd';
import { StickyNote } from 'lucide-react';

import type { NodeInspectorContext, NodeUiContribution } from '../types';
import type { AnnotationConfig } from './config';

export function AnnotationInspector({
  config,
  patchConfig,
}: NodeInspectorContext<AnnotationConfig>) {
  return (
    <section className="inspector-section">
      <label>
        注释内容
        <Input.TextArea
          aria-label="注释内容"
          value={config.text}
          rows={8}
          placeholder="输入注释内容…"
          onChange={(event) => patchConfig({ text: event.target.value })}
        />
      </label>
    </section>
  );
}

export const annotationUi: NodeUiContribution<AnnotationConfig> = {
  label: '注释',
  icon: StickyNote,
  theme: { headerBackground: '#fff8dc', glyphColor: '#8a7340' },
  Inspector: AnnotationInspector,
};

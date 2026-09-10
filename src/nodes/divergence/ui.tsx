import { Checkbox, Input, InputNumber, Select } from 'antd';
import { Sparkles } from 'lucide-react';

import { CARD_VARIABLE_SOURCE_REQUIRED, requireCardVariableSource } from '../../domain/require-card-variable-source';
import type { Workflow, WorkflowNode } from '../../domain/model';
import { listSkills } from '../../skills/registry';
import type { NodeCanvasContext, NodeInspectorContext, NodeUiContribution } from '../types';
import type { DivergenceConfig } from './config';

const TEMPERATURE_OPTIONS = [
  { value: 0.7, label: '0.7' },
  { value: 0.85, label: '0.85' },
  { value: 1, label: '1' },
];

const FEEDBACK_MODE_OPTIONS = [
  { value: 'explore', label: '探索（弱化历史偏好）' },
  { value: 'balanced', label: '均衡（软偏置+探索配额）' },
  { value: 'exploit', label: '深挖（优先跟随方向）' },
] as const;

function boundVariableName(source: WorkflowNode): string {
  const config = source.config as { name?: unknown };
  return typeof config.name === 'string' && config.name.trim() ? config.name.trim() : '卡片池';
}

function boundPoolCount(source: WorkflowNode): number {
  return source.output?.type === 'CardCollection' ? source.output.cardIds.length : 0;
}

function resolveBoundPool(workflow: Workflow | undefined, nodeId: string) {
  if (!workflow) return undefined;
  return requireCardVariableSource(workflow, nodeId, 'pool');
}

export function DivergenceInspector({
  node,
  config,
  workflow,
  patchConfig,
}: NodeInspectorContext<DivergenceConfig>) {
  const methodOptions = listSkills('method').map((skill) => ({
    value: skill.id,
    label: skill.name,
  }));
  const binding = resolveBoundPool(workflow, node.id);

  const patch = (partial: Partial<DivergenceConfig>) => {
    patchConfig(partial);
  };

  return (
    <section className="inspector-section">
      {binding && !binding.ok ? (
        <p className="error-text">{CARD_VARIABLE_SOURCE_REQUIRED}</p>
      ) : binding?.ok ? (
        <p className="inspector-preview">
          绑定变量：{boundVariableName(binding.source)} · 再生成时读取该池上的赞踩 / 分数
        </p>
      ) : null}

      <label>
        最近再生成方向
        <p className="inspector-preview">
          {config.lastDirection?.trim()
            ? config.lastDirection.trim()
            : '尚未评估出方向'}
        </p>
      </label>

      <label>
        需求
        <Input.TextArea
          value={config.requirement}
          onChange={(event) => patch({ requirement: event.target.value })}
          rows={4}
        />
      </label>
      <Checkbox
        checked={config.autoInferMethods}
        onChange={(event) => patch({ autoInferMethods: event.target.checked })}
      >
        智能推断发散方法
      </Checkbox>
      {!config.autoInferMethods ? (
        <label>
          方法
          <Select
            mode="multiple"
            value={config.methodIds}
            options={methodOptions}
            onChange={(methodIds) => patch({ methodIds })}
            style={{ width: '100%' }}
          />
        </label>
      ) : null}
      <label>
        批量大小
        <InputNumber
          min={1}
          value={config.batchSize}
          onChange={(batchSize) => {
            if (typeof batchSize === 'number') {
              patch({ batchSize });
            }
          }}
        />
      </label>
      <label>
        并发
        <InputNumber
          min={1}
          value={config.concurrency}
          onChange={(concurrency) => {
            if (typeof concurrency === 'number') {
              patch({ concurrency });
            }
          }}
        />
      </label>
      <label>
        反馈利用
        <Select
          value={config.feedbackMode ?? 'balanced'}
          options={[...FEEDBACK_MODE_OPTIONS]}
          onChange={(feedbackMode) => patch({ feedbackMode })}
          style={{ width: '100%' }}
        />
      </label>
      <label>
        温度
        <Select
          value={config.temperature}
          options={TEMPERATURE_OPTIONS}
          onChange={(temperature) => patch({ temperature })}
          style={{ width: '100%' }}
        />
      </label>
    </section>
  );
}

export function DivergenceCanvasBody({
  node,
  config,
  workflow,
}: NodeCanvasContext<DivergenceConfig>) {
  const promptPreview = config.requirement.trim();
  const binding = resolveBoundPool(workflow, node.id);
  const bound = binding?.ok
    ? { name: boundVariableName(binding.source), poolCount: boundPoolCount(binding.source) }
    : undefined;
  if (!promptPreview && !bound) {
    return null;
  }
  return (
    <div className="workflow-node__preview" title={promptPreview || undefined}>
      {promptPreview ? <p>{promptPreview}</p> : null}
      {bound ? (
        <div className="divergence-bind">
          <span>绑定：{bound.name}</span>
          <strong>{bound.poolCount}</strong>
        </div>
      ) : null}
    </div>
  );
}

export const divergenceUi: NodeUiContribution<DivergenceConfig> = {
  label: '发散',
  icon: Sparkles,
  theme: { headerBackground: '#f4f0ff', glyphColor: '#6d4ad4' },
  Inspector: DivergenceInspector,
  CanvasBody: DivergenceCanvasBody,
  showRunAction: true,
};

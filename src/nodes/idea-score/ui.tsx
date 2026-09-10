import { Button, Input, InputNumber, Select } from 'antd';
import { Gauge, Plus, Trash2 } from 'lucide-react';

import { summarizeCardPoolFeedback } from '../../domain/card-pool-feedback';
import type { WorkflowNode } from '../../domain/model';
import { CARD_VARIABLE_SOURCE_REQUIRED, requireCardVariableSource } from '../../domain/require-card-variable-source';
import type { NodeInspectorContext, NodeUiContribution } from '../types';
import {
  IDEA_SCORE_MAX_BATCH_SIZE,
  type IdeaScoreConfig,
  type ScoreDimension,
} from './config';

const RUN_MODE_OPTIONS = [
  { value: 'inferDimensions' as const, label: '推断维度' },
  { value: 'describeDimensions' as const, label: '生成维度内容' },
  { value: 'score' as const, label: '按维度评分' },
];

function boundVariableName(source: WorkflowNode): string {
  const config = source.config as { name?: unknown };
  return typeof config.name === 'string' && config.name.trim() ? config.name.trim() : '卡片池';
}

function formatAverage(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function DimensionEditor({
  dimensions,
  patchConfig,
}: {
  dimensions: ScoreDimension[];
  patchConfig: (patch: Partial<IdeaScoreConfig>) => void;
}) {
  const updateDimension = (id: string, patch: Partial<ScoreDimension>) => {
    patchConfig({
      dimensions: dimensions.map((dimension) => (
        dimension.id === id ? { ...dimension, ...patch } : dimension
      )),
    });
  };

  const removeDimension = (id: string) => {
    patchConfig({
      dimensions: dimensions.filter((dimension) => dimension.id !== id),
    });
  };

  const addDimension = () => {
    patchConfig({
      dimensions: [
        ...dimensions,
        { id: crypto.randomUUID(), name: '新维度', description: '' },
      ],
    });
  };

  return (
    <div className="idea-score-dimensions">
      <div className="idea-score-panel__head">
        <h3>评估维度</h3>
        <span className="idea-score-panel__meta">{dimensions.length} 项</span>
      </div>
      {dimensions.length === 0 ? (
        <p className="idea-score-empty">尚未设置维度，可手动添加或先运行「推断维度」。</p>
      ) : (
        <ul className="idea-score-dimensions__list">
          {dimensions.map((dimension, index) => (
            <li key={dimension.id} className="idea-score-dimension">
              <span className="idea-score-dimension__index">{index + 1}</span>
              <div className="idea-score-dimension__fields">
                <Input
                  aria-label={`维度名称 ${dimension.id}`}
                  value={dimension.name}
                  onChange={(event) => updateDimension(dimension.id, { name: event.target.value })}
                  placeholder="维度名称"
                />
                <Input.TextArea
                  aria-label={`维度描述 ${dimension.id}`}
                  value={dimension.description}
                  onChange={(event) => updateDimension(dimension.id, {
                    description: event.target.value,
                  })}
                  placeholder="评分口径（可选）"
                  rows={2}
                />
              </div>
              <Button
                type="text"
                danger
                className="idea-score-dimension__remove"
                aria-label={`删除维度 ${dimension.id}`}
                icon={<Trash2 size={16} />}
                onClick={() => removeDimension(dimension.id)}
              />
            </li>
          ))}
        </ul>
      )}
      <Button
        type="dashed"
        icon={<Plus size={16} />}
        onClick={addDimension}
        block
      >
        添加维度
      </Button>
    </div>
  );
}

export function IdeaScoreInspector({
  node,
  config,
  workflow,
  cards = [],
  patchConfig,
}: NodeInspectorContext<IdeaScoreConfig>) {
  const dimensions = config.dimensions;
  const binding = workflow
    ? requireCardVariableSource(workflow, node.id, 'cards')
    : undefined;
  const scored = binding?.ok
    ? summarizeCardPoolFeedback(binding.source, cards).scored
    : [];

  return (
    <section className="inspector-section">
      {binding && !binding.ok ? (
        <p className="error-text">{CARD_VARIABLE_SOURCE_REQUIRED}</p>
      ) : binding?.ok ? (
        <p className="inspector-preview">
          写入变量：{boundVariableName(binding.source)} · 评分成功后回写 score
        </p>
      ) : null}

      <label>
        运行动作
        <Select
          aria-label="运行动作"
          value={config.runMode}
          options={RUN_MODE_OPTIONS}
          virtual={false}
          onChange={(runMode) => patchConfig({ runMode })}
          style={{ width: '100%' }}
        />
      </label>

      <label>
        批量大小
        <InputNumber
          aria-label="批量大小"
          min={1}
          max={IDEA_SCORE_MAX_BATCH_SIZE}
          value={config.batchSize}
          onChange={(batchSize) => {
            if (typeof batchSize === 'number') {
              patchConfig({ batchSize: Math.min(IDEA_SCORE_MAX_BATCH_SIZE, Math.max(1, batchSize)) });
            }
          }}
        />
      </label>
      <label>
        并发
        <InputNumber
          aria-label="并发"
          min={1}
          value={config.concurrency}
          onChange={(concurrency) => {
            if (typeof concurrency === 'number') {
              patchConfig({ concurrency });
            }
          }}
        />
      </label>

      <DimensionEditor dimensions={dimensions} patchConfig={patchConfig} />

      <div className="idea-score-summary">
        <h3>已评摘要</h3>
        <p className="card-pool-pref__hint">均分高低作为再生成的次要偏好。</p>
        {scored.length === 0 ? (
          <p className="card-pool-pref__empty">绑定池中还没有已评卡片</p>
        ) : (
          <ul className="card-pool-pref__list">
            {scored.map((card) => (
              <li key={card.id}>
                <span className="title">{card.title || `卡片 ${card.id}`}</span>
                <span className="card-pool-badge card-pool-badge--score">
                  {formatAverage(card.score?.average ?? 0)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export const ideaScoreUi: NodeUiContribution<IdeaScoreConfig> = {
  label: '创意评分',
  icon: Gauge,
  theme: { headerBackground: '#eef6ff', glyphColor: '#2f6fed' },
  Inspector: IdeaScoreInspector,
  showRunAction: true,
};

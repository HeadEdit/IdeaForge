import { Button } from 'antd';
import { ExecutionProgressView } from '../../components/ExecutionProgressView';

import type { CandidateCard, NodeRun, ReferenceDocument, Workflow, WorkflowNode } from '../../domain/model';
import { getAiErrorMessage } from '../../ai/error-messages';
import { CARD_VARIABLE_SOURCE_REQUIRED } from '../../domain/require-card-variable-source';
import { lookupNodeUiPlugin } from '../nodes/ui-registry';
import { builtinNodePlatform } from '../../nodes/builtins';
import { statusLabels } from './WorkflowNode';
import type { AppStore } from '../../state/use-app-store';

const AI_ERROR_KINDS = ['network-or-cors', 'auth', 'rate-limit', 'server', 'invalid-response', 'unsupported', 'stopped'] as const;

function runErrorMessage(errorKind: string): string {
  if (errorKind === 'invalid-input') return CARD_VARIABLE_SOURCE_REQUIRED;
  if ((AI_ERROR_KINDS as readonly string[]).includes(errorKind)) {
    return getAiErrorMessage(errorKind as Parameters<typeof getAiErrorMessage>[0]);
  }
  return 'AI 请求失败，请重试';
}

export interface NodeInspectorProps {
  progress?: import('../../domain/execution-progress').ExecutionProgress;
  node?: WorkflowNode;
  workflow?: Workflow;
  cards?: readonly CandidateCard[];
  documents?: readonly ReferenceDocument[];
  runs: readonly NodeRun[];
  store?: AppStore;
  onOpen?: (nodeId: string) => void;
}

export function NodeInspector({
  progress,
  node,
  workflow,
  cards,
  documents,
  runs,
  store,
  onOpen,
}: NodeInspectorProps) {
  if (!node) {
    return <aside className="node-inspector" aria-label="属性面板"><div className="panel-heading"><h2>属性</h2></div><p className="empty-state">选择节点以查看配置</p></aside>;
  }

  const plugin = lookupNodeUiPlugin(node.kind);
  const availability = builtinNodePlatform.inspectNode(node.kind, node.config);
  const Inspector = plugin?.Inspector;
  const latestRun = [...runs].reverse().find((run) => run.nodeId === node.id);
  const parsed = builtinNodePlatform.parseConfig(node.kind, node.config);
  return (
    <aside className="node-inspector" aria-label="属性面板">
      <div className="panel-heading"><h2>{plugin?.label ?? node.kind}</h2><span className={`status-pill status-pill--${node.status}`}>{statusLabels[node.status]}</span></div>
      <div className="node-inspector__content">
        {node.status === 'running' && progress && <ExecutionProgressView progress={progress} />}
        {availability.status === 'plugin-unavailable' && <p className="error-text">节点插件不可用</p>}
        {availability.status === 'invalid-config' && <p className="error-text">节点配置无效</p>}
        {onOpen && availability.status === 'available' && plugin?.Dialog && (
          <section className="inspector-section"><Button onClick={() => onOpen(node.id)}>打开</Button></section>
        )}
        {Inspector && parsed.ok && store && (
          <Inspector
            node={node}
            config={parsed.config}
            workflow={workflow}
            cards={cards}
            documents={documents}
            patchConfig={(patch: unknown) => store.getState().patchNodeConfig(node.id, patch)}
          />
        )}
        {latestRun && (
          <section className="inspector-section">
            <h3>最近运行</h3>
            <p>成功 {latestRun.succeeded} / 失败 {latestRun.failed} / 跳过 {latestRun.skipped}</p>
            {latestRun.errorKind && <p className="error-text">{runErrorMessage(latestRun.errorKind)}</p>}
          </section>
        )}
      </div>
    </aside>
  );
}

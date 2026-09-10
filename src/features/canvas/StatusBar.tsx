import type { NodeRun, WorkflowNode } from '../../domain/model';
import type { SaveStatus } from '../../state/use-app-store';
import { statusLabels } from './WorkflowNode';

export function StatusBar({ nodes, runs, progress, saveStatus, onRetry }: { nodes: readonly WorkflowNode[]; runs: readonly NodeRun[]; progress?: Record<string, import('../../domain/execution-progress').ExecutionProgress>; saveStatus: SaveStatus; onRetry?: () => void }) {
  const active = nodes.filter((node) => node.status === 'running').length;
  const latest = runs.length > 0 ? runs[runs.length - 1] : undefined;
  const running = nodes.find((node) => node.status === 'running');
  const currentProgress = running && progress?.[running.id];
  const saveLabels: Record<SaveStatus, string> = { idle: '未更改', saving: '保存中', saved: '已保存', failed: '保存失败' };
  return (
    <footer className="status-bar" aria-live="polite">
      <span>{active > 0 ? `${active} 个节点运行中` : '当前无活动任务'}</span>
      {currentProgress && <span>{currentProgress.stage} · {currentProgress.estimated ? '约 ' : ''}{Math.round(currentProgress.percent)}%</span>}
      {latest && <span>{statusLabels[latest.status]} · 成功 {latest.succeeded} · 失败 {latest.failed}</span>}
      <span className="status-bar__save">{saveLabels[saveStatus]} {saveStatus === 'failed' && onRetry && <button type="button" onClick={onRetry}>重试保存</button>}</span>
    </footer>
  );
}

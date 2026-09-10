import type { ExecutionProgress } from '../domain/execution-progress';

export function ExecutionProgressView({ progress }: { progress: ExecutionProgress }) {
  const percent = Math.max(0, Math.min(100, Math.round(progress.percent)));
  return <div className="execution-progress" aria-live="polite">
    <div className="execution-progress__label"><span>{progress.stage}</span><span>{progress.estimated ? '约 ' : ''}{percent}%</span></div>
    <progress aria-label={progress.stage} max={100} value={percent} />
    {progress.total !== undefined && <small>已完成 {progress.completed ?? 0}/{progress.total}</small>}
  </div>;
}

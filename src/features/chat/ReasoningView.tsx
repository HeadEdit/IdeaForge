import { SafeMarkdown } from './SafeMarkdown';

export function ReasoningView({ content, running = false }: { content?: string; running?: boolean }) {
  if (!content) return running ? <p className="chat-dialog__thinking">正在思考</p> : null;
  return (
    <details className="chat-dialog__reasoning" open={running ? true : undefined}>
      <summary>{running ? '正在思考' : '已深度思考'}</summary>
      <div className="chat-dialog__reasoning-body"><SafeMarkdown content={content} /></div>
    </details>
  );
}

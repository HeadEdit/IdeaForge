import type { AgentEvent } from '../../domain/execution-progress';

const statusLabels = { running: '进行中', succeeded: '完成', failed: '失败', stopped: '已停止' };

export function AgentTimeline({ events }: { events: readonly AgentEvent[] }) {
  if (!events.length) return null;
  return <details className="agent-timeline">
    <summary>{events.every((e) => e.id.startsWith('search-')) ? `联网检索过程 · ${events.length} 条进度` : <>Agent 过程 · {events.filter((e) => e.kind === 'request').length} 次请求 · {events.filter((e) => e.kind === 'tool').length} 次工具调用</>}</summary>
    <ol>{events.map((event) => <li key={event.id}>
      <details>
        <summary>{event.title} <span className={`agent-timeline__status agent-timeline__status--${event.status}`}>{statusLabels[event.status]}</span></summary>
        <small>{event.startedAt}{event.finishedAt ? ` → ${event.finishedAt}` : ''}</small>
        {event.input !== undefined && <><div>{event.kind === 'tool' ? '工具参数' : '请求消息（含上下文）'}</div><pre>{event.input}</pre></>}
        {event.output !== undefined && <><div>{event.kind === 'tool' ? '工具结果' : '模型回复 / 请求结果'}</div><pre>{event.output}</pre></>}
      </details>
    </li>)}</ol>
  </details>;
}

import { Dropdown } from 'antd';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Play } from 'lucide-react';
import { ExecutionProgressView } from '../../components/ExecutionProgressView';

import { lookupNodeDefinition, type NodePort, type PortDirection } from '../../domain/node-definitions';
import type { NodeDisplayStatus } from '../../domain/model';
import { builtinNodePlatform } from '../../nodes/builtins';
import { lookupNodeUiPlugin } from '../nodes/ui-registry';
import type { WorkflowFlowNode } from './node-adapter';

export { nodeLabels } from '../nodes/ui-registry';

export const statusLabels: Record<NodeDisplayStatus, string> = {
  idle: '等待',
  running: '运行中',
  succeeded: '成功',
  partial: '部分成功',
  failed: '失败',
  stopped: '已停止',
  stale: '下游已过期',
};

export function formatPortCaption(port: Pick<NodePort, 'label' | 'type'>): string {
  if (port.type === 'Control') return '';
  return `${port.label}(${port.type})`;
}

export function orderedCanvasPorts(definition: {
  inputs: readonly NodePort[];
  outputs: readonly NodePort[];
}): Array<{ port: NodePort; direction: PortDirection }> {
  const partition = (ports: readonly NodePort[], direction: PortDirection, control: boolean) =>
    ports
      .filter((port) => (port.type === 'Control') === control)
      .map((port) => ({ port, direction }));
  return [
    ...partition(definition.inputs, 'input', true),
    ...partition(definition.outputs, 'output', true),
    ...partition(definition.inputs, 'input', false),
    ...partition(definition.outputs, 'output', false),
  ];
}

const TEXT_PORT_COERCION_HINT =
  '非Text类型的数据也可以连接到Text类型的端口，系统会自动将数据转换成文本';

function PortRow({
  port,
  direction,
  nodeId,
  onDisconnectPort,
}: {
  port: NodePort;
  direction: PortDirection;
  nodeId: string;
  onDisconnectPort?: (nodeId: string, portId: string, direction: PortDirection) => void;
}) {
  const isIn = direction === 'input';
  const caption = formatPortCaption(port);
  const coercionHint = port.type === 'Text' || port.type === 'Text[]'
    ? TEXT_PORT_COERCION_HINT
    : undefined;
  return (
    <div
      className={`workflow-node__port workflow-node__port--${isIn ? 'in' : 'out'}`}
      data-port-type={port.type}
      title={coercionHint}
    >
      <Dropdown
        trigger={['contextMenu']}
        menu={{
          items: [{
            key: 'disconnect',
            label: '断开',
            onClick: () => onDisconnectPort?.(nodeId, port.id, direction),
          }],
        }}
      >
        <span
          className="workflow-node__port-hit nodrag nopan"
          data-testid={`workflow-port-${direction}-${port.id}`}
          onContextMenu={(event) => event.stopPropagation()}
        >
          <Handle
            id={port.id}
            type={isIn ? 'target' : 'source'}
            position={isIn ? Position.Left : Position.Right}
            aria-label={`${port.label} ${isIn ? '输入' : '输出'}端口 ${port.type}`}
          />
        </span>
      </Dropdown>
      {caption ? (
        <span className="workflow-node__port-caption">{caption}</span>
      ) : null}
    </div>
  );
}

export function WorkflowNodeView({ id, data, selected }: NodeProps<WorkflowFlowNode>) {
  const { domainNode, callbacks, workflow, cards, documents, preview } = data;
  const definition = lookupNodeDefinition(domainNode.kind);
  const uiPlugin = lookupNodeUiPlugin(domainNode.kind);
  const inspection = builtinNodePlatform.inspectNode(domainNode.kind, domainNode.config);
  const availability = inspection.status === 'available' ? undefined : inspection.status;
  const parsed = builtinNodePlatform.parseConfig(domainNode.kind, domainNode.config);
  const label = uiPlugin?.label ?? domainNode.kind;
  const status = statusLabels[domainNode.status];
  const Icon = uiPlugin?.icon;
  const theme = uiPlugin?.theme;
  const CanvasBody = uiPlugin?.CanvasBody;
  const showRun = uiPlugin?.showRunAction && inspection.status === 'available';

  const node = (
            <article
      className={`workflow-node workflow-node--${domainNode.status}${selected ? ' is-selected' : ''}${definition?.category === 'select' ? ' workflow-node--select' : ''}`}
      data-testid="workflow-node"
      {...(definition?.category === 'select' ? { 'data-node-category': 'select' } : {})}
      aria-label={`${label}，${availability === 'plugin-unavailable' ? '节点插件不可用' : availability === 'invalid-config' ? '节点配置无效' : status}`}
      style={theme ? {
        ['--node-header-bg' as string]: theme.headerBackground,
        ['--node-glyph' as string]: theme.glyphColor,
      } : undefined}
      onDoubleClick={() => {
        if (!availability) callbacks.onOpen?.(domainNode.id);
      }}
    >
      <header className="workflow-node__header">
        <span className="workflow-node__glyph" aria-hidden="true">
          {Icon ? <Icon size={14} /> : null}
        </span>
        <strong className="workflow-node__title">{label}</strong>
        <span className={`status-pill status-pill--${domainNode.status}`}>{status}</span>
      </header>
      {domainNode.status === 'running' && data.progress && <ExecutionProgressView progress={data.progress} />}
      {availability === 'plugin-unavailable' ? (
        <p className="workflow-node__preview">节点插件不可用</p>
      ) : availability === 'invalid-config' ? (
        <p className="workflow-node__preview">节点配置无效</p>
      ) : (
        <>
          <div className="workflow-node__ports">
            {definition ? orderedCanvasPorts(definition).map(({ port, direction }) => (
              <PortRow
                key={`${direction}-${port.id}`}
                port={port}
                direction={direction}
                nodeId={id}
                onDisconnectPort={callbacks.onDisconnectPort}
              />
            )) : null}
          </div>
          {preview ? (
            <div className="workflow-node__preview">
              <strong>{preview.title}</strong>
              <p>{preview.concept}</p>
            </div>
          ) : CanvasBody && uiPlugin && parsed.ok ? (
            <CanvasBody
              node={domainNode}
              config={parsed.config}
              workflow={workflow}
              cards={cards}
              documents={documents}
            />
          ) : null}
          {showRun ? (
            <div className="workflow-node__actions">
              <button
                type="button"
                className="workflow-node__run nodrag nopan"
                disabled={domainNode.status === 'running' || !callbacks.onRun}
                onClick={(event) => {
                  event.stopPropagation();
                  callbacks.onRun?.(id);
                }}
              >
                <Play size={12} fill="currentColor" aria-hidden="true" />
                运行
              </button>
            </div>
          ) : null}
        </>
      )}
    </article>
  );

  return (
    <Dropdown
      trigger={['contextMenu']}
      menu={{
        items: [{
          key: 'delete',
          label: '删除',
          danger: true,
          onClick: () => callbacks.onDelete?.(id),
        }],
      }}
    >
      {node}
    </Dropdown>
  );
}

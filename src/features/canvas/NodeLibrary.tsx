import type { DragEvent } from 'react';

import type { NodeKind } from '../../domain/model';
import { getNodeUiPlugin, nodeLibraryGroups } from '../nodes/ui-registry';

export const NODE_DRAG_TYPE = 'application/x-ideaforge-node';

export interface NodeLibraryProps {
  onAddNode(kind: NodeKind): void;
}

export function NodeLibrary({ onAddNode }: NodeLibraryProps) {
  const handleDragStart = (event: DragEvent<HTMLButtonElement>, kind: NodeKind) => {
    event.dataTransfer.setData(NODE_DRAG_TYPE, kind);
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <aside className="node-library" aria-label="节点库">
      <div className="panel-heading"><h2>节点库</h2></div>
      <div className="node-library__groups">
        {nodeLibraryGroups().map((group) => (
          <section key={group.category} className="node-library__group">
            <h3>{group.label}</h3>
            {group.kinds.map((kind) => {
              const uiPlugin = getNodeUiPlugin(kind);
              const Icon = uiPlugin.icon;
              return (
                <button key={kind} type="button" draggable data-testid="library-node" onDragStart={(event) => handleDragStart(event, kind)} onClick={() => onAddNode(kind)}>
                  <Icon size={17} aria-hidden="true" />
                  <span>{uiPlugin.label}</span>
                </button>
              );
            })}
          </section>
        ))}
      </div>
    </aside>
  );
}

import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';

import type { NodeKind } from '../../domain/model';
import type { NodeCategory } from '../../domain/node-definitions';
import { builtinNodePlatform } from '../../nodes/builtins';
import type { NodeCanvasContext, NodeInspectorContext } from '../../nodes/types';

export interface NodeUiPlugin {
  readonly kind: string;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly openable?: string;
  readonly CanvasBody?: ComponentType<NodeCanvasContext<unknown>>;
  readonly Inspector?: ComponentType<NodeInspectorContext<unknown>>;
  readonly Dialog?: ComponentType<{ open: boolean; nodeId: string; onClose: () => void; store: unknown }>;
  readonly showRunAction?: boolean;
  readonly theme?: { headerBackground: string; glyphColor: string };
}

export const nodeUiPlugins: readonly NodeUiPlugin[] = builtinNodePlatform.definitions().map((definition) => {
  const ui = builtinNodePlatform.getUi(definition.kind)!;
  return {
    kind: definition.kind,
    label: ui.label,
    icon: ui.icon,
    openable: ui.Dialog ? definition.kind : undefined,
    Inspector: ui.Inspector as never,
    CanvasBody: ui.CanvasBody as never,
    Dialog: ui.Dialog,
    showRunAction: ui.showRunAction,
    theme: ui.theme,
  };
});

export function lookupNodeUiPlugin(kind: string): NodeUiPlugin | undefined {
  return nodeUiPlugins.find((entry) => entry.kind === kind);
}

export function getNodeUiPlugin(kind: NodeKind): NodeUiPlugin {
  const plugin = lookupNodeUiPlugin(kind);
  if (!plugin) {
    throw new Error(`Unknown node kind: ${kind}`);
  }
  return plugin;
}

export const nodeLabels: Record<string, string> = Object.fromEntries(
  nodeUiPlugins.map((plugin) => [plugin.kind, plugin.label]),
);

const categoryLabels: Partial<Record<NodeCategory, string>> = {
  variable: '变量',
  generate: 'AI 生成',
  select: '筛选数据',
};

export function nodeLibraryGroups(): Array<{
  category: NodeCategory;
  label: string;
  kinds: string[];
}> {
  return (Object.keys(categoryLabels) as NodeCategory[])
    .map((category) => ({
      category,
      label: categoryLabels[category]!,
      kinds: builtinNodePlatform.definitions()
        .filter((definition) => definition.category === category && !definition.hiddenFromLibrary)
        .map((definition) => definition.kind),
    }))
    .filter((group) => group.kinds.length > 0);
}

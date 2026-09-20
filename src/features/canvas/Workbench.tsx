import '@xyflow/react/dist/style.css';

import {
  Background,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useReactFlow,
  type Connection,
  type NodeChange,
  type Viewport,
} from '@xyflow/react';
import { Button, Tooltip } from 'antd';
import { Bot, BookOpen, Maximize, Play, Settings, Square, Trash2, ZoomIn, ZoomOut } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { useStore } from 'zustand';

import type { NodeKind } from '../../domain/model';
import { planControlRun } from '../../domain/control-flow';
import { deletionImpact, dropCardsOutsideVariablePools } from '../../domain/graph';
import type { AppStore } from '../../state/use-app-store';
import { lookupNodeUiPlugin, nodeUiPlugins } from '../nodes/ui-registry';
import { AnnotationNodeView } from './AnnotationNode';
import { NodeInspector } from './NodeInspector';
import { NODE_DRAG_TYPE, NodeLibrary } from './NodeLibrary';
import { PaneContextMenu, type PaneContextMenuState } from './PaneContextMenu';
import { StatusBar } from './StatusBar';
import { toFlowEdges, toFlowNodes } from './node-adapter';
import { applySelectChanges, pruneSelectedIds } from './node-selection';
import { WorkflowNodeView } from './WorkflowNode';
import { DeleteDialog } from './DeleteDialog';
import { WorkspaceRail } from './WorkspaceRail';
import { ReferenceLibraryDialog } from '../reference-library/ReferenceLibraryDialog';
import { MobileWorkbenchChrome, MobileWorkbenchToolbar, type MobilePanel } from './MobileWorkbenchChrome';
import { useMobileWorkbench } from './use-mobile-workbench';

export interface WorkbenchProps {
  store: AppStore;
  createEdgeId: () => string;
  onOpenAiSettings?: () => void;
  onOpenNode?: (nodeId: string) => void;
}

const nodeTypes = {
  workflow: WorkflowNodeView,
  annotation: AnnotationNodeView,
};
const validKinds = new Set(
  nodeUiPlugins
    .filter((plugin) => plugin.kind !== 'annotation')
    .map((plugin) => plugin.kind),
);

function IconButton({ label, children, onClick, disabled, disabledReason, showLabel }: { label: string; children: React.ReactNode; onClick: () => void; disabled?: boolean; disabledReason?: string; showLabel?: boolean }) {
  return (
    <Tooltip title={disabled && disabledReason ? disabledReason : label}>
      <Button
        className={showLabel ? 'tool-button tool-button--labeled' : 'tool-button'}
        aria-label={label}
        title={disabled && disabledReason ? disabledReason : undefined}
        icon={children}
        onClick={onClick}
        disabled={disabled}
      >
        {showLabel ? label : undefined}
      </Button>
    </Tooltip>
  );
}

function WorkbenchCanvas({ store, createEdgeId, onOpenAiSettings, onOpenNode }: WorkbenchProps) {
  const workflow = useStore(store, (state) => state.workflow);
  const nodeProgress = useStore(store, (state) => state.nodeProgress);
  const chatActivities = useStore(store, (state) => state.chatActivities);
  const progress = useMemo(() => {
    const result = { ...nodeProgress };
    const byNode = new Map<string, NonNullable<typeof chatActivities>[string][]>();
    for (const activity of Object.values(chatActivities ?? {})) {
      byNode.set(activity.nodeId, [...(byNode.get(activity.nodeId) ?? []), activity]);
    }
    for (const [nodeId, activities] of byNode) {
      result[nodeId] = activities.length === 1 ? activities[0]!.progress : {
        stage: `${activities.length} 个对话运行中`, percent: activities.reduce((sum, item) => sum + item.progress.percent, 0) / activities.length, estimated: true,
      };
    }
    return result;
  }, [nodeProgress, chatActivities]);
  const cards = useStore(store, (state) => state.cards);
  const runs = useStore(store, (state) => state.runs);
  const sessions = useStore(store, (state) => state.sessions);
  const documents = useStore(store, (state) => state.documents);
  const saveStatus = useStore(store, (state) => state.saveStatus);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [connectionFeedback, setConnectionFeedback] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string>();
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>(null);
  const [mobileMultiSelect, setMobileMultiSelect] = useState(false);
  const [paneMenu, setPaneMenu] = useState<PaneContextMenuState | null>(null);
  const [autoFocusNodeId, setAutoFocusNodeId] = useState<string>();
  const isMobile = useMobileWorkbench();
  const canvasRef = useRef<HTMLElement>(null);
  const { screenToFlowPosition, zoomIn, zoomOut, fitView } = useReactFlow();
  const openNode = useCallback((nodeId: string) => {
    const kind = store.getState().workflow?.nodes.find((node) => node.id === nodeId)?.kind;
    if (!kind) return;
    if (lookupNodeUiPlugin(kind)?.Dialog) onOpenNode?.(nodeId);
  }, [onOpenNode, store]);

  const requestDeleteNode = useCallback((nodeId: string) => {
    const kind = store.getState().workflow?.nodes.find((node) => node.id === nodeId)?.kind;
    if (kind === 'annotation') {
      void store.getState().deleteNode(nodeId);
      return;
    }
    setDeleteTarget(nodeId);
    setDeleteOpen(true);
  }, [store]);

  const disconnectPort = useCallback((nodeId: string, portId: string, direction: 'input' | 'output') => {
    store.getState().disconnectPort(nodeId, portId, direction);
  }, [store]);

  const patchNodeConfig = useCallback((nodeId: string, patch: unknown) => {
    const kind = store.getState().workflow?.nodes.find((node) => node.id === nodeId)?.kind;
    store.getState().patchNodeConfig(
      nodeId,
      patch,
      kind === 'annotation' ? { invalidateDescendants: false } : undefined,
    );
  }, [store]);

  const clearAutoFocus = useCallback((nodeId: string) => {
    setAutoFocusNodeId((current) => (current === nodeId ? undefined : current));
  }, []);

  const executionAvailable = store.getState().isExecutionAvailable();
  const hasRunningNodes = workflow?.nodes.some((node) => node.status === 'running') ?? false;

  const runNode = useCallback((nodeId: string) => {
    void store.getState().rerunNode(nodeId);
  }, [store]);

  const flowNodes = useMemo(() => workflow ? toFlowNodes(workflow, {
    onOpen: openNode,
    onDelete: requestDeleteNode,
    onDisconnectPort: disconnectPort,
    onRun: executionAvailable ? runNode : undefined,
    onPatchConfig: patchNodeConfig,
    onClearAutoFocus: clearAutoFocus,
  }, selectedNodeIds, cards, documents, progress, autoFocusNodeId) : [], [
    workflow, openNode, requestDeleteNode, disconnectPort, runNode, executionAvailable,
    selectedNodeIds, cards, documents, progress, autoFocusNodeId, patchNodeConfig, clearAutoFocus,
  ]);
  const flowEdges = useMemo(() => workflow ? toFlowEdges(workflow) : [], [workflow]);
  const focusedNodeId = selectedNodeIds.at(-1);
  const selectedNode = workflow?.nodes.find((node) => node.id === focusedNodeId);
  const workflowId = workflow?.id;

  useEffect(() => {
    if (!isMobile) {
      setMobilePanel(null);
      setMobileMultiSelect(false);
    }
  }, [isMobile]);

  useEffect(() => {
    setSelectedNodeIds((current) => (current.length === 0 ? current : []));
  }, [workflowId]);

  useEffect(() => {
    const existingIds = new Set(workflow?.nodes.map((node) => node.id) ?? []);
    setSelectedNodeIds((current) => {
      const next = pruneSelectedIds(current, existingIds);
      if (next.length === current.length && next.every((id, index) => id === current[index])) {
        return current;
      }
      return next;
    });
  }, [workflow]);
  const deleteImpact = useMemo(() => {
    if (!workflow) {
      return { nodes: 0, edges: 0, runs: 0, cards: 0, sessions: 0 };
    }
    const nodeIds = deleteTarget ? deletionImpact(workflow, deleteTarget).nodeIds : workflow.nodes.map((node) => node.id);
    const edgeIds = deleteTarget ? deletionImpact(workflow, deleteTarget).edgeIds : workflow.edges.map((edge) => edge.id);
    const nodeIdSet = new Set(nodeIds);
    const affectedRuns = runs.filter((run) => run.workflowId === workflow.id && nodeIdSet.has(run.nodeId));
    const remainingWorkflow = {
      ...workflow,
      nodes: workflow.nodes.filter((node) => !nodeIdSet.has(node.id)),
    };
    const workflowCards = cards.filter((card) => card.workflowId === workflow.id);
    const keptCardIds = new Set(dropCardsOutsideVariablePools(remainingWorkflow, workflowCards).map((card) => card.id));
    const removedCards = workflowCards.filter((card) => !keptCardIds.has(card.id));
    const removedCardIds = new Set(removedCards.map((card) => card.id));
    const affectedSessions = sessions.filter((session) => (
      session.workflowId === workflow.id
      && (nodeIdSet.has(session.nodeId) || session.referencedCardIds.some((cardId) => removedCardIds.has(cardId)))
    ));
    return {
      nodes: nodeIds.length,
      edges: edgeIds.length,
      runs: affectedRuns.length,
      cards: removedCards.length,
      sessions: affectedSessions.length,
    };
  }, [cards, deleteTarget, runs, sessions, workflow]);
  const selectedOpenable = selectedNode
    ? lookupNodeUiPlugin(selectedNode.kind)?.Dialog
    : undefined;
  const canOpenSelectedNode = !!selectedOpenable && !!onOpenNode;

  const handleDrop = useCallback((event: DragEvent) => {
    event.preventDefault();
    const kind = event.dataTransfer.getData(NODE_DRAG_TYPE) as NodeKind;
    if (!validKinds.has(kind)) return;
    store.getState().addNode(kind, screenToFlowPosition({ x: event.clientX, y: event.clientY }));
  }, [screenToFlowPosition, store]);

  const addNodeAtCanvasCenter = useCallback((kind: NodeKind) => {
    const bounds = canvasRef.current?.getBoundingClientRect();
    if (!bounds) return;
    store.getState().addNode(kind, screenToFlowPosition({
      x: bounds.left + bounds.width / 2,
      y: bounds.top + bounds.height / 2,
    }));
    if (isMobile) setMobilePanel(null);
  }, [isMobile, screenToFlowPosition, store]);

  const addAnnotationAt = useCallback((position: { x: number; y: number }) => {
    const id = store.getState().addNode('annotation', position);
    if (!id) return;
    setSelectedNodeIds([id]);
    setAutoFocusNodeId(id);
  }, [store]);

  const handlePaneContextMenu = useCallback((event: React.MouseEvent | MouseEvent) => {
    event.preventDefault();
    const flow = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    setPaneMenu({
      clientX: event.clientX,
      clientY: event.clientY,
      flowX: flow.x,
      flowY: flow.y,
    });
  }, [screenToFlowPosition]);

  const handleConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target || !connection.sourceHandle || !connection.targetHandle) {
      setConnectionFeedback('连接信息不完整');
      return;
    }
    const result = store.getState().connect({
      id: createEdgeId(),
      sourceNodeId: connection.source,
      sourcePortId: connection.sourceHandle,
      targetNodeId: connection.target,
      targetPortId: connection.targetHandle,
    });
    setConnectionFeedback(result.ok ? '' : result.reason);
  }, [createEdgeId, store]);

  const handleNodeChanges = useCallback((changes: NodeChange[]) => {
    const positions = changes.flatMap((change) => (
      change.type === 'position' && change.position
        ? [{ id: change.id, position: change.position }]
        : []
    ));
    if (positions.length > 0) {
      store.getState().moveNodes(positions);
    }
    const selectChanges = changes.flatMap((change) => (
      change.type === 'select'
        ? [{ id: change.id, selected: change.selected }]
        : []
    ));
    if (selectChanges.length > 0 && !mobileMultiSelect) {
      setSelectedNodeIds((current) => applySelectChanges(current, selectChanges));
    }
  }, [mobileMultiSelect, store]);

  const handleNodeClick = useCallback((event: React.MouseEvent, node: { id: string }) => {
    if (!isMobile || !mobileMultiSelect) return;
    event.preventDefault();
    setSelectedNodeIds((current) => applySelectChanges(current, [{
      id: node.id,
      selected: !current.includes(node.id),
    }]));
  }, [isMobile, mobileMultiSelect]);

  const controlPlan = planControlRun(workflow, focusedNodeId);
  const runDisabled = !workflow || !executionAvailable || !controlPlan.ok;
  const runDisabledReason = !executionAvailable
    ? '请先配置 AI 服务'
    : (!controlPlan.ok ? controlPlan.reason : undefined);

  const runWorkflow = () => {
    if (runDisabled) return;
    void store.getState().runControlChain(focusedNodeId);
  };
  const stopActive = () => {
    store.getState().workflow?.nodes.filter((node) => node.status === 'running').forEach((node) => store.getState().stopNode(node.id));
  };

  const workspaceRail = (
    <WorkspaceRail
      store={store}
      collapsed={isMobile ? false : railCollapsed}
      onToggleCollapsed={() => setRailCollapsed((current) => !current)}
    />
  );
  const nodeLibrary = <NodeLibrary onAddNode={addNodeAtCanvasCenter} />;
  const nodeInspector = (
    <NodeInspector
      progress={selectedNode ? progress[selectedNode.id] : undefined}
      node={selectedNode}
      workflow={workflow}
      cards={cards}
      documents={documents}
      runs={runs}
      store={store}
      onOpen={canOpenSelectedNode ? openNode : undefined}
    />
  );

  return (
    <div className="workbench">
      {isMobile ? (
        <MobileWorkbenchToolbar
          workflowName={workflow?.name ?? '正在载入工作流'}
          running={hasRunningNodes}
          runDisabled={runDisabled}
          runDisabledReason={runDisabledReason}
          deleteDisabled={!selectedNode}
          multiSelect={mobileMultiSelect}
          onRun={runWorkflow}
          onStop={stopActive}
          onOpenLibrary={() => setLibraryOpen(true)}
          onZoomIn={() => { void zoomIn(); }}
          onZoomOut={() => { void zoomOut(); }}
          onFitView={() => { void fitView(); }}
          onDelete={() => { if (selectedNode) requestDeleteNode(selectedNode.id); }}
          onToggleMultiSelect={() => setMobileMultiSelect((enabled) => !enabled)}
          onOpenAiSettings={() => onOpenAiSettings?.()}
        />
      ) : <header className="workbench-toolbar">
        <div className="brand"><Bot size={20} aria-hidden="true" /><h1>IdeaForge</h1></div>
        <div className="workflow-name" aria-label="当前工作区">
          <span>工作区</span>
          <span className="workflow-name__sep">/</span>
          <span className="workflow-name__current">{workflow?.name ?? '正在载入工作流'}</span>
        </div>
        <div className="toolbar-actions" aria-label="工作流命令">
          <IconButton label="资料库" showLabel onClick={() => setLibraryOpen(true)}><BookOpen size={17} /></IconButton>
          <IconButton
            label="运行"
            onClick={runWorkflow}
            disabled={runDisabled}
            disabledReason={runDisabledReason}
          >
            <Play size={17} />
          </IconButton>
          <IconButton label="停止活动任务" onClick={stopActive} disabled={!hasRunningNodes}><Square size={16} /></IconButton>
          <span className="toolbar-divider" />
          <IconButton label="放大" onClick={() => { void zoomIn(); }}><ZoomIn size={17} /></IconButton>
          <IconButton label="缩小" onClick={() => { void zoomOut(); }}><ZoomOut size={17} /></IconButton>
          <IconButton label="适应视图" onClick={() => { void fitView(); }}><Maximize size={17} /></IconButton>
          <span className="toolbar-divider" />
          {selectedNode && <IconButton label="删除选中节点" onClick={() => requestDeleteNode(selectedNode.id)}><Trash2 size={17} /></IconButton>}
          <IconButton label="AI 设置" onClick={() => onOpenAiSettings?.()} disabled={!onOpenAiSettings} disabledReason="AI 设置尚未接入"><Settings size={17} /></IconButton>
        </div>
      </header>}
      <div className={`workbench-body${railCollapsed ? ' is-rail-collapsed' : ''}`}>
        {!isMobile && workspaceRail}
        {!isMobile && nodeLibrary}
        <section ref={canvasRef} className="canvas-shell" aria-label="工作流画布">
          {workflow ? (
            <ReactFlow
              key={workflow.id}
              nodes={flowNodes}
              edges={flowEdges}
              nodeTypes={nodeTypes}
              defaultViewport={workflow.viewport}
              onNodesChange={handleNodeChanges}
              onNodeClick={handleNodeClick}
              onPaneClick={() => {
                setSelectedNodeIds([]);
                setPaneMenu(null);
              }}
              onNodeContextMenu={(event) => event.preventDefault()}
              onPaneContextMenu={handlePaneContextMenu}
              deleteKeyCode={null}
              selectionOnDrag={!isMobile}
              selectionMode={SelectionMode.Partial}
              selectionKeyCode={null}
              multiSelectionKeyCode={isMobile ? null : 'Shift'}
              panOnDrag={isMobile ? true : [1, 2]}
              panActivationKeyCode="Space"
              onConnect={handleConnect}
              onMoveEnd={(_event, viewport: Viewport) => store.getState().setViewport(viewport)}
              onDrop={handleDrop}
              onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }}
              defaultEdgeOptions={{ type: 'default', style: { stroke: '#9aa6b2', strokeWidth: 2.25 } }}
              connectionLineStyle={{ stroke: '#1677ff', strokeWidth: 2 }}
              fitViewOptions={{ padding: 0.2 }}
              minZoom={0.35}
              maxZoom={1.8}
            >
              <Background color="#d8dde3" gap={24} size={1} />
              <MiniMap pannable zoomable aria-label="工作流小地图" />
            </ReactFlow>
          ) : <div className="canvas-loading">正在准备工作台...</div>}
          {connectionFeedback && <div className="connection-feedback" role="status" aria-live="polite">{connectionFeedback}</div>}
          <PaneContextMenu
            state={paneMenu}
            onClose={() => setPaneMenu(null)}
            onAddAnnotation={addAnnotationAt}
          />
        </section>
        {!isMobile && nodeInspector}
      </div>
      <StatusBar nodes={workflow?.nodes ?? []} progress={progress} runs={runs} saveStatus={saveStatus} onRetry={() => void store.getState().saveNow()} />
      {isMobile && (
        <MobileWorkbenchChrome
          panel={mobilePanel}
          onPanelChange={setMobilePanel}
          workspace={workspaceRail}
          library={nodeLibrary}
          inspector={nodeInspector}
        />
      )}
      <ReferenceLibraryDialog open={libraryOpen} onClose={() => setLibraryOpen(false)} store={store} />
      <DeleteDialog open={deleteOpen} impact={{ ...deleteImpact, scope: deleteTarget ? 'node' : 'workflow' }} onClose={() => setDeleteOpen(false)} onConfirm={async () => { if (deleteTarget) await store.getState().deleteNode(deleteTarget); else await store.getState().deleteWorkflow(); setDeleteOpen(false); setDeleteTarget(undefined); }} />
    </div>
  );
}

export function Workbench(props: WorkbenchProps) {
  return <ReactFlowProvider><WorkbenchCanvas {...props} /></ReactFlowProvider>;
}

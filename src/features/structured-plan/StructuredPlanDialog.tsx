import { Button, message, Modal, Popconfirm, Tooltip } from 'antd';
import {
  ChevronDown,
  ChevronUp,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useStore } from 'zustand';

import type { AiErrorKind } from '../../ai/client';
import { getAiErrorMessage } from '../../ai/error-messages';
import { AppDialog } from '../../components/AppDialog';
import { ExecutionProgressView } from '../../components/ExecutionProgressView';
import type { StructuredPlanConfig, StructuredPlanModule } from '../../nodes/structured-plan/config';
import { structuredPlanConfigSchema, STRUCTURED_PLAN_PRIORITY_LABELS } from '../../nodes/structured-plan/config';
import {
  createEmptyStructuredPlanModule,
  discardStructuredPlanCandidate,
  formatStructuredPlanOutput,
  markStructuredPlanGraphStale,
  moveStructuredPlanModule,
  replaceStructuredPlanCandidate,
  updateStructuredPlanModule,
  type StructuredPlanModuleEditableFields,
} from '../../nodes/structured-plan/format';
import type { ConfigPatchResult } from '../../nodes/types';
import type { AppStore } from '../../state/use-app-store';
import { StructuredPlanDependencyGraph } from './StructuredPlanDependencyGraph';
import { StructuredPlanDocumentView } from './StructuredPlanDocumentView';
import { StructuredPlanModuleForm } from './StructuredPlanModuleForm';
import { StructuredPlanModuleView } from './StructuredPlanModuleView';

type StructuredPlanTab = 'current' | 'candidate' | 'graph' | 'document';
type StructuredPlanVersion = 'current' | 'candidate';

function readLiveConfig(store: AppStore, nodeId: string) {
  const node = store.getState().workflow?.nodes.find((item) => item.id === nodeId);
  const parsed = structuredPlanConfigSchema.safeParse(node?.config);
  return parsed.success ? parsed.data : null;
}

function versionModules(config: ReturnType<typeof readLiveConfig>, version: StructuredPlanVersion) {
  if (!config) return null;
  return version === 'current' ? config.modules : config.candidateModules;
}

function withStaleGraphForVersion(
  config: StructuredPlanConfig,
  version: StructuredPlanVersion,
  nextModules: StructuredPlanModule[],
): StructuredPlanConfig {
  const graphKey = version === 'current' ? 'dependencyGraph' : 'candidateDependencyGraph';
  const graph = config[graphKey];
  const nextConfig = version === 'current'
    ? { ...config, modules: nextModules }
    : { ...config, candidateModules: nextModules };
  if (!graph) return nextConfig;
  const moduleIds = new Set(nextModules.map((item) => item.id));
  return markStructuredPlanGraphStale({
    ...nextConfig,
    [graphKey]: {
      ...graph,
      nodes: nextModules.map((item) => ({ moduleId: item.id })),
      edges: graph.edges.filter((edge) => (
        moduleIds.has(edge.sourceModuleId) && moduleIds.has(edge.targetModuleId)
      )),
    },
  }, version);
}

function moduleSignature(module: StructuredPlanModule | undefined): string | null {
  return module ? JSON.stringify(module) : null;
}

function nextModuleTitle(modules: readonly StructuredPlanModule[]): string {
  const titles = new Set(modules.map((module) => module.title.trim()));
  if (!titles.has('新系统模块')) return '新系统模块';
  let suffix = 2;
  while (titles.has(`新系统模块 ${suffix}`)) suffix += 1;
  return `新系统模块 ${suffix}`;
}

const candidateDateFormatter = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const structuredPlanStatusLabels = {
  idle: '等待',
  running: '运行中',
  succeeded: '成功',
  partial: '部分成功',
  failed: '失败',
  stopped: '已停止',
  stale: '下游已过期',
} as const;

function formatCandidateGeneratedAt(value: string): string | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : candidateDateFormatter.format(date);
}

const aiErrorKinds = new Set<string>([
  'auth',
  'network-or-cors',
  'rate-limit',
  'server',
  'invalid-response',
  'stopped',
]);

function graphRegenErrorMessage(kind: string): string {
  if (kind === 'missing-client') return '请先配置 AI 服务';
  if (kind === 'invalid-input') return '模块或版本已变化，本次生成结果未写入';
  if (kind === 'invalid-config') return '节点配置无效';
  if (aiErrorKinds.has(kind)) return getAiErrorMessage(kind as AiErrorKind);
  return '依赖图谱重新生成失败';
}

export function StructuredPlanDialog({
  open,
  store,
  nodeId,
  onClose,
}: {
  open: boolean;
  store: AppStore;
  nodeId: string;
  onClose: () => void;
}) {
  const workflow = useStore(store, (state) => state.workflow);
  const progress = useStore(store, (state) => state.nodeProgress?.[nodeId]);
  const node = workflow?.nodes.find((item) => item.id === nodeId);
  const parsed = structuredPlanConfigSchema.safeParse(node?.config);
  const config = parsed.success ? parsed.data : null;
  const [tab, setTab] = useState<StructuredPlanTab>('current');
  const [graphVersion, setGraphVersion] = useState<StructuredPlanVersion>('current');
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null);
  const [editingModuleId, setEditingModuleId] = useState<string | null>(null);
  const [editingVersion, setEditingVersion] = useState<StructuredPlanVersion | null>(null);
  const [editingSourceSignature, setEditingSourceSignature] = useState<string | null>(null);
  const [newModuleDraft, setNewModuleDraft] = useState<StructuredPlanModule | null>(null);
  const [editingDirty, setEditingDirty] = useState(false);
  const [rerunPending, setRerunPending] = useState(false);
  const [graphRegenPending, setGraphRegenPending] = useState(false);
  const graphRegenGenerationRef = useRef(0);
  const tabsetId = useId().replace(/:/g, '');
  const currentTabRef = useRef<HTMLButtonElement>(null);
  const candidateTabRef = useRef<HTMLButtonElement>(null);
  const graphTabRef = useRef<HTMLButtonElement>(null);
  const documentTabRef = useRef<HTMLButtonElement>(null);

  const candidateExists = config?.candidateModules !== null && config?.candidateModules !== undefined;
  const candidateGeneratedAtLabel = config?.candidateGeneratedAt
    ? formatCandidateGeneratedAt(config.candidateGeneratedAt)
    : null;
  const activeVersion: StructuredPlanVersion = tab === 'candidate' ? 'candidate' : 'current';
  const activeModules = config
    ? (tab === 'candidate' ? config.candidateModules ?? [] : config.modules)
    : [];
  const graphModules = config
    ? (graphVersion === 'current' ? config.modules : config.candidateModules ?? [])
    : [];
  const selectedGraph = config
    ? (graphVersion === 'current' ? config.dependencyGraph : config.candidateDependencyGraph)
    : null;
  const activeIds = activeModules.map((module) => module.id).join('\u0000');
  const selectedModule = activeModules.find((module) => module.id === selectedModuleId)
    ?? activeModules[0]
    ?? null;
  const editingModules = config && editingVersion
    ? versionModules(config, editingVersion) ?? []
    : [];
  const editingModule = newModuleDraft
    ?? editingModules.find((module) => module.id === editingModuleId)
    ?? null;
  const liveEditingSignature = newModuleDraft
    ? (editingVersion === 'candidate' ? config?.candidateGeneratedAt ?? null : 'current')
    : moduleSignature(editingModules.find((module) => module.id === editingModuleId));

  useEffect(() => {
    if (tab === 'candidate' && !candidateExists) setTab('current');
    if (graphVersion === 'candidate' && !candidateExists) setGraphVersion('current');
  }, [candidateExists, graphVersion, tab]);

  useEffect(() => {
    if (!editingVersion || !editingModuleId) return;
    const sourceStillApplies = liveEditingSignature === editingSourceSignature;
    if (sourceStillApplies) return;
    const conflicted = editingDirty;
    setEditingModuleId(null);
    setEditingVersion(null);
    setEditingSourceSignature(null);
    setNewModuleDraft(null);
    setEditingDirty(false);
    if (editingVersion === 'candidate' && !candidateExists) setTab('current');
    if (conflicted) void message.error(
      editingVersion === 'candidate'
        ? '候选版本已在外部更新，未保存的修改已关闭'
        : '当前版本已在外部更新，未保存的修改已关闭',
    );
  }, [
    candidateExists,
    editingDirty,
    editingModuleId,
    editingSourceSignature,
    editingVersion,
    liveEditingSignature,
  ]);

  useEffect(() => {
    setSelectedModuleId((current) => (
      current && activeModules.some((module) => module.id === current)
        ? current
        : activeModules[0]?.id ?? null
    ));
  }, [activeIds, tab]);

  useEffect(() => {
    if (!open) {
      setEditingModuleId(null);
      setEditingVersion(null);
      setEditingSourceSignature(null);
      setNewModuleDraft(null);
      setEditingDirty(false);
    }
  }, [open]);

  const closeEditor = () => {
    setEditingModuleId(null);
    setEditingVersion(null);
    setEditingSourceSignature(null);
    setNewModuleDraft(null);
    setEditingDirty(false);
  };

  const guardDirty = (
    action: () => boolean | void | Promise<boolean | void>,
    discardOnSuccess = true,
  ) => {
    const finishAction = (result: boolean | void) => {
      if (result !== false && discardOnSuccess) closeEditor();
      return result;
    };
    const continueAction = () => {
      const result = action();
      return result instanceof Promise ? result.then(finishAction) : finishAction(result);
    };
    if (!editingDirty) {
      void continueAction();
      return;
    }
    Modal.confirm({
      title: '放弃未保存的修改？',
      content: '当前模块的修改尚未保存。',
      okText: '放弃修改',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: continueAction,
    });
  };

  const switchTab = (nextTab: StructuredPlanTab, focus = false) => {
    guardDirty(() => {
      const live = readLiveConfig(store, nodeId);
      if (!live || (nextTab === 'candidate' && !live.candidateModules)) {
        void message.error('目标版本已不存在');
        return false;
      }
      setTab(nextTab);
      if (focus) queueMicrotask(() => {
        const focused = nextTab === 'current'
          ? currentTabRef.current
          : nextTab === 'candidate'
            ? candidateTabRef.current
            : nextTab === 'graph'
              ? graphTabRef.current
              : documentTabRef.current;
        focused?.focus();
      });
      return true;
    });
  };

  const visibleTabs = (): StructuredPlanTab[] => (
    candidateExists ? ['current', 'candidate', 'graph', 'document'] : ['current', 'graph', 'document']
  );

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const tabs = visibleTabs();
    const index = tabs.indexOf(tab);
    const delta = event.key === 'ArrowRight' ? 1 : -1;
    const nextTab = tabs[(index + delta + tabs.length) % tabs.length];
    if (nextTab) switchTab(nextTab, true);
  };

  const reportFailure = (result: ConfigPatchResult): boolean => {
    if (result.ok) return false;
    void message.error(result.message ?? '无法保存结构化策划案');
    return true;
  };

  const persistModules = (
    live: NonNullable<ReturnType<typeof readLiveConfig>>,
    version: StructuredPlanVersion,
    nextModules: StructuredPlanModule[],
  ): boolean => {
    const nextConfig = withStaleGraphForVersion(live, version, nextModules);
    if (version === 'current') {
      const result = store.getState().publishNodeConfigAndOutput(
        nodeId,
        nextConfig,
        formatStructuredPlanOutput(nextModules),
      );
      return !reportFailure(result);
    }
    if (!live.candidateModules) {
      void message.error('候选版本已不存在');
      return false;
    }
    const result = store.getState().commitNodeConfigAndOutput(nodeId, nextConfig);
    return !reportFailure(result);
  };

  const saveModule = (fields: StructuredPlanModuleEditableFields) => {
    if (!editingModule || !editingVersion) return;
    const live = readLiveConfig(store, nodeId);
    const liveModules = versionModules(live, editingVersion);
    if (!live || !liveModules) {
      void message.error('编辑来源版本已不存在，无法保存');
      return;
    }
    const liveSource = newModuleDraft
      ? (editingVersion === 'candidate' ? live.candidateGeneratedAt : 'current')
      : moduleSignature(liveModules.find((module) => module.id === editingModuleId));
    if (liveSource !== editingSourceSignature) {
      void message.error('编辑来源已在外部更新，无法保存');
      closeEditor();
      return;
    }
    const base = newModuleDraft
      ?? liveModules.find((module) => module.id === editingModuleId);
    if (!base) return;
    const saved = updateStructuredPlanModule(base, fields, new Date().toISOString());
    const nextModules = newModuleDraft
      ? [...liveModules, saved]
      : liveModules.map((module) => module.id === saved.id ? saved : module);
    if (!persistModules(live, editingVersion, nextModules)) return;
    setSelectedModuleId(saved.id);
    closeEditor();
  };

  const addModule = () => {
    guardDirty(() => {
      const live = readLiveConfig(store, nodeId);
      const liveModules = versionModules(live, activeVersion);
      if (!live || !liveModules) {
        void message.error('目标版本已不存在');
        return false;
      }
      const draft = createEmptyStructuredPlanModule(nextModuleTitle(liveModules), {
        id: () => crypto.randomUUID(),
        now: () => new Date().toISOString(),
      });
      closeEditor();
      setNewModuleDraft(draft);
      setEditingModuleId(draft.id);
      setEditingVersion(activeVersion);
      setEditingSourceSignature(activeVersion === 'candidate' ? live.candidateGeneratedAt : 'current');
      setEditingDirty(false);
      return true;
    }, false);
  };

  const deleteModule = (version: StructuredPlanVersion, moduleId: string) => {
    const live = readLiveConfig(store, nodeId);
    const liveModules = versionModules(live, version);
    if (!live || !liveModules || !liveModules.some((module) => module.id === moduleId)) {
      void message.error('待删除模块已不存在');
      return false;
    }
    return persistModules(live, version, liveModules.filter((module) => module.id !== moduleId));
  };

  const moveModule = (version: StructuredPlanVersion, moduleId: string, direction: 'up' | 'down') => {
    const live = readLiveConfig(store, nodeId);
    const liveModules = versionModules(live, version);
    if (!live || !liveModules || !liveModules.some((module) => module.id === moduleId)) {
      void message.error('待移动模块已不存在');
      return false;
    }
    return persistModules(live, version, moveStructuredPlanModule(liveModules, moduleId, direction));
  };

  const rerun = async () => {
    if (!readLiveConfig(store, nodeId)) {
      void message.error('结构化策划案节点已不存在');
      return false;
    }
    setRerunPending(true);
    try {
      await store.getState().rerunNode(nodeId);
      return true;
    } catch (error) {
      void message.error(error instanceof Error ? error.message : 'AI 重新生成失败');
      return false;
    } finally {
      setRerunPending(false);
    }
  };

  const rerunGuardingDraft = () => guardDirty(rerun);

  const regenerateGraph = async () => {
    const live = readLiveConfig(store, nodeId);
    if (!live) {
      void message.error('结构化策划案节点已不存在');
      return false;
    }
    if (graphVersion === 'candidate' && !live.candidateModules) {
      void message.error('目标版本已不存在');
      return false;
    }
    const generation = graphRegenGenerationRef.current + 1;
    graphRegenGenerationRef.current = generation;
    setGraphRegenPending(true);
    try {
      const result = await store.getState().regenerateStructuredPlanGraph(nodeId, graphVersion);
      if (graphRegenGenerationRef.current !== generation) return false;
      if (!result.ok) {
        if (result.errorKind !== 'stopped') {
          void message.error(graphRegenErrorMessage(result.errorKind));
        }
        return false;
      }
      return true;
    } catch (error) {
      if (graphRegenGenerationRef.current !== generation) return false;
      void message.error(error instanceof Error ? error.message : '依赖图谱重新生成失败');
      return false;
    } finally {
      if (graphRegenGenerationRef.current === generation) {
        setGraphRegenPending(false);
      }
    }
  };

  const selectGraphVersion = (version: StructuredPlanVersion) => {
    if (version === 'candidate' && !readLiveConfig(store, nodeId)?.candidateModules) {
      void message.error('目标版本已不存在');
      return;
    }
    setGraphVersion(version);
  };

  const replaceCandidate = () => {
    const live = readLiveConfig(store, nodeId);
    if (!live?.candidateModules) {
      void message.error('候选版本已不存在');
      return false;
    }
    const nextConfig = replaceStructuredPlanCandidate(live);
    const result = store.getState().publishNodeConfigAndOutput(
      nodeId,
      nextConfig,
      formatStructuredPlanOutput(nextConfig.modules),
    );
    if (reportFailure(result)) return false;
    setTab('current');
    return true;
  };

  const discardCandidate = () => {
    const live = readLiveConfig(store, nodeId);
    if (!live?.candidateModules) {
      void message.error('候选版本已不存在');
      return false;
    }
    const result = store.getState().commitNodeConfigAndOutput(
      nodeId,
      discardStructuredPlanCandidate(live),
    );
    if (reportFailure(result)) return false;
    setTab('current');
    return true;
  };

  const guardedClose = () => guardDirty(() => {
    onClose();
    return true;
  });

  return (
    <AppDialog open={open} title="结构化策划案" onClose={guardedClose}>
      {node?.status === 'running' && progress && <ExecutionProgressView progress={progress} />}
      {!node ? (
        <p className="structured-plan-error">结构化策划案节点不存在</p>
      ) : !config ? (
        <p className="structured-plan-error">结构化策划案配置无效</p>
      ) : (
        <div className="structured-plan-dialog">
          <div className="structured-plan-toolbar">
            <div className="structured-plan-tabs" role="tablist" aria-label="规划版本">
              <button
                ref={currentTabRef}
                id={`${tabsetId}-current-tab`}
                type="button"
                role="tab"
                aria-selected={tab === 'current'}
                aria-controls={`${tabsetId}-panel`}
                tabIndex={tab === 'current' ? 0 : -1}
                className={`structured-plan-tabs__tab${tab === 'current' ? ' is-active' : ''}`}
                onClick={() => switchTab('current')}
                onKeyDown={handleTabKeyDown}
              >
                当前版本
              </button>
              {candidateExists ? (
                <button
                  ref={candidateTabRef}
                  id={`${tabsetId}-candidate-tab`}
                  type="button"
                  role="tab"
                  aria-selected={tab === 'candidate'}
                  aria-controls={`${tabsetId}-panel`}
                  tabIndex={tab === 'candidate' ? 0 : -1}
                  className={`structured-plan-tabs__tab${tab === 'candidate' ? ' is-active' : ''}`}
                  onClick={() => switchTab('candidate')}
                  onKeyDown={handleTabKeyDown}
                >
                  最新候选
                </button>
              ) : null}
              <button
                ref={graphTabRef}
                id={`${tabsetId}-graph-tab`}
                type="button"
                role="tab"
                aria-selected={tab === 'graph'}
                aria-controls={`${tabsetId}-panel`}
                tabIndex={tab === 'graph' ? 0 : -1}
                className={`structured-plan-tabs__tab${tab === 'graph' ? ' is-active' : ''}`}
                onClick={() => switchTab('graph')}
                onKeyDown={handleTabKeyDown}
              >
                依赖图谱
              </button>
              <button
                ref={documentTabRef}
                id={`${tabsetId}-document-tab`}
                type="button"
                role="tab"
                aria-selected={tab === 'document'}
                aria-controls={`${tabsetId}-panel`}
                tabIndex={tab === 'document' ? 0 : -1}
                className={`structured-plan-tabs__tab${tab === 'document' ? ' is-active' : ''}`}
                onClick={() => switchTab('document')}
                onKeyDown={handleTabKeyDown}
              >
                文档
              </button>
            </div>
            <div className="structured-plan-version-actions">
              {candidateExists ? (
                <Popconfirm
                  title="覆盖最新候选？"
                  description="AI 重新生成将替换现有的最新候选。"
                  okText="确定"
                  cancelText="取消"
                  onConfirm={rerunGuardingDraft}
                >
                  <Button
                    icon={<RefreshCw size={15} />}
                    aria-label="AI 重新生成"
                    loading={rerunPending}
                    disabled={node.status === 'running'}
                  >
                    AI 重新生成
                  </Button>
                </Popconfirm>
              ) : (
                <Button
                  icon={<RefreshCw size={15} />}
                  aria-label="AI 重新生成"
                  onClick={rerunGuardingDraft}
                  loading={rerunPending}
                  disabled={node.status === 'running'}
                >
                  AI 重新生成
                </Button>
              )}
              {tab === 'candidate' && candidateExists ? (
                <>
                  <Popconfirm
                    title="替换当前版本？"
                    description="当前正式版本将被最新候选覆盖。"
                    okText="确定"
                    cancelText="取消"
                    onConfirm={() => guardDirty(replaceCandidate)}
                  >
                    <Button type="primary" aria-label="替换当前版本">替换当前版本</Button>
                  </Popconfirm>
                  <Popconfirm
                    title="放弃最新候选？"
                    okText="确定"
                    cancelText="取消"
                    okButtonProps={{ danger: true }}
                    onConfirm={() => guardDirty(discardCandidate)}
                  >
                    <Button danger aria-label="放弃候选">放弃候选</Button>
                  </Popconfirm>
                </>
              ) : null}
            </div>
          </div>

          <div className="structured-plan-metadata" aria-label="策划案元数据">
            <span>正式模块 <strong aria-label="正式模块数">{config.modules.length}</strong></span>
            <span>状态 <strong aria-label="节点运行状态">{structuredPlanStatusLabels[node.status]}</strong></span>
            {tab === 'candidate' && config.candidateGeneratedAt ? (
              <span>
                候选生成{' '}
                {candidateGeneratedAtLabel ? (
                  <time
                    aria-label="候选生成时间"
                    dateTime={config.candidateGeneratedAt}
                  >
                    {candidateGeneratedAtLabel}
                  </time>
                ) : (
                  <span aria-label="候选生成时间">时间未知</span>
                )}
              </span>
            ) : null}
          </div>

          <div
            id={`${tabsetId}-panel`}
            className={`structured-plan-workspace${
              tab === 'graph'
                ? ' structured-plan-workspace--graph'
                : tab === 'document'
                  ? ' structured-plan-workspace--document'
                  : ''
            }`}
            role="tabpanel"
            aria-labelledby={`${tabsetId}-${tab}-tab`}
          >
            {tab === 'graph' ? (
              <>
                <div className="structured-plan-graph-toolbar">
                  <div
                    className="structured-plan-graph-versions"
                    role="radiogroup"
                    aria-label="图谱版本"
                  >
                    <button
                      type="button"
                      role="radio"
                      aria-checked={graphVersion === 'current'}
                      className={`structured-plan-graph-versions__option${graphVersion === 'current' ? ' is-checked' : ''}`}
                      onClick={() => selectGraphVersion('current')}
                    >
                      当前版本
                    </button>
                    {candidateExists ? (
                      <button
                        type="button"
                        role="radio"
                        aria-checked={graphVersion === 'candidate'}
                        className={`structured-plan-graph-versions__option${graphVersion === 'candidate' ? ' is-checked' : ''}`}
                        onClick={() => selectGraphVersion('candidate')}
                      >
                        最新候选
                      </button>
                    ) : null}
                  </div>
                  <Button
                    icon={<RefreshCw size={15} />}
                    aria-label="重新生成图谱"
                    loading={graphRegenPending}
                    onClick={() => { void regenerateGraph(); }}
                  >
                    重新生成
                  </Button>
                </div>
                <StructuredPlanDependencyGraph
                  key={graphVersion}
                  modules={graphModules}
                  graph={selectedGraph}
                />
              </>
            ) : tab === 'document' ? (
              <StructuredPlanDocumentView
                workflowName={workflow?.name ?? '未命名工作区'}
                modules={config.modules}
                graph={config.dependencyGraph}
              />
            ) : (
              <>
            <aside className="structured-plan-module-list" aria-label="模块列表">
              <div className="structured-plan-module-list__head">
                <h3>{tab === 'current' ? '当前模块' : '候选模块'}</h3>
                <Tooltip title="新增模块">
                  <Button
                    type="text"
                    icon={<Plus size={16} />}
                    aria-label="新增模块"
                    onClick={addModule}
                  />
                </Tooltip>
              </div>
              {activeModules.length === 0 ? (
                <div className="structured-plan-empty">
                  <p>{tab === 'current' ? '当前版本还没有模块' : '最新候选还没有模块'}</p>
                  <Button icon={<Plus size={15} />} onClick={addModule}>新增模块</Button>
                </div>
              ) : (
                <ul>
                  {activeModules.map((module, index) => (
                    <li
                      key={module.id}
                      className={selectedModule?.id === module.id ? 'is-selected' : ''}
                    >
                      <button
                        type="button"
                        className="structured-plan-module-list__select"
                        onClick={() => setSelectedModuleId(module.id)}
                      >
                        {module.title}
                        <span
                          aria-hidden="true"
                          className="structured-plan-module-list__priority"
                        >
                          {STRUCTURED_PLAN_PRIORITY_LABELS[module.priority]}
                        </span>
                      </button>
                      <div className="structured-plan-module-list__actions">
                        <Tooltip title="上移">
                          <Button
                            type="text"
                            icon={<ChevronUp size={15} />}
                            aria-label={`上移 ${module.title}`}
                            disabled={index === 0}
                            onClick={() => guardDirty(() => moveModule(activeVersion, module.id, 'up'))}
                          />
                        </Tooltip>
                        <Tooltip title="下移">
                          <Button
                            type="text"
                            icon={<ChevronDown size={15} />}
                            aria-label={`下移 ${module.title}`}
                            disabled={index === activeModules.length - 1}
                            onClick={() => guardDirty(() => moveModule(activeVersion, module.id, 'down'))}
                          />
                        </Tooltip>
                        <Tooltip title="编辑">
                          <Button
                            type="text"
                            icon={<Pencil size={15} />}
                            aria-label={`编辑 ${module.title}`}
                            onClick={() => guardDirty(() => {
                              const live = readLiveConfig(store, nodeId);
                              const liveModule = versionModules(live, activeVersion)
                                ?.find((item) => item.id === module.id);
                              if (!liveModule) {
                                void message.error('待编辑模块已不存在');
                                return false;
                              }
                              closeEditor();
                              setSelectedModuleId(module.id);
                              setEditingModuleId(module.id);
                              setEditingVersion(activeVersion);
                              setEditingSourceSignature(moduleSignature(liveModule));
                              setNewModuleDraft(null);
                              setEditingDirty(false);
                              return true;
                            }, false)}
                          />
                        </Tooltip>
                        <Popconfirm
                          title={`删除“${module.title}”？`}
                          okText="确定"
                          cancelText="取消"
                          okButtonProps={{ danger: true }}
                          onConfirm={() => guardDirty(() => deleteModule(activeVersion, module.id))}
                        >
                          <Tooltip title="删除">
                            <Button
                              type="text"
                              danger
                              icon={<Trash2 size={15} />}
                              aria-label={`删除 ${module.title}`}
                            />
                          </Tooltip>
                        </Popconfirm>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </aside>
            <main className="structured-plan-module-body">
              {editingModule ? (
                <section className="structured-plan-inline-editor" aria-label="模块编辑">
                  <h3>{newModuleDraft ? '新增模块' : `编辑 · ${editingModule.title}`}</h3>
                  <StructuredPlanModuleForm
                    module={editingModule}
                    onSave={saveModule}
                    onCancel={() => guardDirty(() => true)}
                    onDirtyChange={setEditingDirty}
                  />
                </section>
              ) : selectedModule ? (
                <>
                  <h3>{selectedModule.title}</h3>
                  <StructuredPlanModuleView module={selectedModule} />
                </>
              ) : (
                <p className="structured-plan-module-body__empty">选择或新增一个模块</p>
              )}
            </main>
              </>
            )}
          </div>
        </div>
      )}
    </AppDialog>
  );
}

import {
  BookOpen,
  Boxes,
  FolderKanban,
  Maximize,
  MoreHorizontal,
  Play,
  Settings,
  SlidersHorizontal,
  Square,
  Trash2,
  Workflow,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';

export type MobilePanel = 'workspace' | 'library' | 'inspector' | null;

const panelTitles = {
  workspace: '工作区',
  library: '节点库',
  inspector: '属性',
} as const;

export function MobileWorkbenchToolbar({
  workflowName,
  running,
  runDisabled,
  runDisabledReason,
  deleteDisabled,
  multiSelect,
  onRun,
  onStop,
  onOpenLibrary,
  onZoomIn,
  onZoomOut,
  onFitView,
  onDelete,
  onToggleMultiSelect,
  onOpenAiSettings,
}: {
  workflowName: string;
  running: boolean;
  runDisabled: boolean;
  runDisabledReason?: string;
  deleteDisabled: boolean;
  multiSelect: boolean;
  onRun: () => void;
  onStop: () => void;
  onOpenLibrary: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitView: () => void;
  onDelete: () => void;
  onToggleMultiSelect: () => void;
  onOpenAiSettings: () => void;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const runAction = running ? onStop : onRun;
  const runLabel = running ? '停止活动任务' : '运行';
  const closeThen = (action: () => void) => () => {
    setMoreOpen(false);
    action();
  };

  return (
    <header className="mobile-workbench-toolbar" aria-label="移动端工作流命令">
      <div className="mobile-workbench-toolbar__brand"><span aria-hidden="true">◆</span><h1>IdeaForge</h1></div>
      <span className="mobile-workbench-toolbar__name">{workflowName}</span>
      <button
        type="button"
        className="mobile-workbench-toolbar__run"
        aria-label={runLabel}
        title={!running && runDisabled ? runDisabledReason : undefined}
        disabled={!running && runDisabled}
        onClick={runAction}
      >
        {running ? <Square size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
        <span>{running ? '停止' : '运行'}</span>
      </button>
      <button type="button" className="mobile-workbench-toolbar__more" aria-label="更多" aria-expanded={moreOpen} onClick={() => setMoreOpen((open) => !open)}>
        <MoreHorizontal size={20} aria-hidden="true" />
      </button>
      {moreOpen && (
        <div className="mobile-workbench-menu" role="menu" aria-label="更多工作流命令">
          <button type="button" role="menuitem" onClick={closeThen(onOpenLibrary)}><BookOpen size={18} />资料库</button>
          <button type="button" role="menuitem" onClick={closeThen(onZoomIn)}><ZoomIn size={18} />放大</button>
          <button type="button" role="menuitem" onClick={closeThen(onZoomOut)}><ZoomOut size={18} />缩小</button>
          <button type="button" role="menuitem" onClick={closeThen(onFitView)}><Maximize size={18} />适应视图</button>
          <button type="button" role="menuitem" aria-pressed={multiSelect} onClick={closeThen(onToggleMultiSelect)}><Boxes size={18} />多选模式</button>
          <button type="button" role="menuitem" disabled={deleteDisabled} onClick={closeThen(onDelete)}><Trash2 size={18} />删除选中节点</button>
          <button type="button" role="menuitem" onClick={closeThen(onOpenAiSettings)}><Settings size={18} />AI 设置</button>
        </div>
      )}
    </header>
  );
}

export function MobileWorkbenchChrome({
  panel,
  onPanelChange,
  workspace,
  library,
  inspector,
}: {
  panel: MobilePanel;
  onPanelChange: (panel: MobilePanel) => void;
  workspace: ReactNode;
  library: ReactNode;
  inspector: ReactNode;
}) {
  const openPanel = panel === 'workspace' ? workspace : panel === 'library' ? library : inspector;
  const toggle = (next: Exclude<MobilePanel, null>) => onPanelChange(panel === next ? null : next);

  return (
    <>
      {panel && (
        <div className="mobile-workbench-drawer-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) onPanelChange(null);
        }}>
          <section className="mobile-workbench-drawer" role="dialog" aria-modal="true" aria-label={panelTitles[panel]}>
            <header className="mobile-workbench-drawer__header">
              <h2>{panelTitles[panel]}</h2>
              <button type="button" aria-label={`关闭${panelTitles[panel]}`} onClick={() => onPanelChange(null)}>
                <X size={20} aria-hidden="true" />
              </button>
            </header>
            <div className="mobile-workbench-drawer__body">{openPanel}</div>
          </section>
        </div>
      )}
      <nav className="mobile-workbench-nav" aria-label="移动端工作台导航">
        <button type="button" aria-label="画布" aria-current={panel === null ? 'page' : undefined} onClick={() => onPanelChange(null)}>
          <Workflow size={20} aria-hidden="true" /><span>画布</span>
        </button>
        <button type="button" aria-label="节点" aria-expanded={panel === 'library'} onClick={() => toggle('library')}>
          <Boxes size={20} aria-hidden="true" /><span>节点</span>
        </button>
        <button type="button" aria-label="工作区" aria-expanded={panel === 'workspace'} onClick={() => toggle('workspace')}>
          <FolderKanban size={20} aria-hidden="true" /><span>工作区</span>
        </button>
        <button type="button" aria-label="属性" aria-expanded={panel === 'inspector'} onClick={() => toggle('inspector')}>
          <SlidersHorizontal size={20} aria-hidden="true" /><span>属性</span>
        </button>
      </nav>
    </>
  );
}

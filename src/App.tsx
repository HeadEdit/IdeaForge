import { Button } from 'antd';
import { useEffect, useState } from 'react';
import { useStore } from 'zustand';

import { createWorkspaceRepository } from './db/repository';
import { Workbench, type WorkbenchProps } from './features/canvas/Workbench';
import { lookupNodeUiPlugin } from './features/nodes/ui-registry';
import { AiSettingsDialog } from './features/settings/AiSettingsDialog';
import { ToastRegion } from './components/ToastRegion';
import { createAiClient, type AiClient } from './ai/client';
import {
  bindProductionBriefRunner,
  bindProductionContentExtractRunner,
  bindProductionDivergenceRunner,
  bindProductionIdeaScoreRunner,
  getNodeExecution,
} from './execution/runners';
import { runChat } from './execution/run-chat';
import { recommendChatSkill } from './execution/recommend-chat-skill';
import { createAppStore, type AppStore } from './state/use-app-store';

function createRuntimeStore(): AppStore {
  const repository = createWorkspaceRepository();
  let client: AiClient | undefined;
  const id = () => crypto.randomUUID();
  const now = () => new Date().toISOString();
  bindProductionDivergenceRunner({
    getClient: () => client,
    id,
    now,
  });
  const store = createAppStore({
    repository,
    id,
    now,
    createAbortController: () => new AbortController(),
    isExecutionAvailable: () => !!client,
    configureAiSettings: (settings) => {
      client = settings.baseUrl && settings.apiKey && settings.model
        ? createAiClient(settings)
        : undefined;
    },
    getAiClient: () => client,
    getNodeExecution,
    runChat: (input) => runChat(input, {
      getClient: () => client,
      recommendSkill: recommendChatSkill,
      id,
      now,
    }),
  });
  bindProductionBriefRunner({
    getClient: () => client,
    onConfigPatch: (nodeId, patch) => {
      store.getState().patchNodeConfig(nodeId, patch);
    },
  });
  bindProductionContentExtractRunner({
    getClient: () => client,
    onConfigPatch: (nodeId, patch) => {
      store.getState().patchNodeConfig(nodeId, patch);
    },
  });
  bindProductionIdeaScoreRunner({
    getClient: () => client,
    id,
    now,
    onConfigPatch: (nodeId, patch) => {
      store.getState().patchNodeConfig(nodeId, patch);
    },
    onCardsScored: (updates) => {
      store.getState().getHostCapabilities().cards.applyScores(updates);
    },
  });
  return store;
}

export interface AppProps extends Omit<WorkbenchProps, 'store' | 'createEdgeId'> {
  store?: AppStore;
  createEdgeId?: () => string;
}

function App({ store: injectedStore, createEdgeId = () => crypto.randomUUID(), ...callbacks }: AppProps) {
  const [store] = useState(() => injectedStore ?? createRuntimeStore());
  const initialized = useStore(store, (state) => state.initialized);
  const navigationError = useStore(store, (state) => state.navigationError);
  const runtimeError = useStore(store, (state) => state.runtimeError);
  const saveStatus = useStore(store, (state) => state.saveStatus);
  const workflow = useStore(store, (state) => state.workflow);
  const settings = useStore(store, (state) => state.settings);
  const [openNodeId, setOpenNodeId] = useState<string>();
  const [desktop, setDesktop] = useState(() => typeof window === 'undefined' || window.innerWidth >= 1024);
  const [settingsOpen, setSettingsOpen] = useState(false);
  useEffect(() => { const onResize = () => setDesktop(window.innerWidth >= 1024); window.addEventListener('resize', onResize); return () => window.removeEventListener('resize', onResize); }, []);
  useEffect(() => { void store.getState().initialize(); }, [store]);
  useEffect(() => { void store.getState().loadSettings(); }, [store]);
  const retry = () => { void store.getState().initialize(); };

  if (!desktop) {
    return <main className="app-shell app-state" role="status">请使用桌面浏览器打开工作台</main>;
  }
  if (!initialized && !navigationError) {
    return <main className="app-shell app-state" role="status">正在准备工作区...</main>;
  }
  if (navigationError) {
    const message = navigationError.kind === 'not-found' ? '找不到要加载的工作流' : '无法加载工作区';
    return <main className="app-shell app-state" role="alert"><p>{message}，请重试。</p><Button onClick={retry}>重试加载</Button></main>;
  }
  if (!workflow) {
    return <main className="app-shell app-state" role="status"><p>没有可用的工作流，请重新加载。</p><Button onClick={retry}>重试加载</Button></main>;
  }
  const handleOpenNode = (nodeId: string) => {
    setOpenNodeId(nodeId);
    callbacks.onOpenNode?.(nodeId);
  };
  const openSettings = callbacks.onOpenAiSettings ?? (() => setSettingsOpen(true));
  const errors = [
    ...(saveStatus === 'failed' ? [{ kind: 'storage' as const }] : []),
    ...(runtimeError ? [{ kind: runtimeError.kind }] : []),
  ];
  const openKind = workflow.nodes.find((node) => node.id === openNodeId)?.kind;
  const Dialog = openKind ? lookupNodeUiPlugin(openKind)?.Dialog : undefined;
  return (
    <main className="app-shell">
      <Workbench
        store={store}
        createEdgeId={createEdgeId}
        {...callbacks}
        onOpenAiSettings={openSettings}
        onOpenNode={handleOpenNode}
      />
      {Dialog && (
        <Dialog
          open={openNodeId !== undefined}
          store={store}
          nodeId={openNodeId ?? ''}
          onClose={() => setOpenNodeId(undefined)}
        />
      )}
      <AiSettingsDialog
        open={settingsOpen}
        initial={settings}
        onClose={() => setSettingsOpen(false)}
        onSave={(next) => store.getState().saveSettings(next)}
        onClearKey={() => store.getState().clearApiKey()}
        onTestConnection={(next) => store.getState().testAiConnection(next)}
      />
      <ToastRegion errors={errors} onRetry={() => { void store.getState().saveNow(); void store.getState().loadSettings(); }} />
    </main>
  );
}

export default App;

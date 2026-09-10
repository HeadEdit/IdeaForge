import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from 'idb';

import type {
  AiSettings,
  CandidateCard,
  ChatSession,
  NodeRun,
  ReferenceDocument,
  Workflow,
} from '../domain/model';

export const LEGACY_WORKSPACE_DATABASE_NAME = 'design-canvas';
export const DEFAULT_WORKSPACE_DATABASE_NAME = 'idea-forge';
export const SETTINGS_KEY = 'singleton' as const;

export type PersistedChild<T> = T & { snapshotOrder: number };

export interface WorkspaceDatabaseSchema extends DBSchema {
  workflows: {
    key: string;
    value: Workflow;
  };
  runs: {
    key: string;
    value: PersistedChild<NodeRun>;
    indexes: { workflowId: string };
  };
  documents: {
    key: string;
    value: PersistedChild<ReferenceDocument>;
    indexes: { workflowId: string };
  };
  cards: {
    key: string;
    value: PersistedChild<CandidateCard>;
    indexes: { workflowId: string };
  };
  sessions: {
    key: string;
    value: PersistedChild<ChatSession>;
    indexes: { workflowId: string };
  };
  settings: {
    key: typeof SETTINGS_KEY;
    value: AiSettings;
  };
}

function createWorkspaceDatabase(
  dbName: string,
): Promise<IDBPDatabase<WorkspaceDatabaseSchema>> {
  let connection: IDBPDatabase<WorkspaceDatabaseSchema> | undefined;
  const opening = openDB<WorkspaceDatabaseSchema>(dbName, 2, {
    upgrade(database) {
      if (!database.objectStoreNames.contains('workflows')) {
        database.createObjectStore('workflows', { keyPath: 'id' });
      }

      if (!database.objectStoreNames.contains('runs')) {
        const runs = database.createObjectStore('runs', { keyPath: 'id' });
        runs.createIndex('workflowId', 'workflowId');
      }

      if (!database.objectStoreNames.contains('documents')) {
        const documents = database.createObjectStore('documents', { keyPath: 'id' });
        documents.createIndex('workflowId', 'workflowId');
      }

      if (!database.objectStoreNames.contains('cards')) {
        const cards = database.createObjectStore('cards', { keyPath: 'id' });
        cards.createIndex('workflowId', 'workflowId');
      }

      if (!database.objectStoreNames.contains('sessions')) {
        const sessions = database.createObjectStore('sessions', { keyPath: 'id' });
        sessions.createIndex('workflowId', 'workflowId');
      }

      if (!database.objectStoreNames.contains('settings')) {
        database.createObjectStore('settings');
      }
    },
    blocking() {
      connection?.close();
    },
  });

  return opening.then((database) => {
    connection = database;
    return database;
  });
}

async function migrateLegacyWorkspaceDatabaseIfNeeded(): Promise<void> {
  const source = await createWorkspaceDatabase(LEGACY_WORKSPACE_DATABASE_NAME);
  const target = await createWorkspaceDatabase(DEFAULT_WORKSPACE_DATABASE_NAME);
  try {
    const [sourceWorkflows, runs, documents, cards, sessions, sourceSettings] = await Promise.all([
      source.getAll('workflows'),
      source.getAll('runs'),
      source.getAll('documents'),
      source.getAll('cards'),
      source.getAll('sessions'),
      source.get('settings', SETTINGS_KEY),
    ]);
    const transaction = target.transaction(
      ['workflows', 'runs', 'documents', 'cards', 'sessions', 'settings'],
      'readwrite',
    );

    for (const workflow of sourceWorkflows) {
      const current = await transaction.objectStore('workflows').get(workflow.id);
      if (current !== undefined && workflow.updatedAt <= current.updatedAt) continue;

      for (const storeName of ['runs', 'documents', 'cards', 'sessions'] as const) {
        const store = transaction.objectStore(storeName);
        const existingKeys = await store.index('workflowId').getAllKeys(workflow.id);
        for (const key of existingKeys) {
          await store.delete(key);
        }
      }

      await transaction.objectStore('workflows').put(workflow);
      for (const run of runs.filter((item) => item.workflowId === workflow.id)) {
        await transaction.objectStore('runs').put(run);
      }
      for (const document of documents.filter((item) => item.workflowId === workflow.id)) {
        await transaction.objectStore('documents').put(document);
      }
      for (const card of cards.filter((item) => item.workflowId === workflow.id)) {
        await transaction.objectStore('cards').put(card);
      }
      for (const session of sessions.filter((item) => item.workflowId === workflow.id)) {
        await transaction.objectStore('sessions').put(session);
      }
    }

    const settingsStore = transaction.objectStore('settings');
    if (sourceSettings !== undefined && await settingsStore.get(SETTINGS_KEY) === undefined) {
      await settingsStore.put(sourceSettings, SETTINGS_KEY);
    }
    await transaction.done;
  } finally {
    source.close();
    target.close();
  }
}

export function openWorkspaceDatabase(
  dbName = DEFAULT_WORKSPACE_DATABASE_NAME,
): Promise<IDBPDatabase<WorkspaceDatabaseSchema>> {
  if (dbName === DEFAULT_WORKSPACE_DATABASE_NAME) {
    return migrateLegacyWorkspaceDatabaseIfNeeded().then(() => createWorkspaceDatabase(dbName));
  }
  return createWorkspaceDatabase(dbName);
}

export function deleteWorkspaceDatabase(dbName: string): Promise<void> {
  return deleteDB(dbName);
}

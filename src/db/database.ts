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

async function databaseHasWorkflows(dbName: string): Promise<boolean> {
  try {
    const database = await createWorkspaceDatabase(dbName);
    const count = await database.count('workflows');
    database.close();
    return count > 0;
  } catch {
    return false;
  }
}

async function migrateLegacyWorkspaceDatabaseIfNeeded(): Promise<void> {
  if (await databaseHasWorkflows(DEFAULT_WORKSPACE_DATABASE_NAME)) return;
  if (!await databaseHasWorkflows(LEGACY_WORKSPACE_DATABASE_NAME)) return;

  const source = await createWorkspaceDatabase(LEGACY_WORKSPACE_DATABASE_NAME);
  const target = await createWorkspaceDatabase(DEFAULT_WORKSPACE_DATABASE_NAME);
  try {
    const [workflows, runs, cards, sessions, settings] = await Promise.all([
      source.getAll('workflows'),
      source.getAll('runs'),
      source.getAll('cards'),
      source.getAll('sessions'),
      source.getAll('settings'),
    ]);
    const transaction = target.transaction(
      ['workflows', 'runs', 'cards', 'sessions', 'settings'],
      'readwrite',
    );
    for (const workflow of workflows) {
      await transaction.objectStore('workflows').put(workflow);
    }
    for (const run of runs) {
      await transaction.objectStore('runs').put(run);
    }
    for (const card of cards) {
      await transaction.objectStore('cards').put(card);
    }
    for (const session of sessions) {
      await transaction.objectStore('sessions').put(session);
    }
    for (const setting of settings) {
      await transaction.objectStore('settings').put(setting);
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

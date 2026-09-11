import type { IDBPObjectStore, IDBPTransaction, StoreNames } from 'idb';

import type {
  AiSettings,
  CandidateCard,
  ChatSession,
  NodeRun,
  ReferenceDocument,
  Workflow,
} from '../domain/model';
import {
  DEFAULT_WORKSPACE_DATABASE_NAME,
  SETTINGS_KEY,
  type PersistedChild,
  type WorkspaceDatabaseSchema,
  openWorkspaceDatabase,
} from './database';

export interface WorkspaceSnapshot {
  workflow: Workflow;
  runs: NodeRun[];
  cards: CandidateCard[];
  sessions: ChatSession[];
  documents: ReferenceDocument[];
}

export interface WorkspaceRepository {
  listWorkflows(): Promise<Workflow[]>;
  loadWorkspaceSnapshot(id: string): Promise<WorkspaceSnapshot | undefined>;
  saveWorkspaceSnapshot(snapshot: WorkspaceSnapshot): Promise<void>;
  deleteWorkflow(id: string): Promise<void>;
  loadSettings(): Promise<AiSettings | undefined>;
  saveSettings(settings: AiSettings): Promise<void>;
  clearApiKey(): Promise<void>;
}

export interface WorkspaceRepositoryWithCleanup extends WorkspaceRepository {
  readonly dbName: string;
  close(): Promise<void>;
}

export class StorageError extends Error {
  constructor() {
    super('Unable to complete local storage operation.');
    this.name = 'StorageError';
  }
}

type ChildStoreName = 'runs' | 'cards' | 'sessions' | 'documents';
type WorkspaceTransaction = IDBPTransaction<
  WorkspaceDatabaseSchema,
  ['workflows', 'runs', 'cards', 'sessions', 'documents'],
  'readwrite'
>;

function storageError(): StorageError {
  return new StorageError();
}

function validateSnapshot(snapshot: WorkspaceSnapshot): void {
  const { id } = snapshot.workflow;
  const hasMismatchedWorkflow = [
    ...snapshot.runs,
    ...snapshot.cards,
    ...snapshot.sessions,
  ].some((child) => child.workflowId !== id);

  if (hasMismatchedWorkflow) {
    throw storageError();
  }
}

function toPersistedChildren<T>(children: T[]): PersistedChild<T>[] {
  return children.map((child, snapshotOrder) => ({ ...child, snapshotOrder }));
}

function fromPersistedChildren<T>(children: PersistedChild<T>[]): T[] {
  return children
    .sort((left, right) => left.snapshotOrder - right.snapshotOrder)
    .map((child) => {
      const { snapshotOrder: _snapshotOrder, ...value } = child;
      return value as T;
    });
}

async function deleteChildrenForWorkflow<
  TxStores extends ArrayLike<StoreNames<WorkspaceDatabaseSchema>>,
  StoreName extends ChildStoreName,
>(
  store: IDBPObjectStore<
    WorkspaceDatabaseSchema,
    TxStores,
    StoreName,
    'readwrite'
  >,
  workflowId: string,
): Promise<void> {
  const keys = await store.index('workflowId').getAllKeys(workflowId as never);
  await Promise.all(keys.map((key) => store.delete(key)));
}

async function abortTransaction(transaction: {
  abort(): void;
  done: Promise<unknown>;
}): Promise<void> {
  try {
    transaction.abort();
  } catch {
    // The transaction may already be closed after an IndexedDB request failure.
  }

  try {
    await transaction.done;
  } catch {
    // The caller receives the sanitized StorageError instead of the platform error.
  }
}

export function createWorkspaceRepository(
  dbName = DEFAULT_WORKSPACE_DATABASE_NAME,
): WorkspaceRepositoryWithCleanup {
  let database: ReturnType<typeof openWorkspaceDatabase> | undefined;

  function getDatabase(): ReturnType<typeof openWorkspaceDatabase> {
    database ??= Promise.resolve().then(() => openWorkspaceDatabase(dbName));
    return database;
  }

  return {
    dbName,

    async listWorkflows(): Promise<Workflow[]> {
      try {
        const workflows = await (await getDatabase()).getAll('workflows');
        return workflows.sort((left, right) => (
          right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id)
        ));
      } catch {
        throw storageError();
      }
    },

    async loadWorkspaceSnapshot(id: string): Promise<WorkspaceSnapshot | undefined> {
      try {
        const db = await getDatabase();
        const transaction = db.transaction(
          ['workflows', 'runs', 'cards', 'sessions', 'documents'],
          'readonly',
        );
        const workflow = await transaction.objectStore('workflows').get(id);

        if (!workflow) {
          await transaction.done;
          return undefined;
        }

        const [runs, cards, sessions, documents] = await Promise.all([
          transaction.objectStore('runs').index('workflowId').getAll(id),
          transaction.objectStore('cards').index('workflowId').getAll(id),
          transaction.objectStore('sessions').index('workflowId').getAll(id),
          transaction.objectStore('documents').index('workflowId').getAll(id),
        ]);
        await transaction.done;

        return {
          workflow,
          runs: fromPersistedChildren(runs),
          cards: fromPersistedChildren(cards),
          sessions: fromPersistedChildren(sessions),
          documents: fromPersistedChildren(documents),
        };
      } catch {
        throw storageError();
      }
    },

    async saveWorkspaceSnapshot(snapshot: WorkspaceSnapshot): Promise<void> {
      validateSnapshot(snapshot);

      let transaction: WorkspaceTransaction | undefined;
      try {
        const db = await getDatabase();
        transaction = db.transaction(
          ['workflows', 'runs', 'cards', 'sessions', 'documents'],
          'readwrite',
        );
        const workflowStore = transaction.objectStore('workflows');
        const runsStore = transaction.objectStore('runs');
        const cardsStore = transaction.objectStore('cards');
        const sessionsStore = transaction.objectStore('sessions');
        const documentsStore = transaction.objectStore('documents');

        await workflowStore.put(snapshot.workflow);
        await Promise.all([
          deleteChildrenForWorkflow(runsStore, snapshot.workflow.id),
          deleteChildrenForWorkflow(cardsStore, snapshot.workflow.id),
          deleteChildrenForWorkflow(sessionsStore, snapshot.workflow.id),
          deleteChildrenForWorkflow(documentsStore, snapshot.workflow.id),
        ]);

        for (const child of toPersistedChildren(snapshot.runs)) {
          await runsStore.add(child);
        }
        for (const child of toPersistedChildren(snapshot.cards)) {
          await cardsStore.add(child);
        }
        for (const child of toPersistedChildren(snapshot.sessions)) {
          await sessionsStore.add(child);
        }
        for (const child of toPersistedChildren(snapshot.documents)) {
          await documentsStore.add(child);
        }
        await transaction.done;
      } catch {
        if (transaction) {
          await abortTransaction(transaction);
        }
        throw storageError();
      }
    },

    async deleteWorkflow(id: string): Promise<void> {
      let transaction: WorkspaceTransaction | undefined;
      try {
        const db = await getDatabase();
        transaction = db.transaction(
          ['workflows', 'runs', 'cards', 'sessions', 'documents'],
          'readwrite',
        );
        await transaction.objectStore('workflows').delete(id);
        await Promise.all([
          deleteChildrenForWorkflow(transaction.objectStore('runs'), id),
          deleteChildrenForWorkflow(transaction.objectStore('cards'), id),
          deleteChildrenForWorkflow(transaction.objectStore('sessions'), id),
          deleteChildrenForWorkflow(transaction.objectStore('documents'), id),
        ]);
        await transaction.done;
      } catch {
        if (transaction) {
          await abortTransaction(transaction);
        }
        throw storageError();
      }
    },

    async loadSettings(): Promise<AiSettings | undefined> {
      try {
        const settings = await (await getDatabase()).get('settings', SETTINGS_KEY);
        return settings
          ? {
              ...settings,
              tavilyApiKey: typeof settings.tavilyApiKey === 'string' ? settings.tavilyApiKey : '',
              searchProvider: settings.searchProvider === 'searxng' ? 'searxng' : 'tavily',
              searxngBaseUrl: typeof settings.searxngBaseUrl === 'string' ? settings.searxngBaseUrl : '',
              thinkingEnabled: settings.thinkingEnabled === true,
            }
          : undefined;
      } catch {
        throw storageError();
      }
    },

    async saveSettings(settings: AiSettings): Promise<void> {
      try {
        await (await getDatabase()).put('settings', settings, SETTINGS_KEY);
      } catch {
        throw storageError();
      }
    },

    async clearApiKey(): Promise<void> {
      let transaction: IDBPTransaction<WorkspaceDatabaseSchema, ['settings'], 'readwrite'> | undefined;
      try {
        const db = await getDatabase();
        transaction = db.transaction('settings', 'readwrite');
        const settings = await transaction.objectStore('settings').get(SETTINGS_KEY);
        if (settings) {
          await transaction.objectStore('settings').put({ ...settings, apiKey: '' }, SETTINGS_KEY);
        }
        await transaction.done;
      } catch {
        if (transaction) {
          await abortTransaction(transaction);
        }
        throw storageError();
      }
    },

    async close(): Promise<void> {
      if (database) {
        (await database).close();
      }
    },
  };
}

export { deleteWorkspaceDatabase } from './database';

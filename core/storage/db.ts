import Dexie, { type Table } from 'dexie';
import type { SelectionAction, Uuid } from '../messaging/types';

export const DEFAULT_RETENTION_DAYS = 7;
export const DAY_MS = 86_400_000;

export interface Session {
  id: Uuid;
  tabId: number;
  url: string;
  title: string;
  incognito: boolean;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
}

export interface Message {
  id: Uuid;
  sessionId: Uuid;
  role: 'user' | 'assistant';
  content: string;
  taskType?: SelectionAction | 'summary' | 'qa';
  createdAt: number;
}

export class WispDB extends Dexie {
  sessions!: Table<Session, Uuid>;
  messages!: Table<Message, Uuid>;

  constructor(name = 'wisp') {
    super(name);
    this.version(1).stores({
      sessions: 'id, tabId, url, expiresAt',
      messages: 'id, sessionId, createdAt',
    });
  }
}

/** Service Worker 与 Side Panel 各自持有连接，共用同一个 IndexedDB。 */
export const db = new WispDB();

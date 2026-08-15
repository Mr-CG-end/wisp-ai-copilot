import Dexie, { type Table } from 'dexie';
import type { SelectionAction, Uuid } from '../messaging/types';

export const DEFAULT_RETENTION_DAYS = 7;
export const DAY_MS = 86_400_000;

/**
 * 建立会话时那一份页面快照的可续用副本。
 *
 * 面板一关，store 里的 page 就没了；恢复会话后若拿不回一份快照，追问区没有可问的对象。
 * 正文只留前 SNAPSHOT_TEXT_CHARS 字：它是各性能档里最大的一档上下文预算（均衡档
 * qaContextChars = 2000），存更多也进不了模型。
 *
 * charCount / truncated / method 一并存下来，不是冗余：恢复时若靠猜，凭证行会报出
 * 与事实不符的字数，assessSummaryReadiness 也会拿着错的 method 重新判一次。
 */
export interface SessionSnapshot {
  text: string;
  /** 原始页面的字数，不是 text 的长度 */
  charCount: number;
  truncated: boolean;
  method: 'readability' | 'heuristic';
  readAt: number;
}

export const SNAPSHOT_TEXT_CHARS = 2000;

export interface Session {
  id: Uuid;
  tabId: number;
  url: string;
  title: string;
  incognito: boolean;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  /**
   * 划词会话没有整页快照，这里为空。
   *
   * 不进索引，因此**不需要版本升级**：Dexie 只声明要建索引的属性，其余属性随对象整体
   * 存取，旧记录读出来就是 undefined。为它单开一个 version(2) 只会多一次空迁移。
   */
  snapshot?: SessionSnapshot;
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

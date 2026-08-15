import type { SelectionAction, Uuid } from '../messaging/types';
import type { Message, Session, WispDB } from './db';

export function selectExpiredSessionIds(
  sessions: readonly Pick<Session, 'id' | 'expiresAt'>[],
  now: number,
): Uuid[] {
  return sessions.filter((session) => session.expiresAt <= now).map((session) => session.id);
}

/** Dexie 不提供级联删除，消息与会话必须在同一事务中清理。 */
export async function purgeSessions(database: WispDB, ids: readonly Uuid[]): Promise<void> {
  if (ids.length === 0) return;
  const mutableIds = [...ids];
  await database.transaction('rw', database.sessions, database.messages, async () => {
    await database.messages.where('sessionId').anyOf(mutableIds).delete();
    await database.sessions.bulkDelete(mutableIds);
  });
}

export async function purgeExpired(database: WispDB, now: number): Promise<number> {
  const sessions = await database.sessions.where('expiresAt').belowOrEqual(now).toArray();
  const ids = sessions.map((session) => session.id);
  await purgeSessions(database, ids);
  return ids.length;
}

export async function purgeByTab(database: WispDB, tabId: number): Promise<number> {
  const sessions = await database.sessions.where('tabId').equals(tabId).toArray();
  const ids = sessions.map((session) => session.id);
  await purgeSessions(database, ids);
  return ids.length;
}

/**
 * `ttlMs` 给出时，到期时间按本次写入滑动一次。
 *
 * 保留期的语义是「最后一次用过之后再留多久」，不是「建会话之后再留多久」：
 * 自动续接让一条会话可以跨天连续使用，到期时间若钉死在创建时刻，
 * 会在用户正用着的时候把它连同消息一起清掉。
 *
 * 值由调用方算好传进来而不是在这里读 chrome.storage —— core 不依赖执行上下文。
 */
export async function appendMessage(
  database: WispDB,
  sessionId: Uuid,
  role: Message['role'],
  content: string,
  taskType?: SelectionAction | 'summary' | 'qa',
  ttlMs?: number,
): Promise<Uuid> {
  const id = crypto.randomUUID();
  const now = Date.now();
  const changes: Partial<Session> = { updatedAt: now };
  if (ttlMs !== undefined) changes.expiresAt = now + ttlMs;
  await database.transaction('rw', database.sessions, database.messages, async () => {
    await database.messages.add({
      id,
      sessionId,
      role,
      content,
      taskType,
      createdAt: now,
    });
    await database.sessions.update(sessionId, changes);
  });
  return id;
}

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

export async function appendMessage(
  database: WispDB,
  sessionId: Uuid,
  role: Message['role'],
  content: string,
  taskType?: SelectionAction | 'summary' | 'qa',
): Promise<Uuid> {
  const id = crypto.randomUUID();
  const now = Date.now();
  await database.transaction('rw', database.sessions, database.messages, async () => {
    await database.messages.add({
      id,
      sessionId,
      role,
      content,
      taskType,
      createdAt: now,
    });
    await database.sessions.update(sessionId, { updatedAt: now });
  });
  return id;
}

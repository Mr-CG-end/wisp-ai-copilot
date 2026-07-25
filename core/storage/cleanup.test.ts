import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendMessage, purgeByTab, purgeExpired, purgeSessions, selectExpiredSessionIds } from './cleanup';
import { WispDB, type Session } from './db';

function session(id: string, tabId: number, expiresAt: number): Session {
  return {
    id,
    tabId,
    url: `https://example.com/${id}`,
    title: id,
    incognito: false,
    createdAt: 0,
    updatedAt: 0,
    expiresAt,
  };
}

let database: WispDB;

beforeEach(async () => {
  database = new WispDB(`wisp-test-${crypto.randomUUID()}`);
  await database.open();
  await database.sessions.bulkAdd([
    session('a', 1, 100),
    session('b', 1, 500),
    session('c', 2, 100),
  ]);
  await appendMessage(database, 'a', 'user', '问题 a', 'qa');
  await appendMessage(database, 'a', 'assistant', '回答 a', 'qa');
  await appendMessage(database, 'b', 'user', '问题 b', 'summary');
  await appendMessage(database, 'c', 'user', '问题 c', 'summary');
});

afterEach(async () => {
  await database.delete();
});

describe('selectExpiredSessionIds', () => {
  it('只选出 expiresAt 已过的会话', () => {
    const rows = [session('a', 1, 100), session('b', 1, 500)];
    expect(selectExpiredSessionIds(rows, 200)).toEqual(['a']);
  });

  it('边界值 expiresAt === now 视为已过期', () => {
    expect(selectExpiredSessionIds([session('a', 1, 100)], 100)).toEqual(['a']);
  });

  it('无过期会话时返回空数组', () => {
    expect(selectExpiredSessionIds([session('b', 1, 500)], 200)).toEqual([]);
  });
});

describe('purgeSessions', () => {
  it('级联删除消息，不留孤儿', async () => {
    await purgeSessions(database, ['a']);
    expect(await database.sessions.get('a')).toBeUndefined();
    expect(await database.messages.where('sessionId').equals('a').count()).toBe(0);
    expect(await database.messages.where('sessionId').equals('b').count()).toBe(1);
  });

  it('传空数组时不动任何数据', async () => {
    await purgeSessions(database, []);
    expect(await database.sessions.count()).toBe(3);
    expect(await database.messages.count()).toBe(4);
  });
});

describe('purgeExpired', () => {
  it('按 now 清理过期会话及其消息并返回条数', async () => {
    expect(await purgeExpired(database, 200)).toBe(2);
    expect(await database.sessions.count()).toBe(1);
    expect(await database.messages.count()).toBe(1);
  });
});

describe('purgeByTab', () => {
  it('只清理指定标签页的会话', async () => {
    expect(await purgeByTab(database, 1)).toBe(2);
    expect((await database.sessions.toArray()).map((row) => row.id)).toEqual(['c']);
    expect(await database.messages.count()).toBe(1);
  });
});

describe('appendMessage', () => {
  it('写入消息并刷新会话更新时间', async () => {
    const before = (await database.sessions.get('b'))!.updatedAt;
    const id = await appendMessage(database, 'b', 'assistant', '回答 b', 'qa');
    expect((await database.messages.get(id))?.content).toBe('回答 b');
    expect((await database.sessions.get('b'))!.updatedAt).toBeGreaterThanOrEqual(before);
  });
});

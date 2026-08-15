import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { messagesToTurns, pickResumableSession, type StoredMessage } from './sessionRestore';
import { WispDB, type Session } from './db';

function session(id: string, url: string, updatedAt: number): Session {
  return {
    id,
    tabId: 1,
    url,
    title: url,
    incognito: false,
    createdAt: updatedAt,
    updatedAt,
    expiresAt: 9e12,
  };
}

function message(over: Partial<StoredMessage> & Pick<StoredMessage, 'id' | 'role'>): StoredMessage {
  return { content: over.id, taskType: 'qa', createdAt: 0, ...over };
}

describe('pickResumableSession', () => {
  let database: WispDB;

  beforeEach(async () => {
    database = new WispDB(`wisp-restore-${crypto.randomUUID()}`);
    await database.open();
    // 一个标签页依次访问 a → b → c，每页各留一条会话。
    // id 故意取成与访问顺序相反的字典序，模拟真实的随机 uuid。
    await database.sessions.bulkAdd([
      session('zzz', 'https://a.example/', 1),
      session('aaa', 'https://b.example/', 2),
      session('mmm', 'https://c.example/', 3),
    ]);
  });

  afterEach(async () => {
    await database.delete();
  });

  /**
   * 回归锁：这里锁的是「按 tabId 取出来的顺序不是访问顺序」这个事实。
   * 旧的 ensureSession 写的是 `.where('tabId').equals(tabId).first()`，
   * 拿到的其实是主键序的第一条（实测为 aaa → b.example）。用户此刻若在 c.example，
   * 旧判据 `existing?.url === ctx.url` 不成立，于是明明已有会话还要再建一条，
   * 同一页反复使用便不断长出重复会话，续接时也认不出该接哪一条。
   */
  it('主键序不是访问序，按 URL 精确认领而不是取第一条', async () => {
    const rows = await database.sessions.where('tabId').equals(1).toArray();
    expect(rows.map((row) => row.id)).toEqual(['aaa', 'mmm', 'zzz']);

    expect(pickResumableSession(rows, 'https://c.example/')?.id).toBe('mmm');
    expect(pickResumableSession(rows, 'https://a.example/')?.id).toBe('zzz');
  });

  it('同一 URL 有多条时取 updatedAt 最近的一条', () => {
    const rows = [
      session('old', 'https://a.example/', 10),
      session('new', 'https://a.example/', 30),
      session('mid', 'https://a.example/', 20),
    ];
    expect(pickResumableSession(rows, 'https://a.example/')?.id).toBe('new');
  });

  it('没有匹配的 URL 时返回 undefined', () => {
    expect(pickResumableSession([session('a', 'https://a.example/', 1)], 'https://b.example/'))
      .toBeUndefined();
  });

  /**
   * snapshot 是非索引字段，因此没有为它单开 version(2)。这条锁住那个前提：
   * schema 仍是 version(1)，写进去的 snapshot 要能原样读回来，且旧记录读出来是 undefined。
   */
  it('未声明在 schema 里的 snapshot 字段可原样存取，旧记录读出来为 undefined', async () => {
    await database.sessions.update('zzz', {
      snapshot: {
        text: '存档正文',
        charCount: 4200,
        truncated: true,
        method: 'readability' as const,
        readAt: 1000,
      },
    });

    expect((await database.sessions.get('zzz'))?.snapshot).toEqual({
      text: '存档正文',
      charCount: 4200,
      truncated: true,
      method: 'readability',
      readAt: 1000,
    });
    expect((await database.sessions.get('aaa'))?.snapshot).toBeUndefined();
  });
});

describe('messagesToTurns', () => {
  it('追问的用户消息进 userInput，摘要的占位文案丢弃', () => {
    const turns = messagesToTurns([
      message({ id: 'u1', role: 'user', content: '生成摘要', taskType: 'summary', createdAt: 1 }),
      message({ id: 'a1', role: 'assistant', content: '摘要正文', taskType: 'summary', createdAt: 2 }),
      message({ id: 'u2', role: 'user', content: '第二段讲了什么', taskType: 'qa', createdAt: 3 }),
      message({ id: 'a2', role: 'assistant', content: '回答正文', taskType: 'qa', createdAt: 4 }),
    ]);

    expect(turns).toEqual([
      { id: 'a1', type: 'summary', output: '摘要正文', userInput: undefined, selectionText: undefined },
      { id: 'a2', type: 'qa', output: '回答正文', userInput: '第二段讲了什么', selectionText: undefined },
    ]);
  });

  it('划词类任务的用户消息进 selectionText 而不是 userInput', () => {
    const turns = messagesToTurns([
      message({ id: 'u', role: 'user', content: '待解释的原文', taskType: 'explain', createdAt: 1 }),
      message({ id: 'a', role: 'assistant', content: '解释', taskType: 'explain', createdAt: 2 }),
      message({ id: 'u2', role: 'user', content: 'hello', taskType: 'translate', createdAt: 3 }),
      message({ id: 'a2', role: 'assistant', content: '你好', taskType: 'translate', createdAt: 4 }),
    ]);

    expect(turns.map((turn) => [turn.type, turn.selectionText, turn.userInput])).toEqual([
      ['explain', '待解释的原文', undefined],
      ['translate', 'hello', undefined],
    ]);
  });

  /**
   * 一轮的两条消息是两次独立事务，落库间隔可能不足 1ms，createdAt 会撞在一起。
   * 撞上时若按存储顺序走，回答会排到提问前面，整轮配对随之错位 ——
   * 这里把 assistant 放在数组前面，模拟主键序恰好反过来的情况。
   */
  it('createdAt 相同时 user 仍排在 assistant 之前', () => {
    const turns = messagesToTurns([
      message({ id: 'a', role: 'assistant', content: '回答', taskType: 'qa', createdAt: 5 }),
      message({ id: 'u', role: 'user', content: '提问', taskType: 'qa', createdAt: 5 }),
    ]);
    expect(turns).toEqual([
      { id: 'a', type: 'qa', output: '回答', userInput: '提问', selectionText: undefined },
    ]);
  });

  it('乱序输入按 createdAt 还原成轮次顺序', () => {
    const turns = messagesToTurns([
      message({ id: 'a2', role: 'assistant', content: '第二答', createdAt: 40 }),
      message({ id: 'u1', role: 'user', content: '第一问', createdAt: 10 }),
      message({ id: 'a1', role: 'assistant', content: '第一答', createdAt: 20 }),
      message({ id: 'u2', role: 'user', content: '第二问', createdAt: 30 }),
    ]);
    expect(turns.map((turn) => turn.output)).toEqual(['第一答', '第二答']);
    expect(turns.map((turn) => turn.userInput)).toEqual(['第一问', '第二问']);
  });

  it('没等到回答的用户消息不成轮', () => {
    expect(messagesToTurns([message({ id: 'u', role: 'user', createdAt: 1 })])).toEqual([]);
  });
});

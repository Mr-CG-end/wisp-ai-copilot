import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  forgetTabSession,
  hasTabSession,
  rememberTabSession,
  TAB_SESSION_INDEX_KEY,
  type TabSessionIndex,
} from './tabSessions';

let store: Record<string, unknown>;

function index(): TabSessionIndex {
  return (store[TAB_SESSION_INDEX_KEY] ?? {}) as TabSessionIndex;
}

beforeEach(() => {
  store = {};
  vi.stubGlobal('chrome', {
    storage: {
      session: {
        get: vi.fn(async (key: string) => (key in store ? { [key]: store[key] } : {})),
        set: vi.fn(async (items: Record<string, unknown>) => {
          Object.assign(store, items);
        }),
      },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('标签页会话索引', () => {
  it('记录后可查到，关闭标签页后查不到', async () => {
    await expect(hasTabSession(7)).resolves.toBe(false);
    await rememberTabSession(7, 'session-1', 'https://a.example/');
    await expect(hasTabSession(7)).resolves.toBe(true);
    expect(index()['7']).toEqual({ sessionId: 'session-1', url: 'https://a.example/' });

    await forgetTabSession(7);
    await expect(hasTabSession(7)).resolves.toBe(false);
  });

  it('只动自己那一条，不碰其他标签页', async () => {
    await rememberTabSession(7, 'session-1', 'https://a.example/');
    await rememberTabSession(9, 'session-2', 'https://b.example/');
    await forgetTabSession(7);
    expect(Object.keys(index())).toEqual(['9']);
  });

  it('同一标签页换页后覆盖为最新一条', async () => {
    await rememberTabSession(7, 'session-1', 'https://a.example/');
    await rememberTabSession(7, 'session-2', 'https://b.example/');
    expect(index()['7']).toEqual({ sessionId: 'session-2', url: 'https://b.example/' });
  });

  it('删除不存在的条目不写存储', async () => {
    await forgetTabSession(7);
    expect(chrome.storage.session.set).not.toHaveBeenCalled();
  });

  /** 浏览器重启会清空 chrome.storage.session，索引为空即所有 tabId 都不再续接。 */
  it('存储里没有索引时一律判为不可续接', async () => {
    store[TAB_SESSION_INDEX_KEY] = undefined;
    await expect(hasTabSession(7)).resolves.toBe(false);
  });
});

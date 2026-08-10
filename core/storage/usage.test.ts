import { describe, expect, it } from 'vitest';
import { collectUsage, formatUsageLine, type UsageDeps } from './usage';

const MB = 1024 ** 2;
const GB = 1024 ** 3;

function deps(overrides: Partial<UsageDeps> = {}): UsageDeps {
  return {
    estimate: async () => ({ usage: 412 * MB, quota: 10 * GB }),
    countCacheEntries: async () => 12,
    countSessions: async () => 3,
    ...overrides,
  };
}

describe('collectUsage', () => {
  it('汇总三个数据源', async () => {
    await expect(collectUsage(deps())).resolves.toEqual({
      usageBytes: 412 * MB,
      quotaBytes: 10 * GB,
      cacheEntries: 12,
      sessions: 3,
    });
  });

  it('estimate 失败时用量归 0，其余数据照常返回', async () => {
    await expect(collectUsage(deps({
      estimate: async () => { throw new Error('no storage manager'); },
    }))).resolves.toEqual({ usageBytes: 0, quotaBytes: 0, cacheEntries: 12, sessions: 3 });
  });

  it('缓存计数失败时只有缓存项归 0', async () => {
    await expect(collectUsage(deps({
      countCacheEntries: async () => { throw new Error('caches unavailable'); },
    }))).resolves.toEqual({ usageBytes: 412 * MB, quotaBytes: 10 * GB, cacheEntries: 0, sessions: 3 });
  });

  it('会话计数失败时只有会话数归 0', async () => {
    await expect(collectUsage(deps({
      countSessions: async () => { throw new Error('db blocked'); },
    }))).resolves.toEqual({ usageBytes: 412 * MB, quotaBytes: 10 * GB, cacheEntries: 12, sessions: 0 });
  });

  it('三个数据源同时失败也不 reject', async () => {
    await expect(collectUsage({
      estimate: async () => { throw new Error('x'); },
      countCacheEntries: async () => { throw new Error('x'); },
      countSessions: async () => { throw new Error('x'); },
    })).resolves.toEqual({ usageBytes: 0, quotaBytes: 0, cacheEntries: 0, sessions: 0 });
  });

  it('estimate 缺字段时按 0 处理', async () => {
    await expect(collectUsage(deps({ estimate: async () => ({}) })))
      .resolves.toMatchObject({ usageBytes: 0, quotaBytes: 0 });
    await expect(collectUsage(deps({ estimate: async () => ({ usage: 5 * MB }) })))
      .resolves.toMatchObject({ usageBytes: 5 * MB, quotaBytes: 0 });
  });
});

describe('formatUsageLine', () => {
  function line(usageBytes: number): string {
    return formatUsageLine({ usageBytes, quotaBytes: 10 * GB, cacheEntries: 12, sessions: 3 });
  }

  it('输出单行文本', () => {
    expect(line(412 * MB)).toBe('约 412 MB · 会话 3 条 · 缓存 12 项');
  });

  it('0 字节显示 0 MB', () => {
    expect(formatUsageLine({ usageBytes: 0, quotaBytes: 0, cacheEntries: 0, sessions: 0 }))
      .toBe('约 0 MB · 会话 0 条 · 缓存 0 项');
  });

  it('不足 1 MB 取整到 0 MB', () => {
    expect(line(500 * 1024)).toBe('约 0 MB · 会话 3 条 · 缓存 12 项');
    expect(line(700 * 1024)).toBe('约 1 MB · 会话 3 条 · 缓存 12 项');
  });

  it('超过 1 GB 换算成 GB 并保留一位小数', () => {
    expect(line(GB)).toBe('约 1.0 GB · 会话 3 条 · 缓存 12 项');
    expect(line(GB + GB / 2)).toBe('约 1.5 GB · 会话 3 条 · 缓存 12 项');
    expect(line(GB - 1)).toBe('约 1024 MB · 会话 3 条 · 缓存 12 项');
  });
});

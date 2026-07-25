import { describe, expect, it } from 'vitest';
import { isCtxCurrent } from './taskGuard';

describe('isCtxCurrent', () => {
  it('当 bound 为 null 时返回 false', () => {
    expect(isCtxCurrent({ tabId: 1, url: 'https://a.com', epoch: 1 }, null)).toBe(false);
  });

  it('tabId 与 epoch 完全匹配时返回 true', () => {
    const ctx = { tabId: 1, url: 'https://a.com', epoch: 2 };
    expect(isCtxCurrent(ctx, { tabId: 1, url: 'https://a.com', epoch: 2 })).toBe(true);
  });

  it('URL hash 变化但 tabId 与 epoch 相同，仍返回 true', () => {
    const ctx1 = { tabId: 1, url: 'https://a.com/article#section1', epoch: 2 };
    const ctx2 = { tabId: 1, url: 'https://a.com/article#section2', epoch: 2 };
    expect(isCtxCurrent(ctx1, ctx2)).toBe(true);
  });

  it('tabId 不匹配时返回 false', () => {
    expect(isCtxCurrent({ tabId: 1, url: 'a', epoch: 1 }, { tabId: 2, url: 'a', epoch: 1 })).toBe(false);
  });

  it('epoch 不匹配时返回 false', () => {
    expect(isCtxCurrent({ tabId: 1, url: 'a', epoch: 1 }, { tabId: 1, url: 'a', epoch: 2 })).toBe(false);
  });
});

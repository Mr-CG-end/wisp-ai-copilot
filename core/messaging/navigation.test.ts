import { describe, expect, it } from 'vitest';
import { shouldInvalidateNavigation } from './navigation';

describe('shouldInvalidateNavigation', () => {
  it('忽略纯 hash 变化', () => {
    expect(shouldInvalidateNavigation({
      currentUrl: 'https://example.com/article#one',
      nextUrl: 'https://example.com/article#two',
    })).toBe(false);
  });

  it('忽略紧随滚动发生的同文档 replace 导航', () => {
    expect(shouldInvalidateNavigation({
      currentUrl: 'https://example.com/article/1',
      nextUrl: 'https://example.com/article/2',
      navigationType: 'replace',
      sameDocument: true,
      msSinceScroll: 120,
    })).toBe(false);
  });

  it('保留真实 push 与非滚动 replace 导航', () => {
    expect(shouldInvalidateNavigation({
      currentUrl: 'https://example.com/article/1',
      nextUrl: 'https://example.com/article/2',
      navigationType: 'push',
      sameDocument: true,
      msSinceScroll: 120,
    })).toBe(true);
    expect(shouldInvalidateNavigation({
      currentUrl: 'https://example.com/article/1',
      nextUrl: 'https://example.com/article/2',
      navigationType: 'replace',
      sameDocument: true,
      msSinceScroll: 1200,
    })).toBe(true);
  });
});

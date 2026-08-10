import { describe, expect, it } from 'vitest';
import { isSamePageTarget, shouldInvalidateNavigation } from './navigation';

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

describe('isSamePageTarget', () => {
  it('完全相同的 URL 判为同一页', () => {
    expect(isSamePageTarget('https://example.com/a', 'https://example.com/a')).toBe(true);
  });

  it('只差 hash 或 query 仍判为同一页', () => {
    expect(isSamePageTarget('https://example.com/a#x', 'https://example.com/a#y')).toBe(true);
    expect(isSamePageTarget('https://example.com/a?p=1', 'https://example.com/a?p=2')).toBe(true);
    expect(isSamePageTarget('https://example.com/a?p=1#x', 'https://example.com/a')).toBe(true);
  });

  it('pathname 不同判为已换页', () => {
    expect(isSamePageTarget('https://example.com/a', 'https://example.com/b')).toBe(false);
  });

  it('origin 不同判为已换页，端口与协议都算', () => {
    expect(isSamePageTarget('https://example.com/a', 'https://other.com/a')).toBe(false);
    expect(isSamePageTarget('https://example.com/a', 'http://example.com/a')).toBe(false);
    expect(isSamePageTarget('https://example.com/a', 'https://example.com:8443/a')).toBe(false);
  });

  it('尾斜杠属于 pathname 的一部分，不做归一', () => {
    expect(isSamePageTarget('https://example.com/a', 'https://example.com/a/')).toBe(false);
  });

  it('无法解析的 URL 退化为字符串相等，不因解析失败而丢弃动作', () => {
    expect(isSamePageTarget('not a url', 'not a url')).toBe(true);
    expect(isSamePageTarget('not a url', 'https://example.com/a')).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { classifyPageInjectionError } from './injectionError';

describe('classifyPageInjectionError', () => {
  it('普通网页注入失败归类为尚未授权', () => {
    expect(
      classifyPageInjectionError(
        "Cannot access contents of url 'https://example.com/article'. Extension manifest must request permission to access this host.",
      ),
    ).toBe('PAGE_PERMISSION_REQUIRED');
  });

  it.each([
    "Cannot access contents of url 'chrome://settings/'",
    "Cannot access contents of url 'edge://extensions/'",
    "Cannot access contents of url 'https://chromewebstore.google.com/detail/example'",
    "Cannot access contents of url 'https://microsoftedge.microsoft.com/addons/detail/example'",
  ])('明确受限页面仍归类为禁止注入：%s', (message) => {
    expect(classifyPageInjectionError(message)).toBe('PAGE_INJECTION_BLOCKED');
  });

  it('标签页在注入前关闭时归类为标签变化', () => {
    expect(classifyPageInjectionError('No tab with id: 123.')).toBe('TAB_CHANGED');
  });
});

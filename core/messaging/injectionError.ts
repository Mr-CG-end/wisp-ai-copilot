import type { ErrorCode } from './types';

const RESTRICTED_PAGE_PATTERN =
  /\b(?:chrome|edge|about|devtools|chrome-extension|view-source|file):\/\/|chromewebstore\.google\.com|microsoftedge\.microsoft\.com\/addons/i;

const MISSING_TAB_PATTERN = /no tab with id|tab (?:was )?closed|invalid tab id/i;

/**
 * `chrome.scripting.executeScript()` 对“缺少 activeTab”与“浏览器禁止注入”
 * 都会抛异常。只在错误里能明确识别受限地址时判为 blocked；
 * 普通页面和未知注入失败默认提示用户重新点击扩展图标授权。
 */
export function classifyPageInjectionError(message: string): ErrorCode {
  if (MISSING_TAB_PATTERN.test(message)) return 'TAB_CHANGED';
  if (RESTRICTED_PAGE_PATTERN.test(message)) return 'PAGE_INJECTION_BLOCKED';
  return 'PAGE_PERMISSION_REQUIRED';
}

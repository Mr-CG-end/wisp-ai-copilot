import { describe, expect, it } from 'vitest';
import type { ErrorCode } from '../messaging/types';
import { ERROR_COPY, type ErrorTier } from './errorCopy';

// 显式列全 14 个码，而不是遍历 Object.keys(ERROR_COPY)：
// 后者是拿被测对象给自己作证，漏掉一个码时测试反而会通过。
const ALL_CODES: ErrorCode[] = [
  'PAGE_PERMISSION_REQUIRED',
  'PAGE_INJECTION_BLOCKED',
  'PAGE_NO_CONTENT',
  'PAGE_TOO_LONG',
  'WEBGPU_UNAVAILABLE',
  'WEBGPU_CRASH',
  'DOWNLOAD_FAILED',
  'DOWNLOAD_CANCELLED',
  'CACHE_CORRUPT',
  'OFFLINE_NO_MODEL',
  'STORAGE_FULL',
  'TAB_CHANGED',
  'WORKER_ERROR',
  'FILL_FAILED',
];

/** 审查报告 §4 P-3 的整页态清单：模型不可用，不解决就做不了任何事。 */
const PAGE_CODES: ErrorCode[] = [
  'WEBGPU_UNAVAILABLE',
  'OFFLINE_NO_MODEL',
  'CACHE_CORRUPT',
  'DOWNLOAD_FAILED',
  'STORAGE_FULL',
];

// 阶段门明文检查项：文案不得暗示 Wisp 在持续读取或监视页面（快照语义，见阶段二计划 §2）。
const FORBIDDEN_WORDS = ['仍在', '持续读取', '实时', '监视'];

const TIERS: ErrorTier[] = ['page', 'banner', 'turn', 'inline'];

describe('ERROR_COPY', () => {
  it('覆盖全部 14 个 ErrorCode，且没有多余键', () => {
    expect(ALL_CODES).toHaveLength(14);
    for (const code of ALL_CODES) {
      expect(ERROR_COPY[code], code).toBeDefined();
    }
    expect(Object.keys(ERROR_COPY).sort()).toEqual([...ALL_CODES].sort());
  });

  it('五个整页态码归入 page 层', () => {
    for (const code of PAGE_CODES) {
      expect(ERROR_COPY[code].tier, code).toBe('page');
    }
  });

  it('没有整页态码被降级成横幅', () => {
    const downgraded = PAGE_CODES.filter((code) => ERROR_COPY[code].tier === 'banner');
    expect(downgraded).toEqual([]);
  });

  it('每个码的 tier 都是四类之一', () => {
    for (const code of ALL_CODES) {
      expect(TIERS, code).toContain(ERROR_COPY[code].tier);
    }
  });

  it('title 与 hint 非空，且不以「错误」「失败」开头', () => {
    for (const code of ALL_CODES) {
      const { title, hint } = ERROR_COPY[code];
      expect(title.trim(), code).not.toBe('');
      expect(hint.trim(), code).not.toBe('');
      expect(title.startsWith('错误'), code).toBe(false);
      expect(title.startsWith('失败'), code).toBe(false);
    }
  });

  it('全表文案不含暗示持续读取页面的措辞', () => {
    for (const code of ALL_CODES) {
      const text = `${ERROR_COPY[code].title}${ERROR_COPY[code].hint}`;
      for (const word of FORBIDDEN_WORDS) {
        expect(text.includes(word), `${code} 含「${word}」`).toBe(false);
      }
    }
  });
});

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ErrorCode } from '../core/messaging/types';

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

/**
 * 尚未接入生产路径的显式债务。接通一个码时必须从这里删除；若代码已出现但仍在
 * 白名单中，测试会失败，避免“永久待办”悄悄失去约束力。
 */
const PENDING_CODES = new Set<ErrorCode>([
  'PAGE_TOO_LONG',
  'WEBGPU_CRASH',
  'OFFLINE_NO_MODEL',
  'STORAGE_FULL',
  // v0.2 F-04 预留，v0.1 不触发。
  'FILL_FAILED',
]);

const SOURCE_ROOTS = ['core', 'entrypoints', 'components'];
const EXCLUDED_FILES = new Set([
  'core/messaging/types.ts',
  'core/panel/errorCopy.ts',
]);

function collectProductionSources(directory: string): string[] {
  const entries = readdirSync(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectProductionSources(fullPath));
      continue;
    }

    if (!/\.tsx?$/.test(entry.name) || /\.(?:test|bench)\.tsx?$/.test(entry.name)) continue;
    const relativePath = path.relative(process.cwd(), fullPath).replaceAll('\\', '/');
    if (!EXCLUDED_FILES.has(relativePath)) files.push(fullPath);
  }

  return files;
}

const sources = SOURCE_ROOTS.flatMap((root) => collectProductionSources(path.resolve(root)));

function touchedByProduction(code: ErrorCode): string[] {
  const literal = new RegExp(`(['"])${code}\\1`);
  return sources
    .filter((file) => literal.test(readFileSync(file, 'utf8')))
    .map((file) => path.relative(process.cwd(), file).replaceAll('\\', '/'));
}

describe('ErrorCode 生产路径触达', () => {
  for (const code of ALL_CODES) {
    it(`${code} 的触达状态与待办白名单一致`, () => {
      const files = touchedByProduction(code);
      if (PENDING_CODES.has(code)) {
        expect(files, `${code} 已接入生产路径，请从 PENDING_CODES 删除`).toHaveLength(0);
      } else {
        expect(files, `${code} 未在生产路径中出现`).not.toHaveLength(0);
      }
    });
  }
});

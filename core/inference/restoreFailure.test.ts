import { describe, expect, it } from 'vitest';
import { isCacheRestoreFailure } from './restoreFailure';

describe('isCacheRestoreFailure', () => {
  it('识别 cache-only 缺文件与损坏错误', () => {
    expect(isCacheRestoreFailure(new Error('Could not locate file in local cache'))).toBe(true);
    expect(isCacheRestoreFailure('local_files_only model file missing')).toBe(true);
    expect(isCacheRestoreFailure('cache is incomplete')).toBe(true);
  });

  it('不把 WebGPU 适配器或运行时错误误判为缓存损坏', () => {
    expect(isCacheRestoreFailure(new Error('WebGPU adapter is unavailable'))).toBe(false);
    expect(isCacheRestoreFailure(new Error('Device lost during self check'))).toBe(false);
  });
});

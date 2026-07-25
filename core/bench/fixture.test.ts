import { describe, expect, it } from 'vitest';
import { BENCH_PARAMS, BENCH_TEXT, BENCH_TEXT_HASH, hashText } from './fixture';

describe('bench fixture reproduciability guard', () => {
  it('should match the locked hash', () => {
    expect(BENCH_TEXT_HASH).toBe(958374825);
    expect(hashText(BENCH_TEXT)).toBe(BENCH_TEXT_HASH);
  });

  it('should have length within expected benchmark range (800~1200 chars)', () => {
    expect(BENCH_TEXT.length).toBeGreaterThanOrEqual(800);
    expect(BENCH_TEXT.length).toBeLessThanOrEqual(1200);
  });

  it('should have deterministic bench params', () => {
    expect(BENCH_PARAMS.maxNewTokens).toBe(256);
    expect(BENCH_PARAMS.temperature).toBe(0);
  });
});

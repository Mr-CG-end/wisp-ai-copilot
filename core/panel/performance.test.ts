import { describe, expect, it } from 'vitest';
import { PERFORMANCE_CONFIGS, selectProfileAfterSample } from './performance';

describe('selectProfileAfterSample', () => {
  it('明显掉帧时立即降为省资源模式', () => {
    expect(selectProfileAfterSample('balanced', {
      ttftMs: 1000,
      tokensPerSec: 30,
      maxFrameGapMs: 120,
    })).toBe('resource-saver');
  });

  it('速度快且界面流畅时升级为均衡模式', () => {
    expect(selectProfileAfterSample('resource-saver', {
      ttftMs: 1200,
      tokensPerSec: 24,
      maxFrameGapMs: 24,
    })).toBe('balanced');
  });

  it('处于中间区间时保持当前档位', () => {
    expect(selectProfileAfterSample('resource-saver', {
      ttftMs: 2500,
      tokensPerSec: 12,
      maxFrameGapMs: 55,
    })).toBe('resource-saver');
  });
});

describe('PERFORMANCE_CONFIGS', () => {
  it('省资源模式减少输入、输出和渲染频率', () => {
    const saver = PERFORMANCE_CONFIGS['resource-saver'];
    const balanced = PERFORMANCE_CONFIGS.balanced;
    expect(saver.summaryContextChars).toBeLessThan(balanced.summaryContextChars);
    expect(saver.qaMaxNewTokens).toBeLessThan(balanced.qaMaxNewTokens);
    expect(saver.streamFlushIntervalMs).toBeGreaterThan(balanced.streamFlushIntervalMs);
  });
});

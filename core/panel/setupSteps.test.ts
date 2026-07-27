import { describe, expect, it } from 'vitest';
import { selectSetupSteps } from './setupSteps';

describe('selectSetupSteps', () => {
  it('始终产出四步', () => {
    expect(selectSetupSteps('uninitialized', false)).toHaveLength(4);
    expect(selectSetupSteps('ready', true)).toHaveLength(4);
  });

  it('下载中：前一步完成，下载步为进行中，其后待办', () => {
    const steps = selectSetupSteps('downloading', false);
    expect(steps.map((s) => s.state)).toEqual(['done', 'active', 'todo', 'todo']);
  });

  it('加载中：下载步已完成', () => {
    const steps = selectSetupSteps('loading', false);
    expect(steps.map((s) => s.state)).toEqual(['done', 'done', 'active', 'todo']);
  });

  it('就绪：四步全部完成', () => {
    expect(selectSetupSteps('ready', true).every((s) => s.state === 'done')).toBe(true);
  });

  it('出错：当前步标记为 failed，其后仍为待办', () => {
    const steps = selectSetupSteps('error', false);
    expect(steps.some((s) => s.state === 'failed')).toBe(true);
  });

  it('缓存命中时下载步文案改为「缓存命中」', () => {
    expect(selectSetupSteps('loading', true)[1].label).toBe('缓存命中');
    expect(selectSetupSteps('loading', false)[1].label).toBe('下载权重');
  });
});

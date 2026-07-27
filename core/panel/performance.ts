export type PerformanceProfile = 'resource-saver' | 'balanced';

export interface PerformanceConfig {
  summaryContextChars: number;
  qaContextChars: number;
  summaryMaxNewTokens: number;
  qaMaxNewTokens: number;
  streamFlushIntervalMs: number;
}

export interface PerformanceSample {
  ttftMs: number;
  tokensPerSec: number;
  /**
   * 面板自己的 rAF 帧间隔，其中同时包含流式 Markdown 的解析成本，
   * 因此不是 GPU 争用的精确度量——降档可能由面板渲染而非宿主页面争用触发。
   */
  maxFrameGapMs: number;
}

/**
 * 一律从省资源档起步，由 selectProfileAfterSample 按真实速度与帧间隔升档。
 * 不做设备探测：Chrome 的 navigator.deviceMemory 上限就是 8，16GB 设备也报 8，
 * 任何基于它的初选判据都恒为真。
 */
export const PERFORMANCE_CONFIGS: Record<PerformanceProfile, PerformanceConfig> = {
  'resource-saver': {
    summaryContextChars: 1000,
    qaContextChars: 1400,
    summaryMaxNewTokens: 256,
    qaMaxNewTokens: 320,
    streamFlushIntervalMs: 120,
  },
  balanced: {
    summaryContextChars: 1400,
    qaContextChars: 2000,
    summaryMaxNewTokens: 384,
    qaMaxNewTokens: 512,
    streamFlushIntervalMs: 60,
  },
};

/** 根据真实生成速度与 Side Panel 帧阻塞情况校准下一次任务。 */
export function selectProfileAfterSample(
  current: PerformanceProfile,
  sample: PerformanceSample,
): PerformanceProfile {
  if (
    sample.maxFrameGapMs >= 80
    || sample.tokensPerSec < 8
    || sample.ttftMs >= 5000
  ) {
    return 'resource-saver';
  }
  if (
    sample.maxFrameGapMs <= 40
    && sample.tokensPerSec >= 18
    && sample.ttftMs <= 2000
  ) {
    return 'balanced';
  }
  return current;
}

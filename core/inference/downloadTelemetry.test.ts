import { describe, expect, it } from 'vitest';
import { createDownloadTelemetry } from './downloadTelemetry';

const progress = (loaded: number, total = 1000) => ({
  file: 'onnx/model.onnx',
  loaded,
  total,
  pct: Math.min(99, Math.floor(loaded / total * 100)),
});

describe('createDownloadTelemetry', () => {
  it('至少采样两秒后才给出速度和 ETA', () => {
    const telemetry = createDownloadTelemetry(0);

    expect(telemetry.update(progress(100), 3000).bytesPerSecond).toBeNull();
    expect(telemetry.update(progress(200), 4999).bytesPerSecond).toBeNull();
    const result = telemetry.update(progress(300), 5000);

    expect(result.bytesPerSecond).toBe(100);
    expect(result.etaSeconds).toBe(7);
  });

  it('使用最近十秒的样本计算速度', () => {
    const telemetry = createDownloadTelemetry(0);
    telemetry.update(progress(100, 2000), 5000);
    telemetry.update(progress(600, 2000), 12_000);
    const result = telemetry.update(progress(1100, 2000), 17_000);

    expect(result.bytesPerSecond).toBe(100);
  });

  it('忽略重复和倒退的字节数', () => {
    const telemetry = createDownloadTelemetry(0);
    telemetry.update(progress(400), 2000);
    telemetry.update(progress(600), 4000);
    telemetry.update(progress(300), 5000);
    const result = telemetry.update(progress(600), 6000);

    expect(result.loaded).toBe(600);
    expect(result.bytesPerSecond).toBe(100);
  });

  it('十五秒无字节增长时标记停滞，恢复增长后立即清除', () => {
    const telemetry = createDownloadTelemetry(0);
    telemetry.update(progress(100), 1000);

    expect(telemetry.snapshot(15_999).stalled).toBe(false);
    expect(telemetry.snapshot(16_000).stalled).toBe(true);
    expect(telemetry.update(progress(200), 17_000).stalled).toBe(false);
  });

  it('权重字节完成后进入 preparing 且不报停滞', () => {
    const telemetry = createDownloadTelemetry(0);
    telemetry.update(progress(1000), 3000);
    const result = telemetry.snapshot(30_000);

    expect(result.preparing).toBe(true);
    expect(result.stalled).toBe(false);
    expect(result.etaSeconds).toBeNull();
  });

  it('新 tracker 不继承上一轮下载数据', () => {
    const previous = createDownloadTelemetry(0);
    previous.update(progress(500), 5000);

    const next = createDownloadTelemetry(10_000).snapshot(10_000);
    expect(next).toEqual({
      loaded: 0,
      total: 0,
      bytesPerSecond: null,
      etaSeconds: null,
      stalled: false,
      preparing: false,
    });
  });
});

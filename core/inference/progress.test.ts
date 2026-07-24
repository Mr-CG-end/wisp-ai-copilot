import { describe, expect, it, vi } from 'vitest';
import { createModelProgress } from './progress';

describe('createModelProgress', () => {
  it('忽略 tokenizer/config 等非模型权重文件', () => {
    const onProgress = vi.fn();
    const progress = createModelProgress(onProgress);

    progress.onEvent({
      status: 'progress',
      file: 'tokenizer.json',
      loaded: 100,
      total: 100,
    });

    expect(onProgress).not.toHaveBeenCalled();
  });

  it('聚合权重字节且发现新文件时显示进度不倒退', () => {
    const values: number[] = [];
    const progress = createModelProgress((event) => values.push(event.pct));

    progress.onEvent({
      status: 'progress',
      file: 'onnx/model_q4f16.onnx',
      loaded: 50,
      total: 100,
    });
    progress.onEvent({
      status: 'progress',
      file: 'onnx/model_q4f16.onnx_data',
      loaded: 0,
      total: 100,
    });

    expect(values).toEqual([50, 50]);
  });

  it('自检完成前最多 99，自检完成后才到 100', () => {
    const values: number[] = [];
    const progress = createModelProgress((event) => values.push(event.pct));

    progress.onEvent({
      status: 'progress',
      file: 'onnx/model_q4f16.onnx',
      loaded: 100,
      total: 100,
    });
    progress.complete();

    expect(values).toEqual([99, 100]);
  });
});

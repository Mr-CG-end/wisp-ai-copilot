import { describe, expect, it } from 'vitest';
import { selectNewModelCacheUrls } from './cacheSelection';

const MODEL_ID = 'onnx-community/Qwen3-0.6B-ONNX';
const REVISION = 'abc123';
const base = `https://huggingface.co/${MODEL_ID}/resolve/${REVISION}/`;

describe('selectNewModelCacheUrls', () => {
  it('只返回本次新增且匹配模型与 revision 的条目', () => {
    const existing = new Set([`${base}config.json`]);
    const urls = [
      `${base}config.json`,
      `${base}tokenizer.json`,
      `https://huggingface.co/${MODEL_ID}/resolve/other/model.onnx`,
      'https://huggingface.co/other/model/resolve/abc123/model.onnx',
    ];

    expect(selectNewModelCacheUrls(urls, existing, MODEL_ID, REVISION)).toEqual([
      `${base}tokenizer.json`,
    ]);
  });

  it('保留初始化前已存在的完整模型权重', () => {
    const weight = `${base}onnx/model_q4f16.onnx`;

    expect(selectNewModelCacheUrls([weight], new Set([weight]), MODEL_ID, REVISION)).toEqual([]);
  });
});

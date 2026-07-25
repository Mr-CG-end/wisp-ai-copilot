import { describe, expect, it } from 'vitest';
import type { ModelCacheManifest } from './modelCache';
import { checkCacheMatch } from './modelCache';

const validManifest: ModelCacheManifest = {
  schema: 1,
  modelId: 'onnx-community/Qwen3-0.6B-ONNX',
  revision: 'da1453100cf3ff33ef56d17983fc7a8648706db6',
  backend: 'webgpu',
  dtype: 'q4f16',
  verifiedAt: 123456789,
};

describe('checkCacheMatch', () => {
  it('当 manifest 为 null 时返回 false', () => {
    expect(checkCacheMatch(null, { modelId: validManifest.modelId, revision: validManifest.revision })).toBe(false);
  });

  it('当 modelId 与 revision 完全匹配时返回 true', () => {
    expect(checkCacheMatch(validManifest, { modelId: validManifest.modelId, revision: validManifest.revision })).toBe(true);
  });

  it('当 modelId 不匹配时返回 false', () => {
    expect(checkCacheMatch(validManifest, { modelId: 'other-model', revision: validManifest.revision })).toBe(false);
  });

  it('当 revision 不匹配时返回 false', () => {
    expect(checkCacheMatch(validManifest, { modelId: validManifest.modelId, revision: 'other-sha' })).toBe(false);
  });

  it('指定 backend 且匹配时返回 true，不匹配时返回 false', () => {
    expect(checkCacheMatch(validManifest, {
      modelId: validManifest.modelId,
      revision: validManifest.revision,
      backend: 'webgpu',
    })).toBe(true);

    expect(checkCacheMatch(validManifest, {
      modelId: validManifest.modelId,
      revision: validManifest.revision,
      backend: 'wasm',
    })).toBe(false);
  });

  it('指定 dtype 时必须完全匹配', () => {
    expect(checkCacheMatch(validManifest, {
      modelId: validManifest.modelId,
      revision: validManifest.revision,
      dtype: 'q4f16',
    })).toBe(true);

    expect(checkCacheMatch(validManifest, {
      modelId: validManifest.modelId,
      revision: validManifest.revision,
      dtype: 'q8',
    })).toBe(false);
  });
});

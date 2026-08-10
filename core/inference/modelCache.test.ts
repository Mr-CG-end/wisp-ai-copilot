import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModelCacheManifest } from './modelCache';
import { checkCacheMatch, countModelCacheEntries } from './modelCache';

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

const { modelId, revision } = validManifest;
const hit = (file: string) => `https://huggingface.co/${modelId}/resolve/${revision}/${file}`;

function stubCaches(store: Record<string, string[]>): void {
  vi.stubGlobal('caches', {
    keys: async () => Object.keys(store),
    open: async (name: string) => ({
      keys: async () => (store[name] ?? []).map((url) => ({ url })),
    }),
  });
}

describe('countModelCacheEntries', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('累计所有 cache 中命中当前 revision 的条目', async () => {
    stubCaches({
      'transformers-cache': [hit('onnx/model_q4f16.onnx'), hit('config.json')],
      other: [hit('tokenizer.json')],
    });
    await expect(countModelCacheEntries(modelId, revision)).resolves.toBe(3);
  });

  it('其他模型或其他 revision 的条目不计入', async () => {
    stubCaches({
      'transformers-cache': [
        hit('config.json'),
        `https://huggingface.co/${modelId}/resolve/other-sha/config.json`,
        'https://huggingface.co/other/model/resolve/abc/config.json',
        'https://example.com/unrelated.js',
      ],
    });
    await expect(countModelCacheEntries(modelId, revision)).resolves.toBe(1);
  });

  it('没有任何缓存时返回 0', async () => {
    stubCaches({});
    await expect(countModelCacheEntries(modelId, revision)).resolves.toBe(0);
  });

  it('caches 不可用时返回 0，与 hasModelCacheEntries 的处理一致', async () => {
    vi.stubGlobal('caches', undefined);
    await expect(countModelCacheEntries(modelId, revision)).resolves.toBe(0);
  });

  it('Cache API 抛错时返回 0 而不是 reject', async () => {
    vi.stubGlobal('caches', {
      keys: async () => { throw new Error('storage disabled'); },
    });
    await expect(countModelCacheEntries(modelId, revision)).resolves.toBe(0);
  });
});

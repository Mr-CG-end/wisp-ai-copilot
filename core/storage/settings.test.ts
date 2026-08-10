import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, loadSettings, mergeSettings, saveSettings } from './settings';

let store: Record<string, unknown>;

beforeEach(() => {
  store = {};
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (keys: string[]) => Object.fromEntries(
          keys.filter((key) => key in store).map((key) => [key, store[key]]),
        )),
        set: vi.fn(async (items: Record<string, unknown>) => {
          Object.assign(store, items);
        }),
      },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('mergeSettings', () => {
  it('空存储返回默认值', () => {
    expect(mergeSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  it('默认值：auto / 7 天 / 当前模型', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      backend: 'auto',
      retentionDays: 7,
      modelId: 'onnx-community/Qwen3-0.6B-ONNX',
    });
  });

  it('保留合法的已存值', () => {
    expect(mergeSettings({
      backend: 'wasm',
      retentionDays: 0,
      modelId: 'onnx-community/Qwen3-0.6B-ONNX',
    })).toEqual({
      backend: 'wasm',
      retentionDays: 0,
      modelId: 'onnx-community/Qwen3-0.6B-ONNX',
    });
  });

  it('retentionDays 为 0 是合法值，不能被当成 falsy 回落成 7', () => {
    expect(mergeSettings({ retentionDays: 0 }).retentionDays).toBe(0);
  });

  it('backend 非法值回落 auto', () => {
    expect(mergeSettings({ backend: 'cuda' }).backend).toBe('auto');
    expect(mergeSettings({ backend: '' }).backend).toBe('auto');
    expect(mergeSettings({ backend: 1 }).backend).toBe('auto');
    expect(mergeSettings({ backend: null }).backend).toBe('auto');
  });

  it('retentionDays 非法值回落 7，包括 3 与字符串 "7"', () => {
    expect(mergeSettings({ retentionDays: 3 }).retentionDays).toBe(7);
    expect(mergeSettings({ retentionDays: '7' }).retentionDays).toBe(7);
    expect(mergeSettings({ retentionDays: '0' }).retentionDays).toBe(7);
    expect(mergeSettings({ retentionDays: -1 }).retentionDays).toBe(7);
    expect(mergeSettings({ retentionDays: null }).retentionDays).toBe(7);
  });

  it('modelId 走白名单，非白名单的非空字符串同样回落', () => {
    expect(mergeSettings({ modelId: 'evil/other-model' }).modelId).toBe(DEFAULT_SETTINGS.modelId);
    expect(mergeSettings({ modelId: '' }).modelId).toBe(DEFAULT_SETTINGS.modelId);
    expect(mergeSettings({ modelId: 123 }).modelId).toBe(DEFAULT_SETTINGS.modelId);
  });

  it('忽略存储里的历史遗留键（如已裁撤的 outputLength）', () => {
    expect(mergeSettings({ outputLength: 'long' })).toEqual(DEFAULT_SETTINGS);
  });
});

describe('loadSettings', () => {
  it('空存储返回默认值', async () => {
    await expect(loadSettings()).resolves.toEqual(DEFAULT_SETTINGS);
  });

  it('只读扁平键，读到的合法值生效', async () => {
    store = { retentionDays: 0, backend: 'webgpu' };
    await expect(loadSettings()).resolves.toEqual({
      backend: 'webgpu',
      retentionDays: 0,
      modelId: DEFAULT_SETTINGS.modelId,
    });
    expect(chrome.storage.local.get).toHaveBeenCalledWith(['backend', 'retentionDays', 'modelId']);
  });

  it('存储里被改坏的值回落默认', async () => {
    store = { retentionDays: 3, backend: 'cuda', modelId: 'broken' };
    await expect(loadSettings()).resolves.toEqual(DEFAULT_SETTINGS);
  });
});

describe('saveSettings', () => {
  it('patch 与已存值合并，未出现的键保持原样', async () => {
    store = { backend: 'wasm' };
    await expect(saveSettings({ retentionDays: 0 })).resolves.toEqual({
      backend: 'wasm',
      retentionDays: 0,
      modelId: DEFAULT_SETTINGS.modelId,
    });
  });

  it('写入的是扁平键，background 与 TaskPanel 的裸键读法照旧可用', async () => {
    await saveSettings({ retentionDays: 0 });
    expect(store.retentionDays).toBe(0);
    expect(store.settings).toBeUndefined();
  });

  it('patch 里的非法值同样回落默认', async () => {
    store = { backend: 'wasm' };
    await expect(saveSettings({ backend: 'cuda' as never })).resolves.toEqual(DEFAULT_SETTINGS);
    expect(store.backend).toBe('auto');
  });

  it('空 patch 也会把被改坏的存储值归正', async () => {
    store = { retentionDays: 3 };
    await expect(saveSettings({})).resolves.toEqual(DEFAULT_SETTINGS);
    expect(store.retentionDays).toBe(7);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isSelectionDiscoveryCompleted,
  markSelectionDiscoveryCompleted,
  SELECTION_DISCOVERY_COMPLETED_KEY,
} from './uiHints';

let store: Record<string, unknown>;

beforeEach(() => {
  store = {};
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (key: string) => (
          key in store ? { [key]: store[key] } : {}
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

describe('selection discovery hint', () => {
  it('仅严格的 true 表示用户已经发现划词功能', async () => {
    await expect(isSelectionDiscoveryCompleted()).resolves.toBe(false);
    store[SELECTION_DISCOVERY_COMPLETED_KEY] = 'true';
    await expect(isSelectionDiscoveryCompleted()).resolves.toBe(false);
    store[SELECTION_DISCOVERY_COMPLETED_KEY] = true;
    await expect(isSelectionDiscoveryCompleted()).resolves.toBe(true);
  });

  it('首次点击有效划词动作后写入完成标记', async () => {
    await markSelectionDiscoveryCompleted();
    expect(store[SELECTION_DISCOVERY_COMPLETED_KEY]).toBe(true);
  });
});

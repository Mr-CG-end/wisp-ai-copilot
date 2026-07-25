export const MODEL_CACHE_MANIFEST_KEY = 'wisp:model-cache-manifest:v1';

export interface ModelCacheManifest {
  schema: 1;
  modelId: string;
  revision: string;
  backend: 'webgpu' | 'wasm';
  dtype: 'q4f16' | 'q8';
  verifiedAt: number;
}

export async function readCacheManifest(): Promise<ModelCacheManifest | null> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return null;
  try {
    const data = await chrome.storage.local.get(MODEL_CACHE_MANIFEST_KEY);
    const manifest = data[MODEL_CACHE_MANIFEST_KEY] as ModelCacheManifest | undefined;
    if (manifest && manifest.schema === 1 && manifest.modelId && manifest.revision) {
      return manifest;
    }
    return null;
  } catch {
    return null;
  }
}

export async function writeCacheManifest(manifest: ModelCacheManifest): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
  await chrome.storage.local.set({ [MODEL_CACHE_MANIFEST_KEY]: manifest });
}

export async function clearCacheManifest(): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
  await chrome.storage.local.remove(MODEL_CACHE_MANIFEST_KEY);
}

export function checkCacheMatch(
  manifest: ModelCacheManifest | null,
  expected: { modelId: string; revision: string; backend?: 'webgpu' | 'wasm' },
): boolean {
  if (!manifest || manifest.schema !== 1) return false;
  if (manifest.modelId !== expected.modelId || manifest.revision !== expected.revision) {
    return false;
  }
  if (expected.backend && manifest.backend !== expected.backend) {
    return false;
  }
  return true;
}

/** 辅助方法：检查 Cache API 中是否有属于当前模型 revision 的响应条目 */
export async function hasModelCacheEntries(modelId: string, revision: string): Promise<boolean> {
  if (typeof caches === 'undefined') return false;
  try {
    const keys = await caches.keys();
    const marker = `/${modelId}/resolve/${revision}/`;
    for (const key of keys) {
      const cache = await caches.open(key);
      const requests = await cache.keys();
      if (requests.some((req) => req.url.includes(marker))) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

/** 辅助方法：删除匹配特定 modelId 与 revision 的 Cache API 条目 */
export async function purgeModelCacheEntries(modelId: string, revision: string): Promise<void> {
  if (typeof caches === 'undefined') return;
  try {
    const keys = await caches.keys();
    const marker = `/${modelId}/resolve/${revision}/`;
    for (const key of keys) {
      const cache = await caches.open(key);
      const requests = await cache.keys();
      for (const req of requests) {
        if (req.url.includes(marker)) {
          await cache.delete(req);
        }
      }
    }
  } catch {
    /* ignore */
  }
}

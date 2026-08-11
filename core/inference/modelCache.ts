import { selectNewModelCacheUrls } from './cacheSelection';
import {
  DEFAULT_MODEL_SOURCE_ID,
  isModelSourceId,
  type ModelSourceId,
} from './modelSource';

export const MODEL_CACHE_MANIFEST_KEY = 'wisp:model-cache-manifest:v1';

export interface ModelCacheManifest {
  schema: 2;
  sourceId: ModelSourceId;
  modelId: string;
  revision: string;
  backend: 'webgpu' | 'wasm';
  dtype: 'q4f16' | 'q8';
  verifiedAt: number;
}

interface LegacyModelCacheManifest {
  schema: 1;
  modelId: string;
  revision: string;
  backend: 'webgpu' | 'wasm';
  dtype: 'q4f16' | 'q8';
  verifiedAt: number;
}

type ManifestFields = Omit<LegacyModelCacheManifest, 'schema'>;

function hasValidManifestFields(manifest: Partial<ManifestFields>): boolean {
  return Boolean(
    manifest.modelId
    && manifest.revision
    && (manifest.backend === 'webgpu' || manifest.backend === 'wasm')
    && (manifest.dtype === 'q4f16' || manifest.dtype === 'q8')
    && typeof manifest.verifiedAt === 'number'
    && Number.isFinite(manifest.verifiedAt),
  );
}

export async function readCacheManifest(): Promise<ModelCacheManifest | null> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return null;
  try {
    const data = await chrome.storage.local.get(MODEL_CACHE_MANIFEST_KEY);
    const manifest = data[MODEL_CACHE_MANIFEST_KEY] as
      | ModelCacheManifest
      | LegacyModelCacheManifest
      | undefined;
    if (
      manifest
      && manifest.schema === 2
      && hasValidManifestFields(manifest)
      && isModelSourceId(manifest.sourceId)
    ) {
      return manifest;
    }
    if (manifest && manifest.schema === 1 && hasValidManifestFields(manifest)) {
      const migrated: ModelCacheManifest = {
        ...manifest,
        schema: 2,
        sourceId: DEFAULT_MODEL_SOURCE_ID,
      };
      try {
        await chrome.storage.local.set({ [MODEL_CACHE_MANIFEST_KEY]: migrated });
      } catch {
        // 迁移持久化失败不影响本次使用；下次读取会再次尝试。
      }
      return migrated;
    }
    return null;
  } catch {
    return null;
  }
}

export async function writeCacheManifest(manifest: ModelCacheManifest): Promise<void> {
  if (!isModelSourceId(manifest.sourceId)) {
    throw new Error(`UNKNOWN_MODEL_SOURCE:${String(manifest.sourceId)}`);
  }
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
  await chrome.storage.local.set({ [MODEL_CACHE_MANIFEST_KEY]: manifest });
}

export async function clearCacheManifest(): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
  await chrome.storage.local.remove(MODEL_CACHE_MANIFEST_KEY);
}

export function checkCacheMatch(
  manifest: ModelCacheManifest | null,
  expected: {
    modelId: string;
    revision: string;
    backend?: 'webgpu' | 'wasm';
    dtype?: 'q4f16' | 'q8';
    sourceId?: ModelSourceId;
  },
): boolean {
  if (!manifest || manifest.schema !== 2 || !isModelSourceId(manifest.sourceId)) return false;
  if (manifest.modelId !== expected.modelId || manifest.revision !== expected.revision) {
    return false;
  }
  if (expected.backend && manifest.backend !== expected.backend) {
    return false;
  }
  if (expected.dtype && manifest.dtype !== expected.dtype) {
    return false;
  }
  if (expected.sourceId && manifest.sourceId !== expected.sourceId) {
    return false;
  }
  return true;
}

/** 记录初始化前已经存在的 Cache API URL，用于取消时只清理本次新增文件。 */
export async function snapshotModelCacheUrls(): Promise<Set<string> | null> {
  if (typeof caches === 'undefined') return null;
  const urls = new Set<string>();
  const keys = await caches.keys();
  for (const key of keys) {
    const cache = await caches.open(key);
    for (const request of await cache.keys()) {
      urls.add(request.url);
    }
  }
  return urls;
}

/** 删除本次初始化新增且属于指定模型 revision 的 Cache API 条目。 */
export async function purgeNewModelCacheEntries(
  existingUrls: ReadonlySet<string> | null,
  modelId: string,
  revision: string,
): Promise<number> {
  if (typeof caches === 'undefined' || existingUrls === null) return 0;
  let removed = 0;
  const keys = await caches.keys();
  for (const key of keys) {
    const cache = await caches.open(key);
    const urls = (await cache.keys()).map((request) => request.url);
    const addedUrls = selectNewModelCacheUrls(urls, existingUrls, modelId, revision);
    const results = await Promise.all(addedUrls.map((url) => cache.delete(url)));
    removed += results.filter(Boolean).length;
  }
  return removed;
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

/**
 * 辅助方法：统计 Cache API 中属于当前模型 revision 的响应条目数（设置页用量展示）。
 * 与 `hasModelCacheEntries` 同一套 marker 匹配，只是不能命中即返回——必须走完所有 cache 累加。
 */
export async function countModelCacheEntries(modelId: string, revision: string): Promise<number> {
  if (typeof caches === 'undefined') return 0;
  try {
    const keys = await caches.keys();
    const marker = `/${modelId}/resolve/${revision}/`;
    let count = 0;
    for (const key of keys) {
      const cache = await caches.open(key);
      const requests = await cache.keys();
      count += requests.filter((req) => req.url.includes(marker)).length;
    }
    return count;
  } catch {
    return 0;
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

/**
 * 设置项在 `chrome.storage.local` 里用**扁平裸键**存放，不包一层 `settings` 对象：
 * `retentionDays` 这个裸键已经在用（`entrypoints/background.ts` 的 `tabs.onRemoved`
 * 与 `TaskPanel.tsx` 的 `ensureSession` 都是 `get('retentionDays')` 直读），
 * 换成嵌套结构会逼这两个热点文件跟着改，收益却只是「看起来整齐」。
 */
import { MODEL_ID } from '../inference/modelIdentity';


/**
 * 白名单只有当前这一个模型。常量已下沉到 `core/inference/modelIdentity.ts`，
 * 直接引用即可，不必再手工同步两份字面量。
 */
const MODEL_IDS = [MODEL_ID] as const;

const BACKENDS = ['auto', 'webgpu', 'wasm'] as const;
const RETENTIONS = [7, 0] as const;

export interface Settings {
  backend: 'auto' | 'webgpu' | 'wasm';
  retentionDays: 7 | 0;
  modelId: string;
}

export const DEFAULT_SETTINGS: Settings = {
  backend: 'auto',
  retentionDays: 7,
  modelId: MODEL_IDS[0],
};

const SETTINGS_KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[];

/**
 * 存储里的值可能来自旧版本或被手工改坏，非法值一律回落默认。
 * 三处都用 `find(...) ?? 默认值` 而不是 `||`：`retentionDays: 0`（关标签即清）是合法值，
 * 用 `||` 会把它悄悄改回 7 天。
 * `modelId` 走白名单而非「非空字符串即可」：一个改坏的 modelId 会让缓存清单比对失败，
 * 用户什么都没做却触发一次 570 MB 重新下载。
 */
export function mergeSettings(stored: Record<string, unknown>): Settings {
  return {
    backend: BACKENDS.find((item) => item === stored.backend) ?? DEFAULT_SETTINGS.backend,
    retentionDays: RETENTIONS.find((item) => item === stored.retentionDays) ?? DEFAULT_SETTINGS.retentionDays,
    modelId: MODEL_IDS.find((item) => item === stored.modelId) ?? DEFAULT_SETTINGS.modelId,
  };
}

export async function loadSettings(): Promise<Settings> {
  return mergeSettings(await chrome.storage.local.get(SETTINGS_KEYS));
}

/** 回写整套校验后的值而不是只写 patch：顺手把存储里被改坏的旧值归正。 */
export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const stored = await chrome.storage.local.get(SETTINGS_KEYS);
  const next = mergeSettings({ ...stored, ...patch });
  await chrome.storage.local.set(next);
  return next;
}

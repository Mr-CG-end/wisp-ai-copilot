/**
 * 三个数据源全部由调用方注入：`navigator.storage`、Cache API、Dexie 在 node 单测里都不存在，
 * 直接摸全局就没法测这段汇总与降级逻辑。
 */
export interface UsageDeps {
  estimate: () => Promise<{ usage?: number; quota?: number }>;
  countCacheEntries: () => Promise<number>;
  countSessions: () => Promise<number>;
}

export interface UsageSnapshot {
  usageBytes: number;
  quotaBytes: number;
  cacheEntries: number;
  sessions: number;
}

/** 任一数据源失败都只让那一项归 0：设置页显示「缓存 0 项」也好过整块用量崩掉。 */
async function safely<T>(read: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await read();
  } catch {
    return fallback;
  }
}

/** `estimate()` 的两个字段都是可选的，浏览器不给就按 0 算。 */
function bytes(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

export async function collectUsage(deps: UsageDeps): Promise<UsageSnapshot> {
  const [estimate, cacheEntries, sessions] = await Promise.all([
    safely<{ usage?: number; quota?: number }>(() => deps.estimate(), {}),
    safely(() => deps.countCacheEntries(), 0),
    safely(() => deps.countSessions(), 0),
  ]);
  return {
    usageBytes: bytes(estimate.usage),
    quotaBytes: bytes(estimate.quota),
    cacheEntries,
    sessions,
  };
}

/** 与 `ModelSetup` 的可用空间显示同一口径：MB 取整、上 GB 留一位小数。 */
function formatBytes(value: number): string {
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.round(value / 1024 ** 2)} MB`;
}

/** 设置页的用量只需要这一行文本，不做图表：量级感足够，配额细节留给 snapshot。 */
export function formatUsageLine(snapshot: UsageSnapshot): string {
  return `约 ${formatBytes(snapshot.usageBytes)} · 会话 ${snapshot.sessions} 条 · 缓存 ${snapshot.cacheEntries} 项`;
}

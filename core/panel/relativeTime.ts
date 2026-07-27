const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * 快照读取时刻的相对表述。now 由调用方传入而非内部取 Date.now()，
 * 以便单测确定性断言。
 */
export function formatReadAt(readAt: number, now: number): string {
  const elapsed = Math.max(0, now - readAt);
  if (elapsed < MINUTE) return '刚刚';
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)} 分钟前`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)} 小时前`;
  return `${Math.floor(elapsed / DAY)} 天前`;
}

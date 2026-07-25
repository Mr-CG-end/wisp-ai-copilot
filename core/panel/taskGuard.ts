import type { TaskContext } from '../messaging/types';

/**
 * 校验 ctx 是否属于当前绑定的页面上下文 (bound)。
 * 规则：
 * 1. bound 为 null 时返回 false。
 * 2. tabId 与 epoch 必须完全相等。
 * 3. URL hash 变化不影响匹配，只要 tabId 与 epoch 相同即可。
 */
export function isCtxCurrent(ctx: TaskContext, bound: TaskContext | null): boolean {
  if (!bound) return false;
  return ctx.tabId === bound.tabId && ctx.epoch === bound.epoch;
}

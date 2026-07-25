/** chrome.storage.session 中存放 epoch 快照的键；由 Service Worker 侧读写。 */
export const EPOCH_STORAGE_KEY = 'wisp:epochs';

/** epoch 权威：只在 Service Worker 中实例化一份。类本身不碰 chrome.*，便于纯单测。 */
export class EpochRegistry {
  private map = new Map<number, number>();

  get(tabId: number): number {
    return this.map.get(tabId) ?? 0;
  }

  bump(tabId: number): number {
    const next = this.get(tabId) + 1;
    this.map.set(tabId, next);
    return next;
  }

  forget(tabId: number): void {
    this.map.delete(tabId);
  }

  isCurrent(ref: { tabId: number; epoch: number }): boolean {
    return this.get(ref.tabId) === ref.epoch;
  }

  /** 导出快照，供 SW 写入 chrome.storage.session。 */
  toJSON(): Record<string, number> {
    return Object.fromEntries([...this.map].map(([tabId, epoch]) => [String(tabId), epoch]));
  }

  /**
   * 从快照恢复。MV3 Service Worker 空闲即被回收，重启后内存 Map 归零——
   * 若不恢复，epoch 会倒退回 0，导致 Panel 已持有的 ctx 被误判失效。
   * 取较大值合并：恢复动作永远不会让计数倒退。
   */
  restore(data: Record<string, number> | undefined): void {
    if (!data) return;
    for (const [key, value] of Object.entries(data)) {
      const tabId = Number(key);
      if (!Number.isInteger(tabId) || !Number.isFinite(value)) continue;
      this.map.set(tabId, Math.max(this.get(tabId), value));
    }
  }
}

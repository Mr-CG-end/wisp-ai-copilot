import type { PendingActionEntry } from './types';

export const PENDING_TTL_MS = 30_000;

/** 划词动作在 sidePanel.open() 与面板挂载之间的中转站；单槽位，带过期。 */
export class PendingActionStore {
  private entry: PendingActionEntry | null = null;
  private expiresAt = 0;

  put(entry: PendingActionEntry, now: number, ttlMs: number = PENDING_TTL_MS): void {
    this.entry = entry;
    this.expiresAt = now + ttlMs;
  }

  take(now: number): PendingActionEntry | null {
    const entry = this.entry;
    this.entry = null;
    if (!entry || now >= this.expiresAt) return null;
    return entry;
  }
}

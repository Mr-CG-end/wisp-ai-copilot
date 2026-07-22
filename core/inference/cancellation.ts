export interface Stopper { interrupt(): void; }

// 按 signalId 管理生成中断器（Worker 侧持有 InterruptableStoppingCriteria）。
export class StopperRegistry {
  private map = new Map<string, Stopper>();

  register(id: string, s: Stopper): void { this.map.set(id, s); }

  interrupt(id: string): boolean {
    const s = this.map.get(id);
    if (!s) return false;
    s.interrupt();
    this.map.delete(id);
    return true;
  }

  release(id: string): void { this.map.delete(id); }

  get active(): number { return this.map.size; }
}

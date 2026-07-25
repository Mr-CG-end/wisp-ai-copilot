import { describe, expect, it } from 'vitest';
import { EpochRegistry } from './epoch';

describe('EpochRegistry', () => {
  it('未知标签页的 epoch 为 0', () => {
    expect(new EpochRegistry().get(7)).toBe(0);
  });

  it('bump 递增并返回新值，各标签页互不影响', () => {
    const r = new EpochRegistry();
    expect(r.bump(1)).toBe(1);
    expect(r.bump(1)).toBe(2);
    expect(r.get(2)).toBe(0);
  });

  it('isCurrent 只在 tabId 与 epoch 都匹配时为真', () => {
    const r = new EpochRegistry();
    r.bump(3);
    expect(r.isCurrent({ tabId: 3, epoch: 1 })).toBe(true);
    expect(r.isCurrent({ tabId: 3, epoch: 0 })).toBe(false);
    expect(r.isCurrent({ tabId: 4, epoch: 1 })).toBe(false);
  });

  it('forget 后重新计数从 1 开始', () => {
    const r = new EpochRegistry();
    r.bump(5);
    r.forget(5);
    expect(r.get(5)).toBe(0);
    expect(r.bump(5)).toBe(1);
  });

  it('toJSON/restore 可跨 Service Worker 重启还原计数', () => {
    const before = new EpochRegistry();
    before.bump(1);
    before.bump(1);
    before.bump(2);

    const after = new EpochRegistry();
    after.restore(before.toJSON());
    expect(after.get(1)).toBe(2);
    expect(after.get(2)).toBe(1);
    expect(after.bump(1)).toBe(3);          // 恢复后继续递增，不倒退
  });

  it('restore 取较大值合并，恢复不会覆盖更新的内存值', () => {
    const r = new EpochRegistry();
    r.bump(1);
    r.bump(1);
    r.bump(1);                               // 内存已到 3
    r.restore({ '1': 1 });                   // 落盘的是旧值 1
    expect(r.get(1)).toBe(3);
  });

  it('restore 容忍 undefined 与脏数据', () => {
    const r = new EpochRegistry();
    r.restore(undefined);
    r.restore({ notANumber: Number.NaN, '3': 2 } as Record<string, number>);
    expect(r.get(3)).toBe(2);
  });
});

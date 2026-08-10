import { describe, expect, it } from 'vitest';
import { PendingActionStore, PENDING_TTL_MS } from './pending';

const ctx = { tabId: 1, url: 'https://example.com/a', epoch: 2 };
const entry = { id: 'act-1', action: 'explain' as const, text: '选中的文字', lang: 'zh' as const, ctx };

describe('PendingActionStore', () => {
  it('put 后可在 TTL 内取出一次', () => {
    const s = new PendingActionStore();
    s.put(entry, 1000);
    expect(s.take(1000 + PENDING_TTL_MS - 1)).toEqual(entry);
  });

  it('取出后即清空，二次 take 为 null', () => {
    const s = new PendingActionStore();
    s.put(entry, 0);
    s.take(0);
    expect(s.take(0)).toBeNull();
  });

  it('超过 TTL 返回 null 且不残留', () => {
    const s = new PendingActionStore();
    s.put(entry, 0);
    expect(s.take(PENDING_TTL_MS + 1)).toBeNull();
    expect(s.take(0)).toBeNull();
  });

  it('新 put 覆盖旧的待投递动作', () => {
    const s = new PendingActionStore();
    s.put(entry, 0);
    const next = { ...entry, action: 'translate' as const, text: '另一段' };
    s.put(next, 0);
    expect(s.take(0)).toEqual(next);
  });

  it('未 put 时 take 为 null', () => {
    expect(new PendingActionStore().take(0)).toBeNull();
  });
});

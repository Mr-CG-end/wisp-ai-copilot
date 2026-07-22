import { describe, it, expect, vi } from 'vitest';
import { StopperRegistry } from './cancellation';

describe('StopperRegistry', () => {
  it('interrupt 会调用对应 stopper 并移除', () => {
    const reg = new StopperRegistry();
    const s = { interrupt: vi.fn() };
    reg.register('a', s);
    expect(reg.active).toBe(1);
    expect(reg.interrupt('a')).toBe(true);
    expect(s.interrupt).toHaveBeenCalledOnce();
    expect(reg.active).toBe(0);
  });

  it('interrupt 未知 id 返回 false 且不抛错', () => {
    expect(new StopperRegistry().interrupt('missing')).toBe(false);
  });

  it('release 移除但不触发 interrupt', () => {
    const reg = new StopperRegistry();
    const s = { interrupt: vi.fn() };
    reg.register('a', s);
    reg.release('a');
    expect(s.interrupt).not.toHaveBeenCalled();
    expect(reg.active).toBe(0);
  });
});

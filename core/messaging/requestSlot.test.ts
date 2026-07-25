import { afterEach, describe, expect, it, vi } from 'vitest';
import { RequestSlot } from './requestSlot';

afterEach(() => {
  vi.useRealTimers();
});

describe('RequestSlot', () => {
  it('将回复交给唯一的在途请求', async () => {
    const slot = new RequestSlot<string>();
    const request = slot.start(1000);
    slot.resolve('ok');
    await expect(request).resolves.toBe('ok');
  });

  it('已有请求时拒绝并发请求', async () => {
    const slot = new RequestSlot<string>();
    const first = slot.start(1000);
    await expect(slot.start(1000)).rejects.toThrow('PORT_BUSY');
    slot.resolve('first');
    await expect(first).resolves.toBe('first');
  });

  it('取消旧请求后允许新请求，旧计时器不会清理新请求', async () => {
    vi.useFakeTimers();
    const slot = new RequestSlot<string>();
    const first = slot.start(1000);
    slot.cancel('PORT_CLOSED');
    const second = slot.start(2000);

    await expect(first).rejects.toThrow('PORT_CLOSED');
    await vi.advanceTimersByTimeAsync(1000);
    slot.resolve('second');
    await expect(second).resolves.toBe('second');
  });

  it('超时后清理槽位并允许下一次请求', async () => {
    vi.useFakeTimers();
    const slot = new RequestSlot<string>();
    const first = slot.start(1000);
    const firstExpectation = expect(first).rejects.toThrow('PORT_TIMEOUT');
    await vi.advanceTimersByTimeAsync(1000);
    await firstExpectation;

    const second = slot.start(1000);
    slot.resolve('ok');
    await expect(second).resolves.toBe('ok');
  });
});

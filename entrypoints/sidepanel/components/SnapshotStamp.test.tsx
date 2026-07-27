// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { SnapshotStamp } from './SnapshotStamp';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function render(node: React.ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    createRoot(container).render(node);
  });
  return container;
}

describe('SnapshotStamp', () => {
  it('显示域名首字母大写与相对读取时刻', async () => {
    const c = await render(<SnapshotStamp host="web.dev" readAt={0} now={180_000} stale={false} />);
    expect(c.querySelector('.wisp-stamp-initial')?.textContent).toBe('W');
    expect(c.querySelector('.wisp-stamp-time')?.textContent).toBe('3 分钟前读取');
  });

  it('过期时标记 is-stale 并改写文案', async () => {
    const c = await render(<SnapshotStamp host="web.dev" readAt={0} now={180_000} stale />);
    expect(c.querySelector('.wisp-stamp')?.className).toContain('is-stale');
    expect(c.querySelector('.wisp-stamp-time')?.textContent).toBe('快照已过期');
  });

  it('空域名不渲染出 undefined 首字母', async () => {
    const c = await render(<SnapshotStamp host="" readAt={0} now={0} stale={false} />);
    expect(c.querySelector('.wisp-stamp-initial')?.textContent).toBe('·');
  });

  it('装饰图形不进入无障碍树，时刻文本进入', async () => {
    const c = await render(<SnapshotStamp host="web.dev" readAt={0} now={0} stale={false} />);
    expect(c.querySelector('.wisp-stamp-initial')?.getAttribute('aria-hidden')).toBe('true');
    expect(c.querySelector('.wisp-stamp-time')?.getAttribute('aria-hidden')).toBeNull();
  });
});

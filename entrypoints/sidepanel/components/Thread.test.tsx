// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { Thread } from './Thread';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function render(node: React.ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    createRoot(container).render(node);
  });
  return container;
}

describe('Thread', () => {
  it('编号补零为两位', async () => {
    const c = await render(<Thread index={2} label="追问" status="success" />);
    expect(c.querySelector('.wisp-thread-index')?.textContent).toBe('02');
  });

  it('两位数以上不截断', async () => {
    const c = await render(<Thread index={12} label="追问" status="success" />);
    expect(c.querySelector('.wisp-thread-index')?.textContent).toBe('12');
  });

  it('每个状态产生不同的修饰类，供 CSS 区分形态', async () => {
    const statuses = ['loading', 'success', 'empty', 'cancelled', 'error'] as const;
    const classNames = new Set<string>();
    for (const status of statuses) {
      const c = await render(<Thread index={1} label="摘要" status={status} />);
      classNames.add(c.querySelector('.wisp-thread')!.className);
    }
    expect(classNames.size).toBe(statuses.length);
  });

  it('生成中与空结果的修饰类不同（静态形态必须可区分）', async () => {
    const loading = await render(<Thread index={1} label="摘要" status="loading" />);
    const empty = await render(<Thread index={1} label="摘要" status="empty" />);
    expect(loading.querySelector('.wisp-thread')!.className)
      .not.toBe(empty.querySelector('.wisp-thread')!.className);
  });

  it('整个轨道单元不进入无障碍树', async () => {
    const c = await render(<Thread index={1} label="摘要" status="success" />);
    expect(c.querySelector('.wisp-thread')?.getAttribute('aria-hidden')).toBe('true');
  });
});

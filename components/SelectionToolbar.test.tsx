// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SelectionToolbar } from './SelectionToolbar';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Root[] = [];

async function render(node: React.ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    const root = createRoot(container);
    mounted.push(root);
    root.render(node);
  });
  return container;
}

afterEach(async () => {
  await act(async () => mounted.splice(0).forEach((root) => root.unmount()));
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe('SelectionToolbar hint', () => {
  it('首次启用提示渲染标题和说明，不伪装成动作按钮', async () => {
    const c = await render(
      <SelectionToolbar
        hint="Wisp 划词已启用"
        hintDetail="选中文字即可解释、总结、改写或翻译"
        onAction={() => {}}
        onDismiss={() => {}}
      />,
    );

    expect(c.querySelector('.wisp-toolbar--discovery')).not.toBeNull();
    expect(c.textContent).toContain('Wisp 划词已启用');
    expect(c.textContent).toContain('选中文字即可解释、总结、改写或翻译');
    expect(c.querySelector('button')).toBeNull();
  });

  it('使用传入的停留时间，并在到期时请求宿主收起', async () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    await render(
      <SelectionToolbar
        hint="Wisp 划词已启用"
        hintDetail="选中文字即可操作"
        hintDurationMs={4000}
        onAction={() => {}}
        onDismiss={onDismiss}
      />,
    );

    await act(async () => vi.advanceTimersByTime(3999));
    expect(onDismiss).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(1));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});

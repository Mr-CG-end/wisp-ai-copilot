// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { Turn } from '../../../core/panel/thread';
import { TurnView } from './Turn';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeTurn(overrides: Partial<Turn> = {}): Turn {
  return {
    id: 't1',
    index: 1,
    type: 'summary',
    status: 'success',
    label: '摘要',
    statusLabel: '',
    accessibleName: '第 1 轮 · 摘要 · 已完成',
    output: '摘要正文',
    truncated: false,
    sourceUrl: 'https://example.com/a',
    source: '示例文章',
    isCurrent: false,
    ...overrides,
  };
}

const noop = () => {};
const baseProps = {
  isStale: false,
  isStopping: false,
  canRegenerate: true,
  onCopy: noop,
  onRegenerate: noop,
  onStop: noop,
};

async function render(node: React.ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    createRoot(container).render(node);
  });
  return container;
}

describe('TurnView', () => {
  it('容器可访问名用完整版状态描述', async () => {
    const c = await render(<TurnView turn={makeTurn({ accessibleName: '第 2 轮 · 追问 · 已停止' })} {...baseProps} />);
    expect(c.querySelector('article')?.getAttribute('aria-label')).toBe('第 2 轮 · 追问 · 已停止');
  });

  it('正文容器不得挂 aria-live', async () => {
    const c = await render(<TurnView turn={makeTurn({ status: 'loading' })} {...baseProps} />);
    expect(c.querySelector('.wisp-turn-body')?.getAttribute('aria-live')).toBeNull();
  });

  it('生成中只显示停止，不显示复制与重新生成', async () => {
    const c = await render(<TurnView turn={makeTurn({ status: 'loading' })} {...baseProps} />);
    const labels = [...c.querySelectorAll('button')].map((b) => b.textContent);
    expect(labels).toContain('停止');
    expect(labels).not.toContain('复制');
    expect(labels).not.toContain('重新生成');
  });

  it('完成后显示复制与重新生成', async () => {
    const onCopy = vi.fn();
    const c = await render(<TurnView turn={makeTurn()} {...baseProps} onCopy={onCopy} />);
    const copy = [...c.querySelectorAll('button')].find((b) => b.textContent === '复制')!;
    await act(async () => { copy.click(); });
    expect(onCopy).toHaveBeenCalledOnce();
  });

  it('来源与当前快照一致时不显示来源行', async () => {
    const c = await render(<TurnView turn={makeTurn()} {...baseProps} />);
    expect(c.querySelector('.wisp-turn-origin')).toBeNull();
  });

  it('来源不一致时显示来源行', async () => {
    const c = await render(<TurnView turn={makeTurn()} {...baseProps} isStale />);
    expect(c.querySelector('.wisp-turn-origin')?.textContent).toContain('example.com');
  });

  it('被停止的轮次保留已生成内容并给出状态文字', async () => {
    const turn = makeTurn({ status: 'cancelled', statusLabel: '已停止', output: '半截内容' });
    const c = await render(<TurnView turn={turn} {...baseProps} />);
    expect(c.textContent).toContain('半截内容');
    expect(c.textContent).toContain('已停止');
  });

  it('达到长度上限时给出提示', async () => {
    const c = await render(<TurnView turn={makeTurn({ truncated: true })} {...baseProps} />);
    expect(c.querySelector('.wisp-truncated-note')).not.toBeNull();
  });
});

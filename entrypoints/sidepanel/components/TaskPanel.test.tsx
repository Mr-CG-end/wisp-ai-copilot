// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readiness: {
    value: { decision: 'allow', signals: [] } as
      | { decision: 'allow'; signals: string[] }
      | { decision: 'warn'; reason: 'possibly_fragmented'; signals: string[] }
      | {
          decision: 'reject';
          reason: 'activity_feed' | 'fragmented_content' | 'insufficient_content';
          signals: string[];
        },
  },
  runGeneration: vi.fn(async (_options: unknown) => null),
  appendMessage: vi.fn(async () => {}),
}));

vi.mock('../../../core/extract/summaryReadiness', () => ({
  assessSummaryReadiness: vi.fn(() => mocks.readiness.value),
}));

vi.mock('../useTaskRunner', () => ({
  useTaskRunner: () => ({
    runGeneration: mocks.runGeneration,
    stop: vi.fn(async () => {}),
    isStopping: false,
  }),
}));

vi.mock('../../../core/storage/db', () => ({
  DAY_MS: 86_400_000,
  DEFAULT_RETENTION_DAYS: 30,
  db: {
    sessions: { where: () => ({ equals: () => ({ first: async () => null }) }) },
  },
}));

vi.mock('../../../core/storage/cleanup', () => ({ appendMessage: mocks.appendMessage }));
vi.mock('./SnapshotStamp', () => ({ SnapshotStamp: () => <span>快照凭证</span> }));

import { usePanelStore } from '../store';
import { TaskPanel } from './TaskPanel';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ctx = { tabId: 7, url: 'https://github.com/example', epoch: 1 };
const mounted: ReturnType<typeof createRoot>[] = [];

function pageChannel() {
  return {
    activeTab: { tabId: 7, epoch: 1 },
    adoptCtx: vi.fn(),
    boundCtx: ctx,
    consumePendingAction: vi.fn(),
    lastError: null,
    pendingAction: null,
    readActivePage: vi.fn(async () => null),
    readPage: vi.fn(async () => null),
  };
}

async function renderPanel() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    const root = createRoot(container);
    mounted.push(root);
    root.render(<TaskPanel pageChannel={pageChannel() as never} />);
  });
  return container;
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')]
    .find((candidate) => candidate.textContent?.trim() === text);
  if (!button) throw new Error(`找不到按钮：${text}`);
  return button;
}

describe('TaskPanel 摘要就绪度分流', () => {
  beforeEach(() => {
    mocks.runGeneration.mockClear();
    mocks.appendMessage.mockClear();
    mocks.readiness.value = { decision: 'allow', signals: [] };
    usePanelStore.getState().reset();
    usePanelStore.setState({
      modelStatus: 'ready',
      boundCtx: ctx,
      page: {
        ctx,
        title: 'GitHub profile',
        url: ctx.url,
        text: '这是一段足够长的页面快照内容。'.repeat(30),
        charCount: 450,
        truncated: false,
        method: 'readability',
        readAt: Date.now(),
      },
    });
  });

  afterEach(async () => {
    await act(async () => { mounted.splice(0).forEach((root) => root.unmount()); });
    document.body.textContent = '';
  });

  it('allow 保持普通摘要入口并启动生成', async () => {
    const container = await renderPanel();
    await act(async () => { buttonByText(container, '生成摘要').click(); });

    expect(container.textContent).not.toContain('这页内容比较零散');
    expect(mocks.runGeneration).toHaveBeenCalledOnce();
    expect(mocks.runGeneration.mock.calls[0][0]).toMatchObject({ taskType: 'summary' });
  });

  it('warn 显示风险提示，但“仍然生成摘要”可以继续', async () => {
    mocks.readiness.value = {
      decision: 'warn',
      reason: 'possibly_fragmented',
      signals: ['short-block-ratio'],
    };
    const container = await renderPanel();
    const button = buttonByText(container, '仍然生成摘要');

    expect(container.textContent).toContain('摘要可能遗漏上下文或混淆彼此独立的条目');
    expect(button.disabled).toBe(false);
    await act(async () => { button.click(); });
    expect(mocks.runGeneration).toHaveBeenCalledOnce();
  });

  it('reject 说明能力边界，不启动任务，同时保留页面问答', async () => {
    mocks.readiness.value = {
      decision: 'reject',
      reason: 'activity_feed',
      signals: ['github-profile', 'activity-markers'],
    };
    const container = await renderPanel();
    const qaInput = container.querySelector<HTMLInputElement>('#wisp-qa-input');

    expect([...container.querySelectorAll('button')]
      .some((button) => button.textContent?.includes('生成摘要'))).toBe(false);
    expect(container.textContent).toContain('这页不适合生成文章摘要');
    expect(container.textContent).toContain('避免把彼此无关的条目拼成结论');
    expect(container.textContent).toContain('仍可在下方基于快照提问，或划选具体内容处理');
    expect(qaInput?.disabled).toBe(false);
    expect(mocks.runGeneration).not.toHaveBeenCalled();
    expect(mocks.appendMessage).not.toHaveBeenCalled();
    expect(usePanelStore.getState().currentTask).toBeNull();
  });

  it('reject 同样禁用已有摘要轮次的重新生成', async () => {
    mocks.readiness.value = {
      decision: 'reject',
      reason: 'fragmented_content',
      signals: ['fragmented'],
    };
    usePanelStore.setState({
      currentTask: {
        id: 'summary-1',
        type: 'summary',
        ctx,
        status: 'success',
        retryable: true,
        source: 'GitHub profile',
      },
      streamBuffer: '旧摘要',
    });
    const container = await renderPanel();
    const regenerate = buttonByText(container, '重新生成');

    expect(regenerate.disabled).toBe(true);
    regenerate.click();
    expect(mocks.runGeneration).not.toHaveBeenCalled();
  });
});

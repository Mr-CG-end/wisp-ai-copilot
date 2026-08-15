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
  stop: vi.fn(async () => {}),
  preemptCurrent: vi.fn(),
  loadResumableSession: vi.fn(async (_ctx: unknown) => null as unknown),
}));

vi.mock('../../../core/extract/summaryReadiness', () => ({
  assessSummaryReadiness: vi.fn(() => mocks.readiness.value),
}));

vi.mock('../useTaskRunner', () => ({
  useTaskRunner: () => ({
    runGeneration: mocks.runGeneration,
    stop: mocks.stop,
    preemptCurrent: mocks.preemptCurrent,
    isStopping: false,
  }),
}));

vi.mock('../../../core/storage/db', () => ({
  DAY_MS: 86_400_000,
  DEFAULT_RETENTION_DAYS: 30,
  SNAPSHOT_TEXT_CHARS: 2000,
  db: {
    sessions: { where: () => ({ equals: () => ({ toArray: async () => [] }) }) },
  },
}));

vi.mock('../../../core/storage/cleanup', () => ({ appendMessage: mocks.appendMessage }));
vi.mock('../sessionResume', () => ({ loadResumableSession: mocks.loadResumableSession }));
vi.mock('./SnapshotStamp', () => ({ SnapshotStamp: () => <span>快照凭证</span> }));

import { usePanelStore } from '../store';
import { TaskPanel } from './TaskPanel';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ctx = { tabId: 7, url: 'https://github.com/example', epoch: 1 };
const mounted: ReturnType<typeof createRoot>[] = [];

function pageChannel(overrides: Record<string, unknown> = {}) {
  return {
    activeTab: { tabId: 7, epoch: 1 },
    adoptCtx: vi.fn(),
    boundCtx: ctx,
    consumePendingAction: vi.fn(),
    lastError: null,
    pendingAction: null,
    readActivePage: vi.fn(async () => null),
    readPage: vi.fn(async () => null),
    ...overrides,
  };
}

async function renderPanel(channelOverrides: Record<string, unknown> = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    const root = createRoot(container);
    mounted.push(root);
    root.render(<TaskPanel pageChannel={pageChannel(channelOverrides) as never} />);
  });
  return container;
}

function buttonsByText(container: HTMLElement, text: string): HTMLButtonElement[] {
  return [...container.querySelectorAll('button')]
    .filter((candidate) => candidate.textContent?.trim() === text);
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
    mocks.loadResumableSession.mockClear();
    mocks.loadResumableSession.mockResolvedValue(null);
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

/**
 * 同一个动作在面板里有多个入口是设计使然（就近可操作），但同一屏上不能出现两个。
 * 每条都同时断言「让位的那个消失了」和「留下的那个确实可用」——
 * 只验前一半的话，把最后一个入口也藏掉的回归照样能过。
 */
describe('TaskPanel 异常态入口收口', () => {
  beforeEach(() => {
    mocks.runGeneration.mockClear();
    mocks.stop.mockClear();
    mocks.preemptCurrent.mockClear();
    mocks.loadResumableSession.mockClear();
    mocks.loadResumableSession.mockResolvedValue(null);
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

  it('页面错误横幅在场时，空态不再出现第二个「读取当前页」', async () => {
    usePanelStore.setState({ page: null });
    const container = await renderPanel({
      lastError: { code: 'PAGE_INJECTION_BLOCKED', message: '浏览器不允许扩展读取此页面' },
    });

    const reads = buttonsByText(container, '读取当前页');
    expect(reads).toHaveLength(1);
    expect(reads[0].closest('.wisp-page-error-banner')).not.toBeNull();
  });

  it('跨标签横幅在场时，无快照说明行不再出现同名按钮', async () => {
    usePanelStore.setState({
      page: null,
      currentTask: {
        id: 'sel-1',
        type: 'explain',
        ctx,
        status: 'success',
        retryable: true,
        source: 'example.com · 选区',
        selectionText: '一段选中的中文',
      },
      streamBuffer: '解释结果',
    });
    const container = await renderPanel({ activeTab: { tabId: 9, epoch: 1 } });

    expect(container.querySelector('.wisp-selection-only')).not.toBeNull();
    expect(buttonsByText(container, '读取当前页')).toHaveLength(0);
    expect(buttonsByText(container, '改读当前页')).toHaveLength(1);
  });

  it('摘要轮失败时重来的入口只留轮次里的「重新生成」', async () => {
    usePanelStore.setState({
      currentTask: {
        id: 'summary-1',
        type: 'summary',
        ctx,
        status: 'error',
        retryable: true,
        source: 'GitHub profile',
      },
      streamBuffer: '半截摘要',
    });
    const container = await renderPanel();

    expect(buttonsByText(container, '生成摘要')).toHaveLength(0);
    expect(buttonByText(container, '重新生成').disabled).toBe(false);
  });

  /**
   * 与 useTaskRunner 的抢占同源：api.cancel 的回话排在 Worker 当前这整段生成后面，
   * await 它会让读取动作一起停摆十几秒，界面看着像点了没反应。
   */
  it('生成中点「读取当前页」不等 Worker 回话', async () => {
    usePanelStore.setState({
      page: null,
      currentTask: {
        id: 'summary-1',
        type: 'summary',
        ctx,
        status: 'loading',
        retryable: true,
        source: 'GitHub profile',
      },
      streamBuffer: '半截摘要',
    });
    const readActivePage = vi.fn(async () => null);
    const container = await renderPanel({ readActivePage });

    await act(async () => { buttonByText(container, '读取当前页').click(); });

    expect(mocks.preemptCurrent).toHaveBeenCalledOnce();
    expect(mocks.stop).not.toHaveBeenCalled();
    expect(readActivePage).toHaveBeenCalledOnce();
  });

  it('未绑定任何页面时不查会话库', async () => {
    await renderPanel({ boundCtx: null });
    expect(mocks.loadResumableSession).not.toHaveBeenCalled();
  });

  it('摘要轮失败但无法重跑时，动作条保留「生成摘要」，不至于一个入口都没有', async () => {
    usePanelStore.setState({
      currentTask: {
        id: 'summary-1',
        type: 'summary',
        ctx: { ...ctx, url: 'https://example.com/old' },
        status: 'error',
        retryable: true,
        source: '旧页面',
      },
      streamBuffer: '半截摘要',
    });
    const container = await renderPanel();

    expect(buttonByText(container, '重新生成').disabled).toBe(true);
    expect(buttonsByText(container, '生成摘要')).toHaveLength(1);
  });
});

/**
 * A3：关掉侧边栏、再对同一个词划词，旧行为是「对话从零开始」——
 * 面板每次挂载都是一张白纸，之前那几轮既不在 store 里，也没人去库里取。
 */
describe('TaskPanel 会话续接', () => {
  beforeEach(() => {
    mocks.runGeneration.mockClear();
    mocks.loadResumableSession.mockClear();
    mocks.loadResumableSession.mockResolvedValue(null);
    mocks.readiness.value = { decision: 'allow', signals: [] };
    usePanelStore.getState().reset();
    usePanelStore.setState({ modelStatus: 'ready', boundCtx: ctx });
  });

  afterEach(async () => {
    await act(async () => { mounted.splice(0).forEach((root) => root.unmount()); });
    document.body.textContent = '';
  });

  it('绑定到某一页时把这一页上次的对话接回轨迹', async () => {
    mocks.loadResumableSession.mockResolvedValue({
      id: 'session-1',
      title: 'GitHub profile',
      url: ctx.url,
      snapshot: undefined,
      turns: [
        { id: 'm1', type: 'explain', output: '上次的解释', selectionText: '被划中的词' },
        { id: 'm2', type: 'qa', output: '上次的回答', userInput: '这段讲了什么' },
      ],
    });
    const container = await renderPanel();

    expect(mocks.loadResumableSession).toHaveBeenCalledWith(ctx);
    expect(container.textContent).toContain('上次的解释');
    expect(container.textContent).toContain('被划中的词');
    expect(container.textContent).toContain('上次的回答');
    expect(container.textContent).toContain('这段讲了什么');
    expect(usePanelStore.getState().history.map((entry) => entry.id)).toEqual(['m1', 'm2']);
  });

  /** 重跑要拿原始上下文重新送一遍模型，而上下文没有落库。 */
  it('恢复出来的轮次不可重新生成', async () => {
    mocks.loadResumableSession.mockResolvedValue({
      id: 'session-1',
      title: 'GitHub profile',
      url: ctx.url,
      snapshot: undefined,
      turns: [{ id: 'm1', type: 'summary', output: '上次的摘要' }],
    });
    const container = await renderPanel();

    expect(buttonsByText(container, '重新生成').every((button) => button.disabled)).toBe(true);
    expect(buttonsByText(container, '复制')).toHaveLength(1);
  });

  it('没有实时快照时用存档快照顶上，追问区随之恢复', async () => {
    mocks.loadResumableSession.mockResolvedValue({
      id: 'session-1',
      title: 'GitHub profile',
      url: ctx.url,
      snapshot: {
        text: '存档下来的正文',
        charCount: 4200,
        truncated: true,
        method: 'readability' as const,
        readAt: 1000,
      },
      turns: [{ id: 'm1', type: 'summary', output: '上次的摘要' }],
    });
    const container = await renderPanel();

    expect(usePanelStore.getState().page?.text).toBe('存档下来的正文');
    expect(usePanelStore.getState().page?.charCount).toBe(4200);
    expect(container.querySelector('#wisp-qa-input')).not.toBeNull();
  });

  /** 走「读取当前页」进来的那条路径紧接着就会写一份刚读到的真快照，那份永远更准。 */
  it('已有实时快照时不拿存档覆盖', async () => {
    usePanelStore.setState({
      page: {
        ctx,
        title: 'GitHub profile',
        url: ctx.url,
        text: '刚刚读到的正文',
        charCount: 7,
        truncated: false,
        method: 'readability',
        readAt: Date.now(),
      },
    });
    mocks.loadResumableSession.mockResolvedValue({
      id: 'session-1',
      title: 'GitHub profile',
      url: ctx.url,
      snapshot: {
        text: '存档下来的正文',
        charCount: 4200,
        truncated: true,
        method: 'readability' as const,
        readAt: 1000,
      },
      turns: [{ id: 'm1', type: 'summary', output: '上次的摘要' }],
    });
    await renderPanel();

    expect(usePanelStore.getState().page?.text).toBe('刚刚读到的正文');
  });

  /** 重新读取同一页会换一个新的 boundCtx 对象（epoch 变了），按对象身份去重会反复查库。 */
  it('同一个 URL 在一次面板生命里只查一次库', async () => {
    await renderPanel();
    const root = mounted[mounted.length - 1];
    await act(async () => {
      root.render(
        <TaskPanel pageChannel={pageChannel({ boundCtx: { ...ctx, epoch: 2 } }) as never} />,
      );
    });
    expect(mocks.loadResumableSession).toHaveBeenCalledOnce();
  });

  it('换到另一个 URL 时重新查一次', async () => {
    await renderPanel();
    const root = mounted[mounted.length - 1];
    await act(async () => {
      root.render(
        <TaskPanel
          pageChannel={pageChannel({ boundCtx: { ...ctx, url: 'https://other.example/' } }) as never}
        />,
      );
    });
    expect(mocks.loadResumableSession).toHaveBeenCalledTimes(2);
  });
});

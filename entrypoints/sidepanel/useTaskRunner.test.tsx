// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cancel: vi.fn(),
  generate: vi.fn(),
}));

vi.mock('./InferenceProvider', () => ({
  useInferenceContext: () => ({
    getApi: () => ({ cancel: mocks.cancel, generate: mocks.generate }),
    recreate: vi.fn(),
  }),
}));

import { usePanelStore } from './store';
import { useTaskRunner } from './useTaskRunner';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ctx = { tabId: 1, url: 'https://example.com/a', epoch: 3 };

/** Worker 卡在 model.generate() 里的样子：消息发得出去，回不来。 */
function neverSettles<T>(): Promise<T> {
  return new Promise<T>(() => {});
}

let runner: ReturnType<typeof useTaskRunner> | null = null;

function Probe() {
  runner = useTaskRunner();
  return null;
}

async function mountRunner() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    createRoot(container).render(<Probe />);
  });
}

const flush = () => act(async () => {
  await Promise.resolve();
  await Promise.resolve();
});

describe('useTaskRunner 抢占在途任务', () => {
  beforeEach(() => {
    mocks.cancel.mockReset();
    mocks.generate.mockReset();
    runner = null;
    usePanelStore.getState().reset();
    usePanelStore.setState({ boundCtx: ctx });
  });

  /**
   * 真机 A6：生成摘要途中划词点「解释」，摘要立刻变「已停止」，新一轮却迟迟不出现。
   *
   * 成因是抢占路径 await 了 api.cancel —— 那是一次 Comlink 往返，而 Worker 此刻正卡在
   * model.generate() 里，这条消息要排到整段生成之后才被处理。于是同步执行的状态转换
   * （已停止）先落地，而建新轮次被押后到那次往返之后。
   *
   * 这条测试把 Worker 钉死在「收得到消息、回不了话」的状态，断言新一轮不依赖那次回话。
   */
  it('新一轮不等 Worker 确认中断就出现在轨迹上', async () => {
    mocks.generate.mockImplementation(() => neverSettles());
    mocks.cancel.mockImplementation(() => neverSettles());
    await mountRunner();

    void runner!.runGeneration({
      taskType: 'summary',
      untrustedData: '一段页面正文',
      ctx,
      source: '文章标题',
    });
    await flush();
    expect(usePanelStore.getState().currentTask).toMatchObject({
      type: 'summary',
      status: 'loading',
    });

    void runner!.runGeneration({
      taskType: 'explain',
      untrustedData: '选中的文字',
      selectionText: '选中的文字',
      ctx,
      source: 'example.com · 选中的文字',
    });
    await flush();

    const state = usePanelStore.getState();
    expect(mocks.cancel).toHaveBeenCalledOnce();
    expect(state.currentTask).toMatchObject({ type: 'explain', status: 'loading' });
    expect(state.history.at(-1)).toMatchObject({ type: 'summary', status: 'cancelled' });
  });

  /**
   * 抢占不等回话，但中断必须真的发出去 —— 否则被抢占的那次生成会一直算到 max_new_tokens，
   * 白占 Worker，新一轮的首字也跟着推迟。
   */
  it('被抢占的那一轮仍然收到中断，且中断针对的是它自己的 signalId', async () => {
    mocks.generate.mockImplementation(() => neverSettles());
    mocks.cancel.mockImplementation(async () => undefined);
    await mountRunner();

    void runner!.runGeneration({
      taskType: 'summary',
      untrustedData: '一段页面正文',
      ctx,
      source: '文章标题',
    });
    await flush();
    const preemptedId = usePanelStore.getState().currentTask?.id;

    void runner!.runGeneration({
      taskType: 'explain',
      untrustedData: '选中的文字',
      selectionText: '选中的文字',
      ctx,
      source: 'example.com · 选中的文字',
    });
    await flush();

    expect(mocks.cancel).toHaveBeenCalledWith(preemptedId);
    expect(usePanelStore.getState().currentTask?.id).not.toBe(preemptedId);
  });

  /** 半截内容不能因为抢占而消失：被抢占的那一轮带着已生成的文字进历史。 */
  it('被抢占的一轮把已生成的半截内容留在轨迹上', async () => {
    mocks.generate.mockImplementation(() => neverSettles());
    mocks.cancel.mockImplementation(() => neverSettles());
    await mountRunner();

    void runner!.runGeneration({
      taskType: 'summary',
      untrustedData: '一段页面正文',
      ctx,
      source: '文章标题',
    });
    await flush();
    const preemptedId = usePanelStore.getState().currentTask!.id;
    act(() => {
      usePanelStore.getState().appendStream(preemptedId, '摘要的前半截');
    });

    void runner!.runGeneration({
      taskType: 'explain',
      untrustedData: '选中的文字',
      selectionText: '选中的文字',
      ctx,
      source: 'example.com · 选中的文字',
    });
    await flush();

    expect(usePanelStore.getState().history.at(-1)?.output).toBe('摘要的前半截');
  });
});

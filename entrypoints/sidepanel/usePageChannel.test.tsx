// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePanelStore } from './store';
import { usePageChannel } from './usePageChannel';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type MessageListener = (message: unknown) => void;

function createEvent() {
  const listeners: MessageListener[] = [];
  return {
    listeners,
    addListener(listener: MessageListener) {
      listeners.push(listener);
    },
    removeListener(listener: MessageListener) {
      const index = listeners.indexOf(listener);
      if (index >= 0) listeners.splice(index, 1);
    },
  };
}

describe('usePageChannel', () => {
  beforeEach(() => {
    usePanelStore.getState().reset();
  });

  it('事务读取成功后同步 Store，并在页面导航时清除上下文', async () => {
    const runtimeMessages = createEvent();
    const portMessages = createEvent();
    const portDisconnects = createEvent();
    const port = {
      onMessage: portMessages,
      onDisconnect: portDisconnects,
      postMessage: vi.fn(() => {
        for (const listener of portMessages.listeners) {
          listener({
            type: 'EXTRACTED',
            ctx: { tabId: -1, url: 'https://example.com/article', epoch: 4 },
            title: '文章标题',
            text: '正文',
            charCount: 2,
            truncated: false,
            method: 'readability',
          });
        }
      }),
      disconnect: vi.fn(),
    };

    vi.stubGlobal('chrome', {
      runtime: {
        onMessage: runtimeMessages,
        sendMessage: vi.fn((message: { type: string }) => {
          if (message.type === 'REQUEST_ACTIVE_TAB') {
            return Promise.resolve({ tabId: 7, epoch: 4 });
          }
          return Promise.resolve({ ok: true, epoch: 4 });
        }),
      },
      tabs: {
        connect: vi.fn(() => port),
      },
    });

    let channel: ReturnType<typeof usePageChannel> | null = null;
    function Harness() {
      channel = usePageChannel();
      return null;
    }

    const container = document.createElement('div');
    const root = createRoot(container);
    await act(async () => {
      root.render(<Harness />);
    });

    const captured: {
      result: {
        ctx: { tabId: number; url: string; epoch: number };
      } | null;
    } = { result: null };
    await act(async () => {
      captured.result = await channel!.readActivePage();
    });

    const resultCtx = captured.result?.ctx;
    expect(resultCtx).toEqual({
      tabId: 7,
      url: 'https://example.com/article',
      epoch: 4,
    });
    expect(usePanelStore.getState().boundCtx).toEqual(resultCtx);

    await act(async () => {
      for (const listener of portMessages.listeners) {
        listener({ type: 'PAGE_NAVIGATED', url: 'https://example.com/next' });
      }
    });
    expect(usePanelStore.getState().boundCtx).toBeNull();

    act(() => root.unmount());
    vi.unstubAllGlobals();
  });

  it('同一个划词动作从 PANEL_READY 与广播两条路径投递，只接受一次', async () => {
    const runtimeMessages = createEvent();
    const entry = {
      id: 'action-1',
      action: 'explain' as const,
      text: '被选中的一段话',
      lang: 'zh' as const,
      ctx: { tabId: 7, url: 'https://example.com/article', epoch: 4 },
    };

    vi.stubGlobal('chrome', {
      runtime: {
        onMessage: runtimeMessages,
        sendMessage: vi.fn((message: { type: string }) => {
          if (message.type === 'PANEL_READY') {
            return Promise.resolve({ active: { tabId: 7, epoch: 4 }, pending: entry });
          }
          return Promise.resolve(null);
        }),
      },
      tabs: { connect: vi.fn() },
    });

    let channel: ReturnType<typeof usePageChannel> | null = null;
    function Harness() {
      channel = usePageChannel();
      return null;
    }

    const container = document.createElement('div');
    const root = createRoot(container);
    await act(async () => {
      root.render(<Harness />);
    });

    // 路径一：PANEL_READY 的响应体
    expect(channel!.pendingAction).toEqual(entry);

    // 路径二：同一条动作又被广播一次（SW 在面板挂载前后各投递一次是正常时序）
    await act(async () => {
      for (const listener of runtimeMessages.listeners) {
        listener({ type: 'PENDING_ACTION', ...entry });
      }
    });

    const taken: { first: unknown; second: unknown } = { first: null, second: null };
    await act(async () => {
      taken.first = channel!.consumePendingAction();
    });
    expect(taken.first).toEqual(entry);
    expect(channel!.pendingAction).toBeNull();

    // 取走之后同一 id 再广播也不该复活，否则会重复启动一次生成
    await act(async () => {
      for (const listener of runtimeMessages.listeners) {
        listener({ type: 'PENDING_ACTION', ...entry });
      }
    });
    expect(channel!.pendingAction).toBeNull();

    await act(async () => {
      taken.second = channel!.consumePendingAction();
    });
    expect(taken.second).toBeNull();

    act(() => root.unmount());
    vi.unstubAllGlobals();
  });

  it('adoptCtx 绑定的划词上下文能被 EPOCH_INVALIDATED 作废', async () => {
    const runtimeMessages = createEvent();
    vi.stubGlobal('chrome', {
      runtime: {
        onMessage: runtimeMessages,
        sendMessage: vi.fn(() => Promise.resolve({ active: null, pending: null })),
      },
      tabs: { connect: vi.fn() },
    });

    let channel: ReturnType<typeof usePageChannel> | null = null;
    function Harness() {
      channel = usePageChannel();
      return null;
    }

    const container = document.createElement('div');
    const root = createRoot(container);
    await act(async () => {
      root.render(<Harness />);
    });

    const ctx = { tabId: 7, url: 'https://example.com/article', epoch: 4 };
    await act(async () => {
      channel!.adoptCtx(ctx);
    });
    expect(usePanelStore.getState().boundCtx).toEqual(ctx);

    // 这条断言守的是「绕过 hook 直接写 store」那个坑：那样 boundCtxRef 会停在 null，
    // EPOCH_INVALIDATED 的守卫永远提前返回，绑定再也不会被作废。
    await act(async () => {
      for (const listener of runtimeMessages.listeners) {
        listener({ type: 'EPOCH_INVALIDATED', tabId: 7, epoch: 5 });
      }
    });
    expect(usePanelStore.getState().boundCtx).toBeNull();

    act(() => root.unmount());
    vi.unstubAllGlobals();
  });
});

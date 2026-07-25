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
});

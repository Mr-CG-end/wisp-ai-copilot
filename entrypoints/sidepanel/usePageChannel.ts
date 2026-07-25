import { useCallback, useEffect, useRef, useState } from 'react';
import { RequestSlot } from '../../core/messaging/requestSlot';
import type {
  ActiveTabInfo,
  BackgroundToPanel,
  ContentToPanel,
  EnsureContentScriptResult,
  ErrorCode,
  PanelToContent,
  TaskContext,
} from '../../core/messaging/types';
import { PORT_NAME } from '../../core/messaging/types';

export interface PageChannelError {
  code: ErrorCode;
  message: string;
}

export function usePageChannel() {
  const portRef = useRef<chrome.runtime.Port | null>(null);
  const requestSlotRef = useRef(new RequestSlot<ContentToPanel>());
  /** boundCtx 的同步镜像：同一个事件循环内 bind→read 时 React state 还没提交。 */
  const boundCtxRef = useRef<TaskContext | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTabInfo | null>(null);
  const [boundCtx, setBoundCtx] = useState<TaskContext | null>(null);
  const [lastError, setLastError] = useState<PageChannelError | null>(null);

  const closePort = useCallback(() => {
    const port = portRef.current;
    portRef.current = null;
    requestSlotRef.current.cancel('PORT_CLOSED');
    boundCtxRef.current = null;
    port?.disconnect();
  }, []);

  useEffect(() => {
    const onMessage = (msg: BackgroundToPanel) => {
      if (msg.type === 'ACTIVE_TAB') setActiveTab({ tabId: msg.tabId, epoch: msg.epoch });
      if (msg.type === 'EPOCH_INVALIDATED') {
        const bound = boundCtxRef.current;
        if (!bound || bound.tabId !== msg.tabId) return;
        boundCtxRef.current = null;
        requestSlotRef.current.cancel('PAGE_CHANGED');
        setBoundCtx(null);
        setLastError({ code: 'TAB_CHANGED', message: '页面已导航或关闭，旧任务已作废' });
      }
    };
    chrome.runtime.onMessage.addListener(onMessage);
    void chrome.runtime.sendMessage({ type: 'REQUEST_ACTIVE_TAB' }).then((info: ActiveTabInfo | null) => {
      if (info) setActiveTab(info);
    });
    return () => {
      chrome.runtime.onMessage.removeListener(onMessage);
      closePort();
    };
  }, [closePort]);

  /**
   * 用户显式「在本页启用 Wisp」：注入 CS 并建立 Port。
   * 返回新的 TaskContext 而不是 boolean —— 调用方紧接着要 readPage()，
   * 此时 setBoundCtx 还没被 React 提交，闭包里的 boundCtx 仍是旧值（null）。
   * 把 ctx 沿调用链显式传下去，不依赖刚 set 的 state。
   */
  const bindActiveTab = useCallback(async (): Promise<TaskContext | null> => {
    setLastError(null);
    const info: ActiveTabInfo | null = await chrome.runtime.sendMessage({ type: 'REQUEST_ACTIVE_TAB' });
    if (!info) {
      setLastError({ code: 'PAGE_INJECTION_BLOCKED', message: '没有可用的活动标签页' });
      return null;
    }
    const ensured: EnsureContentScriptResult = await chrome.runtime.sendMessage({
      type: 'ENSURE_CONTENT_SCRIPT',
      tabId: info.tabId,
    });
    if (!ensured.ok) {
      console.warn('[wisp] content script injection failed:', ensured.message);
      const message =
        ensured.code === 'PAGE_PERMISSION_REQUIRED'
          ? '尚未授权当前标签页。请在这个页面点击工具栏 Wisp 图标，然后重新读取。'
          : ensured.code === 'TAB_CHANGED'
            ? '当前标签页已切换或关闭，请重新读取。'
            : '浏览器不允许扩展读取此页面，请换一个普通网页。';
      setLastError({
        code: ensured.code,
        message,
      });
      return null;
    }

    closePort();
    const port = chrome.tabs.connect(info.tabId, { name: PORT_NAME });
    port.onMessage.addListener((msg: ContentToPanel) => {
      if (msg.type === 'PAGE_UNLOADING' || msg.type === 'PAGE_NAVIGATED') {
        boundCtxRef.current = null;
        requestSlotRef.current.cancel('PAGE_CHANGED');
        setBoundCtx(null);
        setLastError({ code: 'TAB_CHANGED', message: '页面已跳转，旧任务已作废，可重新读取本页' });
        return;
      }
      requestSlotRef.current.resolve(msg);
    });
    port.onDisconnect.addListener(() => {
      if (portRef.current !== port) return;
      portRef.current = null;
      boundCtxRef.current = null;
      requestSlotRef.current.cancel('PORT_CLOSED');
      setBoundCtx(null);
    });
    portRef.current = port;

    const ctx: TaskContext = { tabId: info.tabId, url: '', epoch: ensured.epoch };
    setActiveTab(info);
    setBoundCtx(ctx);
    boundCtxRef.current = ctx;        // 供本轮同步链路使用，不等 React 提交
    return ctx;
  }, [closePort]);

  /** 发一条 Port 消息并等待对应回复；同一时刻只允许一个在途请求。 */
  const request = useCallback(
    (msg: PanelToContent, timeoutMs = 8000): Promise<ContentToPanel> => {
      const port = portRef.current;
      if (!port) return Promise.reject(new Error('PORT_CLOSED'));
      if (requestSlotRef.current.busy) return Promise.reject(new Error('PORT_BUSY'));

      const response = requestSlotRef.current.start(timeoutMs);
      try {
        port.postMessage(msg);
      } catch {
        requestSlotRef.current.cancel('PORT_CLOSED');
      }
      return response;
    },
    [],
  );

  /** `ctx` 可由调用方显式传入（刚 bind 完的那一轮），否则用当前绑定。 */
  const readPage = useCallback(
    async (reason: 'initial' | 'reread', ctx?: TaskContext) => {
      const bound = ctx ?? boundCtxRef.current;
      if (!bound) throw new Error('NOT_BOUND');
      const reply = await request({ type: 'EXTRACT', reason, epoch: bound.epoch });
      if (reply.type === 'ERROR') {
        setLastError({ code: reply.code, message: reply.message });
        return null;
      }
      if (reply.type !== 'EXTRACTED') return null;
      const next: TaskContext = { ...reply.ctx, tabId: bound.tabId };
      setBoundCtx(next);
      boundCtxRef.current = next;
      return { ...reply, ctx: next };
    },
    [request],
  );

  const requestSelection = useCallback(
    async (ctx?: TaskContext) => {
      const bound = ctx ?? boundCtxRef.current;
      if (!bound) throw new Error('NOT_BOUND');
      const reply = await request({ type: 'GET_SELECTION', epoch: bound.epoch });
      return reply.type === 'SELECTION' ? { ...reply, ctx: { ...reply.ctx, tabId: bound.tabId } } : null;
    },
    [request],
  );

  return { activeTab, boundCtx, bindActiveTab, readPage, requestSelection, lastError, setLastError };
}

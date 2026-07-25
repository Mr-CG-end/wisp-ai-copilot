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
import { usePanelStore } from './store';

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
  const [boundCtx, setBoundCtxState] = useState<TaskContext | null>(null);
  const [lastError, setLastError] = useState<PageChannelError | null>(null);

  const commitBoundCtx = useCallback((ctx: TaskContext | null) => {
    boundCtxRef.current = ctx;
    setBoundCtxState(ctx);
    const store = usePanelStore.getState();
    store.setBoundCtx(ctx);
    if (!ctx && store.currentTask?.status === 'loading') {
      store.failTask(store.currentTask.id, {
        code: 'TAB_CHANGED',
        message: '页面已刷新、跳转或断开，旧任务已停止接收内容。',
        retryable: true,
      });
    }
  }, []);

  const closePort = useCallback(() => {
    const port = portRef.current;
    portRef.current = null;
    requestSlotRef.current.cancel('PORT_CLOSED');
    commitBoundCtx(null);
    port?.disconnect();
  }, [commitBoundCtx]);

  useEffect(() => {
    const onMessage = (msg: BackgroundToPanel) => {
      if (msg.type === 'ACTIVE_TAB') setActiveTab({ tabId: msg.tabId, epoch: msg.epoch });
      if (msg.type === 'EPOCH_INVALIDATED') {
        const bound = boundCtxRef.current;
        if (!bound || bound.tabId !== msg.tabId) return;
        requestSlotRef.current.cancel('PAGE_CHANGED');
        commitBoundCtx(null);
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
  }, [closePort, commitBoundCtx]);

  /**
   * 用户显式「在本页启用 Wisp」：注入 CS 并建立 Port。
   * 返回新的 TaskContext 而不是 boolean。
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
        requestSlotRef.current.cancel('PAGE_CHANGED');
        commitBoundCtx(null);
        setLastError({ code: 'TAB_CHANGED', message: '页面已跳转，旧任务已作废，可重新读取本页' });
        return;
      }
      requestSlotRef.current.resolve(msg);
    });
    port.onDisconnect.addListener(() => {
      if (portRef.current !== port) return;
      portRef.current = null;
      requestSlotRef.current.cancel('PORT_CLOSED');
      commitBoundCtx(null);
    });
    portRef.current = port;

    const ctx: TaskContext = { tabId: info.tabId, url: '', epoch: ensured.epoch };
    setActiveTab(info);
    commitBoundCtx(ctx);
    return ctx;
  }, [closePort, commitBoundCtx]);

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
      setLastError(null);
      const bound = ctx ?? boundCtxRef.current;
      if (!bound) throw new Error('NOT_BOUND');
      const reply = await request({ type: 'EXTRACT', reason, epoch: bound.epoch });
      if (reply.type === 'ERROR') {
        setLastError({ code: reply.code, message: reply.message });
        return null;
      }
      if (reply.type !== 'EXTRACTED') return null;
      const next: TaskContext = { ...reply.ctx, tabId: bound.tabId };
      commitBoundCtx(next);
      return { ...reply, ctx: next };
    },
    [commitBoundCtx, request],
  );

  /**
   * 候选页面事务式读取：
   * 成功后提交新 Port 与 boundCtx，失败时不影响已有绑定与页面快照。
   */
  const readActivePage = useCallback(async (): Promise<{
    ctx: TaskContext;
    title: string;
    text: string;
    charCount: number;
    truncated: boolean;
    method: 'readability' | 'heuristic';
  } | null> => {
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
      const message =
        ensured.code === 'PAGE_PERMISSION_REQUIRED'
          ? '尚未授权当前标签页。请在这个页面点击工具栏 Wisp 图标，然后重新读取。'
          : ensured.code === 'TAB_CHANGED'
            ? '当前标签页已切换或关闭，请重新读取。'
            : '浏览器不允许扩展读取此页面，请换一个普通网页。';
      setLastError({ code: ensured.code, message });
      return null;
    }

    let candidatePort: chrome.runtime.Port | null = null;
    try {
      candidatePort = chrome.tabs.connect(info.tabId, { name: PORT_NAME });
    } catch {
      setLastError({ code: 'PAGE_INJECTION_BLOCKED', message: '连接候选页面失败' });
      return null;
    }

    const candidateSlot = new RequestSlot<ContentToPanel>();
    candidatePort.onMessage.addListener((msg: ContentToPanel) => {
      candidateSlot.resolve(msg);
    });

    try {
      const responsePromise = candidateSlot.start(8000);
      candidatePort.postMessage({ type: 'EXTRACT', reason: 'initial', epoch: ensured.epoch });
      const reply = await responsePromise;

      if (reply.type === 'ERROR') {
        setLastError({ code: reply.code, message: reply.message });
        candidatePort.disconnect();
        return null;
      }
      if (reply.type !== 'EXTRACTED') {
        candidatePort.disconnect();
        return null;
      }

      // 提取成功！事务提交
      closePort();

      const nextCtx: TaskContext = { ...reply.ctx, tabId: info.tabId };
      candidatePort.onMessage.addListener((msg: ContentToPanel) => {
        if (msg.type === 'PAGE_UNLOADING' || msg.type === 'PAGE_NAVIGATED') {
          requestSlotRef.current.cancel('PAGE_CHANGED');
          commitBoundCtx(null);
          setLastError({ code: 'TAB_CHANGED', message: '页面已跳转，旧任务已作废，可重新读取本页' });
          return;
        }
        requestSlotRef.current.resolve(msg);
      });
      candidatePort.onDisconnect.addListener(() => {
        if (portRef.current !== candidatePort) return;
        portRef.current = null;
        requestSlotRef.current.cancel('PORT_CLOSED');
        commitBoundCtx(null);
      });

      portRef.current = candidatePort;
      commitBoundCtx(nextCtx);

      return {
        ctx: nextCtx,
        title: reply.title,
        text: reply.text,
        charCount: reply.charCount,
        truncated: reply.truncated,
        method: reply.method,
      };
    } catch {
      candidatePort.disconnect();
      setLastError({ code: 'PAGE_INJECTION_BLOCKED', message: '提取候选页面正文超时或失败' });
      return null;
    }
  }, [closePort, commitBoundCtx]);

  const requestSelection = useCallback(
    async (ctx?: TaskContext) => {
      const bound = ctx ?? boundCtxRef.current;
      if (!bound) throw new Error('NOT_BOUND');
      const reply = await request({ type: 'GET_SELECTION', epoch: bound.epoch });
      return reply.type === 'SELECTION' ? { ...reply, ctx: { ...reply.ctx, tabId: bound.tabId } } : null;
    },
    [request],
  );

  return { activeTab, boundCtx, bindActiveTab, readPage, readActivePage, requestSelection, lastError, setLastError };
}

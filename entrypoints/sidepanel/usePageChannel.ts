import { useCallback, useEffect, useRef, useState } from 'react';
import { RequestSlot } from '../../core/messaging/requestSlot';
import type {
  ActiveTabInfo,
  BackgroundToPanel,
  ContentToPanel,
  EnsureContentScriptResult,
  ErrorCode,
  PanelReadyResult,
  PanelToContent,
  PendingActionEntry,
  TaskContext,
  Uuid,
} from '../../core/messaging/types';
import { PORT_NAME } from '../../core/messaging/types';
import { usePanelStore } from './store';

export interface PageChannelError {
  code: ErrorCode;
  message: string;
}

/**
 * 诊断日志：页面通道被判失效时打出来源。
 *
 * 六个调用点全都会 commitBoundCtx(null)，而那会顺带把在途轮次判成失败并弹出
 * 「页面读取已中断」——用户看到的现象一模一样，来源却完全不同（epoch 广播 /
 * Port 导航通知 / Port 断开 / 主动换页）。不标来源就无从分辨。DEV 构建专用。
 */
function logChannelInvalidation(
  source: string,
  bound: TaskContext | null,
  detail?: Record<string, unknown>,
): void {
  if (!import.meta.env.DEV) return;
  const state = usePanelStore.getState();
  console.debug('[wisp:diag] 页面通道失效', {
    source,
    boundCtx: bound,
    currentTaskId: state.currentTask?.id ?? null,
    currentStatus: state.currentTask?.status ?? null,
    ...detail,
  });
}

export function usePageChannel() {
  const portRef = useRef<chrome.runtime.Port | null>(null);
  const requestSlotRef = useRef(new RequestSlot<ContentToPanel>());
  /** boundCtx 的同步镜像：同一个事件循环内 bind→read 时 React state 还没提交。 */
  const boundCtxRef = useRef<TaskContext | null>(null);
  /**
   * 已投递过的划词动作 id。
   *
   * 划词有两条投递路径：面板已开时走 PENDING_ACTION 广播，面板冷启动时走
   * PANEL_READY 的响应体。两条路径在本 hook 汇合，去重就必须放在这个最近共同点——
   * 放进 store 会把「一次性投递」变成持久状态；而面板重新挂载时这个集合该清空，
   * 恰恰是 useRef 的默认行为（新面板本来就该重新接收 SW 里仍在有效期内的动作）。
   */
  const seenActionIdsRef = useRef<Set<Uuid>>(new Set());
  /** pendingAction 的同步镜像：consume 必须在同一次提交里就生效，见 consumePendingAction。 */
  const pendingActionRef = useRef<PendingActionEntry | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTabInfo | null>(null);
  const [boundCtx, setBoundCtxState] = useState<TaskContext | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingActionEntry | null>(null);
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

  /**
   * 让面板绑定到一个不是自己 bind 出来的上下文（当前只有划词动作会用）。
   *
   * 必须走 commitBoundCtx，绝不能直接 store.setBoundCtx(ctx)：store 与本 hook
   * 各持一份 boundCtx，只有 commitBoundCtx 同写两份。绕过 hook 会让 boundCtxRef
   * 停在 null，于是 onMessage 里 EPOCH_INVALIDATED 的守卫
   * `if (!bound || bound.tabId !== msg.tabId) return` 永远提前返回 ——
   * 那个标签页刷新之后，划词任务的绑定再也不会被作废。
   */
  const adoptCtx = useCallback((ctx: TaskContext) => {
    commitBoundCtx(ctx);
  }, [commitBoundCtx]);

  const offerPendingAction = useCallback((entry: PendingActionEntry) => {
    if (import.meta.env.DEV) {
      console.debug('[wisp:diag] 收到划词动作', {
        id: entry.id,
        action: entry.action,
        ctx: entry.ctx,
        duplicate: seenActionIdsRef.current.has(entry.id),
      });
    }
    if (seenActionIdsRef.current.has(entry.id)) return;
    seenActionIdsRef.current.add(entry.id);
    pendingActionRef.current = entry;
    setPendingAction(entry);
  }, []);

  /**
   * 取走待执行的划词动作，取走即清。
   *
   * 读的是 ref 而不是 state：执行发生在消费方的 effect 里，React 18 StrictMode 下
   * 挂载 effect 会跑两次，两次落在同一次提交内、state 还没刷新。ref 能让第二次
   * 直接拿到 null，从而保证「一个动作只启动一次生成」。
   */
  const consumePendingAction = useCallback((): PendingActionEntry | null => {
    const entry = pendingActionRef.current;
    if (!entry) return null;
    pendingActionRef.current = null;
    setPendingAction(null);
    return entry;
  }, []);

  const closePort = useCallback(() => {
    const port = portRef.current;
    logChannelInvalidation('closePort', boundCtxRef.current, { hadPort: Boolean(port) });
    portRef.current = null;
    requestSlotRef.current.cancel('PORT_CLOSED');
    commitBoundCtx(null);
    port?.disconnect();
  }, [commitBoundCtx]);

  useEffect(() => {
    const onMessage = (msg: BackgroundToPanel) => {
      if (msg.type === 'ACTIVE_TAB') setActiveTab({ tabId: msg.tabId, epoch: msg.epoch });
      if (msg.type === 'PENDING_ACTION') {
        const { type: _type, ...entry } = msg;
        offerPendingAction(entry);
      }
      if (msg.type === 'EPOCH_INVALIDATED') {
        const bound = boundCtxRef.current;
        if (!bound || bound.tabId !== msg.tabId) return;
        logChannelInvalidation('EPOCH_INVALIDATED', bound, {
          msgTabId: msg.tabId,
          msgEpoch: msg.epoch,
        });
        requestSlotRef.current.cancel('PAGE_CHANGED');
        commitBoundCtx(null);
        setLastError({ code: 'TAB_CHANGED', message: '页面已导航或关闭，旧任务已作废' });
      }
    };
    // 监听必须先于握手注册：SW 可能在响应 PANEL_READY 之前就广播了新的划词动作，
    // 顺序反过来那一条就永远收不到（两条路径都带 id，重复投递由 offerPendingAction 兜住）。
    chrome.runtime.onMessage.addListener(onMessage);
    // PANEL_READY 同时回活动标签与暂存的划词动作，取代原先单独的 REQUEST_ACTIVE_TAB。
    void chrome.runtime
      .sendMessage({ type: 'PANEL_READY' })
      .then((result: PanelReadyResult | undefined) => {
        if (!result) return;
        if (result.active) setActiveTab(result.active);
        if (result.pending) offerPendingAction(result.pending);
      })
      .catch(() => undefined);
    return () => {
      chrome.runtime.onMessage.removeListener(onMessage);
      closePort();
    };
  }, [closePort, commitBoundCtx, offerPendingAction]);

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
        logChannelInvalidation(`Port:${msg.type}`, boundCtxRef.current, { via: 'bindActiveTab' });
        requestSlotRef.current.cancel('PAGE_CHANGED');
        commitBoundCtx(null);
        setLastError({ code: 'TAB_CHANGED', message: '页面已跳转，旧任务已作废，可重新读取本页' });
        return;
      }
      requestSlotRef.current.resolve(msg);
    });
    port.onDisconnect.addListener(() => {
      if (portRef.current !== port) return;
      logChannelInvalidation('Port:onDisconnect', boundCtxRef.current, { via: 'bindActiveTab' });
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
          logChannelInvalidation(`Port:${msg.type}`, boundCtxRef.current, { via: 'readActivePage' });
          requestSlotRef.current.cancel('PAGE_CHANGED');
          commitBoundCtx(null);
          setLastError({ code: 'TAB_CHANGED', message: '页面已跳转，旧任务已作废，可重新读取本页' });
          return;
        }
        requestSlotRef.current.resolve(msg);
      });
      candidatePort.onDisconnect.addListener(() => {
        if (portRef.current !== candidatePort) return;
        logChannelInvalidation('Port:onDisconnect', boundCtxRef.current, { via: 'readActivePage' });
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

  return {
    activeTab,
    boundCtx,
    adoptCtx,
    pendingAction,
    consumePendingAction,
    bindActiveTab,
    readPage,
    readActivePage,
    requestSelection,
    lastError,
    setLastError,
  };
}

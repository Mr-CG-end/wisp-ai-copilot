import { EPOCH_STORAGE_KEY, EpochRegistry } from '../core/messaging/epoch';
import { classifyPageInjectionError } from '../core/messaging/injectionError';
import { isSamePageTarget } from '../core/messaging/navigation';
import { PendingActionStore } from '../core/messaging/pending';
import { purgeByTab, purgeExpired } from '../core/storage/cleanup';
import { db, DEFAULT_RETENTION_DAYS } from '../core/storage/db';
import type {
  ActiveTabInfo,
  BackgroundToPanel,
  ContentToBackground,
  EnsureContentScriptResult,
  PanelReadyResult,
  PanelToBackground,
} from '../core/messaging/types';

/** WXT 把 entrypoints/content.ts 编译到该路径；executeScript 注入用。 */
const CONTENT_SCRIPT_FILE = 'content-scripts/content.js';

export default defineBackground(() => {
  const epochs = new EpochRegistry();
  const pending = new PendingActionStore();

  void purgeExpired(db, Date.now())
    .catch((error) => console.error('[wisp] purgeExpired', error));

  // MV3 Service Worker 空闲即回收。epoch 存 chrome.storage.session：
  // 它跨 SW 重启保留、随浏览器会话结束清空 —— 与 tabId 的生命周期正好对齐。
  const hydrated = chrome.storage.session
    .get(EPOCH_STORAGE_KEY)
    .then((data) => epochs.restore(data?.[EPOCH_STORAGE_KEY]))
    .catch((error) => console.error('[wisp] epoch restore', error));

  function persistEpochs(): void {
    void chrome.storage.session
      .set({ [EPOCH_STORAGE_KEY]: epochs.toJSON() })
      .catch((error) => console.error('[wisp] epoch persist', error));
  }

  /** 面板可能没开，广播失败是正常情况，静默吞掉。 */
  function broadcast(msg: BackgroundToPanel): void {
    chrome.runtime.sendMessage(msg).catch(() => undefined);
  }

  /**
   * `source` 只服务诊断：epoch 递增有两条通道（Chrome 的 tabs.onUpdated 与
   * Content Script 自报的 SPA 导航），两者引发的面板现象完全一样——在途轮次转失败、
   * 弹「页面读取已中断」——但成因和修法不同，不标来源在 console 里分不出是哪一条。
   */
  function invalidateEpoch(tabId: number, source: string): void {
    const epoch = epochs.bump(tabId);
    if (import.meta.env.DEV) {
      console.debug('[wisp:diag] epoch 递增', { tabId, epoch, source });
    }
    persistEpochs();
    broadcast({ type: 'EPOCH_INVALIDATED', tabId, epoch });
  }

  /**
   * 声明式注入只对「注册之后加载的页面」生效。扩展安装或重新加载的那一刻，用户手上
   * 已经打开的标签页里没有 Content Script，不刷新就不能划词 —— 开发时每点一次
   * 「重新加载扩展」，正在真机核对的那一批页面会集体失效，很容易被误判成 bug。
   *
   * 这里补一次注入把它们接上。受限页面（chrome://、Web Store、PDF 查看器）注入失败，
   * 忽略即可；重复注入由 CS 自己的 window.__wisp 守卫挡掉。
   */
  chrome.runtime.onInstalled.addListener(() => {
    void chrome.tabs
      .query({ url: ['http://*/*', 'https://*/*'] })
      .then((tabs) => {
        for (const tab of tabs) {
          if (tab.id === undefined) continue;
          void chrome.scripting
            .executeScript({ target: { tabId: tab.id }, files: [CONTENT_SCRIPT_FILE] })
            .catch(() => undefined);
        }
      })
      .catch((error) => console.error('[wisp] backfill inject', error));
  });

  chrome.action.onClicked.addListener((tab) => {
    if (tab.windowId === undefined) return;
    if (tab.id !== undefined) {
      // 常驻注入之后这里通常只是一次 PING 探活。仍然保留：用户若在
      // chrome://extensions 把站点访问收窄为「点击时」，声明式注入不会发生，
      // action 点击授予的 activeTab 是这一页唯一的注入机会。
      void ensureContentScript(tab.id);
    }
    chrome.sidePanel
      .open({ windowId: tab.windowId })
      .catch((error) => console.error('[wisp] sidePanel.open', error));
  });

  // 导航开始即作废该标签页的在途任务。
  // SPA 的 History 导航不一定触发本事件，由 Content Script 的 PAGE_NAVIGATED 补齐（Task 4）。
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status !== 'loading') return;
    void hydrated.then(() => {
      invalidateEpoch(tabId, 'tabs.onUpdated:loading');
    });
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    void hydrated.then(() => {
      epochs.forget(tabId);
      persistEpochs();
      broadcast({ type: 'EPOCH_INVALIDATED', tabId, epoch: -1 });
    });
    void chrome.storage.local
      .get('retentionDays')
      .then(({ retentionDays = DEFAULT_RETENTION_DAYS }) => {
        if (retentionDays === 0) return purgeByTab(db, tabId);
        return undefined;
      })
      .catch((error) => console.error('[wisp] purgeByTab', error));
  });

  chrome.tabs.onActivated.addListener(({ tabId }) => {
    void hydrated.then(() => broadcast({ type: 'ACTIVE_TAB', tabId, epoch: epochs.get(tabId) }));
  });

  async function queryActiveTab(): Promise<ActiveTabInfo | null> {
    await hydrated;
    // Service Worker 没有「当前窗口」概念，必须用 lastFocusedWindow
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab?.id) return null;
    return { tabId: tab.id, epoch: epochs.get(tab.id) };
  }

  /** 先探活再注入，避免重复注入；注入失败即视为受限页面。 */
  async function ensureContentScript(tabId: number): Promise<EnsureContentScriptResult> {
    await hydrated;
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'PING' });
      return { ok: true, epoch: epochs.get(tabId) };
    } catch {
      /* 尚未注入，继续走 executeScript */
    }
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: [CONTENT_SCRIPT_FILE] });
      return { ok: true, epoch: epochs.get(tabId) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        code: classifyPageInjectionError(message),
        message,
      };
    }
  }

  chrome.runtime.onMessage.addListener(
    (msg: PanelToBackground | ContentToBackground, sender, sendResponse) => {
      switch (msg.type) {
        case 'PANEL_READY': {
          void (async () => {
            const result: PanelReadyResult = {
              active: await queryActiveTab(),
              pending: pending.take(Date.now()),
            };
            sendResponse(result);
          })();
          return true;
        }
        case 'REQUEST_ACTIVE_TAB': {
          void queryActiveTab().then(sendResponse);
          return true;
        }
        case 'ENSURE_CONTENT_SCRIPT': {
          void ensureContentScript(msg.tabId).then(sendResponse);
          return true;
        }
        case 'PAGE_NAVIGATED': {
          const tabId = sender.tab?.id;
          if (tabId === undefined) return false;
          void hydrated.then(() => invalidateEpoch(tabId, 'content:PAGE_NAVIGATED'));
          return false;
        }
        case 'TOOLBAR_ACTION': {
          const tabId = sender.tab?.id;
          if (tabId === undefined) return false;
          // sidePanel.open() 必须在任何 await 之前同步发出。
          // Chrome 只在「用户手势事件的同步调用栈」内认这次调用；一旦先 await
          // （这里原本是 await hydrated），手势凭证就过期，open() 报
          // "must be called in response to a user gesture"，面板永远打不开。
          // 与下面的 pending 簿记没有因果依赖：面板挂载后会用 PANEL_READY 主动拉取，
          // 簿记晚几毫秒到达没有影响。
          chrome.sidePanel
            .open({ tabId })
            .catch((error) => {
              // 原文照打：核对清单 A1 要的就是这句 rejection message，它决定
              // 「用户手势能否跨 CS→SW 往返保持有效」这条未决项的结论。
              console.error('[wisp] sidePanel.open (TOOLBAR_ACTION)', error);
              chrome.tabs.sendMessage(tabId, { type: 'OPEN_PANEL_HINT' }).catch(() => undefined);
            });
          // sender.tab.url 在常驻主机权限下可读，取值也必须在同步段完成。
          const senderUrl = sender.tab?.url;
          void hydrated.then(() => {
            // epoch 时序的廉价双保险：CS 报的选区 URL 与 SW 眼里这个标签页的
            // 当前 URL 不是同一页，说明选区与点击之间发生了导航，此时 epochs.get()
            // 会填上新页面的 epoch，任务看起来「当前有效」实则用的是旧选区。丢弃即可。
            if (senderUrl && !isSamePageTarget(msg.url, senderUrl)) {
              // 这条分支原本完全静默：动作既不入 pending 也不广播，面板永远收不到，
              // 用户看到的现象是「点了工具条，什么都没发生」。不打日志就无从发现
              // 问题出在 SW 而不是面板。
              if (import.meta.env.DEV) {
                console.debug('[wisp:diag] 划词动作被丢弃：选区 URL 与标签页当前 URL 不同页', {
                  action: msg.action,
                  selectionUrl: msg.url,
                  senderUrl,
                  tabId,
                });
              }
              return;
            }
            const entry = {
              id: crypto.randomUUID(),
              action: msg.action,
              text: msg.text,
              lang: msg.lang,
              ctx: { tabId, url: msg.url, epoch: epochs.get(tabId) },
            };
            pending.put(entry, Date.now());
            if (import.meta.env.DEV) {
              console.debug('[wisp:diag] 划词动作已投递', {
                id: entry.id,
                action: entry.action,
                ctx: entry.ctx,
              });
            }
            broadcast({ type: 'PENDING_ACTION', ...entry });
          });
          return false;
        }
        default:
          return false;
      }
    },
  );
});

import { EPOCH_STORAGE_KEY, EpochRegistry } from '../core/messaging/epoch';
import { PendingActionStore } from '../core/messaging/pending';
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

  chrome.action.onClicked.addListener((tab) => {
    if (tab.windowId === undefined) return;
    chrome.sidePanel
      .open({ windowId: tab.windowId })
      .catch((error) => console.error('[wisp] sidePanel.open', error));
  });

  // 导航开始即作废该标签页的在途任务。
  // SPA 的 History 导航不一定触发本事件，由 Content Script 的 PAGE_NAVIGATED 补齐（Task 4）。
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status !== 'loading') return;
    void hydrated.then(() => {
      const epoch = epochs.bump(tabId);
      persistEpochs();
      broadcast({ type: 'EPOCH_INVALIDATED', tabId, epoch });
    });
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    void hydrated.then(() => {
      epochs.forget(tabId);
      persistEpochs();
      broadcast({ type: 'EPOCH_INVALIDATED', tabId, epoch: -1 });
    });
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
      return {
        ok: false,
        code: 'PAGE_INJECTION_BLOCKED',
        message: error instanceof Error ? error.message : String(error),
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
        case 'TOOLBAR_ACTION': {
          const tabId = sender.tab?.id;
          if (tabId === undefined) return false;
          void hydrated.then(() => {
            const entry = {
              id: crypto.randomUUID(),
              action: msg.action,
              text: msg.text,
              ctx: { tabId, url: msg.url, epoch: epochs.get(tabId) },
            };
            pending.put(entry, Date.now());
            broadcast({ type: 'PENDING_ACTION', ...entry });
            chrome.sidePanel
              .open({ tabId })
              .catch(() => {
                chrome.tabs.sendMessage(tabId, { type: 'OPEN_PANEL_HINT' }).catch(() => undefined);
              });
          });
          return false;
        }
        default:
          return false;
      }
    },
  );
});

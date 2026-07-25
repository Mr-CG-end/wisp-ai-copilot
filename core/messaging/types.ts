import type { Lang, SelectionAction, Uuid } from '../inference/contract';

export type { Lang, SelectionAction, Uuid };

/**
 * Side Panel ↔ Content Script 的 Port 名。
 * 放在 core 而不是 content.ts —— Panel 若从 content entrypoint 导入常量，
 * 会把 defineContentScript 的副作用与 readability 一起打进 Panel bundle。
 */
export const PORT_NAME = 'wisp-page';

/** 任务归属：Panel 应用任何页面数据或流式结果前都要校验它仍然当前。 */
export interface TaskContext {
  tabId: number;
  url: string;      // 由 Content Script 用 location.href 填写
  epoch: number;    // 由 Service Worker 递增
}

export type ErrorCode =
  | 'PAGE_PERMISSION_REQUIRED' | 'PAGE_INJECTION_BLOCKED' | 'PAGE_NO_CONTENT' | 'PAGE_TOO_LONG'
  | 'WEBGPU_UNAVAILABLE' | 'WEBGPU_CRASH'
  | 'DOWNLOAD_FAILED' | 'DOWNLOAD_CANCELLED' | 'CACHE_CORRUPT'
  | 'OFFLINE_NO_MODEL' | 'STORAGE_FULL' | 'TAB_CHANGED'
  | 'WORKER_ERROR' | 'FILL_FAILED';

// —— Port：Side Panel → Content Script —— //
export type PanelToContent =
  | { type: 'EXTRACT'; reason: 'initial' | 'reread'; epoch: number }
  | { type: 'GET_SELECTION'; epoch: number };

// —— Port：Content Script → Side Panel —— //
export type ContentToPanel =
  | { type: 'EXTRACTED'; ctx: TaskContext; title: string; text: string;
      charCount: number; truncated: boolean; method: 'readability' | 'heuristic' }
  | { type: 'SELECTION'; ctx: TaskContext; text: string; lang: Lang }
  | { type: 'PAGE_UNLOADING' }
  // SPA 的 History 导航不销毁 Content Script，也不一定触发 tabs.onUpdated(status:'loading')，
  // 因此由 CS 自己上报「同一文档内换了页面」，Panel 据此作废旧任务。
  | { type: 'PAGE_NAVIGATED'; url: string }
  | { type: 'ERROR'; code: ErrorCode; message: string };

// —— runtime：Content Script → Service Worker —— //
export type ContentToBackground =
  | { type: 'PING' }                                    // SW 探活，CS 回 { type: 'PONG' }
  | { type: 'PAGE_NAVIGATED'; url: string }              // SPA 同文档导航，通知 SW 递增 epoch
  | { type: 'TOOLBAR_ACTION'; action: SelectionAction; text: string; url: string; lang: Lang };

// —— runtime：Side Panel → Service Worker —— //
export type PanelToBackground =
  | { type: 'PANEL_READY' }
  | { type: 'REQUEST_ACTIVE_TAB' }
  | { type: 'ENSURE_CONTENT_SCRIPT'; tabId: number }
  | { type: 'TAB_CLOSED_CLEANUP'; tabId: number };      // 预留给 Task 9 的手动清理触发

// —— runtime：Service Worker → Side Panel（广播）—— //
export type BackgroundToPanel =
  | { type: 'ACTIVE_TAB'; tabId: number; epoch: number }
  // 面板已打开时的主投递路径；面板冷启动时走 PANEL_READY 拉取。两条路径都带 id，Panel 按 id 去重。
  | { type: 'PENDING_ACTION'; id: Uuid; action: SelectionAction; text: string; ctx: TaskContext }
  | { type: 'EPOCH_INVALIDATED'; tabId: number; epoch: number };

// —— runtime 响应体（sendResponse 的形状，Panel 侧按此解构）—— //
export interface ActiveTabInfo { tabId: number; epoch: number; }
export type EnsureContentScriptResult =
  | { ok: true; epoch: number }
  | { ok: false; code: ErrorCode; message: string };
export interface PanelReadyResult {
  active: ActiveTabInfo | null;
  pending: PendingActionEntry | null;
}

/** 划词动作的投递单元；`id` 让「广播」与「PANEL_READY 拉取」两条路径可以安全去重。 */
export interface PendingActionEntry {
  id: Uuid;
  action: SelectionAction;
  text: string;
  ctx: TaskContext;
}

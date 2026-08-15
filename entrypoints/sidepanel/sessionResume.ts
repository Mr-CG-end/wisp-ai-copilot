import { db, type SessionSnapshot } from '../../core/storage/db';
import {
  messagesToTurns,
  pickResumableSession,
  type RestoredTurn,
} from '../../core/storage/sessionRestore';
import { hasTabSession } from '../../core/storage/tabSessions';
import type { TaskContext } from '../../core/messaging/types';

export interface ResumableSession {
  id: string;
  title: string;
  url: string;
  snapshot?: SessionSnapshot;
  turns: RestoredTurn[];
}

/**
 * 找出「这个标签页的这一页」上次聊到哪儿了。
 *
 * 三道门依次收窄，缺一不可：
 * 1. `hasTabSession` —— 标签页还活着，且是本次浏览器会话里的同一个标签页。
 *    没有它，浏览器重启后被复用的 tabId 会接上一条几天前的对话。
 * 2. `pickResumableSession` —— 同一个 tabId 下按 URL 精确匹配，多条取最近。
 * 3. `turns.length` —— 一条没有成轮消息的空会话不值得恢复，返回 null 让面板保持空态。
 *
 * 隐身窗口从不落库（persistGeneration 那侧就跳过了），这里同样直接返回。
 */
export async function loadResumableSession(ctx: TaskContext): Promise<ResumableSession | null> {
  if (chrome.extension.inIncognitoContext) return null;
  if (!ctx.url) return null;
  if (!(await hasTabSession(ctx.tabId))) return null;

  const candidates = await db.sessions.where('tabId').equals(ctx.tabId).toArray();
  const session = pickResumableSession(candidates, ctx.url);
  if (!session) return null;

  const turns = messagesToTurns(await db.messages.where('sessionId').equals(session.id).toArray());
  if (turns.length === 0) return null;

  return {
    id: session.id,
    title: session.title,
    url: session.url,
    snapshot: session.snapshot,
    turns,
  };
}

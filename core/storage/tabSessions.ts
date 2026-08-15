/**
 * 「标签页 → 它当前所在的会话」索引，存放在 `chrome.storage.session`。
 *
 * 这份索引唯一的判据作用是把**续接窗口钉在标签页的这一次生命上**：
 * `chrome.storage.session` 随浏览器会话结束清空，Service Worker 又会在
 * `tabs.onRemoved` 里删掉对应条目——于是「浏览器重启后 tabId 被复用」与
 * 「这个标签页早就关了」两种情况都不会误接上一条陈年对话，而 IndexedDB 里的记录
 * 仍按保留期留着，供设置页的会话列表回看。
 *
 * 它**不是查询键**：一个标签页走过 A→B→A，索引里只留得下最后一条，按它查会漏掉 A。
 * 接哪一条会话由 IndexedDB 按 `(tabId, url)` 取最近一条决定，索引只回答
 * 「这个 tabId 还算不算数」。条目里仍存 sessionId/url，是为了它自身可读——
 * 在 DevTools 里一眼能看出某个标签页正接在哪条会话上。
 */
export const TAB_SESSION_INDEX_KEY = 'wisp:tab-sessions';

export interface TabSessionEntry {
  sessionId: string;
  url: string;
}

export type TabSessionIndex = Record<string, TabSessionEntry>;

async function readIndex(): Promise<TabSessionIndex> {
  const stored = await chrome.storage.session.get(TAB_SESSION_INDEX_KEY);
  const index = stored?.[TAB_SESSION_INDEX_KEY] as unknown;
  return index && typeof index === 'object' ? { ...(index as TabSessionIndex) } : {};
}

/** 由 Side Panel 在建立或复用会话时写入。 */
export async function rememberTabSession(
  tabId: number,
  sessionId: string,
  url: string,
): Promise<void> {
  const index = await readIndex();
  index[String(tabId)] = { sessionId, url };
  await chrome.storage.session.set({ [TAB_SESSION_INDEX_KEY]: index });
}

/** 由 Service Worker 在 tabs.onRemoved 时删除；标签页关掉即结束续接窗口。 */
export async function forgetTabSession(tabId: number): Promise<void> {
  const index = await readIndex();
  if (!(String(tabId) in index)) return;
  delete index[String(tabId)];
  await chrome.storage.session.set({ [TAB_SESSION_INDEX_KEY]: index });
}

/** 续接前的准入判断：这个 tabId 在本次浏览器会话里是否还活着且用过 Wisp。 */
export async function hasTabSession(tabId: number): Promise<boolean> {
  return String(tabId) in await readIndex();
}

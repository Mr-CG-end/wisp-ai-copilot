/**
 * 把落库的消息还原成面板轨迹上的轮次。
 *
 * 纯函数，不碰 Dexie 也不碰 chrome.*：写入侧（TaskPanel 的 persistGeneration）与
 * 读出侧的字段映射必须严丝合缝，而那条映射规则最容易在改动中悄悄错位，
 * 放在这里才能不起浏览器就把它钉死。
 */

/** 划词类任务：用户侧那条消息存的是选区原文，不是用户提的问题。 */
const SELECTION_TASK_TYPES = new Set<string>(['explain', 'summarize', 'translate', 'rewrite']);

/** 落库消息的最小形状，与 core/storage/db.ts 的 Message 结构兼容。 */
export interface StoredMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  taskType?: string;
  createdAt: number;
}

export interface RestoredTurn {
  id: string;
  type: string;
  output: string;
  userInput?: string;
  selectionText?: string;
}

/**
 * 同一个标签页会走过多个 URL，tabId 上因此可能挂着好几条会话；同一个 URL 也可能
 * 因为历史原因留下不止一条。按 updatedAt 取最近的那条——用户想接上的一定是刚才那次。
 */
export function pickResumableSession<T extends { url: string; updatedAt: number }>(
  sessions: readonly T[],
  url: string,
): T | undefined {
  let latest: T | undefined;
  for (const session of sessions) {
    if (session.url !== url) continue;
    if (!latest || session.updatedAt > latest.updatedAt) latest = session;
  }
  return latest;
}

const ROLE_ORDER: Record<StoredMessage['role'], number> = { user: 0, assistant: 1 };

export function messagesToTurns(messages: readonly StoredMessage[]): RestoredTurn[] {
  // 按 sessionId 索引取出来的顺序是主键序（随机 uuid），必须自己排。
  // createdAt 相等时让 user 排在 assistant 前面：一轮的两条消息落库间隔可能不足 1ms，
  // 时间戳撞在一起时若按存储顺序走，回答会跑到提问前面，整轮的配对随之错位。
  const ordered = [...messages].sort(
    (a, b) => a.createdAt - b.createdAt || ROLE_ORDER[a.role] - ROLE_ORDER[b.role],
  );

  const turns: RestoredTurn[] = [];
  let pendingUser: StoredMessage | null = null;
  for (const message of ordered) {
    if (message.role === 'user') {
      pendingUser = message;
      continue;
    }
    // 只有 assistant 消息才成轮：没等到回答的那条 user 消息没有可显示的输出。
    // 落库只在生成成功后发生，正常不会出现这种孤儿。
    const type = message.taskType ?? pendingUser?.taskType ?? 'qa';
    const isSelection = SELECTION_TASK_TYPES.has(type);
    turns.push({
      id: message.id,
      type,
      output: message.content,
      // summary 的用户侧内容是固定字面量「生成摘要」——它只是给落库凑一条 user 消息，
      // 回显出来会变成一句莫名其妙的「你的问题：生成摘要」。
      userInput: !isSelection && type !== 'summary' ? pendingUser?.content : undefined,
      selectionText: isSelection ? pendingUser?.content : undefined,
    });
    pendingUser = null;
  }
  return turns;
}

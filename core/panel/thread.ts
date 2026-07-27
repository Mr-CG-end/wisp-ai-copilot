/**
 * 轮次投影：把面板 store 的 history / currentTask / streamBuffer 三个字段
 * 合成一条连续的会话轨迹。渲染层只负责摆放，不再判断「这是历史还是当前」。
 *
 * 输入类型在此结构化定义，不从 entrypoints/ 反向 import —— core 不依赖执行上下文。
 */

export type TurnInputStatus = 'idle' | 'loading' | 'success' | 'empty' | 'error' | 'cancelled';
export type TurnStatus = Exclude<TurnInputStatus, 'idle'>;

export interface TurnInput {
  id: string;
  type: string;
  status: TurnInputStatus;
  source: string;
  userInput?: string;
  truncated?: boolean;
  contextChars?: number;
  ctx: { url: string };
}

export interface HistoryTurnInput extends TurnInput {
  output: string;
}

export interface Turn {
  id: string;
  /** 1 起，用于轨道上的 01 / 02 编号 */
  index: number;
  type: string;
  status: TurnStatus;
  /** 视觉标签，如「摘要」 */
  label: string;
  /** 状态短语；成功时为空串 */
  statusLabel: string;
  /** 读屏用完整名，如「第 2 轮 · 追问 · 已停止」 */
  accessibleName: string;
  output: string;
  userInput?: string;
  truncated: boolean;
  sourceUrl: string;
  source: string;
  isCurrent: boolean;
}

export const TASK_LABELS: Record<string, string> = {
  summary: '摘要',
  qa: '追问',
  explain: '解释',
  summarize: '总结',
  translate: '翻译',
  rewrite: '改写',
};

const STATUS_LABELS: Record<TurnStatus, string> = {
  loading: '生成中…',
  success: '',
  empty: '没有返回内容',
  cancelled: '已停止',
  error: '生成未完成',
};

function toTurn(input: TurnInput, output: string, index: number, isCurrent: boolean): Turn {
  const status = input.status as TurnStatus;
  const label = TASK_LABELS[input.type] ?? input.type;
  const statusLabel = STATUS_LABELS[status];
  return {
    id: input.id,
    index,
    type: input.type,
    status,
    label,
    statusLabel,
    accessibleName: `第 ${index} 轮 · ${label} · ${statusLabel || '已完成'}`,
    output,
    userInput: input.userInput,
    truncated: input.truncated ?? false,
    sourceUrl: input.ctx.url,
    source: input.source,
    isCurrent,
  };
}

export function selectTurns(
  history: readonly HistoryTurnInput[],
  currentTask: TurnInput | null,
  streamBuffer: string,
): Turn[] {
  const turns: Turn[] = [];
  // idle 在两侧都被剔除后，toTurn 里的 TurnStatus 断言才真正成立 ——
  // 否则 STATUS_LABELS['idle'] 取到 undefined，而 statusLabel 的类型标称是 string。
  // 编号在过滤之后才递增，跳过的条目不会在轨道上留下空号。
  for (const entry of history) {
    if (entry.status === 'idle') continue;
    turns.push(toTurn(entry, entry.output, turns.length + 1, false));
  }
  if (currentTask && currentTask.status !== 'idle') {
    turns.push(toTurn(currentTask, streamBuffer, turns.length + 1, true));
  }
  return turns;
}

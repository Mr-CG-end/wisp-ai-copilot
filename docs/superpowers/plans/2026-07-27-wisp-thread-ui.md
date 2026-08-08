# 轨迹（The Thread）UI 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Side Panel 的装饰性微光轨迹升级为承载会话结构与六态的页面级信息骨架，并把「快照」提升为有分量的视觉对象。

**Architecture:** 新增一个纯函数投影层 `core/panel/thread.ts`，把 store 的 `history` + `currentTask` + `streamBuffer` 三个字段合成统一的轮次数组；渲染层由 `Thread`（轨道单元）、`Turn`（一轮 = 轨道 + 纸面）、`SnapshotStamp`（快照凭证）三个纯展示组件承担。`TaskPanel` 从「历史块 + 结果区」双结构改为 `Turn` 列表，`ModelSetup` 复用同一套节点语汇表达初始化四步。不新增 store 顶层状态——轮次是投影不是状态。

**Tech Stack:** React 18 · TypeScript strict · Zustand · 普通 CSS（无 Tailwind／组件库／动画库）· Vitest（node 环境，组件测试用 `// @vitest-environment jsdom` 文件头）

## Global Constraints

- **硬前置**：`docs/Wisp_M2收口与设计文档回写计划.md` 的 **Task A 必须先合入**。本计划依赖它提供的三件事：已删除逐帧打字机动画、流式期间已走 `StreamMarkdown`、`performanceProfile` 已在 `usePanelStore` 中。
- **收口计划 Task B 已取消**，被本计划 Task 6 的「只 sticky 快照凭证」取代。不要实现 Task B。
- 设计依据：`docs/superpowers/specs/2026-07-27-wisp-thread-ui-design.md`。本计划与 spec 冲突时以 spec 为准，但下述一处例外：spec §10.1 称「不新增 store 字段」不准确——快照凭证需要读取时刻，故 `PageInfo` 新增 `readAt: number`。Task 3 处理，Task 9 修正 spec。
- 不引入任何新依赖。不使用 Tailwind、UI 组件库、动画库、远程字体。
- 单一强调色 `--wisp-accent`；不引入第二强调色、渐变、玻璃拟态。
- 动效一律用 CSS transition／transform，**禁止逐帧 JS 动画**；`prefers-reduced-motion: reduce` 下跳终态。
- 不为获取真实 favicon 发起任何网络请求（凭证只用域名首字母）。
- 轨迹图形一律 `aria-hidden="true"`；状态必须同时由文字承载。
- `aria-live="polite"` 只挂状态行，**不得挂正文容器**。
- `core/` 不得反向 import `entrypoints/` 的类型；`core/panel/thread.ts` 自带结构化输入类型。
- 每个任务独立提交。提交前跑 `npm test` 与 `npx tsc --noEmit`。

## File Structure

| 文件 | 职责 |
|---|---|
| `core/panel/thread.ts` | **新增**。轮次投影：三个 store 字段 → `Turn[]`。含任务标签与可访问名生成。纯函数 |
| `core/panel/thread.test.ts` | **新增**。投影逻辑单测 |
| `core/panel/relativeTime.ts` | **新增**。时间戳 → `刚刚` / `3 分钟前`。纯函数 |
| `core/panel/relativeTime.test.ts` | **新增** |
| `core/panel/setupSteps.ts` | **新增**。`modelStatus` + `downloadPct` → 初始化四步节点。纯函数 |
| `core/panel/setupSteps.test.ts` | **新增** |
| `entrypoints/sidepanel/components/Thread.tsx` | **新增**。轨道单元（线段 + 节点 + 编号 + 标签），纯展示 |
| `entrypoints/sidepanel/components/Thread.test.tsx` | **新增** |
| `entrypoints/sidepanel/components/SnapshotStamp.tsx` | **新增**。快照凭证（首字母、读取时刻、过期态） |
| `entrypoints/sidepanel/components/SnapshotStamp.test.tsx` | **新增** |
| `entrypoints/sidepanel/components/Turn.tsx` | **新增**。一轮 = 轨道单元 + 纸面，历史与当前轮共用 |
| `entrypoints/sidepanel/components/Turn.test.tsx` | **新增** |
| `entrypoints/sidepanel/store.ts` | **修改**。`PageInfo` 增 `readAt: number` |
| `entrypoints/sidepanel/components/TaskPanel.tsx` | **修改**。双结构换成 `Turn` 列表；命令区降级；凭证接入 |
| `entrypoints/sidepanel/components/ModelSetup.tsx` | **修改**。四步节点 |
| `entrypoints/sidepanel/style.css` | **修改**。页面栅格、轨道、凭证 sticky、排版收敛、响应式 |
| `docs/ui/Wisp_M2_UISpec.md` | **修改**。升为 v3，含工具条规范 |
| `docs/Wisp_M2收口与设计文档回写计划.md` | **修改**。标注 Task B 取消 |
| `docs/superpowers/specs/2026-07-27-wisp-thread-ui-design.md` | **修改**。修正 §10.1 的 `readAt` 表述 |

---

## Task 1: 轮次投影 `core/panel/thread.ts`

**Files:**
- Create: `core/panel/thread.ts`
- Test: `core/panel/thread.test.ts`

**Interfaces:**
- Consumes: 无（自带结构化输入类型，不 import store）
- Produces: `TurnStatus`、`TurnInput`、`HistoryTurnInput`、`Turn`、`selectTurns(history, currentTask, streamBuffer): Turn[]`、`TASK_LABELS`

- [ ] **Step 1: 写失败的测试**

创建 `core/panel/thread.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { selectTurns, type HistoryTurnInput, type TurnInput } from './thread';

const ctx = { url: 'https://example.com/a' };

function history(overrides: Partial<HistoryTurnInput> = {}): HistoryTurnInput {
  return {
    id: 'h1',
    type: 'summary',
    status: 'success',
    source: '示例文章',
    ctx,
    output: '历史摘要正文',
    ...overrides,
  };
}

function current(overrides: Partial<TurnInput> = {}): TurnInput {
  return { id: 'c1', type: 'qa', status: 'loading', source: '示例文章', ctx, ...overrides };
}

describe('selectTurns', () => {
  it('历史与当前轮合成连续轮次，编号从 1 递增', () => {
    const turns = selectTurns([history(), history({ id: 'h2', type: 'qa' })], current(), '流式中');
    expect(turns.map((t) => t.index)).toEqual([1, 2, 3]);
    expect(turns.map((t) => t.id)).toEqual(['h1', 'h2', 'c1']);
  });

  it('当前轮取 streamBuffer 作为输出并标记 isCurrent', () => {
    const turns = selectTurns([], current(), '正在生成的内容');
    expect(turns).toHaveLength(1);
    expect(turns[0].output).toBe('正在生成的内容');
    expect(turns[0].isCurrent).toBe(true);
    expect(turns[0].status).toBe('loading');
  });

  it('历史轮次保留各自终态，不被归一化为成功', () => {
    const turns = selectTurns(
      [history({ id: 'h1', status: 'cancelled' }), history({ id: 'h2', status: 'error' })],
      null,
      '',
    );
    expect(turns.map((t) => t.status)).toEqual(['cancelled', 'error']);
    expect(turns[0].statusLabel).toBe('已停止');
    expect(turns[1].statusLabel).toBe('生成未完成');
  });

  it('无当前任务时不产出空轮', () => {
    expect(selectTurns([], null, '')).toEqual([]);
    expect(selectTurns([], null, '残留缓冲')).toEqual([]);
  });

  it('idle 的当前任务不产出轮次', () => {
    expect(selectTurns([], current({ status: 'idle' }), '')).toEqual([]);
  });

  it('可访问名包含轮次序号、类型与状态', () => {
    const turns = selectTurns([history({ status: 'success' })], current({ status: 'cancelled' }), '半截');
    expect(turns[0].accessibleName).toBe('第 1 轮 · 摘要 · 已完成');
    expect(turns[1].accessibleName).toBe('第 2 轮 · 追问 · 已停止');
  });

  it('成功轮次的 statusLabel 为空串', () => {
    expect(selectTurns([history()], null, '')[0].statusLabel).toBe('');
  });

  it('未知任务类型退化为原始标识而非崩溃', () => {
    const turns = selectTurns([history({ type: 'unknown-type' })], null, '');
    expect(turns[0].label).toBe('unknown-type');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run core/panel/thread.test.ts`
Expected: FAIL — `Failed to resolve import "./thread"`

- [ ] **Step 3: 实现**

创建 `core/panel/thread.ts`：

```ts
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
  const turns = history.map((entry, i) => toTurn(entry, entry.output, i + 1, false));
  if (currentTask && currentTask.status !== 'idle') {
    turns.push(toTurn(currentTask, streamBuffer, turns.length + 1, true));
  }
  return turns;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run core/panel/thread.test.ts`
Expected: PASS，8 项全绿

- [ ] **Step 5: 类型检查并提交**

```bash
npx tsc --noEmit
git add core/panel/thread.ts core/panel/thread.test.ts
git commit -m "feat: 新增会话轮次投影"
```

---

## Task 2: 相对时间 `core/panel/relativeTime.ts`

**Files:**
- Create: `core/panel/relativeTime.ts`
- Test: `core/panel/relativeTime.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `formatReadAt(readAt: number, now: number): string`

- [ ] **Step 1: 写失败的测试**

创建 `core/panel/relativeTime.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { formatReadAt } from './relativeTime';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

describe('formatReadAt', () => {
  it('一分钟内显示「刚刚」', () => {
    expect(formatReadAt(1000, 1000)).toBe('刚刚');
    expect(formatReadAt(1000, 1000 + 59_000)).toBe('刚刚');
  });

  it('一小时内显示分钟', () => {
    expect(formatReadAt(0, MINUTE)).toBe('1 分钟前');
    expect(formatReadAt(0, 3 * MINUTE)).toBe('3 分钟前');
    expect(formatReadAt(0, 59 * MINUTE)).toBe('59 分钟前');
  });

  it('一小时以上显示小时', () => {
    expect(formatReadAt(0, HOUR)).toBe('1 小时前');
    expect(formatReadAt(0, 5 * HOUR)).toBe('5 小时前');
  });

  it('超过一天显示天', () => {
    expect(formatReadAt(0, 24 * HOUR)).toBe('1 天前');
  });

  it('未来时间戳按「刚刚」处理，不出现负数', () => {
    expect(formatReadAt(5000, 1000)).toBe('刚刚');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run core/panel/relativeTime.test.ts`
Expected: FAIL — `Failed to resolve import "./relativeTime"`

- [ ] **Step 3: 实现**

创建 `core/panel/relativeTime.ts`：

```ts
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * 快照读取时刻的相对表述。now 由调用方传入而非内部取 Date.now()，
 * 以便单测确定性断言。
 */
export function formatReadAt(readAt: number, now: number): string {
  const elapsed = Math.max(0, now - readAt);
  if (elapsed < MINUTE) return '刚刚';
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)} 分钟前`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)} 小时前`;
  return `${Math.floor(elapsed / DAY)} 天前`;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run core/panel/relativeTime.test.ts`
Expected: PASS，5 项全绿

- [ ] **Step 5: 提交**

```bash
npx tsc --noEmit
git add core/panel/relativeTime.ts core/panel/relativeTime.test.ts
git commit -m "feat: 新增快照读取时刻的相对表述"
```

---

## Task 3: `PageInfo.readAt` 与快照凭证组件

**Files:**
- Modify: `entrypoints/sidepanel/store.ts`（`PageInfo` 接口）
- Modify: `entrypoints/sidepanel/store.test.ts`（`samplePage` 补字段）
- Modify: `entrypoints/sidepanel/components/TaskPanel.tsx:243-253`、`:260-270`（两处 `setPage` 调用补 `readAt`）
- Create: `entrypoints/sidepanel/components/SnapshotStamp.tsx`
- Test: `entrypoints/sidepanel/components/SnapshotStamp.test.tsx`

**Interfaces:**
- Consumes: `formatReadAt`（Task 2）
- Produces: `SnapshotStamp` 组件，props `{ host: string; readAt: number; now: number; stale: boolean }`

- [ ] **Step 1: 写失败的测试**

创建 `entrypoints/sidepanel/components/SnapshotStamp.test.tsx`：

```tsx
// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { SnapshotStamp } from './SnapshotStamp';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function render(node: React.ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    createRoot(container).render(node);
  });
  return container;
}

describe('SnapshotStamp', () => {
  it('显示域名首字母大写与相对读取时刻', async () => {
    const c = await render(<SnapshotStamp host="web.dev" readAt={0} now={180_000} stale={false} />);
    expect(c.querySelector('.wisp-stamp-initial')?.textContent).toBe('W');
    expect(c.querySelector('.wisp-stamp-time')?.textContent).toBe('3 分钟前读取');
  });

  it('过期时标记 is-stale 并改写文案', async () => {
    const c = await render(<SnapshotStamp host="web.dev" readAt={0} now={180_000} stale />);
    expect(c.querySelector('.wisp-stamp')?.className).toContain('is-stale');
    expect(c.querySelector('.wisp-stamp-time')?.textContent).toBe('快照已过期');
  });

  it('空域名不渲染出 undefined 首字母', async () => {
    const c = await render(<SnapshotStamp host="" readAt={0} now={0} stale={false} />);
    expect(c.querySelector('.wisp-stamp-initial')?.textContent).toBe('·');
  });

  it('装饰图形不进入无障碍树，时刻文本进入', async () => {
    const c = await render(<SnapshotStamp host="web.dev" readAt={0} now={0} stale={false} />);
    expect(c.querySelector('.wisp-stamp-initial')?.getAttribute('aria-hidden')).toBe('true');
    expect(c.querySelector('.wisp-stamp-time')?.getAttribute('aria-hidden')).toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run entrypoints/sidepanel/components/SnapshotStamp.test.tsx`
Expected: FAIL — `Failed to resolve import "./SnapshotStamp"`

- [ ] **Step 3: 实现组件**

创建 `entrypoints/sidepanel/components/SnapshotStamp.tsx`：

```tsx
import React from 'react';
import { formatReadAt } from '../../../core/panel/relativeTime';

interface SnapshotStampProps {
  host: string;
  readAt: number;
  now: number;
  /** 绑定页已导航或刷新 —— 快照与页面不再对应 */
  stale: boolean;
}

export const SnapshotStamp: React.FC<SnapshotStampProps> = ({ host, readAt, now, stale }) => {
  const initial = host ? host.charAt(0).toUpperCase() : '·';
  return (
    <div className={`wisp-stamp ${stale ? 'is-stale' : ''}`}>
      {/* 只用域名首字母 —— 取真实 favicon 需要发网络请求，违反不出网红线 */}
      <span className="wisp-stamp-initial" aria-hidden="true">{initial}</span>
      <span className="wisp-stamp-time">
        {stale ? '快照已过期' : `${formatReadAt(readAt, now)}读取`}
      </span>
    </div>
  );
};
```

- [ ] **Step 4: 给 `PageInfo` 加 `readAt`**

`entrypoints/sidepanel/store.ts`，在 `PageInfo` 接口末尾加一行：

```ts
export interface PageInfo {
  ctx: TaskContext;
  title: string;
  url: string;
  text: string;
  charCount: number;
  truncated: boolean;
  method: 'readability' | 'heuristic';
  /** 快照读取时刻，供凭证显示「3 分钟前读取」 */
  readAt: number;
}
```

`entrypoints/sidepanel/store.test.ts` 的 `samplePage` 补 `readAt: 0`。

`entrypoints/sidepanel/components/TaskPanel.tsx` 两处 `setPage({...})` 调用（约 243 行与 260 行）各补一行 `readAt: Date.now(),`。

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run entrypoints/sidepanel/components/SnapshotStamp.test.tsx entrypoints/sidepanel/store.test.ts`
Expected: PASS，SnapshotStamp 4 项 + store 既有测试全绿

- [ ] **Step 6: 提交**

```bash
npx tsc --noEmit
git add entrypoints/sidepanel/store.ts entrypoints/sidepanel/store.test.ts entrypoints/sidepanel/components/SnapshotStamp.tsx entrypoints/sidepanel/components/SnapshotStamp.test.tsx entrypoints/sidepanel/components/TaskPanel.tsx
git commit -m "feat: 新增快照凭证与读取时刻字段"
```

---

## Task 4: 轨道单元 `Thread.tsx`

**Files:**
- Create: `entrypoints/sidepanel/components/Thread.tsx`
- Test: `entrypoints/sidepanel/components/Thread.test.tsx`

**Interfaces:**
- Consumes: `TurnStatus`（Task 1）
- Produces: `Thread` 组件，props `{ index: number; label: string; status: TurnStatus }`

- [ ] **Step 1: 写失败的测试**

创建 `entrypoints/sidepanel/components/Thread.test.tsx`：

```tsx
// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { Thread } from './Thread';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function render(node: React.ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    createRoot(container).render(node);
  });
  return container;
}

describe('Thread', () => {
  it('编号补零为两位', async () => {
    const c = await render(<Thread index={2} label="追问" status="success" />);
    expect(c.querySelector('.wisp-thread-index')?.textContent).toBe('02');
  });

  it('两位数以上不截断', async () => {
    const c = await render(<Thread index={12} label="追问" status="success" />);
    expect(c.querySelector('.wisp-thread-index')?.textContent).toBe('12');
  });

  it('每个状态产生不同的修饰类，供 CSS 区分形态', async () => {
    const statuses = ['loading', 'success', 'empty', 'cancelled', 'error'] as const;
    const classNames = new Set<string>();
    for (const status of statuses) {
      const c = await render(<Thread index={1} label="摘要" status={status} />);
      classNames.add(c.querySelector('.wisp-thread')!.className);
    }
    expect(classNames.size).toBe(statuses.length);
  });

  it('生成中与空结果的修饰类不同（静态形态必须可区分）', async () => {
    const loading = await render(<Thread index={1} label="摘要" status="loading" />);
    const empty = await render(<Thread index={1} label="摘要" status="empty" />);
    expect(loading.querySelector('.wisp-thread')!.className)
      .not.toBe(empty.querySelector('.wisp-thread')!.className);
  });

  it('整个轨道单元不进入无障碍树', async () => {
    const c = await render(<Thread index={1} label="摘要" status="success" />);
    expect(c.querySelector('.wisp-thread')?.getAttribute('aria-hidden')).toBe('true');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run entrypoints/sidepanel/components/Thread.test.tsx`
Expected: FAIL — `Failed to resolve import "./Thread"`

- [ ] **Step 3: 实现**

创建 `entrypoints/sidepanel/components/Thread.tsx`：

```tsx
import React from 'react';
import type { TurnStatus } from '../../../core/panel/thread';

interface ThreadProps {
  index: number;
  label: string;
  status: TurnStatus;
}

/**
 * 轨道单元：线段 + 节点 + 编号 + 标签。
 *
 * 整体 aria-hidden —— 轨迹是状态的视觉加速器，状态本身由 Turn 的
 * aria-label 与纸面内的文字承载，读屏用户不必去理解一条线。
 */
export const Thread: React.FC<ThreadProps> = ({ index, label, status }) => (
  <div className={`wisp-thread wisp-thread--${status}`} aria-hidden="true">
    <span className="wisp-thread-line" />
    <span className="wisp-thread-node" />
    <span className="wisp-thread-index">{String(index).padStart(2, '0')}</span>
    <span className="wisp-thread-type">{label}</span>
  </div>
);
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run entrypoints/sidepanel/components/Thread.test.tsx`
Expected: PASS，5 项全绿

- [ ] **Step 5: 提交**

```bash
npx tsc --noEmit
git add entrypoints/sidepanel/components/Thread.tsx entrypoints/sidepanel/components/Thread.test.tsx
git commit -m "feat: 新增轨道单元组件"
```

---

## Task 5: 轮次容器 `Turn.tsx`

**Files:**
- Create: `entrypoints/sidepanel/components/Turn.tsx`
- Test: `entrypoints/sidepanel/components/Turn.test.tsx`

**Interfaces:**
- Consumes: `Turn` 类型（Task 1）、`Thread`（Task 4）、既有 `StreamMarkdown`
- Produces: `TurnView` 组件（避免与 `Turn` 类型重名），props 见下

- [ ] **Step 1: 写失败的测试**

创建 `entrypoints/sidepanel/components/Turn.test.tsx`：

```tsx
// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { Turn } from '../../../core/panel/thread';
import { TurnView } from './Turn';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeTurn(overrides: Partial<Turn> = {}): Turn {
  return {
    id: 't1',
    index: 1,
    type: 'summary',
    status: 'success',
    label: '摘要',
    statusLabel: '',
    accessibleName: '第 1 轮 · 摘要 · 已完成',
    output: '摘要正文',
    truncated: false,
    sourceUrl: 'https://example.com/a',
    source: '示例文章',
    isCurrent: false,
    ...overrides,
  };
}

const noop = () => {};
const baseProps = {
  isStale: false,
  isStopping: false,
  canRegenerate: true,
  onCopy: noop,
  onRegenerate: noop,
  onStop: noop,
};

async function render(node: React.ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    createRoot(container).render(node);
  });
  return container;
}

describe('TurnView', () => {
  it('容器可访问名用完整版状态描述', async () => {
    const c = await render(<TurnView turn={makeTurn({ accessibleName: '第 2 轮 · 追问 · 已停止' })} {...baseProps} />);
    expect(c.querySelector('article')?.getAttribute('aria-label')).toBe('第 2 轮 · 追问 · 已停止');
  });

  it('正文容器不得挂 aria-live', async () => {
    const c = await render(<TurnView turn={makeTurn({ status: 'loading' })} {...baseProps} />);
    expect(c.querySelector('.wisp-turn-body')?.getAttribute('aria-live')).toBeNull();
  });

  it('生成中只显示停止，不显示复制与重新生成', async () => {
    const c = await render(<TurnView turn={makeTurn({ status: 'loading' })} {...baseProps} />);
    const labels = [...c.querySelectorAll('button')].map((b) => b.textContent);
    expect(labels).toContain('停止');
    expect(labels).not.toContain('复制');
    expect(labels).not.toContain('重新生成');
  });

  it('完成后显示复制与重新生成', async () => {
    const onCopy = vi.fn();
    const c = await render(<TurnView turn={makeTurn()} {...baseProps} onCopy={onCopy} />);
    const copy = [...c.querySelectorAll('button')].find((b) => b.textContent === '复制')!;
    await act(async () => { copy.click(); });
    expect(onCopy).toHaveBeenCalledOnce();
  });

  it('来源与当前快照一致时不显示来源行', async () => {
    const c = await render(<TurnView turn={makeTurn()} {...baseProps} />);
    expect(c.querySelector('.wisp-turn-origin')).toBeNull();
  });

  it('来源不一致时显示来源行', async () => {
    const c = await render(<TurnView turn={makeTurn()} {...baseProps} isStale />);
    expect(c.querySelector('.wisp-turn-origin')?.textContent).toContain('example.com');
  });

  it('被停止的轮次保留已生成内容并给出状态文字', async () => {
    const turn = makeTurn({ status: 'cancelled', statusLabel: '已停止', output: '半截内容' });
    const c = await render(<TurnView turn={turn} {...baseProps} />);
    expect(c.textContent).toContain('半截内容');
    expect(c.textContent).toContain('已停止');
  });

  it('达到长度上限时给出提示', async () => {
    const c = await render(<TurnView turn={makeTurn({ truncated: true })} {...baseProps} />);
    expect(c.querySelector('.wisp-truncated-note')).not.toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run entrypoints/sidepanel/components/Turn.test.tsx`
Expected: FAIL — `Failed to resolve import "./Turn"`

- [ ] **Step 3: 实现**

创建 `entrypoints/sidepanel/components/Turn.tsx`：

```tsx
import React from 'react';
import type { Turn } from '../../../core/panel/thread';
import { Thread } from './Thread';
import { StreamMarkdown } from './StreamMarkdown';

interface TurnViewProps {
  turn: Turn;
  /** 该轮来源与当前快照不同（如跨标签后保留的旧轮） */
  isStale: boolean;
  isStopping: boolean;
  canRegenerate: boolean;
  onCopy: () => void;
  onRegenerate: () => void;
  onStop: () => void;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * 一轮 = 轨道单元 + 纸面。历史轮次与当前轮共用本组件 ——
 * 历史不是「另一种东西」，只是轨道上更早的节点。
 */
export const TurnView: React.FC<TurnViewProps> = ({
  turn, isStale, isStopping, canRegenerate, onCopy, onRegenerate, onStop,
}) => {
  const isGenerating = turn.status === 'loading';
  return (
    <article className="wisp-turn" aria-label={turn.accessibleName}>
      <Thread index={turn.index} label={turn.label} status={turn.status} />

      <div className="wisp-turn-paper">
        {isStale ? (
          <div className="wisp-turn-origin">本结果来自：{hostOf(turn.sourceUrl)}</div>
        ) : null}

        <header className="wisp-turn-tools">
          <span className="wisp-turn-source" title={turn.source}>
            {turn.statusLabel || turn.source}
          </span>
          {isGenerating ? (
            <button className="wisp-btn-sm wisp-btn-danger" disabled={isStopping} onClick={onStop}>
              {isStopping ? '正在停止…' : '停止'}
            </button>
          ) : (
            <div className="wisp-turn-actions">
              {turn.output ? (
                <button className="wisp-btn-sm" onClick={onCopy}>复制</button>
              ) : null}
              <button className="wisp-btn-sm" disabled={!canRegenerate} onClick={onRegenerate}>
                重新生成
              </button>
            </div>
          )}
        </header>

        <div className="wisp-turn-body">
          {turn.userInput ? (
            <div className="wisp-turn-question">
              <span>你的问题</span>
              <p>{turn.userInput}</p>
            </div>
          ) : null}

          {turn.output ? <StreamMarkdown content={turn.output} /> : null}

          {isGenerating && !turn.output ? (
            <div className="wisp-turn-prelude">正在读取快照并生成…</div>
          ) : null}

          {turn.status === 'empty' ? (
            <div className="wisp-state-empty">
              <strong>模型没有返回内容</strong>
              <span>可以重新生成或换个问题。</span>
            </div>
          ) : null}

          {turn.status === 'error' ? (
            <div className="wisp-state-error">
              <strong>生成未完成</strong>
              <span>模型生成遇到错误，可以重试。</span>
            </div>
          ) : null}

          {turn.truncated ? (
            <div className="wisp-truncated-note">
              回答达到长度上限，内容可能未完整结束。可以缩小问题范围后重试。
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
};
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run entrypoints/sidepanel/components/Turn.test.tsx`
Expected: PASS，8 项全绿

- [ ] **Step 5: 提交**

```bash
npx tsc --noEmit
git add entrypoints/sidepanel/components/Turn.tsx entrypoints/sidepanel/components/Turn.test.tsx
git commit -m "feat: 新增轮次容器组件"
```

---

## Task 6: `TaskPanel` 重构为轮次列表

**Files:**
- Modify: `entrypoints/sidepanel/components/TaskPanel.tsx`

**Interfaces:**
- Consumes: `selectTurns`（Task 1）、`SnapshotStamp`（Task 3）、`TurnView`（Task 5）
- Produces: 无新导出

- [ ] **Step 1: 删除被取代的局部结构**

在 `TaskPanel.tsx` 中删除：

- `ConversationHistory` 组件整体（约 100-121 行）
- `ProgressiveOutput` 与 `GenerationPrelude` 组件（已由 `TurnView` 内部承担）
- `TASK_LABELS` 常量（已移入 `core/panel/thread.ts`）
- `taskLabel`、`isHistoricalResult` 等仅服务旧结构的局部变量

- [ ] **Step 2: 接入投影与新组件**

顶部 import 增加：

```tsx
import { selectTurns } from '../../../core/panel/thread';
import { SnapshotStamp } from './SnapshotStamp';
import { TurnView } from './Turn';
```

组件内计算轮次（`page`、`history`、`currentTask`、`streamBuffer` 均已在作用域内）：

```tsx
const turns = selectTurns(history, currentTask, streamBuffer);
const [now, setNow] = useState(() => Date.now());

// 凭证的相对时刻每 30s 刷新一次；只更新一个数字，不触发生成链路
useEffect(() => {
  const timer = window.setInterval(() => setNow(Date.now()), 30_000);
  return () => window.clearInterval(timer);
}, []);
```

- [ ] **Step 3: 把页面栏拆成「常驻凭证行」与「可滚走详情行」**

把整个 `<section className="wisp-page-bar">` 的 `page` 分支替换为两个**平级**的直接子元素——凭证行必须是 `.wisp-task-panel` 的直接子元素，否则 sticky 会被约束在矮盒子里跟着一起滚走：

```tsx
<div className="wisp-snapshot-header">
  <SnapshotStamp
    host={pageHost}
    readAt={page.readAt}
    now={now}
    stale={isSnapshotStale}
  />
  <div className="wisp-snapshot-host">{pageHost}</div>
</div>

<div className="wisp-page-detail">
  <div />
  <div className="wisp-page-info">
    <h2 className="wisp-page-title" title={page.title}>{page.title}</h2>
    <div className="wisp-page-meta">
      <span>{page.charCount.toLocaleString()} 字</span>
      <span aria-hidden="true">·</span>
      <span>{page.truncated ? `已读取前 ${page.text.length.toLocaleString()} 字` : '已读取全文'}</span>
      <button
        className="wisp-btn-link"
        disabled={!boundCtx || isGenerating || isCrossTab}
        onClick={() => void handleRereadBoundPage()}
      >
        重新读取
      </button>
    </div>
  </div>
</div>
```

`page` 为空时的分支（`.wisp-page-empty`）保持原样，只是不再包在 `.wisp-page-bar` 里。

**过期判定**：快照过期与跨标签是两回事，判据也不同。绑定页导航／刷新会让 SW 递增 epoch，故：

```tsx
// 快照过期 = 绑定页已导航或刷新（epoch 已变）；
// 跨标签只是当前不在那个标签，快照仍然有效，由既有横幅表达，不动凭证。
const isSnapshotStale = Boolean(page && boundCtx && page.ctx.epoch !== boundCtx.epoch);
```

同时从 `.wisp-page-meta` 中删除档位标签（若 Task A 已删则跳过）。

- [ ] **Step 4: 用轮次列表替换结果区**

把整个 `<section className="wisp-result-section">…</section>` 替换为：

```tsx
{turns.length === 0 ? (
  <div className="wisp-state-empty">
    <strong>生成结果会显示在这里</strong>
    <span>可以先生成摘要，或在下方基于快照提问。</span>
  </div>
) : (
  <div className="wisp-turns">
    {turns.map((turn) => (
      <TurnView
        key={turn.id}
        turn={turn}
        isStale={turn.sourceUrl !== page.ctx.url}
        isStopping={isStopping}
        canRegenerate={turn.isCurrent && turn.sourceUrl === page.ctx.url}
        onCopy={() => void handleCopyOutput(turn.output)}
        onRegenerate={() => void handleRegenerate()}
        onStop={() => void stop()}
      />
    ))}
  </div>
)}
```

`handleCopyOutput` 改为接受内容参数：

```tsx
const handleCopyOutput = async (content: string) => {
  if (!content) return;
  await navigator.clipboard.writeText(content);
  setCopyNotice('已复制');
  window.setTimeout(() => setCopyNotice(null), 1600);
};
```

- [ ] **Step 5: 命令区首轮后降级**

`.wisp-action-bar` 内的「生成摘要」按钮类名改为条件式：

```tsx
<button
  className={`wisp-btn ${turns.length === 0 ? 'wisp-btn-primary' : 'wisp-btn-secondary'}`}
  disabled={isGenerating}
  onClick={() => void handleGenerateSummary()}
>
  生成摘要
</button>
```

- [ ] **Step 6: 跑全量测试**

Run: `npm test`
Expected: PASS，全部既有测试 + 本计划新增测试全绿

- [ ] **Step 7: 类型检查与构建**

```bash
npx tsc --noEmit
npm run build:dev
```
Expected: 均无错误

- [ ] **Step 8: 提交**

```bash
git add entrypoints/sidepanel/components/TaskPanel.tsx
git commit -m "refactor: 任务面板改为轨迹轮次列表"
```

---

## Task 7: 页面栅格、轨道与凭证样式

**Files:**
- Modify: `entrypoints/sidepanel/style.css`

**Interfaces:**
- Consumes: Task 3/4/5 产出的类名
- Produces: 无

- [ ] **Step 1: 面板保持 flex 列，44px 轨道由各行自己对齐**

`.wisp-task-panel` **不要**改成 grid。原因是 sticky：CSS 中 sticky 元素被约束在自己的**包含块**内，若面板是 grid、凭证是某一行的 grid item，它的包含块就只有那一行的高度，滚过去就跟着离场。凭证必须是一个 flex 直接子元素，包含块才是整个面板高度。

`.wisp-task-panel` 保持现状（flex 列）不改。轨道的 44px 对齐由每一行各自声明相同的两列栅格达成：

```css
.wisp-snapshot-header,
.wisp-page-detail,
.wisp-turn {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr);
  gap: 0 12px;
}
```

- [ ] **Step 2: 轨道单元**

追加：

```css
.wisp-turns {
  display: flex;
  flex-direction: column;
}

.wisp-turn {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr);
  align-items: start;
}

.wisp-thread {
  position: relative;
  min-height: 100%;
  padding: 10px 8px 0 0;
  display: flex;
  align-items: flex-end;
  flex-direction: column;
  gap: 2px;
  align-self: stretch;
}

/* 线：贯穿本轮高度，位于轨道右缘 —— 它同时是轨道与内容的分隔线 */
.wisp-thread-line {
  position: absolute;
  top: 0;
  right: 0;
  width: 1px;
  height: 100%;
  background: var(--wisp-accent);
  transform-origin: top;
}

/* 节点：骑在线上 */
.wisp-thread-node {
  position: absolute;
  top: 12px;
  right: -3.5px;
  width: 8px;
  height: 8px;
  box-sizing: border-box;
  border: 1px solid var(--wisp-accent);
  border-radius: 50%;
  background: var(--wisp-accent);
}

.wisp-thread-index {
  color: var(--wisp-accent);
  font-size: 11px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  line-height: 16px;
}

.wisp-thread-type {
  color: var(--wisp-text-muted);
  font-size: 11px;
  font-weight: 500;
  line-height: 16px;
}

/* 生成中：实线描边空心节点 + 线向下生长 */
.wisp-thread--loading .wisp-thread-node {
  background: var(--wisp-surface);
}

.wisp-thread--loading .wisp-thread-line {
  animation: wisp-thread-grow 900ms ease-out;
}

@keyframes wisp-thread-grow {
  from { transform: scaleY(0); }
  to { transform: scaleY(1); }
}

/* 空结果：虚线描边空心节点 —— 与生成中的静态形态必须可区分 */
.wisp-thread--empty .wisp-thread-node {
  background: var(--wisp-surface);
  border-style: dashed;
}

/* 已停止：节点带横杠，线留断口后转虚线 */
.wisp-thread--cancelled .wisp-thread-node::after {
  content: "";
  position: absolute;
  top: 50%;
  left: -3px;
  width: 12px;
  height: 1px;
  background: var(--wisp-surface);
}

.wisp-thread--cancelled .wisp-thread-line {
  background: repeating-linear-gradient(
    to bottom,
    var(--wisp-accent) 0 3px,
    transparent 3px 7px
  );
}

/* 出错：该段转暖红 */
.wisp-thread--error .wisp-thread-node {
  border-color: var(--wisp-danger);
  background: var(--wisp-danger);
}

.wisp-thread--error .wisp-thread-line {
  background: var(--wisp-danger);
}
```

- [ ] **Step 3: 纸面与轮次内部**

```css
.wisp-turn-paper {
  min-width: 0;
  margin: 8px 0 12px 12px;
  background: var(--wisp-surface);
  border: 1px solid var(--wisp-border);
  border-radius: 10px;
  overflow: hidden;
}

.wisp-turn-tools {
  min-height: 38px;
  padding: 6px 10px 6px 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border-bottom: 1px solid var(--wisp-border);
}

.wisp-turn-source {
  min-width: 0;
  overflow: hidden;
  color: var(--wisp-text-muted);
  font-size: 11px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wisp-turn-actions {
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  gap: 2px;
}

.wisp-turn-body {
  padding: 14px;
  overflow-wrap: anywhere;
  color: var(--wisp-text);
  font-size: 14px;
  line-height: 22px;
}

.wisp-turn-origin {
  padding: 9px 14px;
  border-bottom: 1px solid var(--wisp-border);
  border-left: 2px solid var(--wisp-accent);
  background: color-mix(in srgb, var(--wisp-accent) 7%, transparent);
  color: var(--wisp-text-muted);
  font-size: 12px;
  line-height: 18px;
  overflow-wrap: anywhere;
}

.wisp-turn-prelude {
  color: var(--wisp-text-muted);
  font-size: 12px;
  line-height: 18px;
}
```

- [ ] **Step 4: 快照凭证行与 sticky**

删除原 `.wisp-page-bar` / `.wisp-page-rail` / `.wisp-favicon-placeholder` / `.wisp-source-track` 规则，替换为：

```css
/* 常驻凭证行。sticky 生效的前提是它作为 .wisp-task-panel 的直接子元素，
   包含块因此覆盖整个面板高度 —— 嵌进矮盒子会跟着一起滚走。
   只 sticky 这一行：顶部固定占用 78px（44 + 34），
   整条上下文栏 sticky 则要 132px。 */
.wisp-snapshot-header {
  position: sticky;
  top: 44px;
  z-index: 1;
  margin-inline: -16px;
  padding: 8px 16px;
  align-items: center;
  background: var(--wisp-bg);
  border-bottom: 1px solid var(--wisp-border);
}

.wisp-snapshot-host {
  color: var(--wisp-text-muted);
  font-size: 12px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 标题与字数：一次性信息，随内容滚走 */
.wisp-page-detail {
  margin-inline: -16px;
  padding: 10px 16px 12px;
  border-bottom: 1px solid var(--wisp-border);
}

.wisp-stamp {
  display: flex;
  align-items: center;
  flex-direction: column;
  gap: 3px;
}

.wisp-stamp-initial {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  background: var(--wisp-surface);
  border: 1px solid var(--wisp-border);
  border-radius: 7px;
  color: var(--wisp-accent);
  font-size: 14px;
  font-weight: 650;
}

.wisp-stamp-time {
  color: var(--wisp-text-muted);
  font-size: 11px;
  font-weight: 500;
  line-height: 16px;
  text-align: center;
}

.wisp-stamp.is-stale .wisp-stamp-initial {
  border-style: dashed;
  color: var(--wisp-text-muted);
}
```

- [ ] **Step 5: 构建并真机核对**

```bash
npm run build:dev
```

加载 `.output/chrome-mv3-dev`，核对：

- [ ] 轨迹线连续贯穿多轮，各轮之间无错位
- [ ] 节点形态：成功实心、空结果虚线空心、停止带横杠、错误暖红
- [ ] 滚动时凭证固定可见，标题与字数行滚走
- [ ] 顶部固定占用约 78px（顶栏 44 + 凭证行 34）

- [ ] **Step 6: 提交**

```bash
git add entrypoints/sidepanel/style.css
git commit -m "style: 页面级轨道栅格与快照凭证"
```

---

## Task 8: 排版层收敛与响应式

**Files:**
- Modify: `entrypoints/sidepanel/style.css`

**Interfaces:**
- Consumes: Task 7 的栅格
- Produces: 无

- [ ] **Step 1: 提高 muted 对比度**

`:root` 中把 `--wisp-text-muted` 由 `#697168` 改为 `#5f675e`（通过 WCAG AA）。

- [ ] **Step 2: 字号层级收敛到五档**

全文件搜索并替换违规字号：`font-size: 10px` → 删除该声明改用 11px；`font-size: 13px` → `14px`；`font-size: 16px` → `15px`；`font-size: 24px` → `20px`。

`.wisp-brand` 的 18px 保留——它是字标，不进文字层级。

- [ ] **Step 3: 等宽数字全局启用**

追加：

```css
.wisp-page-meta,
.wisp-stamp-time,
.wisp-thread-index,
.wisp-progress-figure {
  font-variant-numeric: tabular-nums;
}
```

- [ ] **Step 4: 模型输出的基线节奏**

```css
.wisp-turn-body .wisp-markdown-container > * + * {
  margin-top: 12px;
}

.wisp-turn-body .wisp-markdown-container h1,
.wisp-turn-body .wisp-markdown-container h2,
.wisp-turn-body .wisp-markdown-container h3 {
  margin: 20px 0 8px;
  font-size: 15px;
  font-weight: 600;
  line-height: 22px;
}

.wisp-turn-body .wisp-markdown-container p,
.wisp-turn-body .wisp-markdown-container li {
  line-height: 22px;
}
```

- [ ] **Step 5: 响应式三档**

```css
@media (max-width: 359px) {
  .wisp-task-panel {
    padding-inline: 14px;
  }

  .wisp-snapshot-header,
  .wisp-page-detail {
    margin-inline: -14px;
    padding-inline: 14px;
  }

  .wisp-snapshot-header,
  .wisp-page-detail,
  .wisp-turn {
    grid-template-columns: 28px minmax(0, 1fr);
    gap: 0 8px;
  }

  /* 320px 下轨道只留编号，任务标签移交纸面工具行 */
  .wisp-thread-type {
    display: none;
  }

  .wisp-turn-paper {
    margin-left: 8px;
  }
}

/* ≥420px 轨道不增宽，多出的宽度全部给内容 —— 轨道已占 44px，
   正文行宽是本设计的稀缺资源。 */
```

- [ ] **Step 6: reduced-motion 兜底**

确认既有的 `@media (prefers-reduced-motion: reduce)` 块（约 1197 行）已用 `animation-duration: 0.01ms !important` 覆盖 `wisp-thread-grow`。若未覆盖，在该块内追加：

```css
  .wisp-thread-line {
    animation: none !important;
  }
```

- [ ] **Step 7: 三宽度核对**

```bash
npm run build:dev
```

加载扩展，分别把侧边栏拖到 320 / 400 / 500px：

- [ ] 三档均无横向滚动
- [ ] 320px 下轨道收窄、任务标签隐去、编号仍可读
- [ ] 500px 下轨道仍为 44px，多出宽度给了正文
- [ ] 系统开启「减少动态效果」后轨迹不再生长

- [ ] **Step 8: 提交**

```bash
npm test
npx tsc --noEmit
git add entrypoints/sidepanel/style.css
git commit -m "style: 收敛字号层级并落地三档响应式"
```

---

## Task 9: 初始化页四步节点

**Files:**
- Create: `core/panel/setupSteps.ts`
- Test: `core/panel/setupSteps.test.ts`
- Modify: `entrypoints/sidepanel/components/ModelSetup.tsx`
- Modify: `entrypoints/sidepanel/style.css`

**Interfaces:**
- Consumes: `TurnStatus`（Task 1）、`Thread`（Task 4）
- Produces: `SetupStep`、`selectSetupSteps(modelStatus, hasCache): SetupStep[]`

- [ ] **Step 1: 写失败的测试**

创建 `core/panel/setupSteps.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { selectSetupSteps } from './setupSteps';

describe('selectSetupSteps', () => {
  it('始终产出四步', () => {
    expect(selectSetupSteps('uninitialized', false)).toHaveLength(4);
    expect(selectSetupSteps('ready', true)).toHaveLength(4);
  });

  it('下载中：前一步完成，下载步为进行中，其后待办', () => {
    const steps = selectSetupSteps('downloading', false);
    expect(steps.map((s) => s.state)).toEqual(['done', 'active', 'todo', 'todo']);
  });

  it('加载中：下载步已完成', () => {
    const steps = selectSetupSteps('loading', false);
    expect(steps.map((s) => s.state)).toEqual(['done', 'done', 'active', 'todo']);
  });

  it('就绪：四步全部完成', () => {
    expect(selectSetupSteps('ready', true).every((s) => s.state === 'done')).toBe(true);
  });

  it('出错：当前步标记为 failed，其后仍为待办', () => {
    const steps = selectSetupSteps('error', false);
    expect(steps.some((s) => s.state === 'failed')).toBe(true);
  });

  it('缓存命中时下载步文案改为「缓存命中」', () => {
    expect(selectSetupSteps('loading', true)[1].label).toBe('缓存命中');
    expect(selectSetupSteps('loading', false)[1].label).toBe('下载权重');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run core/panel/setupSteps.test.ts`
Expected: FAIL — `Failed to resolve import "./setupSteps"`

- [ ] **Step 3: 实现**

创建 `core/panel/setupSteps.ts`：

```ts
export type SetupStepState = 'done' | 'active' | 'todo' | 'failed';

export interface SetupStep {
  key: string;
  label: string;
  state: SetupStepState;
}

type ModelStatusInput =
  | 'uninitialized' | 'checking-cache' | 'downloading'
  | 'loading' | 'ready' | 'needs-user-choice' | 'error';

/** 各状态对应的「当前进行到第几步」，0 起 */
const ACTIVE_INDEX: Record<ModelStatusInput, number> = {
  uninitialized: 0,
  'needs-user-choice': 0,
  'checking-cache': 1,
  downloading: 1,
  loading: 2,
  error: 1,
  ready: 4,
};

/**
 * 初始化四步。轨迹在此复用同一套节点语汇，让「首次要等约 47 秒」
 * 变得可理解 —— 用户看得见自己在四步里的哪一步。
 */
export function selectSetupSteps(status: ModelStatusInput, hasCache: boolean): SetupStep[] {
  const active = ACTIVE_INDEX[status];
  const labels = [
    { key: 'confirm', label: '确认模型来源' },
    { key: 'fetch', label: hasCache ? '缓存命中' : '下载权重' },
    { key: 'load', label: '加载到后端' },
    { key: 'selfcheck', label: '自检一次生成' },
  ];
  return labels.map((step, i) => {
    let state: SetupStepState = 'todo';
    if (i < active) state = 'done';
    else if (i === active) state = status === 'error' ? 'failed' : 'active';
    return { ...step, state };
  });
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run core/panel/setupSteps.test.ts`
Expected: PASS，6 项全绿

- [ ] **Step 5: 接入 `ModelSetup`**

在 `ModelSetup.tsx` 顶部 import：

```tsx
import { selectSetupSteps } from '../../../core/panel/setupSteps';
```

新增一个局部展示组件（放在 `ModelSetup` 之前）：

```tsx
const SetupThread: React.FC<{ status: Parameters<typeof selectSetupSteps>[0]; hasCache: boolean }> = ({
  status, hasCache,
}) => (
  <ol className="wisp-setup-steps">
    {selectSetupSteps(status, hasCache).map((step, i) => (
      <li key={step.key} className={`wisp-setup-step is-${step.state}`}>
        <span className="wisp-setup-step-node" aria-hidden="true" />
        <span className="wisp-setup-step-index" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
        <span className="wisp-setup-step-label">{step.label}</span>
      </li>
    ))}
  </ol>
);
```

把四个 `return` 分支里的 `<div className="wisp-setup-index">00 / …</div>` 替换为
`<SetupThread status={modelStatus} hasCache={hasLegacyCache} />`。

- [ ] **Step 6: 样式**

`style.css` 追加：

```css
.wisp-setup-steps {
  margin: 0 0 20px;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0;
}

.wisp-setup-step {
  position: relative;
  padding: 0 0 14px 20px;
  display: flex;
  align-items: baseline;
  gap: 8px;
  color: var(--wisp-text-muted);
  font-size: 11px;
  font-weight: 500;
  line-height: 16px;
}

.wisp-setup-step:not(:last-child)::before {
  content: "";
  position: absolute;
  top: 8px;
  left: 3px;
  width: 1px;
  height: 100%;
  background: var(--wisp-border);
}

.wisp-setup-step-node {
  position: absolute;
  top: 5px;
  left: 0;
  width: 7px;
  height: 7px;
  box-sizing: border-box;
  border: 1px solid var(--wisp-border);
  border-radius: 50%;
  background: var(--wisp-bg);
}

.wisp-setup-step-index {
  font-variant-numeric: tabular-nums;
}

.wisp-setup-step.is-done .wisp-setup-step-node,
.wisp-setup-step.is-active .wisp-setup-step-node {
  border-color: var(--wisp-accent);
}

.wisp-setup-step.is-done .wisp-setup-step-node {
  background: var(--wisp-accent);
}

.wisp-setup-step.is-done:not(:last-child)::before {
  background: var(--wisp-accent);
}

.wisp-setup-step.is-active {
  color: var(--wisp-text);
}

.wisp-setup-step.is-failed .wisp-setup-step-node {
  border-color: var(--wisp-danger);
  background: var(--wisp-danger);
}

.wisp-setup-step.is-failed {
  color: var(--wisp-danger);
}
```

- [ ] **Step 7: 全量验证**

```bash
npm test
npx tsc --noEmit
npm run build:dev
```
Expected: 全绿、无类型错误、构建成功

真机核对：

- [ ] 首次进入显示四步，第一步为进行中
- [ ] 下载阶段第二步为进行中且前一步已完成
- [ ] 下载失败时该步转暖红

- [ ] **Step 8: 提交**

```bash
git add core/panel/setupSteps.ts core/panel/setupSteps.test.ts entrypoints/sidepanel/components/ModelSetup.tsx entrypoints/sidepanel/style.css
git commit -m "feat: 初始化页复用轨迹节点表达四步进度"
```

---

## Task 10: UISpec v3 与相关文档回写

**Files:**
- Modify: `docs/ui/Wisp_M2_UISpec.md`
- Modify: `docs/Wisp_M2收口与设计文档回写计划.md`
- Modify: `docs/superpowers/specs/2026-07-27-wisp-thread-ui-design.md`

**Interfaces:**
- Consumes: 前九个任务的实现结果
- Produces: 供 M3 Task 11 施工的工具条规范

> 本任务不写代码。划词工具条本体属 M3 Task 11 的实现范围，本计划只交付其视觉规范。

- [ ] **Step 1: UISpec 升为 v3**

`docs/ui/Wisp_M2_UISpec.md` 头部版本改为 v3，标题范围改为「Side Panel + 划词工具条」，并按以下改动落地：

- §4.1 颜色表：`--wisp-text-muted` 改为 `#5F675E`，注明原值未过 WCAG AA
- §4.2 字体表：收敛为五档（20/15/14/12/11px），删除 10/13/16/24px，注明 18px 字标不进层级
- §5.5 浏览器上下文栏：改写为「快照凭证 + 三行信息」，凭证 30px、只用域名首字母、不发网络请求、sticky 于顶栏之下
- §5.7 编辑器结果区：改为「轮次列表」，边注栏宽 44px（320px 档 28px），操作栏位于纸面**顶部**工具行并注明理由（长输出流式滚动时停止按钮须无需下拉即可点到）
- 新增 §5.9「轨迹」：线即分隔线、逐轮画段、五种状态形态表、`aria-hidden` 与文字承载状态的红线
- 新增 §5.10「划词工具条」：34px 高、8px 圆角、`--wisp-surface` 底、比面板深一档的 1px 边框、`0 4px 16px rgba(0,0,0,0.16)` 投影、左侧 3px 苔绿边条、四个动作用文字不用图标、点击后就地显示「正在解释…」与向右生长的 1px 苔绿线、约 1.5s 后消失、`role="toolbar"`、Esc 关闭、不做背景自适应（理由：会让苔绿在深色网页上消失）
- §7 响应式：按本计划 Task 8 的三档规则改写
- §8：`aria-live="polite"` 范围收窄为「只挂状态行，不挂正文容器」

- [ ] **Step 2: 标注收口计划 Task B 取消**

`docs/Wisp_M2收口与设计文档回写计划.md` 的 Task B 小节顶部加一行：

```markdown
> **本任务已取消**，被 `docs/superpowers/specs/2026-07-27-wisp-thread-ui-design.md` §5.2「只 sticky 快照凭证」取代——顶部固定占用 78px 优于本方案的 132px。
```

同时在 §9 完成判定中把「四个任务全部提交」改为「Task A / C / D 三个任务全部提交」。

- [ ] **Step 3: 修正 spec 的 `readAt` 表述**

`docs/superpowers/specs/2026-07-27-wisp-thread-ui-design.md` §10.1 末句「本设计不新增 store 字段——轮次是投影，不是状态」改为：

```markdown
**轮次是投影不是状态，不新增顶层 store 字段**；唯一的 store 改动是 `PageInfo` 增加 `readAt: number`，供快照凭证显示读取时刻。
```

§11 表格中 Task D 一行的理由同步改为「仅 `PageInfo.readAt` 一个字段变化，§3.3 回写时一并写入」。

- [ ] **Step 4: 提交**

```bash
git add docs/ui/Wisp_M2_UISpec.md docs/Wisp_M2收口与设计文档回写计划.md docs/superpowers/specs/2026-07-27-wisp-thread-ui-design.md
git commit -m "docs: UISpec 升为 v3 并回写轨迹设计的连带改动"
```

---

## 完成判定

- `npm test` / `npx tsc --noEmit` / `npm run build:dev` 全绿
- Task 7、8、9 的真机核对清单逐项勾选
- 320 / 400 / 500px 三种宽度截图无横向滚动
- UISpec v3 已含工具条规范，M3 Task 11 可直接照其施工
- 工作区无未提交改动

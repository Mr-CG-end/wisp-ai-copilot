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

  it('idle 的历史条目同样被剔除，编号不留空号', () => {
    const turns = selectTurns(
      [history({ id: 'h1' }), history({ id: 'h2', status: 'idle' }), history({ id: 'h3' })],
      null,
      '',
    );
    expect(turns.map((t) => t.id)).toEqual(['h1', 'h3']);
    expect(turns.map((t) => t.index)).toEqual([1, 2]);
    expect(turns.every((t) => t.statusLabel !== undefined)).toBe(true);
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

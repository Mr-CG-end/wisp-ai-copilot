import { describe, expect, it } from 'vitest';
import { truncateForContext } from './truncate';

describe('truncateForContext', () => {
  it('未超预算时原样返回', () => {
    const r = truncateForContext('第一段\n第二段', 100);
    expect(r).toEqual({ text: '第一段\n第二段', truncated: false, keptChars: 7 });
  });

  it('超预算时按段落边界从头部保留', () => {
    const text = ['一'.repeat(10), '二'.repeat(10), '三'.repeat(10)].join('\n');
    const r = truncateForContext(text, 21);
    expect(r.text).toBe(`${'一'.repeat(10)}\n${'二'.repeat(10)}`);
    expect(r.truncated).toBe(true);
    expect(r.keptChars).toBe(21);
  });

  it('首段本身超预算时按字符硬截断', () => {
    const r = truncateForContext('长'.repeat(50), 10);
    expect(r.text).toBe('长'.repeat(10));
    expect(r.truncated).toBe(true);
    expect(r.keptChars).toBe(10);
  });

  it('相同输入两次调用结果完全一致（确定性）', () => {
    const text = Array.from({ length: 30 }, (_, i) => `段落${i}内容`).join('\n');
    expect(truncateForContext(text, 40)).toEqual(truncateForContext(text, 40));
  });
});

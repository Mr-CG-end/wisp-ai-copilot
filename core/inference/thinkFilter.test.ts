import { describe, it, expect } from 'vitest';
import { ThinkFilter } from './thinkFilter';

// 便捷：喂入多段并收集全部输出（含 flush）
function run(chunks: string[]): string {
  const f = new ThinkFilter();
  let out = '';
  for (const c of chunks) out += f.push(c);
  out += f.flush();
  return out;
}

describe('ThinkFilter', () => {
  it('普通文本原样透传', () => {
    expect(run(['hello world'])).toBe('hello world');
  });

  it('整段 <think>...</think> 一次移除', () => {
    expect(run(['a<think>xyz</think>b'])).toBe('ab');
  });

  it('开标签跨分片也能识别，think 内容被丢弃', () => {
    expect(run(['a<thi', 'nk>xy</think>z'])).toBe('az');
  });

  it('闭标签跨分片也能识别', () => {
    expect(run(['<think>x</thi', 'nk>done'])).toBe('done');
  });

  it('未闭合的 <think> 到流结束时整段丢弃', () => {
    expect(run(['a<think>bcd'])).toBe('a');
  });

  it('空 <think></think> 结果为空', () => {
    expect(run(['<think></think>'])).toBe('');
  });

  it('普通文本中的 < 不被错误挂起', () => {
    expect(run(['a<b>c'])).toBe('a<b>c');
  });

  it('结尾处形似开标签前缀的 < 最终作为普通文本输出', () => {
    expect(run(['hi<', 'x'])).toBe('hi<x');
  });

  it('多个 think 块都被移除', () => {
    expect(run(['A<think>1</think>B<think>2</think>C'])).toBe('ABC');
  });

  it('token 级逐字符喂入仍正确', () => {
    const s = 'x<think>secret</think>y';
    expect(run([...s])).toBe('xy');
  });
});

import { describe, expect, it } from 'vitest';
import {
  datasetMetrics,
  documentMetrics,
  shingleMatch,
  tokenize,
} from './extractionMetrics';

describe('tokenize', () => {
  it('按 Unicode 词字符切分，不转小写', () => {
    expect(tokenize('The quick brown-fox')).toEqual(['The', 'quick', 'brown', 'fox']);
  });

  it('中文按标点切段，而不是整段丢弃', () => {
    // JS 的 \w 默认只匹配 ASCII，若照抄会让中文页面 token 数为 0，
    // 两篇完全不同的中文文章都会算出 F1=1（空 shingle 集合）。必须用 \p{L}。
    expect(tokenize('人工智能，正在改变 Web')).toEqual(['人工智能', '正在改变', 'Web']);
  });

  it('空串得到空数组', () => {
    expect(tokenize('')).toEqual([]);
  });
});

describe('shingleMatch', () => {
  it('完全一致时全部命中，且按和归一化', () => {
    const r = shingleMatch('the quick brown fox jumps', 'the quick brown fox jumps');
    expect(r).toEqual({ tp: 1, fp: 0, fn: 0 });
  });

  it('完全不同时对半分', () => {
    expect(shingleMatch('aaa bbb ccc ddd', 'eee fff ggg hhh')).toEqual({ tp: 0, fp: 0.5, fn: 0.5 });
  });

  it('预测多抓一段时产生 fp，不产生 fn', () => {
    // true 1 个 shingle；pred 2 个，其中 1 个命中、1 个多余 → 归一化前 (1,1,0)
    expect(shingleMatch('aaa bbb ccc ddd', 'aaa bbb ccc ddd eee')).toEqual({ tp: 0.5, fp: 0.5, fn: 0 });
  });

  it('token 数少于 n 时仍产出一个 shingle', () => {
    expect(shingleMatch('aaa bbb', 'aaa bbb')).toEqual({ tp: 1, fp: 0, fn: 0 });
  });

  it('两边都为空时计数全为 0，不做归一化', () => {
    expect(shingleMatch('', '')).toEqual({ tp: 0, fp: 0, fn: 0 });
  });
});

describe('documentMetrics', () => {
  it('完全一致得满分', () => {
    expect(documentMetrics('the quick brown fox jumps', 'the quick brown fox jumps'))
      .toEqual({ precision: 1, recall: 1, f1: 1, accuracy: 1 });
  });

  it('多抓内容只压低 precision，recall 仍为 1', () => {
    const m = documentMetrics('aaa bbb ccc ddd', 'aaa bbb ccc ddd eee');
    expect(m.precision).toBe(0.5);
    expect(m.recall).toBe(1);
    expect(m.f1).toBeCloseTo(2 / 3, 10);
    expect(m.accuracy).toBe(0); // token 序列不完全相同
  });

  it('漏抓内容只压低 recall', () => {
    const m = documentMetrics('aaa bbb ccc ddd eee', 'aaa bbb ccc ddd');
    expect(m.recall).toBe(0.5);
    expect(m.precision).toBe(1);
  });

  it('完全不相关时 precision/recall/f1 均为 0', () => {
    const m = documentMetrics('aaa bbb ccc ddd', 'eee fff ggg hhh');
    expect(m).toEqual({ precision: 0, recall: 0, f1: 0, accuracy: 0 });
  });

  it('两边都为空视为完全一致（对齐参考实现）', () => {
    expect(documentMetrics('', '')).toEqual({ precision: 1, recall: 1, f1: 1, accuracy: 1 });
  });
});

describe('datasetMetrics', () => {
  it('取各文档分数的平均，而不是先汇总计数', () => {
    // 一篇满分、一篇零分 → 均值 0.5。若先汇总计数会得到别的数。
    const r = datasetMetrics([
      { trueText: 'aaa bbb ccc ddd', predText: 'aaa bbb ccc ddd' },
      { trueText: 'aaa bbb ccc ddd', predText: 'eee fff ggg hhh' },
    ]);
    expect(r.precision).toBe(0.5);
    expect(r.recall).toBe(0.5);
    expect(r.f1).toBe(0.5);
    expect(r.accuracy).toBe(0.5);
    expect(r.count).toBe(2);
  });

  it('空数据集不抛错', () => {
    const r = datasetMetrics([]);
    expect(r.count).toBe(0);
    expect(r.f1).toBe(0);
  });
});

/**
 * 正文抽取质量度量。算法逐条对齐 scrapinghub/article-extraction-benchmark 的
 * `evaluate.py`，这样跑出来的分数才能和公开基线直接比较
 * （trafilatura F1 0.945 / go-readability F1 0.943）。
 *
 * 参考实现里三处容易写错、写错了数字就不可比：
 *   1. 每篇文档的 tp/fp/fn 要按三者之和归一化，否则长文会主导整体分数；
 *   2. 数据集分数是「各文档分数的平均」，不是「先汇总计数再算分」；
 *   3. token 不转小写。
 *
 * 未实现参考实现的 bootstrap 置信区间——本项目用它做配置对比，不发布数字。
 */

/**
 * 对应 Python 的 `re.compile(r'\w+', re.UNICODE)`。
 * ⚠️ JS 的 `\w` 默认只匹配 ASCII，直接照抄会让中文页面切不出任何 token，
 * 于是任意两篇中文文章的 shingle 集合都为空、precision/recall 双双返回 1，
 * 变成一个永远满分的假指标。
 */
const TOKEN_RE = /[\p{L}\p{M}\p{N}_]+/gu;

const DEFAULT_NGRAM_N = 4;

export interface TpFpFn {
  tp: number;
  fp: number;
  fn: number;
}

export interface DocumentScore {
  precision: number;
  recall: number;
  f1: number;
  accuracy: number;
}

export interface DatasetScore extends DocumentScore {
  count: number;
}

export function tokenize(text: string): string[] {
  return text ? (text.match(TOKEN_RE) ?? []) : [];
}

/**
 * 计数 n-gram shingle。token 数不足 n 时仍产出一个（整串），对应参考实现的
 * `range(0, max(1, len(tokens) - n + 1))`；token 为空时不产出。
 */
function countShingles(text: string, ngramN: number): Map<string, number> {
  const tokens = tokenize(text);
  const counts = new Map<string, number>();
  const limit = Math.max(1, tokens.length - ngramN + 1);
  for (let i = 0; i < limit; i += 1) {
    const shingle = tokens.slice(i, i + ngramN);
    if (shingle.length === 0) continue;
    // token 由 \p{L}\p{M}\p{N}_ 组成，不含空格，用空格连接无歧义
    const key = shingle.join(' ');
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** 按 shingle 多重集比对，结果按 tp+fp+fn 归一化。 */
export function shingleMatch(
  trueText: string,
  predText: string,
  ngramN: number = DEFAULT_NGRAM_N,
): TpFpFn {
  const trueShingles = countShingles(trueText, ngramN);
  const predShingles = countShingles(predText, ngramN);

  let tp = 0;
  let fp = 0;
  let fn = 0;
  for (const key of new Set([...trueShingles.keys(), ...predShingles.keys()])) {
    const trueCount = trueShingles.get(key) ?? 0;
    const predCount = predShingles.get(key) ?? 0;
    tp += Math.min(trueCount, predCount);
    fp += Math.max(0, predCount - trueCount);
    fn += Math.max(0, trueCount - predCount);
  }

  const sum = tp + fp + fn;
  if (sum > 0) return { tp: tp / sum, fp: fp / sum, fn: fn / sum };
  return { tp, fp, fn };
}

export function precisionScore({ tp, fp, fn }: TpFpFn): number {
  if (fp === 0 && fn === 0) return 1;
  if (tp === 0 && fp === 0) return 0;
  return tp / (tp + fp);
}

export function recallScore({ tp, fp, fn }: TpFpFn): number {
  if (fp === 0 && fn === 0) return 1;
  if (tp === 0 && fn === 0) return 0;
  return tp / (tp + fn);
}

export function f1FromPr(precision: number, recall: number): number {
  if (precision + recall === 0) return 0;
  return (2 * precision * recall) / (precision + recall);
}

export function documentMetrics(
  trueText: string,
  predText: string,
  ngramN: number = DEFAULT_NGRAM_N,
): DocumentScore {
  const counts = shingleMatch(trueText, predText, ngramN);
  const precision = precisionScore(counts);
  const recall = recallScore(counts);
  return {
    precision,
    recall,
    f1: f1FromPr(precision, recall),
    // 参考实现的 accuracy 是二值的：token 序列完全一致才算 1
    accuracy: tokenize(trueText).join(' ') === tokenize(predText).join(' ') ? 1 : 0,
  };
}

export function datasetMetrics(
  pairs: readonly { trueText: string; predText: string }[],
  ngramN: number = DEFAULT_NGRAM_N,
): DatasetScore {
  if (pairs.length === 0) {
    return { precision: 0, recall: 0, f1: 0, accuracy: 0, count: 0 };
  }
  const scores = pairs.map((pair) => documentMetrics(pair.trueText, pair.predText, ngramN));
  const mean = (pick: (s: DocumentScore) => number): number =>
    scores.reduce((total, score) => total + pick(score), 0) / scores.length;
  return {
    precision: mean((s) => s.precision),
    recall: mean((s) => s.recall),
    f1: mean((s) => s.f1),
    accuracy: mean((s) => s.accuracy),
    count: scores.length,
  };
}

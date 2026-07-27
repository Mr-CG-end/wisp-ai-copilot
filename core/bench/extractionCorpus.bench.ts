// @vitest-environment jsdom
/**
 * 用 scrapinghub/article-extraction-benchmark 的语料评测 extractArticle。
 *
 * 语料不入库（真实网页快照，gz 压缩后数 MB 量级），目录在 .gitignore 里。**未安装时整组跳过**，
 * 因此普通开发机上 `npm test` 不受影响。
 *
 * 单独跑：`npm run bench:extraction`。
 * 注意语料装好之后它也会被 `npm test` 收集（约一分钟），这是有意的——
 * 装了语料就说明你想要这个数字。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { extractArticle } from '../extract/article';
import { datasetMetrics, documentMetrics } from './extractionMetrics';

const CORPUS_DIR = process.env.WISP_EXTRACTION_CORPUS
  ?? path.resolve(process.cwd(), 'bench-corpus');
const GROUND_TRUTH = path.join(CORPUS_DIR, 'ground-truth.json');
const HTML_DIR = path.join(CORPUS_DIR, 'html');
const hasCorpus = existsSync(GROUND_TRUTH) && existsSync(HTML_DIR);

if (!hasCorpus) {
  console.info(
    `\n[bench] 未找到抽取评测语料，已跳过。获取方式：\n`
    + `  git clone --depth 1 https://github.com/scrapinghub/article-extraction-benchmark bench-corpus\n`
    + `或用 WISP_EXTRACTION_CORPUS 指向已有的克隆目录。当前查找路径：${CORPUS_DIR}\n`,
  );
}

interface GroundTruthEntry {
  articleBody?: string;
  url?: string;
}

/** html/ 下的文件名可能带 .html 或 .html.gz，按去扩展名后的 id 建索引。 */
function buildHtmlIndex(): Map<string, string> {
  const index = new Map<string, string>();
  for (const file of readdirSync(HTML_DIR)) {
    index.set(file.replace(/\.html(\.gz)?$/i, ''), file);
  }
  return index;
}

function readHtml(file: string): string {
  const raw = readFileSync(path.join(HTML_DIR, file));
  return file.toLowerCase().endsWith('.gz')
    ? gunzipSync(raw).toString('utf8')
    : raw.toString('utf8');
}

function pct(value: number): string {
  return (value * 100).toFixed(1);
}

describe.skipIf(!hasCorpus)('extractArticle 对照 article-extraction-benchmark', () => {
  it('输出 precision / recall / F1 与降级占比', () => {
    const truth = JSON.parse(readFileSync(GROUND_TRUTH, 'utf8')) as Record<string, GroundTruthEntry>;
    const htmlIndex = buildHtmlIndex();

    const pairs: { id: string; trueText: string; predText: string }[] = [];
    const method = { readability: 0, heuristic: 0, none: 0 };
    let missingHtml = 0;
    let parseFailed = 0;

    for (const [id, entry] of Object.entries(truth)) {
      const file = htmlIndex.get(id);
      if (!file) {
        missingHtml += 1;
        continue;
      }

      let predText = '';
      try {
        const doc = new DOMParser().parseFromString(readHtml(file), 'text/html');
        const result = extractArticle(doc);
        predText = result?.text ?? '';
        method[result?.method ?? 'none'] += 1;
      } catch (error) {
        // jsdom 在个别畸形页面上会抛，记为解析失败而不是静默算 0 分
        parseFailed += 1;
        console.warn(`[bench] 解析失败 ${id}:`, (error as Error).message);
      }

      pairs.push({ id, trueText: entry.articleBody ?? '', predText });
    }

    const overall = datasetMetrics(pairs);
    const total = pairs.length;

    console.log('\n===== extractArticle 抽取质量 =====');
    console.log(`语料 ${total} 篇（缺 HTML ${missingHtml} 篇，解析失败 ${parseFailed} 篇）`);
    console.log(`precision ${overall.precision.toFixed(3)}`);
    console.log(`recall    ${overall.recall.toFixed(3)}`);
    console.log(`F1        ${overall.f1.toFixed(3)}`);
    console.log(`accuracy  ${overall.accuracy.toFixed(3)}（token 序列完全一致的比例）`);
    console.log(
      `抽取路径：readability ${method.readability}（${pct(method.readability / total)}%）`
      + ` / heuristic ${method.heuristic}（${pct(method.heuristic / total)}%）`
      + ` / 无正文 ${method.none}（${pct(method.none / total)}%）`,
    );
    console.log('公开基线：trafilatura F1 0.945 · go-readability F1 0.943');

    const worst = pairs
      .map((pair) => ({ id: pair.id, ...documentMetrics(pair.trueText, pair.predText) }))
      .sort((a, b) => a.f1 - b.f1)
      .slice(0, 10);
    console.log('\n--- F1 最低的 10 篇（先看这些的失败模式）---');
    for (const item of worst) {
      console.log(
        `  ${item.f1.toFixed(3)}  P=${item.precision.toFixed(3)} R=${item.recall.toFixed(3)}  ${item.id}`,
      );
    }

    // 只断言评测确实跑过。质量下限等首次基线出来后再按实测值锁定，
    // 现在写一个拍脑袋的阈值只会是假的门槛。
    expect(total).toBeGreaterThan(0);
  }, 900_000);
});

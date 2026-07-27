import { Readability } from '@mozilla/readability';

/** 超过该 DOM 节点数不跑 readability（它是同步单次操作，无法分片）。 */
export const MAX_DOM_NODES = 12_000;
/** 低于该字符数视为「页面无正文」。 */
export const MIN_ARTICLE_CHARS = 200;
/**
 * 启发式提取的字符上限，防止异常页面把主线程占住。
 * 取值远高于单次生成预算（QA 2000 字）：摘要按段落跨全文取样而非只取开头，
 * 过低的上限会让长文摘要只看得到前半篇。真实长文都在 5 万字内完整保留。
 */
export const MAX_HEURISTIC_CHARS = 50_000;

const STRIP_SELECTOR = 'script,style,noscript,template,nav,header,footer,aside,form,iframe';

export interface ExtractResult {
  title: string;
  text: string;
  charCount: number;
  method: 'readability' | 'heuristic';
}

function normalizeText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * 降级提取。不克隆 DOM —— 本函数在宿主页面主线程同步执行，而降级路径恰恰是
 * 被巨型页面触发的，`cloneNode(true)` 会为几万节点再分配一份平行 DOM 造成可感知冻结。
 * TreeWalker 天然只读，比「在 clone 上删节点」更强地保证不污染页面。
 */
function heuristicText(doc: Document): string {
  const root = doc.querySelector('main') ?? doc.querySelector('article') ?? doc.body;
  if (!root) return '';

  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
      return (node as Element).matches(STRIP_SELECTOR)
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_SKIP;
    },
  });

  const chunks: string[] = [];
  let total = 0;
  for (let node = walker.nextNode(); node && total < MAX_HEURISTIC_CHARS; node = walker.nextNode()) {
    const text = node.nodeValue ?? '';
    chunks.push(text);
    total += text.length;
  }
  return normalizeText(chunks.join('').slice(0, MAX_HEURISTIC_CHARS));
}

/**
 * 正文提取：readability 优先，DOM 过大或结果过短时降级启发式。
 * 两条路径都不修改调用方的 document —— readability 走 clone，降级路径只读遍历。
 */
export function extractArticle(doc: Document): ExtractResult | null {
  const nodeCount = doc.getElementsByTagName('*').length;

  if (nodeCount <= MAX_DOM_NODES) {
    let parsed: ReturnType<Readability['parse']> = null;
    try {
      parsed = new Readability(doc.cloneNode(true) as Document).parse();
    } catch {
      parsed = null;
    }
    const text = normalizeText(parsed?.textContent ?? '');
    if (text.length >= MIN_ARTICLE_CHARS) {
      return {
        title: parsed?.title || doc.title || '',
        text,
        charCount: text.length,
        method: 'readability',
      };
    }
  }

  const fallback = heuristicText(doc);
  if (fallback.length < MIN_ARTICLE_CHARS) return null;
  return { title: doc.title || '', text: fallback, charCount: fallback.length, method: 'heuristic' };
}

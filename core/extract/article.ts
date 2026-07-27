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

/**
 * 进入这些元素时插入换行，把块边界写进纯文本。
 *
 * 必须显式插入：`textContent` 与文本节点首尾相接都**不会**产生换行，静态站点
 * 只是碰巧在标签之间有空白文本节点才看起来正常；JS 渲染出的 DOM（docsify、
 * React 等）没有那些空白，整页会粘成一个巨块，下游按段落切分的选段逻辑随之
 * 全部失效，只能退化成「砍前 N 字」。
 */
const BLOCK_SELECTOR = 'address,article,aside,blockquote,br,dd,div,dl,dt,figcaption,figure,'
  + 'footer,form,h1,h2,h3,h4,h5,h6,header,hr,li,main,nav,ol,p,pre,section,table,tbody,td,'
  + 'tfoot,th,thead,tr,ul';

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
 * 块级感知的纯文本序列化，两条抽取路径共用。
 *
 * 不克隆 DOM —— 降级路径恰恰是被巨型页面触发的，`cloneNode(true)` 会为几万节点
 * 再分配一份平行 DOM，而本函数在宿主页面主线程同步执行。TreeWalker 天然只读，
 * 比「在 clone 上删节点」更强地保证不污染页面。
 */
function blockAwareText(root: Element, limit: number): string {
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
      const element = node as Element;
      if (element.matches(STRIP_SELECTOR)) return NodeFilter.FILTER_REJECT;
      // 块级元素本身也接受，只为在进入时补一个换行；其余元素继续下钻
      return element.matches(BLOCK_SELECTOR) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    },
  });

  const chunks: string[] = [];
  let total = 0;
  for (let node = walker.nextNode(); node && total < limit; node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.nodeValue ?? '';
      chunks.push(text);
      total += text.length;
    } else {
      chunks.push('\n');
    }
  }
  return normalizeText(chunks.join('').slice(0, limit));
}

function heuristicText(doc: Document): string {
  const root = doc.querySelector('main') ?? doc.querySelector('article') ?? doc.body;
  if (!root) return '';
  return blockAwareText(root, MAX_HEURISTIC_CHARS);
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
    // 走 parsed.content（清洗后的 HTML）而非 parsed.textContent：后者同样不产生
    // 块边界，在 JS 渲染的页面上会把整篇粘成一块。此处不设字符上限，保持原行为。
    const text = parsed?.content
      ? blockAwareText(
          new DOMParser().parseFromString(parsed.content, 'text/html').body,
          Number.POSITIVE_INFINITY,
        )
      : normalizeText(parsed?.textContent ?? '');
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

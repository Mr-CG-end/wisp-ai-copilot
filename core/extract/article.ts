import { Readability } from '@mozilla/readability';

/** 超过该 DOM 节点数不跑 readability（它是同步单次操作，无法分片）。 */
export const MAX_DOM_NODES = 12_000;
/** 低于该字符数视为「页面无正文」。 */
export const MIN_ARTICLE_CHARS = 200;

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

function heuristicText(doc: Document): string {
  const clone = doc.cloneNode(true) as Document;
  clone.querySelectorAll(STRIP_SELECTOR).forEach((el) => el.remove());
  const root = clone.querySelector('main') ?? clone.querySelector('article') ?? clone.body;
  return normalizeText(root?.textContent ?? '');
}

/**
 * 正文提取：readability 优先，DOM 过大或结果过短时降级启发式。
 * 不修改调用方的 document —— 两条路径都在 clone 上操作。
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

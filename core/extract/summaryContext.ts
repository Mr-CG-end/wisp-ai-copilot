export const SUMMARY_CONTEXT_CHAR_BUDGET = 1400;

export interface SummaryContext {
  text: string;
  originalChars: number;
  selectedChars: number;
  compressed: boolean;
}

const HEADING_PATTERN =
  /^(?:#{1,6}\s+|第.{1,12}[章节部分篇]|[一二三四五六七八九十]+[、.．]|[（(]?[一二三四五六七八九十\d]+[）)、.．]|\d+(?:\.\d+)*[、.．)\s])/;

function isLikelyHeading(paragraph: string): boolean {
  return paragraph.length <= 72 && HEADING_PATTERN.test(paragraph);
}

/**
 * 正文段落的最小长度。短于此又不是标题的行——裸标识符、导航项、单词列表项——
 * 对摘要没有任何贡献，却会在预算接近用满时被大量塞进来：那时只有短行还塞得下。
 * 实测一篇 2728 字的文档页，无论预算取 1000 / 1400 / 2000，都有约三分之一的
 * 预算被这类碎片占据，模型收到一堆孤立词条后会把摘要写成术语表。
 */
const MIN_BODY_CHARS = 24;

function isEligibleBody(paragraph: string): boolean {
  return paragraph.length >= MIN_BODY_CHARS || isLikelyHeading(paragraph);
}

function sampleEvenly(indices: number[], limit: number): number[] {
  if (indices.length <= limit) return indices;
  if (limit <= 1) return [indices[0]];
  return Array.from({ length: limit }, (_, index) => {
    const position = Math.round(index * (indices.length - 1) / (limit - 1));
    return indices[position];
  });
}

/**
 * 为摘要确定性选择代表段落。完整正文仍由 PageInfo 保存；
 * 本函数只产生一次生成使用的派生上下文，不承担 RAG 检索职责。
 */
export function selectSummaryContext(
  rawText: string,
  budget: number = SUMMARY_CONTEXT_CHAR_BUDGET,
): SummaryContext {
  const text = rawText.trim();
  if (text.length <= budget) {
    return {
      text,
      originalChars: text.length,
      selectedChars: text.length,
      compressed: false,
    };
  }

  const paragraphs = text
    .split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  if (paragraphs.length === 0) {
    const selected = text.slice(0, budget);
    return {
      text: selected,
      originalChars: text.length,
      selectedChars: selected.length,
      compressed: true,
    };
  }

  const allIndices = paragraphs.map((_, index) => index);
  const headingIndices = allIndices.filter((index) => isLikelyHeading(paragraphs[index]));
  const sampledHeadings = sampleEvenly(headingIndices, 10);
  const sampledBody = sampleEvenly(allIndices, 12);
  // 只有首段与末段按位置豁免长度门槛——文章的导语与结论即使很短也承载主旨。
  // 第二段不豁免：页面以标题开头时它往往只是标题后的第一个短行。
  const anchorSet = new Set([0, paragraphs.length - 1]);
  const priorities = [
    0,
    1,
    paragraphs.length - 1,
    ...sampledHeadings,
    ...sampledHeadings.map((index) => index + 1),
    ...sampledBody,
    ...allIndices,
  ];

  const selected = new Set<number>();
  let used = 0;
  for (const index of priorities) {
    if (index < 0 || index >= paragraphs.length || selected.has(index)) continue;
    const paragraph = paragraphs[index];
    if (!anchorSet.has(index) && !isEligibleBody(paragraph)) continue;
    const separatorCost = selected.size === 0 ? 0 : 2;
    if (used + separatorCost + paragraph.length > budget) continue;
    selected.add(index);
    used += separatorCost + paragraph.length;
  }

  if (selected.size === 0) {
    const clipped = paragraphs[0].slice(0, budget);
    return {
      text: clipped,
      originalChars: text.length,
      selectedChars: clipped.length,
      compressed: true,
    };
  }

  const selectedText = [...selected]
    .sort((left, right) => left - right)
    .map((index) => paragraphs[index])
    .join('\n\n');
  return {
    text: selectedText,
    originalChars: text.length,
    selectedChars: selectedText.length,
    compressed: true,
  };
}

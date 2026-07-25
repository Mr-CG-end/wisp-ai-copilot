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
    const separatorCost = selected.size === 0 ? 0 : 2;
    const paragraph = paragraphs[index];
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

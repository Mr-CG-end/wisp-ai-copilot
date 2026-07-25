/** 中文正文的上下文字符预算。真机长文首字延迟偏高，按阶段计划的降档规则收紧到 2000。 */
export const CONTEXT_CHAR_BUDGET = 2000;

export interface TruncateResult {
  text: string;
  truncated: boolean;
  keptChars: number;
}

/**
 * 确定性截断：头部优先、段落边界对齐、无随机与无时间依赖。
 * 相同输入必然得到相同输出，保证跨次实测可比。
 */
export function truncateForContext(text: string, budget: number = CONTEXT_CHAR_BUDGET): TruncateResult {
  if (text.length <= budget) {
    return { text, truncated: false, keptChars: text.length };
  }

  const paragraphs = text.split('\n');
  const kept: string[] = [];
  let used = 0;
  for (const paragraph of paragraphs) {
    const cost = kept.length === 0 ? paragraph.length : paragraph.length + 1;
    if (used + cost > budget) break;
    kept.push(paragraph);
    used += cost;
  }

  if (kept.length === 0) {
    return { text: text.slice(0, budget), truncated: true, keptChars: budget };
  }
  return { text: kept.join('\n'), truncated: true, keptChars: used };
}

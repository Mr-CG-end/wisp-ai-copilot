import { describe, expect, it } from 'vitest';
import { selectSummaryContext } from './summaryContext';

describe('selectSummaryContext', () => {
  it('短正文保持原样', () => {
    expect(selectSummaryContext('第一段\n\n第二段', 100)).toEqual({
      text: '第一段\n\n第二段',
      originalChars: 8,
      selectedChars: 8,
      compressed: false,
    });
  });

  it('长正文保留开头、结尾并覆盖分布在全文中的标题', () => {
    const sections = Array.from({ length: 8 }, (_, index) => (
      `${index + 1}. 第${index + 1}部分\n${String(index + 1).repeat(180)}`
    ));
    const text = ['文章导语', ...sections, '文章结论'].join('\n\n');
    const result = selectSummaryContext(text, 620);

    expect(result.compressed).toBe(true);
    expect(result.text).toContain('文章导语');
    expect(result.text).toContain('1. 第1部分');
    expect(result.text).toContain('8. 第8部分');
    expect(result.text).toContain('文章结论');
    expect(result.text.length).toBeLessThanOrEqual(620);
  });

  it('相同输入始终得到相同选择结果', () => {
    const text = Array.from({ length: 40 }, (_, index) => (
      `${index + 1}. 标题\n第 ${index + 1} 段内容${'文'.repeat(60)}`
    )).join('\n\n');
    expect(selectSummaryContext(text, 800)).toEqual(selectSummaryContext(text, 800));
  });
});

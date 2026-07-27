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

  it('裸标识符等短行不占用摘要预算', () => {
    // docs 站点的典型形状：小节标题后跟一串一行一个的标识符。
    // 这些行既短又无语义，若被选进 material，模型会把摘要写成术语表。
    const text = Array.from({ length: 8 }, (_, i) => [
      `## 第 ${i + 1} 节 流程装配`,
      `checkout_flow_${i + 1}`,
      `cassia_${i + 1}`,
      `integration_${i + 1}`,
      `第 ${i + 1} 节正文说明了装配细节与常见误用${'，以及配套的约束条件'.repeat(6)}。`,
    ].join('\n')).join('\n');

    const result = selectSummaryContext(text, 1000);

    expect(result.compressed).toBe(true);
    expect(result.text).not.toContain('checkout_flow_');
    expect(result.text).not.toContain('cassia_');
    expect(result.text).not.toContain('integration_');
    // 标题保留（它表达文档结构），正文保留
    expect(result.text).toContain('## 第 1 节 流程装配');
    expect(result.text).toContain('节正文说明了装配细节');
  });

  it('通篇都是短行时仍产出内容，不返回空', () => {
    const text = Array.from({ length: 40 }, (_, i) => `条目${i + 1}`).join('\n');
    const result = selectSummaryContext(text, 60);
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.selectedChars).toBeGreaterThan(0);
  });

  it('相同输入始终得到相同选择结果', () => {
    const text = Array.from({ length: 40 }, (_, index) => (
      `${index + 1}. 标题\n第 ${index + 1} 段内容${'文'.repeat(60)}`
    )).join('\n\n');
    expect(selectSummaryContext(text, 800)).toEqual(selectSummaryContext(text, 800));
  });
});

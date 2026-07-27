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

  it('长文中开头主旨不被跨全文采样的小节标题挤出', () => {
    // 主旨落在第 3 段——不在 [0, 1, 末段] 这三个位置锚点上，只能靠开头预留拿到。
    // 复现条件（缺一不可）：标题后紧跟长正文，采样层的 +1 邻居才会把预算吃到
    // 只剩十几字的缝隙；于是 6 字的小节标题挤得进，59 字的主旨段挤不进。
    const lead = [
      '第 10 章 快速上手与 HelloWorld',
      '本章课程目标：',
      '完成从环境准备到第一次成功调用的闭环，重点是理解接入模型所必需的调用三件套这一组信息，以及它们各自在请求链路中的作用。',
      '会运行并理解本章全部案例：环境检查、最小示例、多模型共存、企业级封装与流式输出，为后续章节打基础。',
    ];
    const sections = Array.from({ length: 40 }, (_, i) => [
      `${i + 1}、章节标题`,
      `第 ${i + 1} 节正文${'，展开实现细节与注意事项'.repeat(16)}。`,
    ].join('\n'));

    const result = selectSummaryContext([...lead, ...sections].join('\n'), 1000);

    expect(result.compressed).toBe(true);
    expect(result.text).toContain('调用三件套');
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

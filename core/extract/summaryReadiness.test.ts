import { describe, expect, it } from 'vitest';
import { assessSummaryReadiness } from './summaryReadiness';

const GITHUB_ACTIVITY_FIXTURE = `Edit pinned items

Skip to contributions year list

Learn how we count contributions

Medium-low contributions.

Medium-high contributions.

64 commits

17 commits

Mr-CG-end/agent-harness-bootstrap

3 commits

2 commits

Mr-CG-end/agent-harness-bootstrap

This contribution was made on Aug 10

This contribution was made on Aug 4

This contribution was made on Aug 4

Created a pull request in YishenTu/claudian that received 1

fix: detect Claude Code installed under nvm-for-Windows

nvm-for-Windows keeps global npm packages under the active version directory, which NVM_SYMLINK points at:

Mr-CG-end/agent-harness-bootstrap

This contribution was made on Aug 10

This contribution was made on Aug 10

chore: Dockerfile 配置 npmmirror 镜像源加速构建

This contribution was made on Aug 8

feat: 完成 V2.0 AI 治理与发布收口

This contribution was made on Aug 7

fix: read the basename from either path separator in the file-naming lint rule

This contribution was made on Aug 4

2025`;

const CHINESE_PARAGRAPH =
  '浏览器端推理把模型和输入数据保留在本地设备上，可以降低敏感内容离开设备的风险。实际部署仍需要处理模型下载、缓存完整性、硬件兼容和失败恢复等问题，不能只比较单次生成速度。';
const ENGLISH_PARAGRAPH =
  'Local inference keeps source material on the device and can reduce disclosure risk, but a reliable product must still handle model delivery, cache integrity, hardware compatibility, cancellation, and recovery instead of comparing generation speed alone.';

describe('assessSummaryReadiness', () => {
  it('拒绝用户给出的 GitHub 个人主页活动流', () => {
    const result = assessSummaryReadiness({
      text: GITHUB_ACTIVITY_FIXTURE,
      title: 'Mr-CG-end · Overview',
      url: 'https://github.com/Mr-CG-end',
      method: 'readability',
    });

    expect(result.decision).toBe('reject');
    if (result.decision === 'reject') expect(result.reason).toBe('activity_feed');
    expect(result.signals).toContain('github_profile_url');
    expect(result.signals.some((signal) => signal.startsWith('activity_markers:'))).toBe(true);
  });

  it('GitHub README 有连续说明文字时允许摘要', () => {
    const result = assessSummaryReadiness({
      text: ['Wisp', CHINESE_PARAGRAPH.repeat(2), '安装', CHINESE_PARAGRAPH.repeat(2)].join('\n\n'),
      title: 'Mr-CG-end/wisp: README',
      url: 'https://github.com/Mr-CG-end/wisp',
      method: 'readability',
    });

    expect(result.decision).toBe('allow');
  });

  it('GitHub Issue 的标题、正文和讨论不会被活动标记误杀', () => {
    const result = assessSummaryReadiness({
      text: [
        '首次模型下载耗时过长',
        CHINESE_PARAGRAPH.repeat(2),
        '复现步骤',
        CHINESE_PARAGRAPH,
        '维护者回复',
        CHINESE_PARAGRAPH,
      ].join('\n\n'),
      title: '首次模型下载耗时过长 · Issue #42',
      url: 'https://github.com/Mr-CG-end/wisp/issues/42',
      method: 'readability',
    });

    expect(result.decision).toBe('allow');
  });

  it.each([
    {
      title: '本地推理的工程边界',
      url: 'https://example.com/zh/article',
      text: Array.from({ length: 5 }, (_, index) => `第${index + 1}段。${CHINESE_PARAGRAPH}`).join('\n\n'),
    },
    {
      title: 'Engineering boundaries of local inference',
      url: 'https://example.com/en/article',
      text: Array.from({ length: 5 }, (_, index) => `Part ${index + 1}. ${ENGLISH_PARAGRAPH}`).join('\n\n'),
    },
  ])('允许普通中英文文章：$title', ({ text, title, url }) => {
    expect(assessSummaryReadiness({ text, title, url, method: 'readability' }).decision)
      .toBe('allow');
  });

  it('允许带短标题和代码标识符的技术文档', () => {
    const text = Array.from({ length: 5 }, (_, index) => [
      `${index + 1}. 配置步骤`,
      `remoteHost_${index}`,
      `${CHINESE_PARAGRAPH}${CHINESE_PARAGRAPH}`,
    ].join('\n')).join('\n\n');

    expect(assessSummaryReadiness({
      text,
      title: '模型源配置文档',
      url: 'https://docs.example.com/model-source',
      method: 'heuristic',
    }).decision).toBe('allow');
  });

  it('FAQ 短行占比高时只警告，不直接拒绝', () => {
    const text = Array.from({ length: 12 }, (_, index) => [
      `问题 ${index + 1}：如何处理？`,
      `回答 ${index + 1}：请检查设置并重新尝试。`,
    ].join('\n')).join('\n');
    const result = assessSummaryReadiness({
      text,
      title: '常见问题 FAQ',
      url: 'https://example.com/faq',
      method: 'readability',
    });

    expect(result).toMatchObject({ decision: 'warn', reason: 'possibly_fragmented' });
  });

  it('同一类活动文案重复三次不足以判定 activity feed', () => {
    const text = [
      'This contribution was made on Aug 10',
      'This contribution was made on Aug 9',
      'This contribution was made on Aug 8',
      ...Array.from({ length: 5 }, () => ENGLISH_PARAGRAPH),
    ].join('\n');
    const result = assessSummaryReadiness({
      text,
      title: 'Release retrospective',
      url: 'https://example.com/retrospective',
      method: 'readability',
    });

    expect(result.decision).not.toBe('reject');
  });

  it('连续文章引用多类活动文案时不因关键词直接拒绝', () => {
    const text = [
      'This contribution was made on Aug 10',
      'This contribution was made on Aug 9',
      'Created a pull request in an example repository',
      ...Array.from({ length: 6 }, () => ENGLISH_PARAGRAPH),
    ].join('\n');
    const result = assessSummaryReadiness({
      text,
      title: 'How contribution feeds are represented',
      url: 'https://example.com/articles/contribution-feeds',
      method: 'readability',
    });

    expect(result.decision).toBe('allow');
  });

  it('只有碎片形状但没有重复模板或结构签名时仅警告', () => {
    const labels = [
      '甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸',
      '子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉',
    ];
    const text = labels.map((label) => `${label}号清晨微风掠过安静窗台`).join('\n');
    const result = assessSummaryReadiness({
      text,
      title: '短句随笔',
      url: 'https://example.com/notes',
      method: 'readability',
    });

    expect(result).toMatchObject({ decision: 'warn', reason: 'possibly_fragmented' });
  });

  it('八行是通用碎片判定的最低行数', () => {
    const text = Array.from({ length: 8 }, (_, index) => `菜单项目 ${index + 1} · 查看详情`).join('\n');
    const result = assessSummaryReadiness({
      text: `${text}。这是补足字符门槛但不增加段落结构的说明文字。`.repeat(2),
      title: '项目列表',
      url: 'https://example.com/items',
      method: 'heuristic',
    });

    expect(result.decision).not.toBe('allow');
  });

  it('拒绝没有活动语义的高度碎片化列表', () => {
    const text = Array.from({ length: 30 }, (_, index) => `筛选项目 ${index + 1} · 查看详情`).join('\n');
    expect(assessSummaryReadiness({
      text,
      title: '筛选结果',
      url: 'https://example.com/results',
      method: 'heuristic',
    })).toMatchObject({ decision: 'reject', reason: 'fragmented_content' });
  });

  it('拒绝由多组标题和摘要组成的搜索结果页', () => {
    const text = Array.from({ length: 5 }, (_, index) => [
      `结果 ${index + 1}：浏览器本地推理实践`,
      `${CHINESE_PARAGRAPH.slice(0, 88)}……`,
    ].join('\n')).join('\n');
    const result = assessSummaryReadiness({
      text,
      title: '本地推理 - 搜索结果',
      url: 'https://example.com/search?q=local-inference',
      method: 'readability',
    });

    expect(result).toMatchObject({ decision: 'reject', reason: 'fragmented_content' });
    expect(result.signals).toContain('search_results_page');
    expect(result.signals).toContain('title_snippet_pairs:5');
  });

  it('普通文章即使有标题和段落交替也不按搜索结果拒绝', () => {
    const text = Array.from({ length: 5 }, (_, index) => [
      `第 ${index + 1} 节：工程约束`,
      CHINESE_PARAGRAPH,
    ].join('\n')).join('\n');
    const result = assessSummaryReadiness({
      text,
      title: '浏览器本地推理实践',
      url: 'https://example.com/articles/local-inference',
      method: 'readability',
    });

    expect(result.decision).toBe('allow');
  });

  it('拒绝内容不足的输入', () => {
    expect(assessSummaryReadiness({
      text: '只有一句过短的内容。',
      title: '短页面',
      url: 'https://example.com/short',
      method: 'readability',
    })).toMatchObject({ decision: 'reject', reason: 'insufficient_content' });
  });
});

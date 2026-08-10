import { describe, expect, it } from 'vitest';
import type { SelectionAction } from '../inference/contract';
import { truncateForContext } from '../extract/truncate';
import { PERFORMANCE_CONFIGS } from './performance';
import { OUTPUT_TOKEN_CAP, OUTPUT_TOKEN_RATIO, selectionBudget } from './selectionBudget';

const SAVER = PERFORMANCE_CONFIGS['resource-saver'];
const BALANCED = PERFORMANCE_CONFIGS.balanced;

const SHORT = '这是一段很短的选区';
/** 超过 MAX_SELECTION 的规模，两档配置都必然截断。无换行，截断结果就是定长切片。 */
const LONG = '字'.repeat(4000);

const ACTIONS: SelectionAction[] = ['explain', 'summarize', 'rewrite', 'translate'];

describe('selectionBudget 上下文', () => {
  it('短选区原样透传，contextChars 就是文本长度', () => {
    for (const action of ACTIONS) {
      const r = selectionBudget(action, SHORT, SAVER);
      expect(r.text).toBe(SHORT);
      expect(r.contextChars).toBe(SHORT.length);
    }
  });

  it('长选区按 qaContextChars 截断，两档配置给出不同上下文', () => {
    expect(selectionBudget('explain', LONG, SAVER).contextChars).toBe(SAVER.qaContextChars);
    expect(selectionBudget('explain', LONG, BALANCED).contextChars).toBe(BALANCED.qaContextChars);
  });

  it('截断完全委托给 truncateForContext，段落边界一致', () => {
    const paragraphs = Array.from({ length: 40 }, (_, i) => `第${i}段的正文内容`.repeat(6)).join('\n');
    for (const config of [SAVER, BALANCED]) {
      const r = selectionBudget('summarize', paragraphs, config);
      expect(r.text).toBe(truncateForContext(paragraphs, config.qaContextChars).text);
      expect(r.contextChars).toBe(r.text.length);
    }
  });
});

describe('selectionBudget 输出预算：explain / summarize', () => {
  it('输入长输出短，恒等于 qaMaxNewTokens', () => {
    for (const action of ['explain', 'summarize'] as const) {
      expect(selectionBudget(action, SHORT, SAVER).maxNewTokens).toBe(SAVER.qaMaxNewTokens);
      expect(selectionBudget(action, LONG, SAVER).maxNewTokens).toBe(SAVER.qaMaxNewTokens);
      expect(selectionBudget(action, SHORT, BALANCED).maxNewTokens).toBe(BALANCED.qaMaxNewTokens);
      expect(selectionBudget(action, LONG, BALANCED).maxNewTokens).toBe(BALANCED.qaMaxNewTokens);
    }
  });
});

describe('selectionBudget 输出预算：translate / rewrite', () => {
  it('短选区落到 qaMaxNewTokens 下限，两档配置不同', () => {
    for (const action of ['translate', 'rewrite'] as const) {
      expect(selectionBudget(action, SHORT, SAVER).maxNewTokens).toBe(SAVER.qaMaxNewTokens);
      expect(selectionBudget(action, SHORT, BALANCED).maxNewTokens).toBe(BALANCED.qaMaxNewTokens);
    }
  });

  it('中等长度按比例放大，且不低于下限', () => {
    const mid = '中'.repeat(600);
    const scaled = Math.ceil(600 * OUTPUT_TOKEN_RATIO);
    expect(scaled).toBeGreaterThan(SAVER.qaMaxNewTokens);
    expect(scaled).toBeLessThan(BALANCED.qaMaxNewTokens);
    for (const action of ['translate', 'rewrite'] as const) {
      expect(selectionBudget(action, mid, SAVER).maxNewTokens).toBe(scaled);
      // 比例算出的值低于 balanced 的下限时下限生效
      expect(selectionBudget(action, mid, BALANCED).maxNewTokens).toBe(BALANCED.qaMaxNewTokens);
    }
  });

  it('比例值超过两档下限时，两档给出同一个按比例的值', () => {
    const chars = 900;
    const scaled = Math.ceil(chars * OUTPUT_TOKEN_RATIO);
    expect(scaled).toBeGreaterThan(BALANCED.qaMaxNewTokens);
    expect(scaled).toBeLessThan(OUTPUT_TOKEN_CAP);
    for (const action of ['translate', 'rewrite'] as const) {
      expect(selectionBudget(action, '文'.repeat(chars), SAVER).maxNewTokens).toBe(scaled);
      expect(selectionBudget(action, '文'.repeat(chars), BALANCED).maxNewTokens).toBe(scaled);
    }
  });

  it('长选区被 cap 截住，不随上下文继续增长', () => {
    for (const action of ['translate', 'rewrite'] as const) {
      expect(selectionBudget(action, LONG, SAVER).maxNewTokens).toBe(OUTPUT_TOKEN_CAP);
      expect(selectionBudget(action, LONG, BALANCED).maxNewTokens).toBe(OUTPUT_TOKEN_CAP);
    }
  });

  it('按截断后的上下文算，而不是原文长度', () => {
    // 4000 字原文若按原长算是 3000 tokens；实际只喂进 qaContextChars 那么多。
    const r = selectionBudget('translate', LONG, BALANCED);
    expect(r.maxNewTokens).toBe(
      Math.min(OUTPUT_TOKEN_CAP, Math.ceil(BALANCED.qaContextChars * OUTPUT_TOKEN_RATIO)),
    );
  });
});

describe('selectionBudget 常量取值', () => {
  it('比例覆盖中文改写的最坏 token 密度，cap 覆盖 balanced 满上下文的翻译', () => {
    expect(OUTPUT_TOKEN_RATIO).toBeGreaterThanOrEqual(0.7);
    expect(OUTPUT_TOKEN_CAP).toBe(1024);
  });

  it('输出预算恒为正整数', () => {
    for (const action of ACTIONS) {
      for (const config of [SAVER, BALANCED]) {
        for (const text of ['', SHORT, '中'.repeat(600), LONG]) {
          const { maxNewTokens } = selectionBudget(action, text, config);
          expect(Number.isInteger(maxNewTokens)).toBe(true);
          expect(maxNewTokens).toBeGreaterThan(0);
        }
      }
    }
  });
});

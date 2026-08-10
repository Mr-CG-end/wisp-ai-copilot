import { truncateForContext } from '../extract/truncate';
import type { SelectionAction } from '../inference/contract';
import type { PerformanceConfig } from './performance';

/**
 * 输出 token 相对输入字符数的放大系数。
 *
 * 翻译与改写的输出长度跟着输入走，直接套 qaMaxNewTokens 必然截在半句话上：
 * 4000 字的选区配 320 token 只够写两行。系数按最坏一档的 token 密度取：
 * Qwen 系分词器上中文约 1.5 字/token（≈0.65 token/字），中文改写的输出长度
 * 又与输入基本相当，所以 0.65 是下界，取 0.75 留出提示语与标点的余量。
 * 英文输入（≈4 字符/token）用这个系数会明显偏松，但宁可多给——多给只是
 * 提前结束，少给是把结果砍断。
 */
export const OUTPUT_TOKEN_RATIO = 0.75;

/**
 * 输出 token 上限。
 *
 * 由生成时长而非上下文长度决定：小模型在 WebGPU 上约 15–20 tok/s，
 * 1024 token 已是约 50–70 秒的等待，同时还在和宿主页面抢 GPU。
 * 这个值恰好覆盖 balanced 档满上下文（2000 字）的中译英（约 850 token）；
 * 中文改写 2000 字仍会被截住，这是刻意的时长取舍——真要整段改写请分段选。
 */
export const OUTPUT_TOKEN_CAP = 1024;

export interface SelectionBudget {
  /** 实际送进模型的上下文，已按 qaContextChars 截断。 */
  text: string;
  contextChars: number;
  maxNewTokens: number;
}

/**
 * 划词任务的上下文与输出预算。
 *
 * 复用 PerformanceConfig 的 qa 两键而不新增划词专属键：硬扩键会牵动两档配置
 * 与既有测试，而划词与追问的上下文规模本来就是同一量级。差异只在输出长度，
 * 于是把这段逻辑抽成纯函数——系数与上限可以单测、可以调参，不污染 performance.ts。
 */
export function selectionBudget(
  action: SelectionAction,
  text: string,
  config: PerformanceConfig,
): SelectionBudget {
  const truncated = truncateForContext(text, config.qaContextChars);
  // 按截断后的规模算输出预算：模型看不到被截掉的部分，为它留 token 是浪费。
  const scaled = Math.min(OUTPUT_TOKEN_CAP, Math.ceil(truncated.keptChars * OUTPUT_TOKEN_RATIO));
  const maxNewTokens = action === 'translate' || action === 'rewrite'
    ? Math.max(config.qaMaxNewTokens, scaled)
    : config.qaMaxNewTokens; // explain / summarize 是「输入长、输出短」

  return { text: truncated.text, contextChars: truncated.keptChars, maxNewTokens };
}

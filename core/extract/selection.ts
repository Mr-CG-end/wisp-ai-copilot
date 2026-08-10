import type { Lang } from '../inference/contract';

/**
 * 选区长度守卫。
 *
 * 下限 2：单个字符几乎都是误触（双击落空、拖拽起手），弹出工具条只会挡住正文。
 * 上限 4000：远超单次生成的上下文预算（qaContextChars 最多 2000），
 * 再长的选区即便截断也只用得上前半段，与其给出一半的结果不如不弹，让用户分段选。
 */
export const MIN_SELECTION = 2;
export const MAX_SELECTION = 4000;

/**
 * 判为中文的汉字占比阈值。
 *
 * 取 15% 而非「过半」：中英混排的技术正文里汉字本来就少（术语、代码、变量名都是拉丁字符），
 * 但读者要的仍是中文回答。反过来，英文正文里偶尔夹一两个汉字很难超过 15%。
 */
const HAN_RATIO_THRESHOLD = 0.15;
/** 判为英文的拉丁字母占比阈值：不到半数说明主体是数字、标点或其他文字。 */
const LATIN_RATIO_THRESHOLD = 0.5;

/**
 * 选区文本规范化。
 *
 * 折叠的是「横向空白」，换行一律保留：宿主页面的软换行落在英文单词之间，
 * 换成空格没问题，但直接删掉会把两个单词粘成一个。全角空格与不换行空格
 * 也算横向空白——它们在中文排版和被复制保护的页面里大量出现。
 */
export function normalizeSelection(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/[\u2028\u2029]/g, '\n')
    .replace(/[ \t\u00a0\u3000]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/**
 * 长度守卫，输入应当是 normalizeSelection 的结果。
 * 只看长度、不看内容：纯标点的选区照样放行——判断「这段值不值得解释」是模型的事，
 * 在这里加内容规则只会误伤代码片段、公式和外文。
 */
export function isSelectionUsable(text: string): boolean {
  return text.length >= MIN_SELECTION && text.length <= MAX_SELECTION;
}

/** 汉字占比达阈值判 zh；否则看拉丁字母是否占多数判 en；都不满足为 other。 */
export function detectLang(text: string): Lang {
  const total = text.replace(/\s/g, '').length;
  if (total === 0) return 'other';
  const han = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  if (han / total >= HAN_RATIO_THRESHOLD) return 'zh';
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  return latin / total >= LATIN_RATIO_THRESHOLD ? 'en' : 'other';
}

/** 翻译的默认目标语言：中文译英文，其余一律译中文。 */
export function defaultTargetLang(lang: Lang): 'zh' | 'en' {
  return lang === 'zh' ? 'en' : 'zh';
}

/**
 * 敏感特征关键词。命中即整条祖先链判敏感，所以宁可窄一点：
 * 误判成敏感的代价是「正当页面上工具条不出现」，用户找不到原因也没法自救。
 *
 * 两处刻意收窄（都来自真实误伤）：
 * - `token` 必须与别的词相连（`csrf_token` / `authToken` / `token-id`）。
 *   Prism、highlight.js 给每个代码片段都挂 `class="token keyword"`，
 *   按裸词匹配会让技术文章的整个代码块都弹不出工具条——那正是本产品的主场。
 * - 验证码只认 `verif…code` 与 `verification`，不认裸 `verif`，
 *   否则 `class="verified"`（社交平台的认证徽章）会整片误伤。
 */
const SENSITIVE_TEXT = new RegExp([
  'password', 'passwd', 'pwd', 'passphrase', 'secret',
  '\\bcvv\\b', '\\bcvc\\b',
  'credit[-_ ]?card', 'card[-_ ]?(?:number|no)\\b', 'cardnumber',
  'one[-_ ]?time[-_ ]?code', '\\botp\\b',
  'verif\\w*code', 'verification', 'captcha',
  '\\w[-_]?token', 'token[-_]\\w',
  '\\bssn\\b', 'social[-_ ]?security', 'passport', 'national[-_ ]?id',
  '\\biban\\b', 'routing[-_ ]?number',
  '密码', '口令', '密保', '验证码', '短信码', '银行卡', '信用卡', '卡号',
  '支付', '付款', '身份证', '护照', '社保',
].join('|'), 'i');

/** autocomplete 的敏感取值前缀；`cc-` 覆盖整族银行卡字段。 */
const SENSITIVE_AUTOCOMPLETE = /^(?:current-password|new-password|one-time-code|cc-)/i;
const SENSITIVE_TYPES = new Set(['password']);

/**
 * 原生文本控件。落在其中的选区一律不弹工具条——这是产品口径不是安全口径：
 * 浮层会和输入法候选框、拖选把手抢位置，正是用户正在打字的地方。
 * contenteditable 不在此列，否则 Gmail、Notion 这类正当场景会被整片砍掉。
 */
const TEXT_CONTROL_SELECTOR = 'input, textarea';

/** Selection 对外暴露的两个端点；测试与调用方都按这个形状传值。 */
export interface SelectionEndpoints {
  anchorNode: Node | null;
  focusNode: Node | null;
}

function attrsOf(el: Element): string {
  return [
    el.getAttribute('name'),
    el.getAttribute('id'),
    el.getAttribute('aria-label'),
    el.getAttribute('placeholder'),
    el.getAttribute('class'),
  ]
    .filter(Boolean)
    .join(' ');
}

function selfIsSensitive(el: Element): boolean {
  if (el.hasAttribute('data-sensitive')) return true;
  const type = el.getAttribute('type');
  if (type && SENSITIVE_TYPES.has(type.toLowerCase())) return true;
  // autocomplete 是空格分隔的 token 列表（`section-blue billing cc-number`），
  // 只测整串会漏掉带 section / billing 前缀的那一半真实表单。
  const autocomplete = el.getAttribute('autocomplete');
  if (autocomplete && autocomplete.split(/\s+/).some((token) => SENSITIVE_AUTOCOMPLETE.test(token))) {
    return true;
  }
  return SENSITIVE_TEXT.test(attrsOf(el));
}

function nearestElement(node: Node | null): Element | null {
  if (!node) return null;
  return node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
}

/**
 * 敏感区域判定：命中即不显示工具条、不读取选区。
 * 判定沿祖先链上溯，覆盖「选区落在敏感表单内的说明文字上」这种情况。
 */
export function isSensitiveTarget(el: Element | null): boolean {
  let node: Element | null = el;
  while (node) {
    if (selfIsSensitive(node)) return true;
    node = node.parentElement;
  }
  return false;
}

/**
 * 选区级判定，工具条的实际入口。
 *
 * 必须分别查 anchor 与 focus 两端，不能只查 range.commonAncestorContainer：
 * 跨元素的选区其 CAC 常常直接就是 body，查一遍必过，等于没查——
 * 「从密码框拖到旁边的说明文字」这种最该拦的选区反而会放行。
 *
 * 判定失效时返回 true（按敏感处理）。open shadow root 里的端点可能落在
 * 宿主之外、根本取不到 Element，此时默认拒绝比默认放行安全：
 * 代价只是少弹一次工具条。
 */
export function isSensitiveSelection(selection: SelectionEndpoints | null): boolean {
  if (!selection) return true;
  for (const node of [selection.anchorNode, selection.focusNode]) {
    const element = nearestElement(node);
    if (!element) return true;
    if (element.closest(TEXT_CONTROL_SELECTOR)) return true;
    if (isSensitiveTarget(element)) return true;
  }
  return false;
}

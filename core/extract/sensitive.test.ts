// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { isSensitiveSelection, isSensitiveTarget } from './sensitive';

function el(html: string): Element {
  const host = document.createElement('div');
  host.innerHTML = html;
  return host.firstElementChild!;
}

/** 把 HTML 装进真实 body，才能构造跨元素的 Range。 */
function mount(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.body;
}

/** Selection 对外只暴露这两个端点，测试直接按同样的形状构造。 */
function endpoints(anchorNode: Node | null, focusNode: Node | null) {
  return { anchorNode, focusNode };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('isSensitiveTarget', () => {
  it('密码框敏感', () => {
    expect(isSensitiveTarget(el('<input type="password">'))).toBe(true);
  });

  it('按 autocomplete 识别一次性验证码与银行卡', () => {
    expect(isSensitiveTarget(el('<input autocomplete="one-time-code">'))).toBe(true);
    expect(isSensitiveTarget(el('<input autocomplete="cc-number">'))).toBe(true);
    expect(isSensitiveTarget(el('<input autocomplete="current-password">'))).toBe(true);
  });

  it('autocomplete 是 token 列表时逐个 token 判定', () => {
    expect(isSensitiveTarget(el('<input autocomplete="section-blue billing cc-number">'))).toBe(true);
    expect(isSensitiveTarget(el('<input autocomplete="shipping street-address">'))).toBe(false);
  });

  it('按 name/id/aria-label 的中英文关键词识别', () => {
    expect(isSensitiveTarget(el('<input name="verifyCode">'))).toBe(true);
    expect(isSensitiveTarget(el('<input id="cvv">'))).toBe(true);
    expect(isSensitiveTarget(el('<input aria-label="支付密码">'))).toBe(true);
    expect(isSensitiveTarget(el('<input placeholder="请输入银行卡号">'))).toBe(true);
    expect(isSensitiveTarget(el('<input name="csrf_token">'))).toBe(true);
  });

  it('祖先链上的敏感容器也算敏感', () => {
    const form = el('<form data-sensitive="true"><div><span id="t">文本</span></div></form>');
    expect(isSensitiveTarget(form.querySelector('#t'))).toBe(true);
  });

  it('普通文本与普通输入框不敏感', () => {
    expect(isSensitiveTarget(el('<p>普通正文</p>'))).toBe(false);
    expect(isSensitiveTarget(el('<input type="text" name="nickname">'))).toBe(false);
  });

  it('语法高亮的 token 类名不算敏感', () => {
    // Prism / highlight.js 给每个代码片段都挂 class="token xxx"，
    // 若按裸词 token 命中，技术文章的整个代码块都会被判敏感。
    const pre = el('<pre><code><span class="token keyword" id="k">const</span></code></pre>');
    expect(isSensitiveTarget(pre.querySelector('#k'))).toBe(false);
  });

  it('contenteditable 不算敏感——Gmail / Notion 是正当场景', () => {
    const editor = el('<div contenteditable="true"><p id="p">正在写的一段话</p></div>');
    expect(isSensitiveTarget(editor.querySelector('#p'))).toBe(false);
  });

  it('null 不敏感', () => {
    expect(isSensitiveTarget(null)).toBe(false);
  });
});

describe('isSensitiveSelection', () => {
  it('两端都落在普通正文上时不敏感', () => {
    mount('<p id="a">前一段正文</p><p id="b">后一段正文</p>');
    const a = document.querySelector('#a')!.firstChild;
    const b = document.querySelector('#b')!.firstChild;
    expect(isSensitiveSelection(endpoints(a, b))).toBe(false);
  });

  it('回归：跨元素选区的 CAC 是 body，但 anchor 落在密码框内', () => {
    mount('<div id="left"><input id="pw" type="password"></div><p id="right">同意条款</p>');
    const pw = document.querySelector('#pw')!;
    const rightText = document.querySelector('#right')!.firstChild!;

    const range = document.createRange();
    range.setStart(pw, 0);
    range.setEnd(rightText, 2);

    // 旧判据只看 commonAncestorContainer：这里就是 body，一查即过，等于没查。
    expect(range.commonAncestorContainer).toBe(document.body);
    expect(isSensitiveTarget(range.commonAncestorContainer as Element)).toBe(false);

    // 新判据分别查两端，anchor 端命中密码框。
    expect(isSensitiveSelection(endpoints(range.startContainer, range.endContainer))).toBe(true);
  });

  it('focus 端命中敏感同样拒绝', () => {
    mount('<p id="note">说明文字</p><div><input id="otp" autocomplete="one-time-code"></div>');
    const note = document.querySelector('#note')!.firstChild;
    expect(isSensitiveSelection(endpoints(note, document.querySelector('#otp')))).toBe(true);
  });

  it('input / textarea 内的选区一律不弹，哪怕字段本身不敏感', () => {
    mount('<input id="nickname" type="text" name="nickname"><textarea id="bio"></textarea>');
    const nickname = document.querySelector('#nickname')!;
    const bio = document.querySelector('#bio')!;
    expect(isSensitiveTarget(nickname)).toBe(false);
    expect(isSensitiveSelection(endpoints(nickname, nickname))).toBe(true);
    expect(isSensitiveSelection(endpoints(bio, bio))).toBe(true);
  });

  it('contenteditable 内的选区放行', () => {
    mount('<div contenteditable="true"><p id="p">正在写的一段话</p></div>');
    const text = document.querySelector('#p')!.firstChild;
    expect(isSensitiveSelection(endpoints(text, text))).toBe(false);
  });

  it('拿不到可靠 Element 时按敏感处理', () => {
    mount('<p id="a">正文</p>');
    const a = document.querySelector('#a')!.firstChild;
    expect(isSensitiveSelection(null)).toBe(true);
    expect(isSensitiveSelection(endpoints(null, null))).toBe(true);
    expect(isSensitiveSelection(endpoints(a, null))).toBe(true);
    // 游离文本节点没有父元素，祖先链无从查起。
    expect(isSensitiveSelection(endpoints(document.createTextNode('游离'), a))).toBe(true);
    // shadow root 自身不是 Element，parentElement 为 null。
    const shadow = document.createElement('div').attachShadow({ mode: 'open' });
    expect(isSensitiveSelection(endpoints(shadow, shadow))).toBe(true);
  });

  it('选区落在敏感表单内的说明文字上也拒绝', () => {
    mount('<form data-sensitive="true"><span id="tip">请输入收到的短信</span></form>');
    const tip = document.querySelector('#tip')!.firstChild;
    expect(isSensitiveSelection(endpoints(tip, tip))).toBe(true);
  });
});

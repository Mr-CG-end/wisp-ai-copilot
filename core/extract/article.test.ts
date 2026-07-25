// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { extractArticle, MAX_DOM_NODES } from './article';

function docFrom(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

const BODY_TEXT = '这是一篇测试文章的正文内容，用来验证提取逻辑是否可靠。'.repeat(12);

describe('extractArticle', () => {
  it('提取文章正文且不含导航与页脚', () => {
    const doc = docFrom(`
      <html><head><title>测试标题</title></head><body>
        <nav><a href="/a">导航链接甲</a><a href="/b">导航链接乙</a></nav>
        <article><h1>测试标题</h1><p>${BODY_TEXT}</p></article>
        <footer>页脚版权声明</footer>
      </body></html>`);
    const r = extractArticle(doc);
    expect(r).not.toBeNull();
    expect(r!.text).toContain('这是一篇测试文章的正文内容');
    expect(r!.text).not.toContain('导航链接甲');
    expect(r!.text).not.toContain('页脚版权声明');
    expect(r!.charCount).toBe(r!.text.length);
  });

  it('正文过短返回 null（对应 PAGE_NO_CONTENT）', () => {
    expect(extractArticle(docFrom('<html><body><p>太短</p></body></html>'))).toBeNull();
  });

  it('不修改传入的 document（内部走 clone）', () => {
    const doc = docFrom(`<html><body><nav>导航</nav><article><p>${BODY_TEXT}</p></article></body></html>`);
    const before = doc.body.innerHTML;
    extractArticle(doc);
    expect(doc.body.innerHTML).toBe(before);
  });

  it('DOM 规模超上限时降级为启发式提取', () => {
    const filler = '<span>x</span>'.repeat(MAX_DOM_NODES + 10);
    const doc = docFrom(`<html><body><main><p>${BODY_TEXT}</p></main>${filler}</body></html>`);
    const r = extractArticle(doc);
    expect(r).not.toBeNull();
    expect(r!.method).toBe('heuristic');
    expect(r!.text).toContain('这是一篇测试文章的正文内容');
  });

  it('折叠连续空白，不产生大段空行', () => {
    const doc = docFrom(`<html><body><article><p>${BODY_TEXT}</p>\n\n\n<p>   尾段   </p></article></body></html>`);
    const r = extractArticle(doc);
    expect(r!.text).not.toMatch(/\n{3,}/);
    expect(r!.text).not.toMatch(/ {3,}/);
  });
});

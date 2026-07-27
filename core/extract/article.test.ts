// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { extractArticle, MAX_DOM_NODES, MAX_HEURISTIC_CHARS } from './article';

function docFrom(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

const BODY_TEXT = '这是一篇测试文章的正文内容，用来验证提取逻辑是否可靠。'.repeat(12);
/** 超过 MAX_DOM_NODES 即强制走降级路径；用最短的空标签压低构造成本。 */
const OVERSIZE_FILLER = '<i></i>'.repeat(MAX_DOM_NODES + 10);

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

  it('块级元素之间产生换行，即使 DOM 里没有元素间空白', () => {
    // JS 渲染出的 DOM（docsify / React 等）标签之间没有空白文本节点，
    // textContent 与首尾相接的 join('') 都会把标题和正文粘成一句，
    // 下游按段落切分的选段逻辑随之全部失效，只能退化成「砍前 N 字」。
    const doc = docFrom(
      `<html><body><article><h2>基础理论与模型部署</h2><p>${BODY_TEXT}</p>`
      + `<ul><li>要点甲：${BODY_TEXT}</li><li>要点乙：${BODY_TEXT}</li></ul></article></body></html>`,
    );
    const r = extractArticle(doc);
    expect(r).not.toBeNull();
    expect(r!.text).not.toContain('基础理论与模型部署这是一篇');
    expect(r!.text.split('\n').length).toBeGreaterThan(3);
  });

  it('降级路径同样保留块边界', () => {
    const doc = docFrom(
      `<html><body><main><h2>小节标题</h2><p>${BODY_TEXT}</p><p>${BODY_TEXT}</p></main>${OVERSIZE_FILLER}</body></html>`,
    );
    const r = extractArticle(doc);
    expect(r!.method).toBe('heuristic');
    expect(r!.text).not.toContain('小节标题这是一篇');
    expect(r!.text.split('\n').length).toBeGreaterThan(2);
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

  it('降级路径跳过 STRIP_SELECTOR 元素内的文本', () => {
    const doc = docFrom(`
      <html><body><main>
        <nav>导航链接甲</nav>
        <p>${BODY_TEXT}</p>
        <script>var 脚本内容 = 1;</script>
        <footer>页脚版权声明</footer>
      </main>${OVERSIZE_FILLER}</body></html>`);
    const r = extractArticle(doc);
    expect(r!.method).toBe('heuristic');
    expect(r!.text).toContain('这是一篇测试文章的正文内容');
    expect(r!.text).not.toContain('导航链接甲');
    expect(r!.text).not.toContain('脚本内容');
    expect(r!.text).not.toContain('页脚版权声明');
  });

  it('降级路径不修改宿主 document，被跳过的元素仍在 DOM 中', () => {
    const doc = docFrom(
      `<html><body><main><nav>导航链接甲</nav><p>${BODY_TEXT}</p></main>${OVERSIZE_FILLER}</body></html>`,
    );
    const before = doc.body.innerHTML;
    expect(extractArticle(doc)!.method).toBe('heuristic');
    expect(doc.body.innerHTML).toBe(before);
    expect(doc.querySelector('main nav')?.textContent).toBe('导航链接甲');
  });

  it('超长文档在字符上限处截断，仍返回 heuristic', () => {
    const doc = docFrom(
      `<html><body><main><p>${'长'.repeat(MAX_HEURISTIC_CHARS + 500)}</p></main>${OVERSIZE_FILLER}</body></html>`,
    );
    const r = extractArticle(doc);
    expect(r!.method).toBe('heuristic');
    // 不断言恰好等于上限：块边界补进去的换行会被 normalizeText 收尾 trim 掉，
    // 长度可能差几个字符。真正要守的是「不超过上限、且确实截断到上限附近」。
    expect(r!.text.length).toBeLessThanOrEqual(MAX_HEURISTIC_CHARS);
    expect(r!.text.length).toBeGreaterThan(MAX_HEURISTIC_CHARS - 10);
  });

  it('降级路径的根节点定位保持 main → article → body 顺序', () => {
    const withMain = docFrom(
      `<html><body><main><p>${BODY_TEXT}</p></main><article><p>文章区独有内容</p></article>${OVERSIZE_FILLER}</body></html>`,
    );
    expect(extractArticle(withMain)!.text).not.toContain('文章区独有内容');

    const withArticle = docFrom(
      `<html><body><article><p>${BODY_TEXT}</p></article><div><p>散装区独有内容</p></div>${OVERSIZE_FILLER}</body></html>`,
    );
    expect(extractArticle(withArticle)!.text).not.toContain('散装区独有内容');

    const bodyOnly = docFrom(
      `<html><body><div><p>${BODY_TEXT}</p></div><div><p>散装区独有内容</p></div>${OVERSIZE_FILLER}</body></html>`,
    );
    expect(extractArticle(bodyOnly)!.text).toContain('散装区独有内容');
  });

  it('折叠连续空白，不产生大段空行', () => {
    const doc = docFrom(`<html><body><article><p>${BODY_TEXT}</p>\n\n\n<p>   尾段   </p></article></body></html>`);
    const r = extractArticle(doc);
    expect(r!.text).not.toMatch(/\n{3,}/);
    expect(r!.text).not.toMatch(/ {3,}/);
  });
});

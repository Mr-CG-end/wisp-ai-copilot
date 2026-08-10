/**
 * 划词工具条的样式，以字符串常量而不是 `.css` 文件存在。
 *
 * 两条理由：
 * 1. WXT 的 `createShadowRootUi` 只有在 `cssInjectionMode: 'ui'` 那条分支才会
 *    `fetch(runtime.getURL(...))` 取构建产物里的 CSS；直接传进去的 `css` 字符串是被
 *    push 进 shadow 内 `<style>.textContent` 的。走字符串就零 fetch、零
 *    web_accessible_resources，也绕开「`registration:'runtime'` + `matches:[]` 下
 *    CSS 产物是否可达」这个未知数。
 * 2. `import './x.css'` 会把样式变成 content script 的构建产物，等于把上面那个未知数请回来。
 *
 * 色值必须写死：Shadow Root 取不到面板 `:root` 上的 `--wisp-*`（WXT 还会先注入
 * `:host{all:initial}`），`var()` 在这里一律落空。下面每个色值都标注了它在
 * `entrypoints/sidepanel/style.css` 里的来源变量 —— **改一处要改两处**。
 * 视觉规范见 `docs/ui/Wisp_M2_UISpec.md` §5.10（工具条）与 §4.1 / §4.2（令牌）。
 */
export const TOOLBAR_CSS = `
/* WXT 注入的 :host{all:initial!important} 是重要声明，会盖掉 applyPosition 写在
   shadowHost 上的普通行内样式（display:block / width:0 / height:0）。这里在其后
   重新钉死宿主盒：零尺寸块级盒挂在 body 末尾，既不产生行盒也不占高度，
   宿主页面布局零位移。 */
:host {
  display: block !important;
  width: 0 !important;
  height: 0 !important;
}

/* shadow 内部照样命中 UA 样式（body{margin:8px}），清掉免得测量与定位偏移 */
html,
body {
  margin: 0;
  padding: 0;
}

.wisp-toolbar,
.wisp-toolbar * {
  box-sizing: border-box;
}

.wisp-toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
  height: 34px;
  padding: 2px;
  /* --wisp-border 是 #d7d6ce；工具条浮在任意宿主页面之上，面板里那一档会糊掉，
     按 §5.10「比面板深一档」取深一档的 #c6c5bb（本文件独有，style.css 里没有对应变量） */
  border: 1px solid #c6c5bb;
  /* 左侧 3px 苔绿边条 = --wisp-accent */
  border-left: 3px solid #476c5a;
  border-radius: 8px;
  /* --wisp-surface */
  background: #fbfaf6;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.16);
  /* --wisp-text */
  color: #20241f;
  /* 与 §4.2 的字体栈一致；:host{all:initial} 后字体不再从宿主页面继承，必须自带 */
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
  font-size: 14px;
  white-space: nowrap;
  /* 工具条自身不可选中：否则点按会改写宿主页面的选区 */
  user-select: none;
  -webkit-user-select: none;
}

.wisp-toolbar__btn {
  align-self: stretch;
  margin: 0;
  padding: 0 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  line-height: 22px;
  cursor: pointer;
  /* §5.2：按下反馈不超过 120ms */
  transition: background-color 120ms ease, transform 120ms ease;
}

.wisp-toolbar__btn:hover {
  /* --wisp-surface-muted */
  background: #e9ece5;
}

.wisp-toolbar__btn:active {
  /* --wisp-accent-soft */
  background: #dce8df;
  transform: translateY(1px);
}

.wisp-toolbar__btn:focus-visible {
  /* --wisp-focus。§5.2 的 offset 2px 会画到 34px 纸面之外、被相邻按钮压住，
     34px 高度里改为内描边 */
  outline: 2px solid #1a73e8;
  outline-offset: -2px;
}

/* 就地反馈态与提示态共用同一张纸面，只换内容（§5.10：结果在 Side Panel 出，工具条不等结果） */
.wisp-toolbar--message {
  gap: 8px;
  padding: 0 12px;
}

.wisp-toolbar__status {
  /* --wisp-text-muted；§4.2 状态短语属微文本档 11px/16px/500 */
  color: #5f675e;
  font-size: 11px;
  font-weight: 500;
  line-height: 16px;
}

/* 向右生长的 1px 苔绿线（--wisp-accent），语汇同 §5.9 的轨道线段 */
.wisp-toolbar__line {
  flex: 0 0 auto;
  width: 64px;
  height: 1px;
  background: #476c5a;
  transform: scaleX(0);
  transform-origin: left center;
  transition: transform 900ms cubic-bezier(0.22, 0.61, 0.36, 1);
}

.wisp-toolbar__line--grown {
  transform: scaleX(1);
}

/* 关掉过渡即等于跳终态：类名照常翻，只是不再有中间帧 */
@media (prefers-reduced-motion: reduce) {
  .wisp-toolbar__btn,
  .wisp-toolbar__line {
    transition: none;
  }
}
`;

/** 工具条与视口边缘的最小间距，四边通用。 */
export const VIEWPORT_MARGIN = 8;
/** 工具条与选区之间的留白：贴着选区会压住高亮的最后一行，也挡住拖选把手。 */
export const SELECTION_GAP = 6;

export interface ToolbarPositionInput {
  /** 选区矩形，视口坐标（getBoundingClientRect 原样传入，不加 scrollY）。 */
  rect: { top: number; bottom: number; left: number; right: number };
  viewport: { width: number; height: number };
  size: { width: number; height: number };
}

export interface ToolbarPosition {
  left: number;
  top: number;
  placement: 'below' | 'above';
}

/**
 * min > max 时返回 min：视口比工具条还小的极端情形下，
 * 保住左边/上边可见（工具条从左上角开始画），总好过按 max 钳到负值滑出屏幕。
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

/**
 * 计算划词工具条的落点，全部用视口坐标。
 *
 * 输出直接喂给 `position: fixed`，因此不加 scrollY —— WXT `createShadowRootUi`
 * 的 overlay 模式把 shadowHost 追加在 body 末尾并设成 `position: relative`，
 * 用 absolute + scrollY 会以那个静态流位置为原点，在有内容的页面上工具条会掉到页面底部。
 *
 * 抽成纯函数是为了让「工具条被裁掉一半」这类问题能用单测复现，而不是靠真机反复试。
 */
export function clampToolbarPosition(input: ToolbarPositionInput): ToolbarPosition {
  const { rect, viewport, size } = input;

  const centered = Math.round((rect.left + rect.right) / 2 - size.width / 2);
  const left = clamp(centered, VIEWPORT_MARGIN, viewport.width - size.width - VIEWPORT_MARGIN);

  const belowTop = Math.round(rect.bottom + SELECTION_GAP);
  const aboveTop = Math.round(rect.top - SELECTION_GAP - size.height);
  if (belowTop + size.height <= viewport.height - VIEWPORT_MARGIN) {
    return { left, top: belowTop, placement: 'below' };
  }
  if (aboveTop >= VIEWPORT_MARGIN) {
    return { left, top: aboveTop, placement: 'above' };
  }

  // 上下都放不下：完整可见优先于不遮挡选区，往剩余空间大的一侧靠。
  const placement = viewport.height - rect.bottom >= rect.top ? 'below' : 'above';
  const top = clamp(
    placement === 'below' ? belowTop : aboveTop,
    VIEWPORT_MARGIN,
    viewport.height - size.height - VIEWPORT_MARGIN,
  );
  return { left, top, placement };
}

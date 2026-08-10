import { describe, expect, it } from 'vitest';
import { SELECTION_GAP, VIEWPORT_MARGIN, clampToolbarPosition } from './toolbarPosition';

const SIZE = { width: 240, height: 36 };
const VIEWPORT = { width: 1000, height: 800 };

function rect(top: number, bottom: number, left: number, right: number) {
  return { top, bottom, left, right };
}

function at(r: ReturnType<typeof rect>, viewport = VIEWPORT, size = SIZE) {
  return clampToolbarPosition({ rect: r, viewport, size });
}

describe('clampToolbarPosition 常规摆放', () => {
  it('默认放在选区下方并水平居中', () => {
    const p = at(rect(300, 320, 400, 600));
    expect(p).toEqual({ left: 380, top: 320 + SELECTION_GAP, placement: 'below' });
  });

  it('坐标取整，避免亚像素导致的文字发虚', () => {
    const p = at(rect(300.2, 320.4, 400.3, 599.9));
    expect(Number.isInteger(p.left)).toBe(true);
    expect(Number.isInteger(p.top)).toBe(true);
  });
});

describe('clampToolbarPosition 四角', () => {
  it('左上角：左侧钳到边距，仍放下方', () => {
    const p = at(rect(0, 18, 0, 40));
    expect(p).toEqual({ left: VIEWPORT_MARGIN, top: 18 + SELECTION_GAP, placement: 'below' });
  });

  it('右上角：右侧钳到边距', () => {
    const p = at(rect(0, 18, 960, 1000));
    expect(p.left).toBe(VIEWPORT.width - SIZE.width - VIEWPORT_MARGIN);
    expect(p.left + SIZE.width).toBeLessThanOrEqual(VIEWPORT.width - VIEWPORT_MARGIN);
    expect(p.placement).toBe('below');
  });

  it('左下角：下方放不下则翻到上方', () => {
    const p = at(rect(780, 800, 0, 40));
    expect(p).toEqual({
      left: VIEWPORT_MARGIN,
      top: 780 - SELECTION_GAP - SIZE.height,
      placement: 'above',
    });
  });

  it('右下角：同时钳右侧并翻到上方', () => {
    const p = at(rect(780, 800, 960, 1000));
    expect(p).toEqual({
      left: VIEWPORT.width - SIZE.width - VIEWPORT_MARGIN,
      top: 780 - SELECTION_GAP - SIZE.height,
      placement: 'above',
    });
  });
});

describe('clampToolbarPosition 贴边选区', () => {
  it('选区贴顶：正常放下方', () => {
    const p = at(rect(0, 20, 400, 600));
    expect(p.placement).toBe('below');
    expect(p.top).toBe(20 + SELECTION_GAP);
  });

  it('选区贴底：翻到上方且完整可见', () => {
    const p = at(rect(790, 800, 400, 600));
    expect(p.placement).toBe('above');
    expect(p.top).toBe(790 - SELECTION_GAP - SIZE.height);
    expect(p.top).toBeGreaterThanOrEqual(VIEWPORT_MARGIN);
  });

  it('选区贴顶且视口极矮：上下都放不下，优先保证完整可见', () => {
    const viewport = { width: 1000, height: 50 };
    const p = at(rect(0, 20, 400, 600), viewport);
    expect(p.top).toBeGreaterThanOrEqual(VIEWPORT_MARGIN);
    expect(p.top + SIZE.height).toBeLessThanOrEqual(viewport.height);
  });

  it('上下都不足时选剩余空间更大的一侧', () => {
    const viewport = { width: 1000, height: 120 };
    expect(at(rect(45, 100, 400, 600), viewport).placement).toBe('above');
    expect(at(rect(10, 60, 400, 600), viewport).placement).toBe('below');
  });

  it('视口比工具条还矮时至少保住顶边', () => {
    const viewport = { width: 1000, height: 30 };
    const p = at(rect(0, 10, 400, 600), viewport);
    expect(p.top).toBe(VIEWPORT_MARGIN);
  });
});

describe('clampToolbarPosition 超宽选区', () => {
  it('选区横跨整个视口时仍居中于选区，并被边距钳住', () => {
    const p = at(rect(300, 320, 20, 980));
    expect(p.left).toBe(380);
  });

  it('选区中心在视口外（左侧被滚出）时钳到左边距', () => {
    const p = at(rect(300, 320, -400, 600));
    expect(p.left).toBe(VIEWPORT_MARGIN);
  });

  it('工具条比视口还宽时靠左对齐，保住左半边', () => {
    const p = at(rect(300, 320, 400, 600), VIEWPORT, { width: 1200, height: 36 });
    expect(p.left).toBe(VIEWPORT_MARGIN);
  });
});

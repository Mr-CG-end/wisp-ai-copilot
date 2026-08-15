// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createToolbarHost, type ToolbarProps } from './selectionToolbar';

function mountHost(props: ToolbarProps | null) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const host = createToolbarHost(container);
  host.render(props);
  return { container, host };
}

const baseProps: ToolbarProps = {
  onAction: () => {},
  onDismiss: () => {},
};

function buttonLabels(container: HTMLElement): string[] {
  return [...container.querySelectorAll('.wisp-toolbar__btn')].map((b) => b.textContent ?? '');
}

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe('工具条动作态', () => {
  it('四个动作按文字渲染，容器带 toolbar 角色与可访问名', () => {
    const { container } = mountHost(baseProps);

    expect(buttonLabels(container)).toEqual(['解释', '总结', '改写', '翻译']);
    const root = container.querySelector('.wisp-toolbar')!;
    expect(root.getAttribute('role')).toBe('toolbar');
    expect(root.getAttribute('aria-label')).toBe('Wisp 划词操作');
  });

  it('mousedown 被阻止，避免按钮抢焦点清掉宿主页面的选区', () => {
    const { container } = mountHost(baseProps);
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });

    container.querySelector<HTMLButtonElement>('.wisp-toolbar__btn')!.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it('点击上报对应动作，并就地切到反馈态', () => {
    const onAction = vi.fn();
    const { container } = mountHost({ ...baseProps, onAction });

    container.querySelectorAll<HTMLButtonElement>('.wisp-toolbar__btn')[3].click();

    expect(onAction).toHaveBeenCalledWith('translate');
    expect(container.textContent).toContain('正在翻译…');
    expect(container.querySelector('.wisp-toolbar__btn')).toBeNull();
  });

  /**
   * 工具条是盖在宿主页面上的第三方 UI。点击外溢会触发宿主的全局委托处理器，
   * 其中 pushState 一路会让 Wisp 自己判定页面已导航，把在途任务连同快照一起作废。
   */
  it('点击不冒泡到宿主页面', () => {
    const onHostClick = vi.fn();
    document.addEventListener('click', onHostClick);
    const { container } = mountHost(baseProps);

    container.querySelector<HTMLButtonElement>('.wisp-toolbar__btn')!.click();

    expect(onHostClick).not.toHaveBeenCalled();
    document.removeEventListener('click', onHostClick);
  });

  it('Tab 在四个按钮之间循环，不把焦点还给宿主页面', () => {
    const { container } = mountHost(baseProps);
    const buttons = [...container.querySelectorAll<HTMLButtonElement>('.wisp-toolbar__btn')];

    buttons[3].focus();
    buttons[3].dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(buttons[0]);

    buttons[0].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }),
    );
    expect(document.activeElement).toBe(buttons[3]);
  });

  /**
   * 收起工具条的 Esc 监听挂在 document 上（content.ts）。这里一旦顺手把 keydown
   * 整个拦下来，焦点进了工具条之后 Esc 就再也关不掉它 —— 真机核对 B3/B4 两条。
   */
  it('Esc 继续冒泡到宿主 document，不被工具条吃掉', () => {
    const onHostKeydown = vi.fn();
    document.addEventListener('keydown', onHostKeydown);
    const { container } = mountHost(baseProps);

    container.querySelector<HTMLButtonElement>('.wisp-toolbar__btn')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );

    expect(onHostKeydown).toHaveBeenCalledOnce();
    document.removeEventListener('keydown', onHostKeydown);
  });
});

describe('工具条反馈态', () => {
  it('1.5s 后请求宿主收起', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const { container } = mountHost({ ...baseProps, onDismiss });

    container.querySelector<HTMLButtonElement>('.wisp-toolbar__btn')!.click();

    vi.advanceTimersByTime(1499);
    expect(onDismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('生长线先落终态类名之外的起始态，隔一帧才生长', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    const { container } = mountHost(baseProps);

    container.querySelector<HTMLButtonElement>('.wisp-toolbar__btn')!.click();
    const line = container.querySelector('.wisp-toolbar__line')!;
    expect(line.classList.contains('wisp-toolbar__line--grown')).toBe(false);

    frames.forEach((cb) => cb(0));
    expect(line.classList.contains('wisp-toolbar__line--grown')).toBe(true);
    vi.unstubAllGlobals();
  });
});

describe('工具条提示态', () => {
  it('首次启用提示渲染标题和说明，不伪装成动作按钮', () => {
    const { container } = mountHost({
      ...baseProps,
      hint: '划选网页文字',
      hintDetail: 'Wisp 可以解释、总结、改写或翻译',
    });

    expect(container.querySelector('.wisp-toolbar--discovery')).not.toBeNull();
    expect(container.textContent).toContain('划选网页文字');
    expect(container.textContent).toContain('Wisp 可以解释、总结、改写或翻译');
    expect(container.querySelector('button')).toBeNull();
  });

  it('没有第二行说明时不渲染标题，也不带 discovery 修饰', () => {
    const { container } = mountHost({ ...baseProps, hint: '点击浏览器工具栏上的扩展图标继续' });

    expect(container.querySelector('.wisp-toolbar__hint-title')).toBeNull();
    expect(container.querySelector('.wisp-toolbar--discovery')).toBeNull();
    expect(container.textContent).toContain('点击浏览器工具栏上的扩展图标继续');
  });

  it('使用传入的停留时间，并在到期时请求宿主收起', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    mountHost({ ...baseProps, hint: '划选网页文字', hintDetail: '说明', hintDurationMs: 4000, onDismiss });

    vi.advanceTimersByTime(3999);
    expect(onDismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});

describe('工具条重建与清理', () => {
  it('再次 render 整棵重建，上一次的反馈态不残留', () => {
    const { container, host } = mountHost(baseProps);
    container.querySelector<HTMLButtonElement>('.wisp-toolbar__btn')!.click();
    expect(container.textContent).toContain('正在解释…');

    host.render(baseProps);

    expect(container.textContent).not.toContain('正在解释…');
    expect(buttonLabels(container)).toHaveLength(4);
  });

  it('render(null) 清空内容，不给宿主页面留下隐形按钮', () => {
    const { container, host } = mountHost(baseProps);

    host.render(null);

    expect(container.querySelector('button')).toBeNull();
    expect(container.childNodes).toHaveLength(0);
  });

  /** 定时器活到元素移除之后，会在工具条早已消失时回调一次 onDismiss。 */
  it('destroy 之后在途定时器不再回调', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const { host } = mountHost({ ...baseProps, hint: '提示', onDismiss });

    host.destroy();
    vi.advanceTimersByTime(10_000);

    expect(onDismiss).not.toHaveBeenCalled();
  });
});

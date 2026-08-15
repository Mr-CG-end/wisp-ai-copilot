import type { SelectionAction } from '../core/messaging/types';

/**
 * 手写 DOM，不用 React。
 *
 * 工具条只有四个按钮两个状态，不依赖 React 的任何调度能力；而 Content Script 改为
 * 全站常驻注入后，这段解析成本从「每次启用一次」变成「用户访问的每个页面一次」——
 * React + react-dom 让 content script 从 40.6 kB 涨到 198.5 kB，摊到全网不成比例。
 *
 * 另一个顺带的好处：DOM 写入本身就是同步的，宿主不再需要 flushSync 去逼出一次同步
 * 提交，就能立刻量到真实尺寸再落位（见 content.ts 的 placeAt）。
 */

/** 四个动作按 §5.10 用文字不用图标：34px 高度里图标既难辨认，又要额外配可访问名。 */
const ACTIONS: ReadonlyArray<{ action: SelectionAction; label: string }> = [
  { action: 'explain', label: '解释' },
  { action: 'summarize', label: '总结' },
  { action: 'rewrite', label: '改写' },
  { action: 'translate', label: '翻译' },
];

/** 就地反馈文案。四个动作各写一句，读屏用户也能确认点中的是哪一个。 */
const BUSY_LABEL: Record<SelectionAction, string> = {
  explain: '正在解释…',
  summarize: '正在总结…',
  rewrite: '正在改写…',
  translate: '正在翻译…',
};

/** §5.10：点击后就地反馈约 1.5s 后消失 —— 工具条不等结果，结果在 Side Panel 出。 */
const FEEDBACK_MS = 1500;
/** 提示态停留久得多：它要求用户抬手去点浏览器工具栏，1.5s 连读都读不完。 */
const HINT_MS = 6000;

export interface ToolbarProps {
  /** 非空即切换为提示态；落点由 Content Script 按提示用途决定。 */
  hint?: string;
  /** 首次启用提示的第二行说明；普通兜底提示不传。 */
  hintDetail?: string;
  /** 首次启用提示为 4s；不传时保留原有面板兜底提示的 6s。 */
  hintDurationMs?: number;
  onAction: (action: SelectionAction) => void;
  /** 反馈或提示播完后，请求宿主收起工具条。 */
  onDismiss: () => void;
}

export interface ToolbarHost {
  /**
   * 渲染一次；传 null 即清空。
   * 每次调用都整棵重建，因此上一次的反馈态绝不会残留 ——
   * 这正是原先靠 React `key` 换实例达到的效果，手写 DOM 下是默认行为。
   */
  render(props: ToolbarProps | null): void;
  /** 宿主销毁：清掉在途定时器与 rAF，避免它们在元素移除后还回调。 */
  destroy(): void;
}

export function createToolbarHost(container: HTMLElement): ToolbarHost {
  const doc = container.ownerDocument;
  let timer = 0;
  let frame = 0;

  function clearPending(): void {
    if (timer) {
      window.clearTimeout(timer);
      timer = 0;
    }
    if (frame) {
      window.cancelAnimationFrame(frame);
      frame = 0;
    }
  }

  function el(tag: string, className: string): HTMLElement {
    const node = doc.createElement(tag);
    node.className = className;
    return node;
  }

  /** 提示态与反馈态共用同一张消息纸面，区别只在有没有标题行和生长线。 */
  function renderMessage(options: {
    className: string;
    title?: string;
    status: string;
    withLine?: boolean;
    dismissAfterMs: number;
    onDismiss: () => void;
  }): void {
    const root = el('div', options.className);
    root.setAttribute('role', 'status');

    if (options.title) {
      const title = el('strong', 'wisp-toolbar__hint-title');
      title.textContent = options.title;
      root.appendChild(title);
    }

    const status = el('span', 'wisp-toolbar__status');
    status.textContent = options.status;
    root.appendChild(status);

    if (options.withLine) {
      const line = el('span', 'wisp-toolbar__line');
      line.setAttribute('aria-hidden', 'true');
      root.appendChild(line);
      // 生长必须发生在「起始态已被浏览器采纳」之后：同一帧内先后写两个 transform，
      // 浏览器只会看到终值，过渡根本不跑。用一帧 rAF 翻类名，动画本身仍全交给 CSS。
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        line.classList.add('wisp-toolbar__line--grown');
      });
    }

    container.replaceChildren(root);
    timer = window.setTimeout(options.onDismiss, options.dismissAfterMs);
  }

  function renderBusy(action: SelectionAction, props: ToolbarProps): void {
    clearPending();
    renderMessage({
      className: 'wisp-toolbar wisp-toolbar--message',
      status: BUSY_LABEL[action],
      withLine: true,
      dismissAfterMs: FEEDBACK_MS,
      onDismiss: props.onDismiss,
    });
  }

  function renderActions(props: ToolbarProps): void {
    const root = el('div', 'wisp-toolbar');
    root.setAttribute('role', 'toolbar');
    root.setAttribute('aria-label', 'Wisp 划词操作');

    /** Tab 在四个动作间循环（§5.10）：不把焦点还给宿主页面，退出走 Esc。 */
    root.addEventListener('keydown', (event) => {
      // 只吃 Tab。Esc 必须继续冒泡到 document —— 收起工具条的监听挂在那里，
      // 一旦在这里拦下，焦点进了工具条之后 Esc 就再也关不掉它。
      if (event.key !== 'Tab') return;
      const buttons = [...root.querySelectorAll<HTMLButtonElement>('.wisp-toolbar__btn')];
      const current = buttons.indexOf(event.target as HTMLButtonElement);
      if (current < 0) return;
      event.preventDefault();
      event.stopPropagation();
      const step = event.shiftKey ? -1 : 1;
      buttons[(current + step + buttons.length) % buttons.length]?.focus();
    });

    for (const { action, label } of ACTIONS) {
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'wisp-toolbar__btn';
      button.textContent = label;
      // 保住宿主页面的选区：按钮抢到焦点会让选区被清掉，快照就取不到了
      button.addEventListener('mousedown', (event) => event.preventDefault());
      button.addEventListener('click', (event) => {
        // 工具条是盖在别人页面上的第三方 UI，点击不该外溢到宿主。宿主的全局委托
        // 处理器（关菜单、埋点、SPA 路由）会被误触发，其中 pushState 一路会让
        // Wisp 自己判定页面已导航，把在途任务连同快照一起作废。
        event.stopPropagation();
        renderBusy(action, props);
        props.onAction(action);
      });
      root.appendChild(button);
    }

    container.replaceChildren(root);
  }

  return {
    render(props) {
      clearPending();
      if (!props) {
        container.replaceChildren();
        return;
      }
      if (props.hint) {
        renderMessage({
          className: `wisp-toolbar wisp-toolbar--message${props.hintDetail ? ' wisp-toolbar--discovery' : ''}`,
          title: props.hintDetail ? props.hint : undefined,
          status: props.hintDetail ?? props.hint,
          dismissAfterMs: props.hintDurationMs ?? HINT_MS,
          onDismiss: props.onDismiss,
        });
        return;
      }
      renderActions(props);
    },

    destroy() {
      clearPending();
      container.replaceChildren();
    },
  };
}

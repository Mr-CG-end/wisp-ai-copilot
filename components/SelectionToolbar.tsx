import React, { useEffect, useState } from 'react';
import type { SelectionAction } from '../core/messaging/types';

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

interface SelectionToolbarProps {
  /** 非空即切换为提示态，占工具条原位（面板无法程序化打开时的兜底）。 */
  hint?: string;
  onAction: (action: SelectionAction) => void;
  /** 反馈或提示播完后，请求宿主收起工具条。宿主须传稳定引用。 */
  onDismiss: () => void;
}

export const SelectionToolbar: React.FC<SelectionToolbarProps> = ({
  hint,
  onAction,
  onDismiss,
}) => {
  const [busy, setBusy] = useState<SelectionAction | null>(null);
  const [grown, setGrown] = useState(false);

  useEffect(() => {
    if (!hint) return undefined;
    const timer = window.setTimeout(onDismiss, HINT_MS);
    return () => window.clearTimeout(timer);
  }, [hint, onDismiss]);

  useEffect(() => {
    if (!busy) return undefined;
    // 生长必须发生在「起始态已被浏览器采纳」之后：同一帧内先后写两个 transform，
    // 浏览器只会看到终值，过渡根本不跑。用一帧 rAF 翻类名，动画本身仍全交给 CSS。
    const frame = requestAnimationFrame(() => setGrown(true));
    const timer = window.setTimeout(onDismiss, FEEDBACK_MS);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [busy, onDismiss]);

  if (hint) {
    return (
      <div className="wisp-toolbar wisp-toolbar--message" role="status">
        <span className="wisp-toolbar__status">{hint}</span>
      </div>
    );
  }

  if (busy) {
    return (
      <div className="wisp-toolbar wisp-toolbar--message" role="status">
        <span className="wisp-toolbar__status">{BUSY_LABEL[busy]}</span>
        <span
          className={`wisp-toolbar__line${grown ? ' wisp-toolbar__line--grown' : ''}`}
          aria-hidden="true"
        />
      </div>
    );
  }

  /** Tab 在四个动作间循环（§5.10）：不把焦点还给宿主页面，退出走 Esc。 */
  const cycleFocus = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('.wisp-toolbar__btn'),
    );
    const current = buttons.indexOf(event.target as HTMLButtonElement);
    if (current < 0) return;
    event.preventDefault();
    const step = event.shiftKey ? -1 : 1;
    buttons[(current + step + buttons.length) % buttons.length]?.focus();
  };

  return (
    <div
      className="wisp-toolbar"
      role="toolbar"
      aria-label="Wisp 划词操作"
      onKeyDown={cycleFocus}
    >
      {ACTIONS.map(({ action, label }) => (
        <button
          key={action}
          type="button"
          className="wisp-toolbar__btn"
          // 保住宿主页面的选区：按钮抢到焦点会让选区被清掉，快照就取不到了
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            setBusy(action);
            onAction(action);
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
};

import React from 'react';
import type { Turn } from '../../../core/panel/thread';
import { Thread } from './Thread';
import { StreamMarkdown } from './StreamMarkdown';

interface TurnViewProps {
  turn: Turn;
  /** 该轮来源与当前快照不同（如跨标签后保留的旧轮） */
  isStale: boolean;
  isStopping: boolean;
  canRegenerate: boolean;
  /** 划词轮次的原选区；有值即在正文顶部回显，让用户确认这一轮处理的是哪段文字 */
  selectionText?: string;
  /** 翻译轮次的目标语言与切换回调；只有同时给出才渲染下拉 */
  targetLang?: 'zh' | 'en';
  onTargetLangChange?: (lang: 'zh' | 'en') => void;
  onCopy: () => void;
  onRegenerate: () => void;
  onStop: () => void;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * 一轮 = 轨道单元 + 纸面。历史轮次与当前轮共用本组件 ——
 * 历史不是「另一种东西」，只是轨道上更早的节点。
 */
export const TurnView: React.FC<TurnViewProps> = ({
  turn, isStale, isStopping, canRegenerate, selectionText, targetLang,
  onTargetLangChange, onCopy, onRegenerate, onStop,
}) => {
  const isGenerating = turn.status === 'loading';
  return (
    <article className="wisp-turn" aria-label={turn.accessibleName}>
      <Thread index={turn.index} label={turn.label} status={turn.status} />

      <div className="wisp-turn-paper">
        {isStale ? (
          <div className="wisp-turn-origin">本结果来自：{hostOf(turn.sourceUrl)}</div>
        ) : null}

        <header className="wisp-turn-tools">
          <span className="wisp-turn-source" title={turn.source}>
            {turn.statusLabel || turn.source}
          </span>
          {isGenerating ? (
            <button className="wisp-btn-sm wisp-btn-danger" disabled={isStopping} onClick={onStop}>
              {isStopping ? '正在停止…' : '停止'}
            </button>
          ) : (
            <div className="wisp-turn-actions">
              {onTargetLangChange ? (
                <select
                  className="wisp-turn-lang"
                  aria-label="翻译目标语言"
                  value={targetLang ?? 'zh'}
                  disabled={!canRegenerate}
                  onChange={(event) => onTargetLangChange(event.target.value as 'zh' | 'en')}
                >
                  <option value="zh">译为中文</option>
                  <option value="en">译为英文</option>
                </select>
              ) : null}
              {turn.output ? (
                <button className="wisp-btn-sm" onClick={onCopy}>复制</button>
              ) : null}
              <button className="wisp-btn-sm" disabled={!canRegenerate} onClick={onRegenerate}>
                重新生成
              </button>
            </div>
          )}
        </header>

        <div className="wisp-turn-body">
          {selectionText ? (
            <div className="wisp-turn-selection">
              <span>选中的文字</span>
              <p>{selectionText}</p>
            </div>
          ) : null}

          {turn.userInput ? (
            <div className="wisp-turn-question">
              <span>你的问题</span>
              <p>{turn.userInput}</p>
            </div>
          ) : null}

          {turn.output ? <StreamMarkdown content={turn.output} /> : null}

          {isGenerating && !turn.output ? (
            <div className="wisp-turn-prelude">正在读取快照并生成…</div>
          ) : null}

          {turn.status === 'empty' ? (
            <div className="wisp-state-empty">
              <strong>模型没有返回内容</strong>
              <span>可以重新生成或换个问题。</span>
            </div>
          ) : null}

          {turn.status === 'error' ? (
            <div className="wisp-state-error">
              <strong>生成未完成</strong>
              <span>模型生成遇到错误，可以重试。</span>
            </div>
          ) : null}

          {turn.truncated ? (
            <div className="wisp-truncated-note">
              回答达到长度上限，内容可能未完整结束。可以缩小问题范围后重试。
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
};

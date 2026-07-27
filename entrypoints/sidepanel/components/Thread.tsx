import React from 'react';
import type { TurnStatus } from '../../../core/panel/thread';

interface ThreadProps {
  index: number;
  label: string;
  status: TurnStatus;
}

/**
 * 轨道单元：线段 + 节点 + 编号 + 标签。
 *
 * 整体 aria-hidden —— 轨迹是状态的视觉加速器，状态本身由 Turn 的
 * aria-label 与纸面内的文字承载，读屏用户不必去理解一条线。
 */
export const Thread: React.FC<ThreadProps> = ({ index, label, status }) => (
  <div className={`wisp-thread wisp-thread--${status}`} aria-hidden="true">
    <span className="wisp-thread-line" />
    <span className="wisp-thread-node" />
    <span className="wisp-thread-index">{String(index).padStart(2, '0')}</span>
    <span className="wisp-thread-type">{label}</span>
  </div>
);

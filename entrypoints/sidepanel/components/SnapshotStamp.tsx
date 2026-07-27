import React from 'react';
import { formatReadAt } from '../../../core/panel/relativeTime';

interface SnapshotStampProps {
  host: string;
  readAt: number;
  now: number;
  /** 绑定页已导航或刷新 —— 快照与页面不再对应 */
  stale: boolean;
}

export const SnapshotStamp: React.FC<SnapshotStampProps> = ({ host, readAt, now, stale }) => {
  const initial = host ? host.charAt(0).toUpperCase() : '·';
  return (
    <div className={`wisp-stamp ${stale ? 'is-stale' : ''}`}>
      {/* 只用域名首字母 —— 取真实 favicon 需要发网络请求，违反不出网红线 */}
      <span className="wisp-stamp-initial" aria-hidden="true">{initial}</span>
      <span className="wisp-stamp-time">
        {stale ? '快照已过期' : `${formatReadAt(readAt, now)}读取`}
      </span>
    </div>
  );
};

export type SetupStepState = 'done' | 'active' | 'todo' | 'failed';

export interface SetupStep {
  key: string;
  label: string;
  state: SetupStepState;
}

type ModelStatusInput =
  | 'uninitialized' | 'checking-cache' | 'downloading'
  | 'loading' | 'ready' | 'needs-user-choice' | 'error';

/** 各状态对应的「当前进行到第几步」，0 起 */
const ACTIVE_INDEX: Record<ModelStatusInput, number> = {
  uninitialized: 0,
  'needs-user-choice': 0,
  'checking-cache': 1,
  downloading: 1,
  loading: 2,
  error: 1,
  ready: 4,
};

/**
 * 初始化四步。轨迹在此复用同一套节点语汇，让「首次要等约 47 秒」
 * 变得可理解 —— 用户看得见自己在四步里的哪一步。
 */
export function selectSetupSteps(status: ModelStatusInput, hasCache: boolean): SetupStep[] {
  const active = ACTIVE_INDEX[status];
  const labels = [
    { key: 'confirm', label: '确认模型来源' },
    { key: 'fetch', label: hasCache ? '缓存命中' : '下载权重' },
    { key: 'load', label: '加载到后端' },
    { key: 'selfcheck', label: '自检一次生成' },
  ];
  return labels.map((step, i) => {
    let state: SetupStepState = 'todo';
    if (i < active) state = 'done';
    else if (i === active) state = status === 'error' ? 'failed' : 'active';
    return { ...step, state };
  });
}

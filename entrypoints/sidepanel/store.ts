import { create } from 'zustand';
import type { Lang } from '../../core/inference/contract';
import type { ErrorCode, TaskContext, Uuid } from '../../core/messaging/types';
import type { PerformanceProfile } from '../../core/panel/performance';

export type AsyncStatus =
  | 'idle'
  | 'loading'
  | 'success'
  | 'empty'
  | 'error'
  | 'cancelled';

export type ModelStatus =
  | 'uninitialized'
  | 'checking-cache'
  | 'downloading'
  | 'loading'
  | 'ready'
  | 'needs-user-choice'
  | 'error';

export type TaskType = 'summary' | 'qa' | 'explain' | 'summarize' | 'translate' | 'rewrite';

export interface PageInfo {
  ctx: TaskContext;
  title: string;
  url: string;
  text: string;
  charCount: number;
  truncated: boolean;
  method: 'readability' | 'heuristic';
  /** 快照读取时刻，供凭证显示「3 分钟前读取」 */
  readAt: number;
}

export interface CurrentTask {
  id: Uuid;
  type: TaskType;
  ctx: TaskContext;
  status: AsyncStatus;
  retryable: boolean;
  source: string;
  userInput?: string;
  truncated?: boolean;
  contextChars?: number;
  /** 翻译轮次的目标语言；留在轮次上，「改目标语言重跑」才有据可依 */
  targetLang?: Lang;
  /** 划词轮次的原选区，供结果区顶部回显 */
  selectionText?: string;
}

export interface TaskHistoryEntry extends CurrentTask {
  output: string;
}

export interface ErrorState {
  code: ErrorCode;
  message: string;
  retryable: boolean;
}

export interface PanelStoreState {
  // 模型状态
  modelStatus: ModelStatus;
  modelBackend: 'webgpu' | 'wasm' | null;
  downloadPct: number;

  // 页面绑定与快照
  boundCtx: TaskContext | null;
  page: PageInfo | null;

  // 当前任务与输出
  currentTask: CurrentTask | null;
  streamBuffer: string;
  history: TaskHistoryEntry[];

  // 错误状态
  error: ErrorState | null;

  /**
   * 性能档位。它决定送入模型的上下文预算与输出上限，属产品状态而非短生命周期
   * UI 状态，因此进 store —— 顶栏与任务面板都要读到同一个来源。
   */
  performanceProfile: PerformanceProfile;

  // Actions
  setModelStatus: (status: ModelStatus, error?: ErrorState | null) => void;
  setModelBackend: (backend: 'webgpu' | 'wasm' | null) => void;
  setDownloadPct: (pct: number) => void;
  setBoundCtx: (boundCtx: TaskContext | null) => void;
  setPage: (page: PageInfo | null) => void;
  restoreHistory: (entries: TaskHistoryEntry[]) => void;
  startTask: (task: CurrentTask, options?: { archiveCurrent?: boolean }) => void;
  appendStream: (taskId: Uuid, text: string) => void;
  finishTask: (taskId: Uuid, result?: { truncated?: boolean }) => void;
  cancelTask: (taskId: Uuid) => void;
  failTask: (taskId: Uuid, error: ErrorState) => void;
  setError: (error: ErrorState | null) => void;
  setPerformanceProfile: (profile: PerformanceProfile) => void;
  reset: () => void;
}

const initialState = {
  modelStatus: 'uninitialized' as ModelStatus,
  modelBackend: null,
  downloadPct: 0,
  boundCtx: null,
  page: null,
  currentTask: null,
  streamBuffer: '',
  history: [],
  error: null,
  performanceProfile: 'resource-saver' as PerformanceProfile,
};

export const usePanelStore = create<PanelStoreState>((set) => ({
  ...initialState,

  setModelStatus: (modelStatus, error = null) => set((state) => ({
    modelStatus,
    error: error ?? (modelStatus === 'error' ? state.error : null),
  })),

  setModelBackend: (modelBackend) => set({ modelBackend }),

  setDownloadPct: (downloadPct) => set({ downloadPct }),

  setBoundCtx: (boundCtx) => set({ boundCtx }),

  setPage: (page) => set({ page }),

  /**
   * 把落库的旧轮次铺回轨迹。恢复是异步的，期间用户完全可能已经开始新一轮，
   * 因此「轨迹是否仍为空」必须在 set 内部判定，不能由调用方先读后写 ——
   * 那中间隔着一次 await，判据会过期。
   *
   * 轨迹非空即放弃：硬塞会把已经在跑的轮次挤到恢复出来的历史后面，编号一起错乱。
   * 在途轮次留在 currentTask 上，不在 history 里，所以「恢复历史 + 当前轮仍在生成」
   * 这一种叠加是安全的，顺序天然正确。
   */
  restoreHistory: (entries) => set((state) => (
    state.history.length > 0 || entries.length === 0 ? state : { history: entries }
  )),

  startTask: (task, options) => set((state) => {
    const shouldArchive = options?.archiveCurrent !== false;
    // 终态轮次（empty / cancelled / error）即便零输出也要进历史 —— 否则
    // 「点了停止但一个字都没出」和「模型返回空结果」会从轨道上凭空蒸发，
    // 用户看不到「刚才那次失败了」。唯一该丢的是「在途且零输出」的空壳。
    const isEmptyInFlight = state.currentTask?.status === 'loading'
      && state.streamBuffer.trim() === '';
    const canArchive = Boolean(
      shouldArchive
      && state.currentTask
      && !isEmptyInFlight,
    );
    const history = canArchive
      ? [
          ...state.history,
          { ...state.currentTask!, output: state.streamBuffer },
        ].slice(-20)
      : state.history;
    return {
      currentTask: task,
      streamBuffer: '',
      history,
      error: null,
    };
  }),

  appendStream: (taskId, text) => set((state) => {
    if (
      !state.currentTask
      || state.currentTask.id !== taskId
      || state.currentTask.status !== 'loading'
    ) return state;
    return { streamBuffer: state.streamBuffer + text };
  }),

  finishTask: (taskId, result) => set((state) => {
    if (
      !state.currentTask
      || state.currentTask.id !== taskId
      || state.currentTask.status !== 'loading'
    ) return state;
    const finalStatus: AsyncStatus = state.streamBuffer.trim().length === 0 ? 'empty' : 'success';
    return {
      currentTask: {
        ...state.currentTask,
        status: finalStatus,
        truncated: result?.truncated ?? false,
      },
    };
  }),

  cancelTask: (taskId) => set((state) => {
    if (
      !state.currentTask
      || state.currentTask.id !== taskId
      || state.currentTask.status !== 'loading'
    ) return state;
    return {
      currentTask: { ...state.currentTask, status: 'cancelled' },
    };
  }),

  failTask: (taskId, error) => set((state) => {
    if (
      !state.currentTask
      || state.currentTask.id !== taskId
      || state.currentTask.status !== 'loading'
    ) return state;
    return {
      currentTask: { ...state.currentTask, status: 'error' },
      error,
    };
  }),

  setError: (error) => set({ error }),

  setPerformanceProfile: (performanceProfile) => set({ performanceProfile }),

  reset: () => set(initialState),
}));

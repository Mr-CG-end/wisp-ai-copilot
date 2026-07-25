import { create } from 'zustand';
import type { ErrorCode, TaskContext, Uuid } from '../../core/messaging/types';

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
}

export interface CurrentTask {
  id: Uuid;
  type: TaskType;
  ctx: TaskContext;
  status: AsyncStatus;
  retryable: boolean;
  source: string;
}

export interface ErrorState {
  code: ErrorCode;
  message: string;
  retryable: boolean;
}

export interface PanelStoreState {
  // 模型状态
  modelStatus: ModelStatus;
  downloadPct: number;

  // 页面绑定与快照
  boundCtx: TaskContext | null;
  page: PageInfo | null;

  // 当前任务与输出
  currentTask: CurrentTask | null;
  streamBuffer: string;

  // 错误状态
  error: ErrorState | null;

  // Actions
  setModelStatus: (status: ModelStatus, error?: ErrorState | null) => void;
  setDownloadPct: (pct: number) => void;
  setBoundCtx: (boundCtx: TaskContext | null) => void;
  setPage: (page: PageInfo | null) => void;
  startTask: (task: CurrentTask) => void;
  appendStream: (taskId: Uuid, text: string) => void;
  finishTask: (taskId: Uuid) => void;
  cancelTask: (taskId: Uuid) => void;
  failTask: (taskId: Uuid, error: ErrorState) => void;
  setError: (error: ErrorState | null) => void;
  reset: () => void;
}

const initialState = {
  modelStatus: 'uninitialized' as ModelStatus,
  downloadPct: 0,
  boundCtx: null,
  page: null,
  currentTask: null,
  streamBuffer: '',
  error: null,
};

export const usePanelStore = create<PanelStoreState>((set) => ({
  ...initialState,

  setModelStatus: (modelStatus, error = null) => set((state) => ({
    modelStatus,
    error: error ?? (modelStatus === 'error' ? state.error : null),
  })),

  setDownloadPct: (downloadPct) => set({ downloadPct }),

  setBoundCtx: (boundCtx) => set({ boundCtx }),

  setPage: (page) => set({ page }),

  startTask: (task) => set({
    currentTask: task,
    streamBuffer: '',
    error: null,
  }),

  appendStream: (taskId, text) => set((state) => {
    if (!state.currentTask || state.currentTask.id !== taskId) return state;
    return { streamBuffer: state.streamBuffer + text };
  }),

  finishTask: (taskId) => set((state) => {
    if (!state.currentTask || state.currentTask.id !== taskId) return state;
    const finalStatus: AsyncStatus = state.streamBuffer.trim().length === 0 ? 'empty' : 'success';
    return {
      currentTask: { ...state.currentTask, status: finalStatus },
    };
  }),

  cancelTask: (taskId) => set((state) => {
    if (!state.currentTask || state.currentTask.id !== taskId) return state;
    return {
      currentTask: { ...state.currentTask, status: 'cancelled' },
    };
  }),

  failTask: (taskId, error) => set((state) => {
    if (!state.currentTask || state.currentTask.id !== taskId) return state;
    return {
      currentTask: { ...state.currentTask, status: 'error' },
      error,
    };
  }),

  setError: (error) => set({ error }),

  reset: () => set(initialState),
}));

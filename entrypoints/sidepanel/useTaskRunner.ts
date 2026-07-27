import { useCallback, useRef, useState } from 'react';
import * as Comlink from 'comlink';
import { useInferenceContext } from './InferenceProvider';
import { usePanelStore, type AsyncStatus } from './store';
import { isCtxCurrent } from '../../core/panel/taskGuard';
import type {
  GenerateRequest,
  GenStats,
  Lang,
  SelectionAction,
  Uuid,
} from '../../core/inference/contract';
import type { TaskContext } from '../../core/messaging/types';

const DEFAULT_STREAM_FLUSH_INTERVAL_MS = 60;

export interface RunOptions {
  taskType: 'summary' | 'qa' | SelectionAction;
  untrustedData: string;
  userInput?: string;
  targetLang?: Lang;
  maxNewTokens?: number;
  temperature?: number;
  ctx: TaskContext;
  source: string;
  archivePrevious?: boolean;
  contextChars?: number;
  streamFlushIntervalMs?: number;
}

export interface GenerationRunResult {
  taskId: Uuid;
  status: 'success' | 'empty' | 'cancelled' | 'error';
  content: string;
  stats?: GenStats;
  maxFrameGapMs: number;
}

function toGenerationResultStatus(
  status: AsyncStatus,
): GenerationRunResult['status'] {
  return status === 'success' || status === 'empty' || status === 'cancelled'
    ? status
    : 'error';
}

function startFrameLagMonitor(): { stop: () => number } {
  if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
    return { stop: () => 0 };
  }

  let frameId = 0;
  let stopped = false;
  let lastFrameAt = performance.now();
  let maxFrameGapMs = 0;
  const sample = (now: number) => {
    if (stopped) return;
    if (document.visibilityState === 'visible') {
      maxFrameGapMs = Math.max(maxFrameGapMs, now - lastFrameAt);
    }
    lastFrameAt = now;
    frameId = window.requestAnimationFrame(sample);
  };
  frameId = window.requestAnimationFrame(sample);

  return {
    stop: () => {
      if (!stopped) {
        stopped = true;
        window.cancelAnimationFrame(frameId);
        if (document.visibilityState === 'visible') {
          maxFrameGapMs = Math.max(maxFrameGapMs, performance.now() - lastFrameAt);
        }
      }
      return maxFrameGapMs;
    },
  };
}

export function useTaskRunner() {
  const { getApi } = useInferenceContext();
  const [isStopping, setIsStopping] = useState(false);
  const activeSignalIdRef = useRef<Uuid | null>(null);
  const pendingStreamRef = useRef<{ taskId: Uuid | null; text: string }>({
    taskId: null,
    text: '',
  });
  const flushTimerRef = useRef<number | null>(null);
  const streamFlushIntervalRef = useRef(DEFAULT_STREAM_FLUSH_INTERVAL_MS);

  const startTask = usePanelStore((s) => s.startTask);
  const appendStream = usePanelStore((s) => s.appendStream);
  const finishTask = usePanelStore((s) => s.finishTask);
  const cancelTask = usePanelStore((s) => s.cancelTask);
  const failTask = usePanelStore((s) => s.failTask);

  const flushPendingStream = useCallback((taskId: Uuid) => {
    if (flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    const pending = pendingStreamRef.current;
    if (pending.taskId !== taskId || !pending.text) return;
    const text = pending.text;
    pendingStreamRef.current = { taskId, text: '' };
    appendStream(taskId, text);
  }, [appendStream]);

  const enqueueStream = useCallback((taskId: Uuid, delta: string) => {
    const pending = pendingStreamRef.current;
    pendingStreamRef.current = {
      taskId,
      text: pending.taskId === taskId ? pending.text + delta : delta,
    };
    if (flushTimerRef.current === null) {
      flushTimerRef.current = window.setTimeout(() => {
        flushPendingStream(taskId);
      }, streamFlushIntervalRef.current);
    }
  }, [flushPendingStream]);

  const stop = useCallback(async () => {
    const signalId = activeSignalIdRef.current;
    if (!signalId) return;
    setIsStopping(true);
    flushPendingStream(signalId);
    cancelTask(signalId);
    try {
      const api = getApi();
      await api.cancel(signalId);
    } catch (e) {
      console.error('[wisp] cancel failed:', e);
    } finally {
      setIsStopping(false);
    }
  }, [getApi, cancelTask, flushPendingStream]);

  const runGeneration = useCallback(
    async (options: RunOptions) => {
      const boundCtx = usePanelStore.getState().boundCtx;
      if (!isCtxCurrent(options.ctx, boundCtx)) {
        console.warn('[wisp] task target ctx is not current boundCtx');
        return null;
      }

      if (activeSignalIdRef.current) {
        await stop();
      }

      const signalId = crypto.randomUUID();
      activeSignalIdRef.current = signalId;
      pendingStreamRef.current = { taskId: signalId, text: '' };
      streamFlushIntervalRef.current = options.streamFlushIntervalMs
        ?? DEFAULT_STREAM_FLUSH_INTERVAL_MS;

      startTask(
        {
          id: signalId,
          type: options.taskType,
          ctx: options.ctx,
          status: 'loading',
          retryable: true,
          source: options.source,
          userInput: options.userInput,
          contextChars: options.contextChars,
        },
        { archiveCurrent: options.archivePrevious !== false },
      );

      const req: GenerateRequest = {
        taskType: options.taskType,
        untrustedData: options.untrustedData,
        userInput: options.userInput,
        targetLang: options.targetLang,
        params: {
          maxNewTokens: options.maxNewTokens ?? 512,
          temperature: options.temperature ?? 0.7,
        },
      };

      const frameLagMonitor = startFrameLagMonitor();
      try {
        const api = getApi();
        const stats = await api.generate(
          req,
          signalId,
          Comlink.proxy((delta: string) => {
            const currentBound = usePanelStore.getState().boundCtx;
            const task = usePanelStore.getState().currentTask;
            if (
              activeSignalIdRef.current === signalId
              && task?.id === signalId
              && task.status === 'loading'
              && isCtxCurrent(options.ctx, currentBound)
            ) {
              enqueueStream(signalId, delta);
            }
          }),
        );

        flushPendingStream(signalId);
        const state = usePanelStore.getState();
        if (
          activeSignalIdRef.current === signalId
          && state.currentTask?.id === signalId
          && state.currentTask.status === 'loading'
          && isCtxCurrent(options.ctx, state.boundCtx)
        ) {
          finishTask(signalId, { truncated: stats.truncated });
        } else if (
          activeSignalIdRef.current === signalId
          && state.currentTask?.id === signalId
          && state.currentTask.status === 'loading'
        ) {
          failTask(signalId, {
            code: 'TAB_CHANGED',
            message: '页面已刷新或跳转，旧任务已停止接收内容。',
            retryable: true,
          });
        }
        const completed = usePanelStore.getState();
        if (completed.currentTask?.id !== signalId) return null;
        return {
          taskId: signalId,
          status: toGenerationResultStatus(completed.currentTask.status),
          content: completed.streamBuffer,
          stats,
          maxFrameGapMs: frameLagMonitor.stop(),
        } satisfies GenerationRunResult;
      } catch (e: unknown) {
        console.error('[wisp] generate error:', e);
        flushPendingStream(signalId);
        const state = usePanelStore.getState();
        if (
          activeSignalIdRef.current === signalId
          && state.currentTask?.id === signalId
          && state.currentTask.status === 'loading'
        ) {
          const errMsg = e instanceof Error ? e.message : String(e);
          failTask(signalId, {
            code: isCtxCurrent(options.ctx, state.boundCtx) ? 'WORKER_ERROR' : 'TAB_CHANGED',
            message: isCtxCurrent(options.ctx, state.boundCtx)
              ? errMsg || '模型生成遇到错误'
              : '页面已刷新或跳转，旧任务已停止接收内容。',
            retryable: true,
          });
        }
        const failed = usePanelStore.getState();
        if (failed.currentTask?.id !== signalId) return null;
        return {
          taskId: signalId,
          status: toGenerationResultStatus(failed.currentTask.status),
          content: failed.streamBuffer,
          maxFrameGapMs: frameLagMonitor.stop(),
        } satisfies GenerationRunResult;
      } finally {
        frameLagMonitor.stop();
        if (activeSignalIdRef.current === signalId) {
          activeSignalIdRef.current = null;
          if (flushTimerRef.current !== null) {
            window.clearTimeout(flushTimerRef.current);
            flushTimerRef.current = null;
          }
          pendingStreamRef.current = { taskId: null, text: '' };
        }
      }
    },
    [getApi, startTask, enqueueStream, flushPendingStream, finishTask, failTask, stop],
  );

  return {
    runGeneration,
    stop,
    isStopping,
  };
}

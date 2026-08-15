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
  /** 划词任务的原选区；只用于回显与「改目标语言重跑」，不参与提示词拼装。 */
  selectionText?: string;
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

  /**
   * 只负责通知 Worker 中断，不碰 store。
   *
   * 这是一次 Comlink 往返，而 Worker 在生成期间卡在 model.generate() 里 ——
   * 这条消息要排到它腾出手才被处理，回话可能是十几秒之后的事。
   * 因此调用方必须自己决定「要不要等」，store 侧的状态转换一律不许挂在它后面。
   */
  const requestWorkerCancel = useCallback(async (signalId: Uuid) => {
    try {
      await getApi().cancel(signalId);
    } catch (e) {
      console.error('[wisp] cancel failed:', e);
    }
  }, [getApi]);

  /**
   * 放弃在途轮次：store 侧的状态转换在同步段内完成，Worker 侧的中断只发不等。
   *
   * 与 stop() 的区别只在「等不等回话」。凡是紧接着还要做别的事的调用方都该用这个 ——
   * api.cancel 的回话排在 Worker 当前这整段生成后面，await 它会让后续动作一起停摆
   * 十几秒。真机 A6（抢占摘要）与「生成中点读取当前页」都是同一个成因。
   */
  const preemptCurrent = useCallback((): void => {
    const signalId = activeSignalIdRef.current;
    if (!signalId) return;
    flushPendingStream(signalId);
    cancelTask(signalId);
    void requestWorkerCancel(signalId);
  }, [flushPendingStream, cancelTask, requestWorkerCancel]);

  /** 用户点「停止」：等回话是对的 —— 按钮要一直显示「正在停止…」直到中断真的送达。 */
  const stop = useCallback(async () => {
    const signalId = activeSignalIdRef.current;
    if (!signalId) return;
    setIsStopping(true);
    flushPendingStream(signalId);
    cancelTask(signalId);
    try {
      await requestWorkerCancel(signalId);
    } finally {
      setIsStopping(false);
    }
  }, [requestWorkerCancel, cancelTask, flushPendingStream]);

  const runGeneration = useCallback(
    async (options: RunOptions) => {
      const boundCtx = usePanelStore.getState().boundCtx;
      // 划词投递链路的诊断锚点之一。这个守卫是「点了工具条却一轮都没出现」的
      // 头号嫌疑：它一旦早退，既不建轮次也不抢占在途任务，屏幕上什么都不会变。
      if (import.meta.env.DEV) {
        console.debug('[wisp:diag] runGeneration 入口', {
          taskType: options.taskType,
          ctx: options.ctx,
          boundCtx,
          passed: isCtxCurrent(options.ctx, boundCtx),
        });
      }
      if (!isCtxCurrent(options.ctx, boundCtx)) {
        console.warn('[wisp] task target ctx is not current boundCtx');
        return null;
      }

      // 必须是同步的 preemptCurrent 而不是 await stop()：后者会把下面的 startTask
      // 一起押到 Worker 回话之后，真机现象就是「被抢占那轮立刻变已停止，新一轮迟迟不出现」。
      preemptCurrent();

      const signalId = crypto.randomUUID();
      activeSignalIdRef.current = signalId;
      pendingStreamRef.current = { taskId: signalId, text: '' };
      streamFlushIntervalRef.current = options.streamFlushIntervalMs
        ?? DEFAULT_STREAM_FLUSH_INTERVAL_MS;

      // 归档判据只看 currentTask 的状态与 streamBuffer 是否为空，两者都在这一刻定型。
      // 「摘要变已停止但新一轮没出现」若真发生，前后两条日志会直接指出是哪一半失灵。
      if (import.meta.env.DEV) {
        const before = usePanelStore.getState();
        console.debug('[wisp:diag] startTask 前', {
          historyLen: before.history.length,
          currentTaskId: before.currentTask?.id ?? null,
          currentStatus: before.currentTask?.status ?? null,
          streamChars: before.streamBuffer.length,
          archiveCurrent: options.archivePrevious !== false,
        });
      }

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
          // 这两项留在轮次上，「改目标语言重跑」与选区回显才有据可依。
          targetLang: options.targetLang,
          selectionText: options.selectionText,
        },
        { archiveCurrent: options.archivePrevious !== false },
      );

      if (import.meta.env.DEV) {
        const after = usePanelStore.getState();
        console.debug('[wisp:diag] startTask 后', {
          historyLen: after.history.length,
          currentTaskId: after.currentTask?.id ?? null,
          currentStatus: after.currentTask?.status ?? null,
        });
      }

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

      // 开发构建下打印真正送进模型的材料。摘要跑偏时，这是区分
      // 「上下文没选对」与「模型没能力」的唯一直接证据——两者的修法完全不同。
      if (import.meta.env.DEV) {
        console.debug(
          `[wisp] ${options.taskType} material（${options.untrustedData.length} 字）:\n`
          + options.untrustedData,
        );
      }

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
    [
      getApi,
      startTask,
      enqueueStream,
      flushPendingStream,
      finishTask,
      failTask,
      preemptCurrent,
    ],
  );

  return {
    runGeneration,
    stop,
    preemptCurrent,
    isStopping,
  };
}

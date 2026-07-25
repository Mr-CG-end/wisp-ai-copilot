import { useCallback, useRef, useState } from 'react';
import * as Comlink from 'comlink';
import { useInferenceContext } from './InferenceProvider';
import { usePanelStore } from './store';
import { isCtxCurrent } from '../../core/panel/taskGuard';
import type { GenerateRequest, Lang, SelectionAction, Uuid } from '../../core/inference/contract';
import type { TaskContext } from '../../core/messaging/types';

export interface RunOptions {
  taskType: 'summary' | 'qa' | SelectionAction;
  untrustedData: string;
  userInput?: string;
  targetLang?: Lang;
  maxNewTokens?: number;
  temperature?: number;
  ctx: TaskContext;
}

export function useTaskRunner() {
  const { getApi } = useInferenceContext();
  const [isStopping, setIsStopping] = useState(false);
  const activeSignalIdRef = useRef<Uuid | null>(null);

  const startTask = usePanelStore((s) => s.startTask);
  const appendStream = usePanelStore((s) => s.appendStream);
  const finishTask = usePanelStore((s) => s.finishTask);
  const cancelTask = usePanelStore((s) => s.cancelTask);
  const failTask = usePanelStore((s) => s.failTask);

  const stop = useCallback(async () => {
    const signalId = activeSignalIdRef.current;
    if (!signalId) return;
    setIsStopping(true);
    try {
      const api = getApi();
      await api.cancel(signalId);
      cancelTask(signalId);
    } catch (e) {
      console.error('[wisp] cancel failed:', e);
    } finally {
      setIsStopping(false);
    }
  }, [getApi, cancelTask]);

  const runGeneration = useCallback(
    async (options: RunOptions) => {
      const boundCtx = usePanelStore.getState().boundCtx;
      if (!isCtxCurrent(options.ctx, boundCtx)) {
        console.warn('[wisp] task target ctx is not current boundCtx');
        return;
      }

      if (activeSignalIdRef.current) {
        await stop();
      }

      const signalId = crypto.randomUUID();
      activeSignalIdRef.current = signalId;

      startTask({
        id: signalId,
        type: options.taskType,
        ctx: options.ctx,
        status: 'loading',
        retryable: true,
        source: options.ctx.url,
      });

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

      try {
        const api = getApi();
        await api.generate(
          req,
          signalId,
          Comlink.proxy((delta: string) => {
            const currentBound = usePanelStore.getState().boundCtx;
            if (activeSignalIdRef.current === signalId && isCtxCurrent(options.ctx, currentBound)) {
              appendStream(signalId, delta);
            }
          }),
        );

        if (activeSignalIdRef.current === signalId) {
          finishTask(signalId);
        }
      } catch (e: any) {
        console.error('[wisp] generate error:', e);
        if (activeSignalIdRef.current === signalId) {
          const errMsg = e instanceof Error ? e.message : String(e);
          failTask(signalId, {
            code: 'WORKER_ERROR',
            message: errMsg || '模型生成遇到错误',
            retryable: true,
          });
        }
      } finally {
        if (activeSignalIdRef.current === signalId) {
          activeSignalIdRef.current = null;
        }
      }
    },
    [getApi, startTask, appendStream, finishTask, failTask, stop],
  );

  return {
    runGeneration,
    stop,
    isStopping,
  };
}

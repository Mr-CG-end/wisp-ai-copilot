import * as Comlink from 'comlink';
import { useCallback, useEffect, useRef } from 'react';
import type { InferenceApi } from '../../core/inference/contract';
import InferenceWorker from './inference.worker?worker';

type Handle = {
  worker: Worker;
  api: Comlink.Remote<InferenceApi>;
};

export function useInference() {
  const ref = useRef<Handle | null>(null);

  const spawn = useCallback((): Handle => {
    const worker = new InferenceWorker();
    const api = Comlink.wrap<InferenceApi>(worker);
    ref.current = { worker, api };
    return ref.current;
  }, []);

  const teardown = useCallback(() => {
    ref.current?.api[Comlink.releaseProxy]();
    ref.current?.worker.terminate();
    ref.current = null;
  }, []);

  useEffect(() => {
    return teardown;
  }, [teardown]);

  // 下载取消 / Worker 异常时：可靠中止 = 终止并重建（Task 8）
  const recreate = useCallback(() => {
    teardown();
    spawn();
  }, [teardown, spawn]);

  return {
    getApi: () => (ref.current ?? spawn()).api,
    recreate,
  };
}

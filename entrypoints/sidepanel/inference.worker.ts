import * as Comlink from 'comlink';
import {
  AutoModelForCausalLM,
  AutoTokenizer,
  env,
  type PreTrainedModel,
  type PreTrainedTokenizer,
} from '@huggingface/transformers';
import ortWasmModuleUrl from '../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.mjs?url';
import ortWasmBinaryUrl from '../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm?url';
import type {
  InferenceApi,
  InitConfig,
  InitResult,
  LoadProgress,
} from '../../core/inference/contract';
import { createModelProgress } from '../../core/inference/progress';

env.allowLocalModels = false;
env.allowRemoteModels = true;
env.backends.onnx.wasm!.wasmPaths = {
  mjs: ortWasmModuleUrl,
  wasm: ortWasmBinaryUrl,
};

const nativeFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input, init) => {
  try {
    return await nativeFetch(input, init);
  } catch (error) {
    const rawUrl = input instanceof Request ? input.url : String(input);
    let resource = rawUrl;
    try {
      const url = new URL(rawUrl);
      resource = `${url.origin}${url.pathname}`;
    } catch {
      /* keep the original value */
    }
    const reason = error instanceof Error ? error.message : String(error);
    throw new TypeError(`Failed to fetch ${resource}: ${reason}`);
  }
};

let model: PreTrainedModel | null = null;
let tokenizer: PreTrainedTokenizer | null = null;
let currentBackend: 'webgpu' | 'wasm' | null = null;

async function disposeLoaded(): Promise<void> {
  try {
    await model?.dispose?.();
  } catch {
    /* ignore */
  }
  model = null;
  tokenizer = null;
  currentBackend = null;
}

async function init(cfg: InitConfig, onProgress: (p: LoadProgress) => void): Promise<InitResult> {
  await disposeLoaded();
  const backend = cfg.backend ?? 'webgpu';
  const dtype = backend === 'webgpu' ? cfg.quant.webgpu : cfg.quant.wasm;
  const progress = createModelProgress(onProgress);

  try {
    tokenizer = await AutoTokenizer.from_pretrained(cfg.modelId, {
      revision: cfg.revision,
    });
    model = await AutoModelForCausalLM.from_pretrained(cfg.modelId, {
      revision: cfg.revision,
      dtype,
      device: backend,
      progress_callback: progress.onEvent,
    });

    const t = performance.now();
    const probe = tokenizer('Hello');
    await model.generate({ ...probe, max_new_tokens: 1 });
    currentBackend = backend;
    progress.complete();

    return { backend, ready: true, selfCheckMs: performance.now() - t };
  } catch (e) {
    await disposeLoaded();
    throw e;
  }
}

const api: Partial<InferenceApi> = {
  init,
  dispose: disposeLoaded,
  async getStatus() {
    return { loaded: !!model, backend: currentBackend ?? undefined };
  },
  async generate(_req, _signalId, onToken) {
    for (const c of ['你好', '，这是', '流式', '测试。']) {
      onToken(c);
      await new Promise((r) => setTimeout(r, 120));
    }
    return {
      ttftMs: 120,
      tokens: 6,
      tokensPerSec: 8,
      backend: currentBackend ?? 'webgpu',
      truncated: false,
    };
  },
};

Comlink.expose(api);

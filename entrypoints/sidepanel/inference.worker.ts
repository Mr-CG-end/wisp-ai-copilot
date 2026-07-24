import * as Comlink from 'comlink';
import {
  AutoModelForCausalLM,
  AutoTokenizer,
  env,
  TextStreamer,
  InterruptableStoppingCriteria,
  type PreTrainedModel,
  type PreTrainedTokenizer,
} from '@huggingface/transformers';
import ortWasmModuleUrl from '../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.mjs?url';
import ortWasmBinaryUrl from '../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm?url';
import type {
  GenerateRequest,
  GenStats,
  InferenceApi,
  InitConfig,
  InitResult,
  LoadProgress,
  Uuid,
} from '../../core/inference/contract';
import { createModelProgress } from '../../core/inference/progress';
import { SYSTEM_PROMPT, buildUserContent } from '../../core/inference/chatTemplate';
import { ThinkFilter } from '../../core/inference/thinkFilter';
import { StopperRegistry } from '../../core/inference/cancellation';

env.allowLocalModels = false;
env.allowRemoteModels = true;

const isIsolated = typeof self !== 'undefined' && Boolean(self.crossOriginIsolated);
env.backends.onnx.wasm!.wasmPaths = {
  mjs: ortWasmModuleUrl,
  wasm: ortWasmBinaryUrl,
};
env.backends.onnx.wasm!.numThreads = isIsolated ? undefined : 1;

console.log(
  '[wisp] crossOriginIsolated=',
  isIsolated,
  'SAB=',
  typeof SharedArrayBuffer !== 'undefined',
  'numThreads=',
  env.backends.onnx.wasm!.numThreads ?? 'auto'
);

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
const stoppers = new StopperRegistry();

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

async function generate(
  req: GenerateRequest,
  signalId: Uuid,
  onToken: (delta: string) => void,
): Promise<GenStats> {
  if (!model || !tokenizer || !currentBackend) {
    throw new Error('WORKER_NOT_READY');
  }

  const t0 = performance.now();
  const stopping = new InterruptableStoppingCriteria();
  stoppers.register(signalId, stopping);
  const filter = new ThinkFilter();
  let firstTokAt = 0;
  let tokenCount = 0;

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT[req.taskType] ?? SYSTEM_PROMPT.summary },
    { role: 'user', content: buildUserContent(req) },
  ];

  const chatTemplateOptions = {
    add_generation_prompt: true,
    return_dict: true,
    enable_thinking: false,
  };
  const inputs = tokenizer.apply_chat_template(messages, chatTemplateOptions) as any;

  const streamer = new TextStreamer(tokenizer, {
    skip_prompt: true,
    callback_function: (text: string) => {
      const safe = filter.push(text);
      if (safe) onToken(safe);
    },
    token_callback_function: (ids: (number | bigint)[]) => {
      if (firstTokAt === 0) firstTokAt = performance.now();
      tokenCount += ids.length;
    },
  });

  try {
    await model.generate({
      ...inputs,
      max_new_tokens: req.params.maxNewTokens,
      do_sample: req.params.temperature > 0,
      temperature: req.params.temperature,
      streamer,
      stopping_criteria: stopping,
    });
  } finally {
    const tail = filter.flush();
    if (tail) onToken(tail);
    stoppers.release(signalId);
  }

  const end = performance.now();
  const ttftMs = firstTokAt ? firstTokAt - t0 : end - t0;
  const genSecs = firstTokAt ? (end - firstTokAt) / 1000 : 0;

  return {
    ttftMs,
    tokens: tokenCount,
    tokensPerSec: genSecs > 0 && tokenCount > 1 ? (tokenCount - 1) / genSecs : 0,
    backend: currentBackend,
    truncated: tokenCount >= req.params.maxNewTokens,
  };
}

function cancel(signalId: Uuid): void {
  stoppers.interrupt(signalId);
}

const api: Partial<InferenceApi> = {
  init,
  dispose: disposeLoaded,
  async getStatus() {
    return {
      loaded: !!model,
      backend: currentBackend ?? undefined,
      crossOriginIsolated: typeof self !== 'undefined' ? Boolean(self.crossOriginIsolated) : false,
      sharedArrayBufferAvailable: typeof SharedArrayBuffer !== 'undefined',
      numThreads: env.backends.onnx.wasm!.numThreads,
    };
  },
  generate,
  cancel,
};

Comlink.expose(api);

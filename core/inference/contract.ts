import type { ModelSourceId } from './modelSource';

export type Uuid = string;
export type Lang = 'zh' | 'en' | 'other';
export type SelectionAction = 'explain' | 'summarize' | 'rewrite' | 'translate';

export interface LoadProgress {
  file: string; // 最近更新的文件名（诊断用）
  loaded: number; // 已知文件累计已下载字节（总体，见 Worker 聚合）
  total: number; // 已知文件累计总字节（随发现新文件而增长）
  pct: number; // 单调显示进度；模型自检通过后才为 100
}

export interface InitConfig {
  modelId: string;
  revision: string; // 必须是「下载前」锁定的确切 commit sha
  sourceId: ModelSourceId; // 受控下载源；缓存恢复必须使用首次下载时的同一来源
  quant: { webgpu: 'q4f16'; wasm: 'q8' };
  backend?: 'webgpu' | 'wasm';
  cacheOnly?: boolean; // 若为 true，模型只使用本地 Cache，禁止联网下载缺失文件
}
export interface InitResult { backend: 'webgpu' | 'wasm'; ready: boolean; selfCheckMs: number; }

export interface GenerateRequest {
  taskType: 'summary' | 'qa' | SelectionAction;
  untrustedData: string;
  userInput?: string;
  targetLang?: Lang;
  params: { maxNewTokens: number; temperature: number };
}
export interface GenStats {
  ttftMs: number; // Worker 侧：generate() 入口 → 首 token
  tokens: number; // 精确 token 数（token_callback_function 累计）
  tokensPerSec: number;
  backend: 'webgpu' | 'wasm';
  truncated: boolean;
}

export interface InferenceApi {
  init(cfg: InitConfig, onProgress: (p: LoadProgress) => void): Promise<InitResult>;
  generate(req: GenerateRequest, signalId: Uuid, onToken: (delta: string) => void): Promise<GenStats>;
  cancel(signalId: Uuid): void;
  dispose(): Promise<void>;
  getStatus(): Promise<{
    loaded: boolean;
    backend?: 'webgpu' | 'wasm';
    crossOriginIsolated: boolean;
    sharedArrayBufferAvailable: boolean;
    numThreads?: number;
  }>;
}

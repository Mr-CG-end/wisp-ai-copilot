export type Uuid = string;
export type Lang = 'zh' | 'en' | 'other';
export type SelectionAction = 'explain' | 'summarize' | 'rewrite' | 'translate';

export interface LoadProgress {
  file: string; // 最近更新的文件名（诊断用）
  loaded: number; // 已知文件累计已下载字节（总体，见 Worker 聚合）
  total: number; // 已知文件累计总字节（随发现新文件而增长）
}

export interface InitConfig {
  modelId: string;
  revision: string; // 必须是「下载前」锁定的确切 commit sha
  quant: { webgpu: 'q4f16'; wasm: 'q8' };
  backend?: 'webgpu' | 'wasm';
  ortBaseUrl: string; // ORT 本地资产基址；由 Side Panel 传入，Worker 不碰 chrome.*
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
  getStatus(): Promise<{ loaded: boolean; backend?: 'webgpu' | 'wasm' }>;
}

import * as Comlink from 'comlink';
import type { InferenceApi } from '../../core/inference/contract';

const api: Partial<InferenceApi> = {
  async getStatus() {
    return { loaded: false };
  },
  async generate(_req, _signalId, onToken) {
    for (const c of ['你好', '，这是', '流式', '测试。']) {
      onToken(c);
      await new Promise((r) => setTimeout(r, 120));
    }
    return { ttftMs: 120, tokens: 6, tokensPerSec: 8, backend: 'webgpu', truncated: false };
  },
};

Comlink.expose(api);

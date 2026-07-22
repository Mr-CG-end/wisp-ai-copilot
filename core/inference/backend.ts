export type Backend = 'webgpu' | 'wasm';

export type InitState =
  | { status: 'idle' }
  | { status: 'initializing'; backend: Backend }
  | { status: 'self-check'; backend: Backend }
  | { status: 'ready'; backend: Backend }
  | { status: 'needs-user-choice'; reason: string }
  | { status: 'error'; reason: string };

export type InitEvent =
  | { t: 'start'; requested: 'auto' | 'webgpu' | 'wasm'; webgpuAvailable: boolean }
  | { t: 'init-ok' }
  | { t: 'init-fail'; reason: string }
  | { t: 'self-check-ok' }
  | { t: 'self-check-fail'; reason: string }
  | { t: 'choose-wasm' };

// 后端选择状态机。红线：WebGPU 失败绝不自动回退 WASM，只有用户显式选择才走 WASM。
export function reduce(state: InitState, ev: InitEvent): InitState {
  switch (ev.t) {
    case 'start':
      if (ev.requested === 'wasm') return { status: 'initializing', backend: 'wasm' };
      return ev.webgpuAvailable
        ? { status: 'initializing', backend: 'webgpu' }
        : { status: 'needs-user-choice', reason: 'WEBGPU_UNAVAILABLE' };
    case 'init-ok':
      return state.status === 'initializing' ? { status: 'self-check', backend: state.backend } : state;
    case 'init-fail':
      if (state.status !== 'initializing') return state;
      return state.backend === 'webgpu'
        ? { status: 'needs-user-choice', reason: ev.reason }
        : { status: 'error', reason: ev.reason };
    case 'self-check-ok':
      return state.status === 'self-check' ? { status: 'ready', backend: state.backend } : state;
    case 'self-check-fail':
      if (state.status !== 'self-check') return state;
      return state.backend === 'webgpu'
        ? { status: 'needs-user-choice', reason: ev.reason }
        : { status: 'error', reason: ev.reason };
    case 'choose-wasm':
      return { status: 'initializing', backend: 'wasm' };
  }
}

import { describe, it, expect } from 'vitest';
import { reduce, type InitState, type InitEvent } from './backend';

const idle: InitState = { status: 'idle' };
const run = (evs: InitEvent[], start: InitState = idle) => evs.reduce((s, e) => reduce(s, e), start);

describe('backend reduce', () => {
  it('WebGPU 全程成功 → ready webgpu', () => {
    expect(
      run([{ t: 'start', requested: 'auto', webgpuAvailable: true }, { t: 'init-ok' }, { t: 'self-check-ok' }]),
    ).toEqual({ status: 'ready', backend: 'webgpu' });
  });

  it('WebGPU 初始化失败 → needs-user-choice（绝不自动进 wasm）', () => {
    expect(
      run([{ t: 'start', requested: 'auto', webgpuAvailable: true }, { t: 'init-fail', reason: 'x' }]).status,
    ).toBe('needs-user-choice');
  });

  it('WebGPU 自检失败 → needs-user-choice', () => {
    expect(
      run([
        { t: 'start', requested: 'auto', webgpuAvailable: true },
        { t: 'init-ok' },
        { t: 'self-check-fail', reason: 'x' },
      ]).status,
    ).toBe('needs-user-choice');
  });

  it('auto 但无 WebGPU → needs-user-choice（不静默降级）', () => {
    expect(reduce(idle, { t: 'start', requested: 'auto', webgpuAvailable: false }).status).toBe(
      'needs-user-choice',
    );
  });

  it('用户显式选 wasm 后可进入 wasm 并 ready', () => {
    expect(
      run([
        { t: 'start', requested: 'auto', webgpuAvailable: false },
        { t: 'choose-wasm' },
        { t: 'init-ok' },
        { t: 'self-check-ok' },
      ]),
    ).toEqual({ status: 'ready', backend: 'wasm' });
  });

  it('wasm 初始化失败 → error（无更低退路）', () => {
    expect(
      run([{ t: 'start', requested: 'wasm', webgpuAvailable: false }, { t: 'init-fail', reason: 'x' }]).status,
    ).toBe('error');
  });
});

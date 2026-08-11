// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Worker 走 `?worker` 后缀导入，node 里解析不了；设置页只用到 getApi / recreate 两个口子。
vi.mock('../InferenceProvider', () => ({
  useInferenceContext: () => ({
    getApi: () => ({ cancel: async () => {} }),
    recreate: () => {},
  }),
}));

vi.mock('../../../core/storage/db', () => ({
  db: {
    sessions: {
      count: async () => 0,
      toCollection: () => ({ primaryKeys: async () => ['s1'] }),
    },
  },
}));

const purgeSessions = vi.fn(async () => {});
vi.mock('../../../core/storage/cleanup', () => ({ purgeSessions: (...args: unknown[]) => purgeSessions(...(args as [])) }));

import { MODEL_CACHE_MANIFEST_KEY } from '../../../core/inference/modelCache';
import { SELECTION_DISCOVERY_COMPLETED_KEY } from '../../../core/storage/uiHints';
import { usePanelStore } from '../store';
import { SettingsPanel } from './SettingsPanel';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let stored: Record<string, unknown> = {};
const removed: string[][] = [];
const cleared = vi.fn();

function pick(keys: string | string[] | null): Record<string, unknown> {
  const list = typeof keys === 'string' ? [keys] : keys ?? Object.keys(stored);
  const out: Record<string, unknown> = {};
  for (const key of list) if (key in stored) out[key] = stored[key];
  return out;
}

(globalThis as unknown as { chrome: unknown }).chrome = {
  storage: {
    local: {
      get: async (keys: string | string[]) => pick(keys),
      set: async (values: Record<string, unknown>) => { Object.assign(stored, values); },
      remove: async (keys: string | string[]) => {
        const list = typeof keys === 'string' ? [keys] : keys;
        removed.push(list);
        for (const key of list) delete stored[key];
      },
      clear: cleared,
    },
  },
  extension: { inIncognitoContext: false },
};

/** loadSettings / collectUsage 各自要走好几跳 microtask，冲一次不够。 */
async function flush() {
  await act(async () => {
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  });
}

const mounted: ReturnType<typeof createRoot>[] = [];

async function render(node: React.ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    const root = createRoot(container);
    mounted.push(root);
    root.render(node);
  });
  await flush();
  return container;
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);
  if (!found) throw new Error(`no button labelled ${text}; got ${[...container.querySelectorAll('button')].map((b) => b.textContent).join(' | ')}`);
  return found;
}

function buttonByLabel(container: HTMLElement, label: string): HTMLButtonElement {
  const found = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!found) throw new Error(`no button aria-labelled ${label}`);
  return found;
}

describe('SettingsPanel', () => {
  beforeEach(() => {
    stored = {};
    removed.length = 0;
    cleared.mockClear();
    purgeSessions.mockClear();
    usePanelStore.getState().reset();
  });

  // 不卸载的话，上一个用例遗留的 promise 会在下一个用例里落地，React 报 act 警告
  afterEach(async () => {
    await act(async () => { mounted.splice(0).forEach((root) => root.unmount()); });
  });

  it('第一次点击只进入确认态，不清除任何东西', async () => {
    const c = await render(<SettingsPanel onBack={() => {}} />);
    await act(async () => { buttonByLabel(c, '清除会话记录').click(); });
    expect(c.textContent).toContain('确认清除');
    expect(purgeSessions).not.toHaveBeenCalled();
  });

  it('「清除全部数据」按键名精确删除，不调用 storage.local.clear', async () => {
    stored = {
      backend: 'wasm',
      retentionDays: 0,
      modelId: 'onnx-community/Qwen3-0.6B-ONNX',
      [SELECTION_DISCOVERY_COMPLETED_KEY]: true,
    };
    const c = await render(<SettingsPanel onBack={() => {}} />);
    await act(async () => { buttonByLabel(c, '清除全部数据').click(); });
    await act(async () => { buttonByText(c, '确认清除').click(); });
    await flush();

    expect(cleared).not.toHaveBeenCalled();
    const keys = removed.flat();
    expect(keys).toContain('backend');
    expect(keys).toContain('retentionDays');
    expect(keys).toContain('modelId');
    expect(keys).toContain(MODEL_CACHE_MANIFEST_KEY);
    expect(keys).toContain(SELECTION_DISCOVERY_COMPLETED_KEY);
    expect(stored).toEqual({});
  });

  it('清除后复位状态机，不让 modelStatus 停在 ready', async () => {
    usePanelStore.setState({ modelStatus: 'ready', modelBackend: 'webgpu' });
    const c = await render(<SettingsPanel onBack={() => {}} />);
    await act(async () => { buttonByLabel(c, '清理模型缓存').click(); });
    await act(async () => { buttonByText(c, '确认清除').click(); });
    await flush();

    expect(usePanelStore.getState().modelStatus).toBe('uninitialized');
    expect(usePanelStore.getState().page).toBeNull();
  });

  it('只清会话时保留模型运行态', async () => {
    stored = { [SELECTION_DISCOVERY_COMPLETED_KEY]: true };
    usePanelStore.setState({ modelStatus: 'ready', modelBackend: 'wasm' });
    const c = await render(<SettingsPanel onBack={() => {}} />);
    await act(async () => { buttonByLabel(c, '清除会话记录').click(); });
    await act(async () => { buttonByText(c, '确认清除').click(); });
    await flush();

    expect(purgeSessions).toHaveBeenCalledOnce();
    expect(usePanelStore.getState().modelStatus).toBe('ready');
    expect(usePanelStore.getState().modelBackend).toBe('wasm');
    expect(stored[SELECTION_DISCOVERY_COMPLETED_KEY]).toBe(true);
  });

  it('首选后端与当前运行不一致时才给「重新加载模型」', async () => {
    stored = { backend: 'wasm' };
    usePanelStore.setState({ modelStatus: 'ready', modelBackend: 'webgpu' });
    const c = await render(<SettingsPanel onBack={() => {}} />);
    expect(c.textContent).toContain('重新加载模型');
  });

  it('首选为 auto 时不提示不一致', async () => {
    usePanelStore.setState({ modelStatus: 'ready', modelBackend: 'wasm' });
    const c = await render(<SettingsPanel onBack={() => {}} />);
    expect(c.textContent).not.toContain('重新加载模型');
  });

  it('兼容模式说明必须同时给出「不占显卡」与「需要另外下载」', async () => {
    const c = await render(<SettingsPanel onBack={() => {}} />);
    expect(c.textContent).toContain('不占用显卡');
    expect(c.textContent).toContain('需要另外下载');
  });

  it('隐私说明八条，且如实交代常驻主机权限', async () => {
    const c = await render(<SettingsPanel onBack={() => {}} />);
    const items = [...c.querySelectorAll('.wisp-privacy-list li')].map((li) => li.textContent ?? '');
    expect(items).toHaveLength(8);
    expect(items[5]).toContain('http(s) 全站访问权限');
    expect(items[5]).toContain('安装时一次性授予');
  });

  it('文案不得暗示 Wisp 在持续读取或监视页面', async () => {
    const c = await render(<SettingsPanel onBack={() => {}} />);
    const text = c.textContent ?? '';
    for (const banned of ['仍在', '持续读取', '实时', '监视']) {
      expect(text).not.toContain(banned);
    }
  });

  it('没有「输出长度」这一组', async () => {
    const c = await render(<SettingsPanel onBack={() => {}} />);
    expect(c.textContent).not.toContain('输出长度');
  });
});

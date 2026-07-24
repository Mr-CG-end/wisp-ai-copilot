import { useReducer, useState } from 'react';
import * as Comlink from 'comlink';
import { useInference } from './useInference';
import type { GenStats, LoadProgress, InitResult } from '../../core/inference/contract';
import { reduce } from '../../core/inference/backend';

const MODEL_ID = 'onnx-community/Qwen3-0.6B-ONNX';
const REVISION = 'da1453100cf3ff33ef56d17983fc7a8648706db6';
const WORKER_UNAVAILABLE = import.meta.env.COMMAND === 'serve';

export function App() {
  const { getApi, recreate } = useInference();
  const [initState, dispatch] = useReducer(reduce, { status: 'idle' });
  const [output, setOutput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [initResult, setInitResult] = useState<InitResult | null>(null);
  const [progressPct, setProgressPct] = useState<number>(0);
  const [stats, setStats] = useState<GenStats | null>(null);

  const runInit = async (backend: 'webgpu' | 'wasm') => {
    setProgressPct(0);
    setInitResult(null);

    try {
      const api = await getApi();
      const res = await api.init(
        {
          modelId: MODEL_ID,
          revision: REVISION,
          quant: { webgpu: 'q4f16', wasm: 'q8' },
          backend,
        },
        Comlink.proxy((p: LoadProgress) => {
          setProgressPct(p.pct);
        })
      );
      setInitResult(res);
      dispatch({ t: 'init-ok' });
      dispatch({ t: 'self-check-ok' });
    } catch (err) {
      console.error('Init failed:', err);
      dispatch({ t: 'init-fail', reason: String(err) });
    }
  };

  const handleAutoInit = () => {
    const webgpuAvailable = 'gpu' in navigator;
    dispatch({ t: 'start', requested: 'auto', webgpuAvailable });
    if (webgpuAvailable) void runInit('webgpu');
  };

  const handleChooseWasm = () => {
    dispatch({ t: 'choose-wasm' });
    void runInit('wasm');
  };

  const handleRecreate = () => {
    void recreate();
    dispatch({ t: 'reset' });
    setInitResult(null);
    setProgressPct(0);
    setOutput('');
    setStats(null);
  };

  const handleGenerate = async () => {
    setOutput('');
    setStats(null);
    setIsGenerating(true);

    try {
      const api = await getApi();
      const resStats = await api.generate(
        {
          taskType: 'qa',
          untrustedData: '测试数据',
          params: { maxNewTokens: 100, temperature: 0.7 },
        },
        crypto.randomUUID(),
        Comlink.proxy((delta: string) => {
          setOutput((prev) => prev + delta);
        })
      );
      setStats(resStats);
    } catch (err) {
      console.error('Generation failed:', err);
    } finally {
      setIsGenerating(false);
    }
  };

  const isInitializing = initState.status === 'initializing' || initState.status === 'self-check';
  const isReady = initState.status === 'ready';

  return (
    <main style={{ padding: 16, fontFamily: 'system-ui' }}>
      <h2>Wisp Spike (Task 6)</h2>
      {WORKER_UNAVAILABLE && (
        <div style={{ color: '#8a4b08', marginBottom: 12 }}>
          WXT 实时开发模式不支持扩展 Worker。请运行 npm run build:dev 后重新加载扩展。
        </div>
      )}
      <div style={{ marginBottom: 12 }}>
        <button onClick={handleAutoInit} disabled={WORKER_UNAVAILABLE || isInitializing || isGenerating}>
          {isInitializing ? `模型加载中 (${progressPct}%)...` : '加载 Qwen3-0.6B (WebGPU)'}
        </button>
        <button
          onClick={handleRecreate}
          style={{ marginLeft: 8 }}
          disabled={WORKER_UNAVAILABLE || isInitializing || isGenerating}
        >
          重启 Worker
        </button>
      </div>

      {initState.status === 'needs-user-choice' && (
        <div style={{ color: 'red', marginBottom: 12 }}>
          WebGPU 不可用或加载失败：{initState.reason}
          <div style={{ marginTop: 8 }}>
            <button onClick={handleChooseWasm}>用 WASM 兼容模式（将另行下载 q8）</button>
          </div>
        </div>
      )}

      {initState.status === 'error' && (
        <div style={{ color: 'red', marginBottom: 12 }}>加载失败：{initState.reason}</div>
      )}

      {isReady && initResult && (
        <div style={{ background: '#e6f7ff', padding: 8, borderRadius: 4, marginBottom: 12, fontSize: 13 }}>
          已就绪 | 后端: {initResult.backend} | 自检耗时: {Math.round(initResult.selfCheckMs)}ms
        </div>
      )}

      <div style={{ marginBottom: 12 }}>
        <button onClick={handleGenerate} disabled={!isReady || isGenerating || isInitializing}>
          {isGenerating ? '生成中...' : '桩生成回归（非真实模型输出）'}
        </button>
      </div>

      <div style={{ marginTop: 12 }}>
        <label style={{ fontWeight: 'bold' }}>输出内容：</label>
        <pre
          style={{
            background: '#f5f5f5',
            padding: 12,
            borderRadius: 4,
            minHeight: 60,
            whiteSpace: 'pre-wrap',
            marginTop: 8,
          }}
        >
          {output}
        </pre>
      </div>
      {stats && (
        <div style={{ marginTop: 12, fontSize: 12, color: '#666' }}>
          <p>
            TTFT: {stats.ttftMs}ms | 速度: {stats.tokensPerSec} tokens/s | 标记数: {stats.tokens}
          </p>
        </div>
      )}
    </main>
  );
}

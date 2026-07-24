import { useReducer, useRef, useState } from 'react';
import * as Comlink from 'comlink';
import { useInference } from './useInference';
import type { GenerateRequest, GenStats, Lang, LoadProgress, InitResult } from '../../core/inference/contract';
import { reduce } from '../../core/inference/backend';

const MODEL_ID = 'onnx-community/Qwen3-0.6B-ONNX';
const REVISION = 'da1453100cf3ff33ef56d17983fc7a8648706db6';
const WORKER_UNAVAILABLE = import.meta.env.COMMAND === 'serve';

const DEFAULT_TEXT =
  '人工智能正在改变我们生活与工作的方方面面。特别是在前端与边缘计算领域，WebGPU 和 WASM 技术使得在浏览器本地运行小参数语言模型成为可能。';

export function App() {
  const { getApi, recreate } = useInference();
  const [initState, dispatch] = useReducer(reduce, { status: 'idle' });
  const [inputText, setInputText] = useState(DEFAULT_TEXT);
  const [userInput, setUserInput] = useState('');
  const [taskType, setTaskType] = useState<GenerateRequest['taskType']>('summary');
  const [targetLang, setTargetLang] = useState<Exclude<Lang, 'other'>>('en');
  const [output, setOutput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [initResult, setInitResult] = useState<InitResult | null>(null);
  const [progressPct, setProgressPct] = useState<number>(0);
  const [stats, setStats] = useState<GenStats | null>(null);
  const [perceivedTtft, setPerceivedTtft] = useState<number | null>(null);
  const currentSignalIdRef = useRef<string | null>(null);

  // 🔬 调查结论：@huggingface/transformers 暂未暴露原生 AbortSignal 传递钩子。
  // 因此采用 Panel 侧终止并重建 Worker + 显式清理 Cache API 条目作为 100% 可靠的下载取消手段。
  const clearModelCache = async (modelId: string, _revision: string) => {
    try {
      if (typeof caches === 'undefined') return;
      const cacheNames = await caches.keys();
      for (const name of cacheNames) {
        if (name.includes('transformers') || name.includes('huggingface')) {
          const cache = await caches.open(name);
          const keys = await cache.keys();
          await Promise.all(
            keys.filter((r) => r.url.includes(modelId)).map((r) => cache.delete(r))
          );
        }
      }
    } catch (e) {
      console.warn('clearModelCache failed:', e);
    }
  };

  const handleCancelDownload = async () => {
    recreate();
    await clearModelCache(MODEL_ID, REVISION);
    dispatch({ t: 'init-fail', reason: 'DOWNLOAD_CANCELLED' });
    setProgressPct(0);
  };

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
    setPerceivedTtft(null);
  };

  const handleCancelGeneration = async () => {
    if (currentSignalIdRef.current) {
      try {
        const api = await getApi();
        await api.cancel(currentSignalIdRef.current);
      } catch (err) {
        console.error('Cancel generation failed:', err);
      }
    }
  };

  const handleGenerate = async () => {
    setOutput('');
    setStats(null);
    setPerceivedTtft(null);
    setIsGenerating(true);

    const signalId = crypto.randomUUID();
    currentSignalIdRef.current = signalId;

    const clickAt = performance.now();
    let firstTokenReceived = false;

    try {
      const api = await getApi();
      const resStats = await api.generate(
        {
          taskType,
          untrustedData: inputText,
          userInput: taskType === 'qa' ? userInput || undefined : undefined,
          targetLang: taskType === 'translate' ? targetLang : undefined,
          params: { maxNewTokens: 256, temperature: 0 },
        },
        signalId,
        Comlink.proxy((delta: string) => {
          setOutput((prev) => prev + delta);
          if (!firstTokenReceived) {
            firstTokenReceived = true;
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                setPerceivedTtft(Math.round(performance.now() - clickAt));
              });
            });
          }
        })
      );
      setStats(resStats);
    } catch (err) {
      console.error('Generation failed:', err);
    } finally {
      currentSignalIdRef.current = null;
      setIsGenerating(false);
    }
  };

  const isInitializing = initState.status === 'initializing' || initState.status === 'self-check';
  const isReady = initState.status === 'ready';

  return (
    <main style={{ padding: 16, fontFamily: 'system-ui' }}>
      <h2>Wisp Spike (Task 8)</h2>
      {WORKER_UNAVAILABLE && (
        <div style={{ color: '#8a4b08', marginBottom: 12 }}>
          WXT 实时开发模式不支持扩展 Worker。请运行 npm run build:dev 后重新加载扩展。
        </div>
      )}
      <div style={{ marginBottom: 12 }}>
        <button onClick={handleAutoInit} disabled={WORKER_UNAVAILABLE || isInitializing || isGenerating}>
          {isInitializing ? `模型加载中 (${progressPct}%)...` : '加载 Qwen3-0.6B (WebGPU)'}
        </button>
        {isInitializing && (
          <button onClick={handleCancelDownload} style={{ marginLeft: 8, color: '#d32f2f' }}>
            取消下载
          </button>
        )}
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
        <label style={{ display: 'block', fontWeight: 'bold', marginBottom: 4 }}>任务类型：</label>
        <select
          value={taskType}
          onChange={(e) => setTaskType(e.target.value as GenerateRequest['taskType'])}
          disabled={!isReady || isGenerating}
          style={{ marginBottom: 8, padding: '4px 8px' }}
        >
          <option value="summary">总结 (summary)</option>
          <option value="qa">问答 (qa)</option>
          <option value="explain">解释 (explain)</option>
          <option value="translate">翻译 (translate)</option>
        </select>

        <label style={{ display: 'block', fontWeight: 'bold', marginBottom: 4 }}>待处理文本 (material)：</label>
        <textarea
          rows={3}
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          disabled={!isReady || isGenerating}
          style={{ width: '100%', boxSizing: 'border-box', marginBottom: 8 }}
        />

        {taskType === 'qa' && (
          <>
            <label style={{ display: 'block', fontWeight: 'bold', marginBottom: 4 }}>用户提问：</label>
            <input
              type="text"
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              disabled={!isReady || isGenerating}
              style={{ width: '100%', boxSizing: 'border-box', marginBottom: 8 }}
              placeholder="请输入提问..."
            />
          </>
        )}

        {taskType === 'translate' && (
          <>
            <label style={{ display: 'block', fontWeight: 'bold', marginBottom: 4 }}>目标语言：</label>
            <select
              value={targetLang}
              onChange={(e) => setTargetLang(e.target.value as Exclude<Lang, 'other'>)}
              disabled={!isReady || isGenerating}
              style={{ marginBottom: 8, padding: '4px 8px' }}
            >
              <option value="zh">中文</option>
              <option value="en">英文</option>
            </select>
          </>
        )}

        <button onClick={handleGenerate} disabled={!isReady || isGenerating || isInitializing}>
          {isGenerating ? '流式生成中...' : '流式生成'}
        </button>
        {isGenerating && (
          <button onClick={handleCancelGeneration} style={{ marginLeft: 8, color: '#d32f2f' }}>
            停止生成
          </button>
        )}
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
        <div style={{ marginTop: 12, padding: 8, background: '#f0f0f0', borderRadius: 4, fontSize: 12, color: '#333' }}>
          <p style={{ margin: '2px 0' }}>
            <strong>用户感知 TTFT:</strong> {perceivedTtft ?? '-'}ms | <strong>Worker TTFT:</strong>{' '}
            {Math.round(stats.ttftMs)}ms
          </p>
          <p style={{ margin: '2px 0' }}>
            <strong>生成速度:</strong> {stats.tokensPerSec.toFixed(1)} tokens/s | <strong>Token 数量:</strong>{' '}
            {stats.tokens}
          </p>
          <p style={{ margin: '2px 0' }}>
            <strong>后端:</strong> {stats.backend} | <strong>截断:</strong> {stats.truncated ? '是' : '否'}
          </p>
        </div>
      )}
    </main>
  );
}

import { useReducer, useRef, useState } from 'react';
import * as Comlink from 'comlink';
import { useInference } from './useInference';
import { usePageChannel } from './usePageChannel';
import type { GenerateRequest, GenStats, Lang, LoadProgress, InitResult } from '../../core/inference/contract';
import { reduce } from '../../core/inference/backend';
import { selectNewModelCacheUrls } from '../../core/inference/cacheSelection';
import { BENCH_TEXT, BENCH_PARAMS } from '../../core/bench/fixture';

const MODEL_ID = 'onnx-community/Qwen3-0.6B-ONNX';
const REVISION = 'da1453100cf3ff33ef56d17983fc7a8648706db6';
const WORKER_UNAVAILABLE = import.meta.env.COMMAND === 'serve';
const TRANSFORMERS_CACHE = 'transformers-cache';

const DEFAULT_TEXT =
  '人工智能正在改变我们生活与工作的方方面面。特别是在前端与边缘计算领域，WebGPU 和 WASM 技术使得在浏览器本地运行小参数语言模型成为可能。';

type CancelMetrics = {
  stopTextMs: number;
  endMs: number;
};

async function snapshotModelCache(): Promise<Set<string> | null> {
  if (typeof caches === 'undefined') return null;
  const cacheNames = await caches.keys();
  if (!cacheNames.includes(TRANSFORMERS_CACHE)) return new Set();
  const cache = await caches.open(TRANSFORMERS_CACHE);
  return new Set((await cache.keys()).map((request) => request.url));
}

async function clearNewModelCacheEntries(existingUrls: ReadonlySet<string> | null): Promise<number> {
  if (typeof caches === 'undefined' || existingUrls === null) return 0;
  const cacheNames = await caches.keys();
  if (!cacheNames.includes(TRANSFORMERS_CACHE)) return 0;

  const cache = await caches.open(TRANSFORMERS_CACHE);
  const urls = (await cache.keys()).map((request) => request.url);
  const addedUrls = selectNewModelCacheUrls(urls, existingUrls, MODEL_ID, REVISION);
  await Promise.all(addedUrls.map((url) => cache.delete(url)));
  return addedUrls.length;
}

export function App() {
  const { getApi, recreate } = useInference();
  const page = usePageChannel();
  const [pageInfo, setPageInfo] = useState<string>('');

  const handleReadPage = async () => {
    setPageInfo('');
    const ctx = await page.bindActiveTab();
    if (!ctx) return;
    const extracted = await page.readPage('initial', ctx);
    setPageInfo(
      extracted
        ? `${extracted.title} | 原文 ${extracted.charCount} 字 | 送模型 ${extracted.text.length} 字 | 截断=${extracted.truncated} | ${extracted.method}`
        : '未提取到正文',
    );
  };

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
  const [initNotice, setInitNotice] = useState<string | null>(null);
  const [isCancellingInit, setIsCancellingInit] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [workerStatus, setWorkerStatus] = useState<{
    crossOriginIsolated: boolean;
    sharedArrayBufferAvailable: boolean;
    numThreads?: number;
  } | null>(null);
  const [generationNotice, setGenerationNotice] = useState<string | null>(null);
  const [cancelMetrics, setCancelMetrics] = useState<CancelMetrics | null>(null);
  const currentSignalIdRef = useRef<string | null>(null);
  const initAttemptRef = useRef(0);
  const initCacheBaselineRef = useRef<Set<string> | null>(null);
  const cancelRequestedAtRef = useRef<number | null>(null);
  const lastTokenAtRef = useRef<number | null>(null);

  // 🔬 调查结论：@huggingface/transformers 暂未暴露原生 AbortSignal 传递钩子。
  // 因此采用 Panel 侧终止并重建 Worker，并且只清理本次初始化新增的缓存条目。
  const handleCancelDownload = async () => {
    if (isCancellingInit) return;
    setIsCancellingInit(true);
    const baseline = initCacheBaselineRef.current;
    initAttemptRef.current += 1;
    recreate();
    dispatch({ t: 'reset' });
    setInitResult(null);
    setProgressPct(0);

    try {
      const removed = await clearNewModelCacheEntries(baseline);
      setInitNotice(removed > 0 ? `加载已取消，已清理本次新增的 ${removed} 个缓存条目` : '加载已取消，可重新加载');
    } catch (err) {
      console.warn('clearNewModelCacheEntries failed:', err);
      setInitNotice('加载已终止，但缓存清理失败；既有完整模型缓存未主动删除');
    } finally {
      initCacheBaselineRef.current = null;
      setIsCancellingInit(false);
    }
  };

  const runInit = async (backend: 'webgpu' | 'wasm') => {
    const attempt = initAttemptRef.current + 1;
    initAttemptRef.current = attempt;
    setProgressPct(0);
    setInitResult(null);
    setWorkerStatus(null);
    setInitNotice(null);

    let cacheBaseline: Set<string> | null = null;
    try {
      cacheBaseline = await snapshotModelCache();
    } catch (err) {
      console.warn('snapshotModelCache failed:', err);
    }
    if (attempt !== initAttemptRef.current) return;
    initCacheBaselineRef.current = cacheBaseline;

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
          if (attempt === initAttemptRef.current) setProgressPct(p.pct);
        })
      );
      if (attempt !== initAttemptRef.current) return;
      setInitResult(res);
      const status = await api.getStatus();
      if (attempt === initAttemptRef.current) {
        setWorkerStatus({
          crossOriginIsolated: status.crossOriginIsolated,
          sharedArrayBufferAvailable: status.sharedArrayBufferAvailable,
          numThreads: status.numThreads,
        });
      }
      dispatch({ t: 'init-ok' });
      dispatch({ t: 'self-check-ok' });
    } catch (err) {
      if (attempt !== initAttemptRef.current) return;
      console.error('Init failed:', err);
      dispatch({ t: 'init-fail', reason: String(err) });
    } finally {
      if (attempt === initAttemptRef.current) initCacheBaselineRef.current = null;
    }
  };

  const handleAutoInit = () => {
    setInitNotice(null);
    const webgpuAvailable = 'gpu' in navigator;
    dispatch({ t: 'start', requested: 'auto', webgpuAvailable });
    if (webgpuAvailable) void runInit('webgpu');
  };

  const handleChooseWasm = () => {
    setInitNotice(null);
    dispatch({ t: 'choose-wasm' });
    void runInit('wasm');
  };

  const handleRecreate = () => {
    initAttemptRef.current += 1;
    recreate();
    dispatch({ t: 'reset' });
    initCacheBaselineRef.current = null;
    setInitResult(null);
    setWorkerStatus(null);
    setInitNotice(null);
    setProgressPct(0);
    setOutput('');
    setStats(null);
    setPerceivedTtft(null);
  };

  const handleCancelGeneration = async () => {
    if (currentSignalIdRef.current && !isStopping) {
      cancelRequestedAtRef.current = performance.now();
      setIsStopping(true);
      setGenerationNotice('正在停止生成...');
      try {
        const api = await getApi();
        await api.cancel(currentSignalIdRef.current);
      } catch (err) {
        console.error('Cancel generation failed:', err);
        cancelRequestedAtRef.current = null;
        setIsStopping(false);
        setGenerationNotice('停止请求失败，生成仍可能继续');
      }
    }
  };

  const handleGenerate = async () => {
    setOutput('');
    setStats(null);
    setPerceivedTtft(null);
    setGenerationNotice(null);
    setCancelMetrics(null);
    setIsGenerating(true);
    setIsStopping(false);
    cancelRequestedAtRef.current = null;
    lastTokenAtRef.current = null;

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
          params: BENCH_PARAMS,
        },
        signalId,
        Comlink.proxy((delta: string) => {
          lastTokenAtRef.current = performance.now();
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
      const cancelRequestedAt = cancelRequestedAtRef.current;
      if (cancelRequestedAt !== null) {
        const endedAt = performance.now();
        const lastTokenAt = lastTokenAtRef.current;
        setCancelMetrics({
          stopTextMs: lastTokenAt === null ? 0 : Math.max(0, lastTokenAt - cancelRequestedAt),
          endMs: Math.max(0, endedAt - cancelRequestedAt),
        });
        setGenerationNotice('生成已取消');
      }
      currentSignalIdRef.current = null;
      cancelRequestedAtRef.current = null;
      setIsGenerating(false);
      setIsStopping(false);
    }
  };

  const handleLoadBenchFixture = () => {
    setInputText(BENCH_TEXT);
    setTaskType('summary');
    setGenerationNotice('已载入 1000字 基准 Fixture 输入与参数 (maxNewTokens: 256, temp: 0)');
  };

  const isInitializing = initState.status === 'initializing' || initState.status === 'self-check';
  const isReady = initState.status === 'ready';

  return (
    <main style={{ padding: 16, fontFamily: 'system-ui' }}>
      <h2>Wisp Spike (Task 10)</h2>
      <div style={{ marginBottom: 12, padding: 8, background: '#f0f4f8', borderRadius: 4 }}>
        <button onClick={handleReadPage}>读取本页（Task 4 链路验证）</button>
        {pageInfo && <div style={{ marginTop: 4, fontSize: 12 }}>{pageInfo}</div>}
        {page.lastError && <div style={{ marginTop: 4, color: '#d32f2f', fontSize: 12 }}>{page.lastError.message}</div>}
      </div>
      {WORKER_UNAVAILABLE && (
        <div style={{ color: '#8a4b08', marginBottom: 12 }}>
          WXT 实时开发模式不支持扩展 Worker。请运行 npm run build:dev 后重新加载扩展。
        </div>
      )}
      <div style={{ marginBottom: 12 }}>
        <button
          onClick={handleAutoInit}
          disabled={WORKER_UNAVAILABLE || isInitializing || isCancellingInit || isGenerating}
        >
          {isInitializing && initState.backend === 'webgpu'
            ? `WebGPU 模型加载中 (${progressPct}%)...`
            : '加载 Qwen3-0.6B (WebGPU)'}
        </button>
        <button
          onClick={handleChooseWasm}
          disabled={WORKER_UNAVAILABLE || isInitializing || isCancellingInit || isGenerating}
          style={{ marginLeft: 8 }}
        >
          {isInitializing && initState.backend === 'wasm'
            ? `WASM q8 模型加载中 (${progressPct}%)...`
            : '加载 Qwen3-0.6B (WASM q8)'}
        </button>
        {isInitializing && (
          <button
            onClick={handleCancelDownload}
            disabled={isCancellingInit}
            style={{ marginLeft: 8, color: '#d32f2f' }}
          >
            {isCancellingInit ? '正在取消...' : '取消加载/下载'}
          </button>
        )}
        <button
          onClick={handleRecreate}
          style={{ marginLeft: 8 }}
          disabled={WORKER_UNAVAILABLE || isInitializing || isCancellingInit || isGenerating}
        >
          重启 Worker
        </button>
      </div>

      {initNotice && <div style={{ color: '#8a4b08', marginBottom: 12 }}>{initNotice}</div>}

      {initState.status === 'needs-user-choice' && (
        <div style={{ color: 'red', marginBottom: 12 }}>
          WebGPU 不可用或加载失败：{initState.reason}。可使用上方 WASM q8 兼容模式。
        </div>
      )}

      {initState.status === 'error' && (
        <div style={{ color: 'red', marginBottom: 12 }}>加载失败：{initState.reason}</div>
      )}

      {isReady && initResult && (
        <div style={{ background: '#e6f7ff', padding: 8, borderRadius: 4, marginBottom: 12, fontSize: 13 }}>
          已就绪 | 后端: {initResult.backend} | 自检耗时: {Math.round(initResult.selfCheckMs)}ms
          {workerStatus && (
            <span>
              {' '}
              | 跨源隔离: {workerStatus.crossOriginIsolated ? '已开启' : '未开启'}
              {' '}| SharedArrayBuffer: {workerStatus.sharedArrayBufferAvailable ? '可用' : '不可用'}
              {initResult.backend === 'wasm' && (
                <>
                  {' '}| WASM 线程配置:{' '}
                  {workerStatus.numThreads === undefined
                    ? '自动（实际线程数由 ORT 决定）'
                    : workerStatus.numThreads}
                </>
              )}
            </span>
          )}
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

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <label style={{ fontWeight: 'bold' }}>待处理文本 (material)：</label>
          <button
            onClick={handleLoadBenchFixture}
            disabled={!isReady || isGenerating}
            style={{ fontSize: 12, padding: '2px 6px' }}
          >
            载入 1000字 基准 Fixture
          </button>
        </div>
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
          <button
            onClick={handleCancelGeneration}
            disabled={isStopping}
            style={{ marginLeft: 8, color: '#d32f2f' }}
          >
            {isStopping ? '停止中...' : '停止生成'}
          </button>
        )}
      </div>

      {generationNotice && (
        <div style={{ color: generationNotice === '生成已取消' ? '#8a4b08' : '#d32f2f', marginBottom: 12 }}>
          {generationNotice}
          {cancelMetrics && (
            <>
              {' '}
              | 停止新增文字: {Math.round(cancelMetrics.stopTextMs)}ms | 任务结束: {Math.round(cancelMetrics.endMs)}ms
            </>
          )}
        </div>
      )}

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

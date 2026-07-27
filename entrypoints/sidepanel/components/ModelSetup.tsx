import React, { useEffect, useRef, useState } from 'react';
import * as Comlink from 'comlink';
import { useInferenceContext } from '../InferenceProvider';
import { usePanelStore } from '../store';
import {
  checkCacheMatch,
  clearCacheManifest,
  hasModelCacheEntries,
  purgeNewModelCacheEntries,
  purgeModelCacheEntries,
  readCacheManifest,
  snapshotModelCacheUrls,
  writeCacheManifest,
} from '../../../core/inference/modelCache';
import { isCacheRestoreFailure } from '../../../core/inference/restoreFailure';
import { selectSetupSteps } from '../../../core/panel/setupSteps';
import type { LoadProgress } from '../../../core/inference/contract';

export const MODEL_ID = 'onnx-community/Qwen3-0.6B-ONNX';
export const REVISION = 'da1453100cf3ff33ef56d17983fc7a8648706db6';
export const QUANT = { webgpu: 'q4f16' as const, wasm: 'q8' as const };
const MODEL_SIZE_MB = 390;

function formatAvailableBytes(bytes: number | null): string {
  if (bytes === null) return '浏览器未提供';
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.max(0, Math.round(bytes / 1024 ** 2))} MB`;
}

/**
 * 初始化四步。与任务面板的轨迹共用同一套节点语汇 ——
 * 首次约 47 秒的等待因此变成「看得见自己在第几步」。
 */
const SetupThread: React.FC<{
  status: Parameters<typeof selectSetupSteps>[0];
  hasCache: boolean;
}> = ({ status, hasCache }) => (
  <ol className="wisp-setup-steps">
    {selectSetupSteps(status, hasCache).map((step, i) => (
      <li key={step.key} className={`wisp-setup-step is-${step.state}`}>
        <span className="wisp-setup-step-node" aria-hidden="true" />
        <span className="wisp-setup-step-index" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
        <span className="wisp-setup-step-label">{step.label}</span>
      </li>
    ))}
  </ol>
);

export const ModelSetup: React.FC = () => {
  const { getApi, recreate } = useInferenceContext();
  const modelStatus = usePanelStore((s) => s.modelStatus);
  const downloadPct = usePanelStore((s) => s.downloadPct);
  const error = usePanelStore((s) => s.error);
  const setModelStatus = usePanelStore((s) => s.setModelStatus);
  const setModelBackend = usePanelStore((s) => s.setModelBackend);
  const setDownloadPct = usePanelStore((s) => s.setDownloadPct);
  const setError = usePanelStore((s) => s.setError);

  const [hasLegacyCache, setHasLegacyCache] = useState(false);
  const [currentFile, setCurrentFile] = useState<string>('');
  const [isCancelling, setIsCancelling] = useState(false);
  const [isClearingCache, setIsClearingCache] = useState(false);
  const [availableBytes, setAvailableBytes] = useState<number | null>(null);
  const [cacheNotice, setCacheNotice] = useState<string | null>(null);
  const initAttemptLock = useRef(false);
  const initAttemptRef = useRef(0);
  const initCacheBaselineRef = useRef<ReadonlySet<string> | null>(null);

  const createProgressHandler = (attempt: number) => Comlink.proxy((p: LoadProgress) => {
    if (attempt !== initAttemptRef.current) return;
    setDownloadPct(Math.round(p.pct * 100) / 100);
    setCurrentFile(p.file);
  });

  // 挂载时校验本地缓存
  useEffect(() => {
    if (initAttemptLock.current) return;
    initAttemptLock.current = true;

    async function checkLocalCache() {
      const attempt = initAttemptRef.current + 1;
      initAttemptRef.current = attempt;
      setModelStatus('checking-cache');
      const storageEstimate = navigator.storage?.estimate
        ? navigator.storage.estimate().catch(() => null)
        : Promise.resolve(null);
      const [manifest, estimate] = await Promise.all([
        readCacheManifest(),
        storageEstimate,
      ]);
      if (attempt !== initAttemptRef.current) return;
      if (estimate?.quota !== undefined) {
        setAvailableBytes(Math.max(0, estimate.quota - (estimate.usage ?? 0)));
      }

      const expectedDtype = manifest?.backend === 'wasm' ? QUANT.wasm : QUANT.webgpu;
      if (checkCacheMatch(manifest, {
        modelId: MODEL_ID,
        revision: REVISION,
        backend: manifest?.backend,
        dtype: expectedDtype,
      })) {
        // 有匹配的完整清单，尝试 cacheOnly 自动恢复
        try {
          const api = getApi();
          const res = await api.init(
            { modelId: MODEL_ID, revision: REVISION, quant: QUANT, backend: manifest!.backend, cacheOnly: true },
            createProgressHandler(attempt),
          );
          if (attempt !== initAttemptRef.current) return;
          if (res.ready) {
            setModelBackend(res.backend);
            setModelStatus('ready');
            return;
          }
        } catch (e: unknown) {
          if (attempt !== initAttemptRef.current) return;
          console.warn('[wisp] cache-only restore failed:', e);
          if (!isCacheRestoreFailure(e) && manifest!.backend === 'webgpu') {
            // WebGPU 初始化失败，进入需要用户选择状态，不破坏已存在的模型缓存
            setModelStatus('needs-user-choice', {
              code: 'WEBGPU_UNAVAILABLE',
              message: 'WebGPU 加载失败，您可以尝试切换 WASM 模式恢复。',
              retryable: true,
            });
            return;
          }
          // 缓存残缺或损坏
          await clearCacheManifest();
          await purgeModelCacheEntries(MODEL_ID, REVISION);
          if (attempt !== initAttemptRef.current) return;
          setModelStatus('error', {
            code: 'CACHE_CORRUPT',
            message: '本地模型缓存损坏，请重新下载。',
            retryable: true,
          });
          return;
        }
      }

      if (manifest) {
        await clearCacheManifest();
        if (attempt !== initAttemptRef.current) return;
      }

      // 没有有效清单，检查 Cache API 中是否有旧文件
      const legacyExist = await hasModelCacheEntries(MODEL_ID, REVISION);
      if (attempt !== initAttemptRef.current) return;
      if (legacyExist) {
        setHasLegacyCache(true);
        setModelStatus('uninitialized');
      } else {
        setModelStatus('uninitialized');
      }
    }

    void checkLocalCache();
    return () => {
      initAttemptRef.current += 1;
    };
  }, []);

  const handleStartDownload = async (backend: 'webgpu' | 'wasm' = 'webgpu') => {
    const attempt = initAttemptRef.current + 1;
    initAttemptRef.current = attempt;
    setModelStatus('downloading');
    setModelBackend(null);
    setError(null);
    setDownloadPct(0);
    setCurrentFile('');

    try {
      initCacheBaselineRef.current = await snapshotModelCacheUrls();
    } catch (e) {
      console.warn('[wisp] cache snapshot failed:', e);
      initCacheBaselineRef.current = null;
    }
    if (attempt !== initAttemptRef.current) return;

    try {
      const api = getApi();
      const res = await api.init(
        { modelId: MODEL_ID, revision: REVISION, quant: QUANT, backend },
        createProgressHandler(attempt),
      );
      if (attempt !== initAttemptRef.current) return;

      if (res.ready) {
        await writeCacheManifest({
          schema: 1,
          modelId: MODEL_ID,
          revision: REVISION,
          backend,
          dtype: backend === 'webgpu' ? QUANT.webgpu : QUANT.wasm,
          verifiedAt: Date.now(),
        });
        if (attempt !== initAttemptRef.current) return;
        setModelBackend(res.backend);
        setModelStatus('ready');
      }
    } catch (e: unknown) {
      if (attempt !== initAttemptRef.current) return;
      console.error('[wisp] download/init error:', e);
      const errMsg = e instanceof Error ? e.message : String(e);
      if (backend === 'webgpu' && (errMsg.includes('WebGPU') || errMsg.includes('adapter'))) {
        setModelStatus('needs-user-choice', {
          code: 'WEBGPU_UNAVAILABLE',
          message: '当前显卡或浏览器不支持 WebGPU 推理，请尝试使用 CPU (WASM) 模式。',
          retryable: true,
        });
      } else {
        setModelStatus('error', {
          code: 'DOWNLOAD_FAILED',
          message: errMsg || '下载模型失败，请检查网络后重试。',
          retryable: true,
        });
      }
    } finally {
      if (attempt === initAttemptRef.current) {
        initCacheBaselineRef.current = null;
      }
    }
  };

  const handleVerifyLegacyCache = async () => {
    const attempt = initAttemptRef.current + 1;
    initAttemptRef.current = attempt;
    setModelStatus('loading');
    setError(null);
    try {
      const api = getApi();
      const res = await api.init(
        { modelId: MODEL_ID, revision: REVISION, quant: QUANT, backend: 'webgpu', cacheOnly: true },
        createProgressHandler(attempt),
      );
      if (attempt !== initAttemptRef.current) return;
      if (res.ready) {
        await writeCacheManifest({
          schema: 1,
          modelId: MODEL_ID,
          revision: REVISION,
          backend: 'webgpu',
          dtype: QUANT.webgpu,
          verifiedAt: Date.now(),
        });
        if (attempt !== initAttemptRef.current) return;
        setModelBackend(res.backend);
        setModelStatus('ready');
      }
    } catch {
      if (attempt !== initAttemptRef.current) return;
      await clearCacheManifest();
      await purgeModelCacheEntries(MODEL_ID, REVISION);
      setHasLegacyCache(false);
      setModelStatus('uninitialized', {
        code: 'CACHE_CORRUPT',
        message: '旧版缓存验证失败，请重新下载模型。',
        retryable: true,
      });
    }
  };

  const handleCancelDownload = async () => {
    if (isCancelling) return;
    setIsCancelling(true);
    initAttemptRef.current += 1;
    const baseline = initCacheBaselineRef.current;
    initCacheBaselineRef.current = null;
    recreate();
    setModelBackend(null);
    setModelStatus('uninitialized');
    setDownloadPct(0);
    setCurrentFile('');
    try {
      await purgeNewModelCacheEntries(baseline, MODEL_ID, REVISION);
    } catch (e) {
      console.warn('[wisp] partial cache cleanup failed:', e);
      setError({
        code: 'DOWNLOAD_CANCELLED',
        message: '下载已取消，但部分临时缓存清理失败。',
        retryable: true,
      });
    } finally {
      setIsCancelling(false);
    }
  };

  const handleClearModelCache = async () => {
    if (isClearingCache) return;
    setIsClearingCache(true);
    setCacheNotice(null);
    setError(null);
    initAttemptRef.current += 1;
    try {
      recreate();
      await Promise.all([
        clearCacheManifest(),
        purgeModelCacheEntries(MODEL_ID, REVISION),
      ]);
      setHasLegacyCache(false);
      setModelBackend(null);
      setModelStatus('uninitialized');
      setCacheNotice('模型缓存已清理');
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError({
        code: 'CACHE_CORRUPT',
        message: message || '模型缓存清理失败，请重试。',
        retryable: true,
      });
    } finally {
      setIsClearingCache(false);
    }
  };

  if (modelStatus === 'checking-cache' || modelStatus === 'loading') {
    return (
      <section className="wisp-setup-container" aria-live="polite" aria-busy="true">
        <SetupThread status={modelStatus} hasCache={hasLegacyCache} />
        <div className="wisp-setup-panel">
          <div className="wisp-skeleton" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <p className="wisp-setup-kicker">本地模型</p>
          <h2 className="wisp-setup-heading">正在恢复模型</h2>
          <p className="wisp-setup-intro">从浏览器缓存加载并执行一步自检，全程无需联网。</p>
        </div>
      </section>
    );
  }

  if (modelStatus === 'downloading') {
    const downloadedMb = Math.round(MODEL_SIZE_MB * downloadPct / 100);
    return (
      <section className="wisp-setup-container" aria-live="polite" aria-busy="true">
        <SetupThread status={modelStatus} hasCache={hasLegacyCache} />
        <div className="wisp-setup-panel">
          <p className="wisp-setup-kicker">Qwen3-0.6B</p>
          <h2 className="wisp-setup-heading">正在准备本地模型</h2>
          <p className="wisp-setup-intro">模型下载完成并通过自检后，即可离线摘要和问答。</p>

          <div
            className="wisp-progress-box"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(downloadPct)}
            aria-label="模型下载进度"
          >
            <div className="wisp-progress-bar" style={{ transform: `scaleX(${downloadPct / 100})` }} />
          </div>

          <div className="wisp-progress-info">
            <strong>{downloadPct.toFixed(1)}%</strong>
            <span>约 {downloadedMb} MB / {MODEL_SIZE_MB} MB</span>
          </div>
          {currentFile ? <div className="wisp-file-tag" title={currentFile}>{currentFile}</div> : null}

          <button
            className="wisp-btn wisp-btn-secondary"
            disabled={isCancelling}
            onClick={() => void handleCancelDownload()}
          >
            {isCancelling ? '正在取消…' : '取消下载'}
          </button>
        </div>
      </section>
    );
  }

  if (modelStatus === 'needs-user-choice') {
    return (
      <section className="wisp-setup-container" aria-live="polite">
        <SetupThread status={modelStatus} hasCache={hasLegacyCache} />
        <div className="wisp-setup-panel">
          <p className="wisp-setup-kicker">兼容模式</p>
          <h2 className="wisp-setup-heading">当前设备无法使用 WebGPU</h2>
          <div className="wisp-status-banner is-warning" role="status">
            <strong>可以改用 WASM 兼容模式</strong>
            <span>{error?.message || 'WebGPU 初始化失败，模型缓存仍保留在本机。'}</span>
          </div>
          <div className="wisp-btn-group">
            <button className="wisp-btn wisp-btn-primary" onClick={() => void handleStartDownload('wasm')}>
              使用 WASM 兼容模式
            </button>
            <button className="wisp-btn wisp-btn-secondary" onClick={() => void handleStartDownload('webgpu')}>
              重试 WebGPU
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="wisp-setup-container">
      <SetupThread status={modelStatus} hasCache={hasLegacyCache} />
      <div className="wisp-setup-panel">
        <p className="wisp-setup-kicker">浏览器端 AI</p>
        <h1 className="wisp-setup-heading">在浏览器中运行 AI</h1>
        <p className="wisp-setup-intro">
          模型只需下载一次。之后摘要和问答都在本地完成。
        </p>

        <div className="wisp-model-heading">
          <span className="wisp-model-mark" aria-hidden="true">Q</span>
          <div>
            <strong>Qwen3-0.6B</strong>
            <span>本地推理模型</span>
          </div>
        </div>

        <div className="wisp-meta-list">
          <div className="wisp-meta-item">
            <span className="wisp-meta-label">来源</span>
            <span className="wisp-meta-value">huggingface.co</span>
          </div>
          <div className="wisp-meta-item">
            <span className="wisp-meta-label">预计下载</span>
            <span className="wisp-meta-value">{MODEL_SIZE_MB} MB</span>
          </div>
          <div className="wisp-meta-item">
            <span className="wisp-meta-label">当前可用空间</span>
            <span className="wisp-meta-value">{formatAvailableBytes(availableBytes)}</span>
          </div>
        </div>

        {error && (
          <div className="wisp-status-banner is-error" role="alert">
            <strong>暂时无法完成操作</strong>
            <span>{error.message}</span>
          </div>
        )}
        {cacheNotice ? <div className="wisp-inline-notice" role="status">{cacheNotice}</div> : null}

        <div className="wisp-action-area">
          <button className="wisp-btn wisp-btn-primary wisp-btn-confirm" onClick={() => void handleStartDownload('webgpu')}>
            开始下载
          </button>
          {hasLegacyCache && (
            <button className="wisp-btn wisp-btn-secondary" onClick={() => void handleVerifyLegacyCache()}>
              验证旧版本地缓存
            </button>
          )}
          <button
            className="wisp-btn-link"
            disabled={isClearingCache}
            onClick={() => void handleClearModelCache()}
          >
            {isClearingCache ? '正在清理…' : '清理模型缓存'}
          </button>
        </div>

        <p className="wisp-privacy-note">
          <span className="wisp-privacy-shield" aria-hidden="true" />
          除模型下载外，网页内容、问题和回答不会上传。
        </p>
      </div>
    </section>
  );
};

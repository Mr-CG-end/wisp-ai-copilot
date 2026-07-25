import React, { useEffect, useRef, useState } from 'react';
import { useInferenceContext } from '../InferenceProvider';
import { usePanelStore } from '../store';
import {
  clearCacheManifest,
  hasModelCacheEntries,
  purgeModelCacheEntries,
  readCacheManifest,
  writeCacheManifest,
} from '../../../core/inference/modelCache';
import type { LoadProgress } from '../../../core/inference/contract';

export const MODEL_ID = 'onnx-community/Qwen3-0.6B-ONNX';
export const REVISION = 'da1453100cf3ff33ef56d17983fc7a8648706db6';
export const QUANT = { webgpu: 'q4f16' as const, wasm: 'q8' as const };

export const ModelSetup: React.FC = () => {
  const { getApi, recreate } = useInferenceContext();
  const modelStatus = usePanelStore((s) => s.modelStatus);
  const downloadPct = usePanelStore((s) => s.downloadPct);
  const error = usePanelStore((s) => s.error);
  const setModelStatus = usePanelStore((s) => s.setModelStatus);
  const setDownloadPct = usePanelStore((s) => s.setDownloadPct);
  const setError = usePanelStore((s) => s.setError);

  const [hasLegacyCache, setHasLegacyCache] = useState(false);
  const [currentFile, setCurrentFile] = useState<string>('');
  const initAttemptLock = useRef(false);

  // 挂载时校验本地缓存
  useEffect(() => {
    if (initAttemptLock.current) return;
    initAttemptLock.current = true;

    async function checkLocalCache() {
      setModelStatus('checking-cache');
      const manifest = await readCacheManifest();

      if (manifest && manifest.modelId === MODEL_ID && manifest.revision === REVISION) {
        // 有匹配的完整清单，尝试 cacheOnly 自动恢复
        try {
          const api = getApi();
          const res = await api.init(
            { modelId: MODEL_ID, revision: REVISION, quant: QUANT, backend: manifest.backend, cacheOnly: true },
            ComlinkProgressHandler,
          );
          if (res.ready) {
            setModelStatus('ready');
            return;
          }
        } catch (e: any) {
          console.warn('[wisp] cache-only restore failed:', e);
          if (manifest.backend === 'webgpu') {
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
          setModelStatus('error', {
            code: 'CACHE_CORRUPT',
            message: '本地模型缓存损害，请重新下载。',
            retryable: true,
          });
          return;
        }
      }

      // 没有有效清单，检查 Cache API 中是否有旧文件
      const legacyExist = await hasModelCacheEntries(MODEL_ID, REVISION);
      if (legacyExist) {
        setHasLegacyCache(true);
        setModelStatus('uninitialized');
      } else {
        setModelStatus('uninitialized');
      }
    }

    void checkLocalCache();
  }, []);

  const ComlinkProgressHandler = (p: LoadProgress) => {
    setDownloadPct(Math.round(p.pct * 100) / 100);
    setCurrentFile(p.file);
  };

  const handleStartDownload = async (backend: 'webgpu' | 'wasm' = 'webgpu') => {
    setModelStatus('downloading');
    setError(null);
    setDownloadPct(0);

    try {
      const api = getApi();
      const res = await api.init(
        { modelId: MODEL_ID, revision: REVISION, quant: QUANT, backend },
        ComlinkProgressHandler,
      );

      if (res.ready) {
        await writeCacheManifest({
          schema: 1,
          modelId: MODEL_ID,
          revision: REVISION,
          backend,
          dtype: backend === 'webgpu' ? QUANT.webgpu : QUANT.wasm,
          verifiedAt: Date.now(),
        });
        setModelStatus('ready');
      }
    } catch (e: any) {
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
    }
  };

  const handleVerifyLegacyCache = async () => {
    setModelStatus('loading');
    setError(null);
    try {
      const api = getApi();
      const res = await api.init(
        { modelId: MODEL_ID, revision: REVISION, quant: QUANT, backend: 'webgpu', cacheOnly: true },
        ComlinkProgressHandler,
      );
      if (res.ready) {
        await writeCacheManifest({
          schema: 1,
          modelId: MODEL_ID,
          revision: REVISION,
          backend: 'webgpu',
          dtype: QUANT.webgpu,
          verifiedAt: Date.now(),
        });
        setModelStatus('ready');
      }
    } catch {
      setHasLegacyCache(false);
      setModelStatus('uninitialized', {
        code: 'CACHE_CORRUPT',
        message: '旧版缓存验证失败，请重新下载模型。',
        retryable: true,
      });
    }
  };

  const handleCancelDownload = () => {
    recreate();
    setModelStatus('uninitialized');
    setDownloadPct(0);
    setCurrentFile('');
  };

  if (modelStatus === 'checking-cache' || modelStatus === 'loading') {
    return (
      <div className="wisp-setup-container">
        <div className="wisp-setup-card">
          <div className="wisp-spinner" />
          <h3 className="wisp-setup-title">正在从本地缓存恢复模型…</h3>
          <p className="wisp-setup-desc">正在进行本地校验与轻量自检，无需联网。</p>
        </div>
      </div>
    );
  }

  if (modelStatus === 'downloading') {
    return (
      <div className="wisp-setup-container">
        <div className="wisp-setup-card">
          <h3 className="wisp-setup-title">正在准备 AI 推理引擎</h3>
          <p className="wisp-setup-desc">首次加载需要下载模型权重，后续打开自动本地加载。</p>

          <div className="wisp-progress-box">
            <div className="wisp-progress-bar" style={{ width: `${downloadPct}%` }} />
          </div>

          <div className="wisp-progress-info">
            <span>{downloadPct.toFixed(1)}%</span>
            {currentFile && <span className="wisp-file-tag">{currentFile}</span>}
          </div>

          <button className="wisp-btn wisp-btn-secondary" onClick={handleCancelDownload}>
            取消下载
          </button>
        </div>
      </div>
    );
  }

  if (modelStatus === 'needs-user-choice') {
    return (
      <div className="wisp-setup-container">
        <div className="wisp-setup-card wisp-border-warning">
          <h3 className="wisp-setup-title">WebGPU 初始化受阻</h3>
          <p className="wisp-setup-desc">{error?.message || '您的浏览器或显卡环境未能成功启动 WebGPU。'}</p>
          <div className="wisp-btn-group">
            <button className="wisp-btn wisp-btn-primary" onClick={() => handleStartDownload('wasm')}>
              使用 WASM (CPU) 模式重试
            </button>
            <button className="wisp-btn wisp-btn-secondary" onClick={() => handleStartDownload('webgpu')}>
              重试 WebGPU
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="wisp-setup-container">
      <div className="wisp-setup-card">
        <div className="wisp-header-badge">Wisp v0.1 MVP</div>
        <h2 className="wisp-setup-heading">首次初始化模型</h2>
        <p className="wisp-setup-intro">
          Wisp 完全基于浏览器端侧 AI 架构运行，您的网页数据不会离开本机。
        </p>

        <div className="wisp-meta-list">
          <div className="wisp-meta-item">
            <span className="wisp-meta-label">模型架构</span>
            <span className="wisp-meta-value">Qwen3-0.6B-ONNX</span>
          </div>
          <div className="wisp-meta-item">
            <span className="wisp-meta-label">预计下载</span>
            <span className="wisp-meta-value">~390 MB (下载后持久化缓存)</span>
          </div>
          <div className="wisp-meta-item">
            <span className="wisp-meta-label">默认后端</span>
            <span className="wisp-meta-value">WebGPU (自动硬件加速)</span>
          </div>
          <div className="wisp-meta-item">
            <span className="wisp-meta-label">隐私保证</span>
            <span className="wisp-meta-value">100% 纯本地推理，零数据上传</span>
          </div>
        </div>

        {error && (
          <div className="wisp-error-banner">
            <span>{error.message}</span>
          </div>
        )}

        <div className="wisp-action-area">
          {hasLegacyCache && (
            <button className="wisp-btn wisp-btn-secondary" onClick={handleVerifyLegacyCache}>
              验证旧版本地缓存
            </button>
          )}
          <button className="wisp-btn wisp-btn-primary" onClick={() => handleStartDownload('webgpu')}>
            开始下载并初始化
          </button>
        </div>
      </div>
    </div>
  );
};

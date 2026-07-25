import React from 'react';
import { usePageChannel } from './usePageChannel';
import { usePanelStore } from './store';
import { ModelSetup } from './components/ModelSetup';
import { TaskPanel } from './components/TaskPanel';

export function App() {
  const modelStatus = usePanelStore((s) => s.modelStatus);
  const modelBackend = usePanelStore((s) => s.modelBackend);
  const pageChannel = usePageChannel();
  const isReady = modelStatus === 'ready';
  const statusLabel = isReady
    ? `本地 · ${modelBackend === 'wasm' ? 'WASM' : 'WebGPU'}`
    : modelStatus === 'checking-cache' || modelStatus === 'loading'
      ? '正在恢复'
      : modelStatus === 'downloading'
        ? '正在下载'
        : '尚未初始化';

  return (
    <div className="wisp-app-root">
      <header className="wisp-app-header">
        <div className="wisp-brand">Wisp</div>
        <div className={`wisp-runtime-status ${isReady ? 'is-ready' : ''}`}>
          <span className="wisp-status-dot" aria-hidden="true" />
          <span>{statusLabel}</span>
        </div>
      </header>

      <main className="wisp-app-main">
        {isReady ? (
          <TaskPanel pageChannel={pageChannel} />
        ) : (
          <ModelSetup />
        )}
      </main>
    </div>
  );
}

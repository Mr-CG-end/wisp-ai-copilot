import React, { useState } from 'react';
import { usePageChannel } from './usePageChannel';
import { usePanelStore } from './store';
import { ModelSetup } from './components/ModelSetup';
import { SettingsPanel } from './components/SettingsPanel';
import { TaskPanel } from './components/TaskPanel';

type PanelView = 'task' | 'settings';

export function App() {
  const modelStatus = usePanelStore((s) => s.modelStatus);
  const modelBackend = usePanelStore((s) => s.modelBackend);
  const performanceProfile = usePanelStore((s) => s.performanceProfile);
  const [view, setView] = useState<PanelView>('task');
  /**
   * usePageChannel 必须留在 App 层：App 不随视图切换卸载，
   * 因此切到设置页不会掉 Port、不会丢 boundCtx。
   * 不要把它下沉进 TaskPanel —— 那样每进一次设置页就断一次连接。
   */
  const pageChannel = usePageChannel();
  const isReady = modelStatus === 'ready';
  const isSettings = view === 'settings';
  // 只在偏离默认时发声：均衡档不显示第三段，顶栏保持安静。
  const profileLabel = performanceProfile === 'resource-saver' ? ' · 省资源' : '';
  const statusLabel = isReady
    ? `本地 · ${modelBackend === 'wasm' ? 'WASM' : 'WebGPU'}${profileLabel}`
    : modelStatus === 'checking-cache' || modelStatus === 'loading'
      ? '正在恢复'
      : modelStatus === 'downloading'
        ? '正在下载'
        : '尚未初始化';

  return (
    <div className="wisp-app-root">
      <header className="wisp-app-header">
        {isSettings ? (
          <button className="wisp-btn-nav" onClick={() => setView('task')}>返回</button>
        ) : (
          <div className="wisp-brand">Wisp</div>
        )}
        <div className="wisp-header-actions">
          <div className={`wisp-runtime-status ${isReady ? 'is-ready' : ''}`}>
            <span className="wisp-status-dot" aria-hidden="true" />
            <span>{statusLabel}</span>
          </div>
          {isSettings ? null : (
            <button className="wisp-btn-nav" onClick={() => setView('settings')}>设置</button>
          )}
        </div>
      </header>

      <main className="wisp-app-main">
        {/*
          视图优先于模型状态。把设置页嵌进 ready 分支会在模型初始化失败时把它锁死，
          而「清理损坏缓存」「换后端」恰恰是那一刻用户最需要的两个操作。
        */}
        {isSettings ? (
          <SettingsPanel onBack={() => setView('task')} />
        ) : isReady ? (
          <TaskPanel pageChannel={pageChannel} />
        ) : (
          <>
            {/*
              划词动作在模型就绪前到达时不会丢（它存在 usePageChannel 里，
              TaskPanel 挂载时的首个 effect 会取走执行），但此刻用户看到的是
              初始化页——不说一句，他会以为刚才那次点击石沉大海。
            */}
            {pageChannel.pendingAction ? (
              <div className="wisp-status-banner is-warning" role="status">
                <strong>模型尚未就绪</strong>
                <p>完成初始化后将继续这次划词操作。</p>
              </div>
            ) : null}
            <ModelSetup />
          </>
        )}
      </main>
    </div>
  );
}

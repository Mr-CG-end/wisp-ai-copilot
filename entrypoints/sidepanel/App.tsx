import React from 'react';
import { usePageChannel } from './usePageChannel';
import { usePanelStore } from './store';
import { ModelSetup } from './components/ModelSetup';
import { TaskPanel } from './components/TaskPanel';

export function App() {
  const modelStatus = usePanelStore((s) => s.modelStatus);
  const pageChannel = usePageChannel();

  return (
    <div className="wisp-app-root">
      <header className="wisp-app-header">
        <div className="wisp-brand">
          <span className="wisp-brand-icon">✨</span>
          <span className="wisp-brand-name">Wisp AI Copilot</span>
        </div>
      </header>

      <main className="wisp-app-main">
        {modelStatus === 'ready' ? (
          <TaskPanel pageChannel={pageChannel} />
        ) : (
          <ModelSetup />
        )}
      </main>
    </div>
  );
}

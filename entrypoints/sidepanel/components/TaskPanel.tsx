import React, { useState } from 'react';
import { usePanelStore } from '../store';
import { useTaskRunner } from '../useTaskRunner';
import { StreamMarkdown } from './StreamMarkdown';
import type { usePageChannel } from '../usePageChannel';

interface TaskPanelProps {
  pageChannel: ReturnType<typeof usePageChannel>;
}

export const TaskPanel: React.FC<TaskPanelProps> = ({ pageChannel }) => {
  const { activeTab, boundCtx, readActivePage, readPage } = pageChannel;
  const page = usePanelStore((s) => s.page);
  const currentTask = usePanelStore((s) => s.currentTask);
  const streamBuffer = usePanelStore((s) => s.streamBuffer);
  const error = usePanelStore((s) => s.error);
  const setPage = usePanelStore((s) => s.setPage);

  const { runGeneration, stop, isStopping } = useTaskRunner();
  const [qaInput, setQaInput] = useState('');
  const [copyNotice, setCopyNotice] = useState<string | null>(null);

  const isCrossTab = activeTab && boundCtx && activeTab.tabId !== boundCtx.tabId;
  const isGenerating = currentTask?.status === 'loading';

  const handleReadActivePage = async () => {
    if (isGenerating) {
      await stop();
    }
    const result = await readActivePage();
    if (result) {
      setPage({
        ctx: result.ctx,
        title: result.title,
        url: result.ctx.url || activeTab?.tabId ? `Tab ${activeTab?.tabId}` : '',
        text: result.text,
        charCount: result.charCount,
        truncated: result.truncated,
        method: result.method,
      });
      setQaInput('');
    }
  };

  const handleRereadBoundPage = async () => {
    if (!boundCtx) return;
    if (isGenerating) await stop();
    const result = await readPage('reread', boundCtx);
    if (result) {
      setPage({
        ctx: result.ctx,
        title: result.title,
        url: result.ctx.url,
        text: result.text,
        charCount: result.charCount,
        truncated: result.truncated,
        method: result.method,
      });
    }
  };

  const handleGenerateSummary = async () => {
    if (!page) return;
    await runGeneration({
      taskType: 'summary',
      untrustedData: page.text,
      ctx: page.ctx,
    });
  };

  const handleSendQa = async () => {
    if (!page || !qaInput.trim() || isGenerating) return;
    const input = qaInput.trim();
    setQaInput('');
    await runGeneration({
      taskType: 'qa',
      untrustedData: page.text,
      userInput: input,
      ctx: page.ctx,
    });
  };

  const handleCopyOutput = async () => {
    if (!streamBuffer) return;
    try {
      await navigator.clipboard.writeText(streamBuffer);
      setCopyNotice('已复制到剪贴板');
      setTimeout(() => setCopyNotice(null), 2000);
    } catch {
      setCopyNotice('复制失败');
      setTimeout(() => setCopyNotice(null), 2000);
    }
  };

  const handleRegenerate = async () => {
    if (!currentTask || !page) return;
    await runGeneration({
      taskType: currentTask.type,
      untrustedData: page.text,
      userInput: currentTask.type === 'qa' ? qaInput : undefined,
      ctx: page.ctx,
    });
  };

  return (
    <div className="wisp-task-panel">
      {/* 跨标签页提醒横幅 */}
      {isCrossTab && (
        <div className="wisp-banner wisp-banner-info">
          <span>当前活动页与读取页不同</span>
          <button className="wisp-btn-link" onClick={handleReadActivePage}>
            改读当前页
          </button>
        </div>
      )}

      {/* 页面快照状态栏 */}
      <div className="wisp-page-bar">
        {page ? (
          <div className="wisp-page-info">
            <div className="wisp-page-title-row">
              <span className="wisp-page-icon">📄</span>
              <span className="wisp-page-title" title={page.title}>
                {page.title}
              </span>
            </div>
            <div className="wisp-page-meta">
              <span>{page.charCount} 字</span>
              <span>•</span>
              <span>{page.method}</span>
              {page.truncated && <span className="wisp-badge-warn">已截断</span>}
            </div>
          </div>
        ) : (
          <div className="wisp-page-empty">
            <span>尚未读取网页正文</span>
            <button className="wisp-btn wisp-btn-primary" onClick={handleReadActivePage}>
              读取当前页
            </button>
          </div>
        )}
      </div>

      {page && (
        <>
          {/* 快捷动作条 */}
          <div className="wisp-action-bar">
            <button
              className="wisp-btn wisp-btn-primary"
              disabled={isGenerating}
              onClick={handleGenerateSummary}
            >
              生成摘要
            </button>
            <button
              className="wisp-btn wisp-btn-secondary"
              disabled={isGenerating}
              onClick={handleRereadBoundPage}
            >
              重新读取
            </button>
          </div>

          {/* 结果显示区 */}
          <div className="wisp-result-section">
            <div className="wisp-result-header">
              <span className="wisp-result-source">
                {currentTask ? `来源: ${page.title}` : '生成结果'}
              </span>

              {isGenerating ? (
                <button
                  className="wisp-btn-sm wisp-btn-danger"
                  disabled={isStopping}
                  onClick={stop}
                >
                  {isStopping ? '正在停止…' : '停止生成'}
                </button>
              ) : (
                streamBuffer && (
                  <div className="wisp-result-tools">
                    {copyNotice && <span className="wisp-notice-pop">{copyNotice}</span>}
                    <button className="wisp-btn-sm" onClick={handleCopyOutput}>
                      复制
                    </button>
                    <button className="wisp-btn-sm" onClick={handleRegenerate}>
                      重新生成
                    </button>
                  </div>
                )
              )}
            </div>

            {/* 六态渲染 */}
            <div className="wisp-result-body">
              {!currentTask && <div className="wisp-state-idle">点击上方“生成摘要”或在下方输入问题发起追问。</div>}

              {currentTask?.status === 'loading' && (
                <div className="wisp-state-loading">
                  <StreamMarkdown content={streamBuffer || '思考中…'} />
                  <span className="wisp-cursor" />
                </div>
              )}

              {currentTask?.status === 'success' && (
                <div className="wisp-state-success">
                  <StreamMarkdown content={streamBuffer} />
                </div>
              )}

              {currentTask?.status === 'empty' && (
                <div className="wisp-state-empty">
                  <p>模型没有返回内容。</p>
                  <button className="wisp-btn-sm" onClick={handleRegenerate}>
                    重新生成
                  </button>
                </div>
              )}

              {currentTask?.status === 'cancelled' && (
                <div className="wisp-state-cancelled">
                  <div className="wisp-status-tag">已停止生成</div>
                  <StreamMarkdown content={streamBuffer} />
                </div>
              )}

              {currentTask?.status === 'error' && (
                <div className="wisp-state-error">
                  <div className="wisp-error-msg">{error?.message || '生成失败'}</div>
                  <button className="wisp-btn-sm" onClick={handleRegenerate}>
                    重试
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* 追问输入框 */}
          <div className="wisp-qa-area">
            <input
              type="text"
              className="wisp-qa-input"
              placeholder="基于本页快照追问…"
              value={qaInput}
              disabled={isGenerating}
              onChange={(e) => setQaInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void handleSendQa();
                }
              }}
            />
            <button
              className="wisp-btn-send"
              disabled={!qaInput.trim() || isGenerating}
              onClick={handleSendQa}
            >
              发送
            </button>
          </div>
        </>
      )}
    </div>
  );
};

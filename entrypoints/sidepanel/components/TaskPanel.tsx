import React, { useEffect, useState } from 'react';
import { selectSummaryContext } from '../../../core/extract/summaryContext';
import { truncateForContext } from '../../../core/extract/truncate';
import { isCtxCurrent } from '../../../core/panel/taskGuard';
import { appendMessage } from '../../../core/storage/cleanup';
import { DAY_MS, db, DEFAULT_RETENTION_DAYS } from '../../../core/storage/db';
import type { TaskContext, Uuid } from '../../../core/messaging/types';
import type { TaskHistoryEntry, TaskType } from '../store';
import { usePanelStore } from '../store';
import type { usePageChannel } from '../usePageChannel';
import { useTaskRunner } from '../useTaskRunner';
import { StreamMarkdown } from './StreamMarkdown';

interface TaskPanelProps {
  pageChannel: ReturnType<typeof usePageChannel>;
}

const TASK_LABELS: Record<TaskType, string> = {
  summary: '摘要',
  qa: '追问',
  explain: '解释',
  summarize: '总结',
  translate: '翻译',
  rewrite: '改写',
};

const SUMMARY_MAX_NEW_TOKENS = 384;
const QA_MAX_NEW_TOKENS = 512;

const GenerationPrelude: React.FC<{ sourceChars: number }> = ({ sourceChars }) => {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="wisp-generation-prelude" role="status">
      <strong>正在阅读 {sourceChars.toLocaleString()} 字页面快照</strong>
      <span>
        {elapsedSeconds < 4
          ? '本地模型正在组织要点，首段内容生成后会立即显示。'
          : `本地推理已进行 ${elapsedSeconds} 秒，可随时停止。`}
      </span>
    </div>
  );
};

const ProgressiveOutput: React.FC<{
  content: string;
  complete: boolean;
  sourceChars: number;
}> = ({ content, complete, sourceChars }) => {
  const [visibleLength, setVisibleLength] = useState(0);

  useEffect(() => {
    if (!content) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setVisibleLength(content.length);
      return;
    }

    let frame = 0;
    let currentLength = visibleLength;
    const tick = () => {
      const remaining = content.length - currentLength;
      if (remaining <= 0) return;
      const step = remaining > 80 ? 10 : remaining > 24 ? 5 : 2;
      currentLength = Math.min(content.length, currentLength + step);
      setVisibleLength(currentLength);
      if (currentLength < content.length) {
        frame = window.requestAnimationFrame(tick);
      }
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [content]);

  if (!content) return <GenerationPrelude sourceChars={sourceChars} />;
  if (complete && visibleLength >= content.length) {
    return <StreamMarkdown content={content} />;
  }
  return (
    <div className="wisp-progressive-output">
      <span className="wisp-stream-text">{content.slice(0, visibleLength)}</span>
      <span className="wisp-cursor" aria-hidden="true" />
    </div>
  );
};

const ConversationHistory = React.memo(function ConversationHistory({
  entries,
}: {
  entries: TaskHistoryEntry[];
}) {
  if (entries.length === 0) return null;
  return (
    <div className="wisp-conversation-history" aria-label="之前的对话">
      {entries.map((entry) => (
        <article className="wisp-history-turn" key={entry.id}>
          <header>
            <span>{TASK_LABELS[entry.type]}</span>
            <span title={entry.source}>{entry.source}</span>
          </header>
          {entry.userInput ? <div className="wisp-question-text">{entry.userInput}</div> : null}
          <StreamMarkdown content={entry.output} />
          {entry.truncated ? <div className="wisp-truncated-note">该回答达到长度上限</div> : null}
        </article>
      ))}
    </div>
  );
});

function getPageHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '当前页面';
  }
}

function getPageLocation(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname.replace(/^www\./, '')}${parsed.pathname}`;
  } catch {
    return url;
  }
}

async function ensureSession(
  page: { title: string },
  ctx: TaskContext,
): Promise<Uuid | null> {
  if (chrome.extension.inIncognitoContext) return null;

  const existing = await db.sessions.where('tabId').equals(ctx.tabId).first();
  if (existing?.url === ctx.url) return existing.id;

  const id = crypto.randomUUID();
  const now = Date.now();
  const { retentionDays = DEFAULT_RETENTION_DAYS } = await chrome.storage.local.get('retentionDays');
  await db.sessions.add({
    id,
    tabId: ctx.tabId,
    url: ctx.url,
    title: page.title,
    incognito: false,
    createdAt: now,
    updatedAt: now,
    expiresAt: now + (retentionDays === 0 ? DAY_MS : retentionDays * DAY_MS),
  });
  return id;
}

async function persistGeneration(
  page: { title: string },
  ctx: TaskContext,
  taskType: TaskType,
  userContent: string,
  assistantContent: string,
): Promise<void> {
  const sessionId = await ensureSession(page, ctx);
  if (!sessionId) return;
  await appendMessage(db, sessionId, 'user', userContent, taskType);
  await appendMessage(db, sessionId, 'assistant', assistantContent, taskType);
}

function prepareGenerationContext(taskType: TaskType, text: string): {
  text: string;
  chars: number;
} {
  if (taskType === 'summary') {
    const context = selectSummaryContext(text);
    return { text: context.text, chars: context.selectedChars };
  }
  const context = truncateForContext(text);
  return { text: context.text, chars: context.keptChars };
}

export const TaskPanel: React.FC<TaskPanelProps> = ({ pageChannel }) => {
  const {
    activeTab,
    boundCtx,
    lastError: pageError,
    readActivePage,
    readPage,
  } = pageChannel;
  const page = usePanelStore((s) => s.page);
  const currentTask = usePanelStore((s) => s.currentTask);
  const streamBuffer = usePanelStore((s) => s.streamBuffer);
  const history = usePanelStore((s) => s.history);
  const error = usePanelStore((s) => s.error);
  const setPage = usePanelStore((s) => s.setPage);

  const { runGeneration, stop, isStopping } = useTaskRunner();
  const [qaInput, setQaInput] = useState('');
  const [copyNotice, setCopyNotice] = useState<string | null>(null);

  const isCrossTab = Boolean(activeTab && boundCtx && activeTab.tabId !== boundCtx.tabId);
  const isGenerating = currentTask?.status === 'loading';
  const isHistoricalResult = Boolean(currentTask && page && !isCtxCurrent(currentTask.ctx, page.ctx));
  const pageHost = page ? getPageHost(page.url) : '';
  const taskLabel = currentTask ? TASK_LABELS[currentTask.type] : '结果';

  const handleReadActivePage = async () => {
    if (isGenerating) await stop();
    const result = await readActivePage();
    if (!result) return;
    setPage({
      ctx: result.ctx,
      title: result.title,
      url: result.ctx.url || (activeTab?.tabId ? `Tab ${activeTab.tabId}` : ''),
      text: result.text,
      charCount: result.charCount,
      truncated: result.truncated,
      method: result.method,
    });
    setQaInput('');
  };

  const handleRereadBoundPage = async () => {
    if (!boundCtx || isCrossTab) return;
    if (isGenerating) await stop();
    const result = await readPage('reread', boundCtx);
    if (!result) return;
    setPage({
      ctx: result.ctx,
      title: result.title,
      url: result.ctx.url,
      text: result.text,
      charCount: result.charCount,
      truncated: result.truncated,
      method: result.method,
    });
  };

  const handleGenerateSummary = async () => {
    if (!page) return;
    const context = prepareGenerationContext('summary', page.text);
    const result = await runGeneration({
      taskType: 'summary',
      untrustedData: context.text,
      maxNewTokens: SUMMARY_MAX_NEW_TOKENS,
      contextChars: context.chars,
      ctx: page.ctx,
      source: page.title,
    });
    if (result?.status === 'success') {
      await persistGeneration(page, page.ctx, 'summary', '生成摘要', result.content)
        .catch((error) => console.error('[wisp] persist summary', error));
    }
  };

  const handleSendQa = async () => {
    if (!page || !qaInput.trim() || isGenerating) return;
    const input = qaInput.trim();
    const context = prepareGenerationContext('qa', page.text);
    setQaInput('');
    const result = await runGeneration({
      taskType: 'qa',
      untrustedData: context.text,
      userInput: input,
      maxNewTokens: QA_MAX_NEW_TOKENS,
      contextChars: context.chars,
      ctx: page.ctx,
      source: page.title,
    });
    if (result?.status === 'success') {
      await persistGeneration(page, page.ctx, 'qa', input, result.content)
        .catch((error) => console.error('[wisp] persist qa', error));
    }
  };

  const handleCopyOutput = async () => {
    if (!streamBuffer) return;
    try {
      await navigator.clipboard.writeText(streamBuffer);
      setCopyNotice('已复制');
    } catch {
      setCopyNotice('复制失败');
    }
    window.setTimeout(() => setCopyNotice(null), 2000);
  };

  const handleRegenerate = async () => {
    if (!currentTask || !page || isHistoricalResult) return;
    const context = prepareGenerationContext(currentTask.type, page.text);
    const result = await runGeneration({
      taskType: currentTask.type,
      untrustedData: context.text,
      userInput: currentTask.userInput,
      maxNewTokens: currentTask.type === 'summary'
        ? SUMMARY_MAX_NEW_TOKENS
        : QA_MAX_NEW_TOKENS,
      contextChars: context.chars,
      ctx: page.ctx,
      source: page.title,
      archivePrevious: false,
    });
    if (result?.status === 'success') {
      await persistGeneration(
        page,
        page.ctx,
        currentTask.type,
        currentTask.userInput ?? '生成摘要',
        result.content,
      ).catch((error) => console.error('[wisp] persist regeneration', error));
    }
  };

  return (
    <div className="wisp-task-panel">
      {isCrossTab ? (
        <div className="wisp-status-banner is-warning wisp-cross-tab-banner" role="status">
          <div>
            <strong>当前结果来自已读取的页面</strong>
            <span>你正在查看另一个标签页，Wisp 不会自动混入新页面内容。</span>
          </div>
          <button className="wisp-btn wisp-btn-secondary" onClick={() => void handleReadActivePage()}>
            改读当前页
          </button>
        </div>
      ) : null}

      {pageError ? (
        <div className="wisp-status-banner is-error wisp-page-error-banner" role="alert">
          <div>
            <strong>页面读取已中断</strong>
            <span>{pageError.message}</span>
          </div>
          <button className="wisp-btn wisp-btn-secondary" onClick={() => void handleReadActivePage()}>
            读取当前页
          </button>
        </div>
      ) : null}

      <section className="wisp-page-bar" aria-label="页面快照">
        {page ? (
          <>
            <div className="wisp-page-rail" aria-hidden="true">
              <span className="wisp-favicon-placeholder">{pageHost.charAt(0).toUpperCase()}</span>
              <span className="wisp-source-track" />
            </div>
            <div className="wisp-page-info">
              <div className="wisp-page-eyebrow">
                <span>{pageHost}</span>
                <span aria-hidden="true">·</span>
                <span>刚刚读取</span>
              </div>
              <h2 className="wisp-page-title" title={page.title}>{page.title}</h2>
              <div className="wisp-page-meta">
                <span>{page.charCount.toLocaleString()} 字</span>
                <span aria-hidden="true">·</span>
                <span>{page.truncated ? `已读取前 ${page.text.length.toLocaleString()} 字` : '已读取全文'}</span>
                <button
                  className="wisp-btn-link"
                  disabled={!boundCtx || isGenerating || isCrossTab}
                  onClick={() => void handleRereadBoundPage()}
                >
                  重新读取
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="wisp-page-empty">
            <div>
              <strong>读取一份页面快照</strong>
              <span>只在你点击后提取正文，不会持续监视网页。</span>
            </div>
            <button className="wisp-btn wisp-btn-primary" onClick={() => void handleReadActivePage()}>
              读取当前页
            </button>
          </div>
        )}
      </section>

      {page ? (
        <>
          <div className="wisp-action-bar" aria-label="页面操作">
            <button
              className="wisp-btn wisp-btn-primary"
              disabled={isGenerating}
              onClick={() => void handleGenerateSummary()}
            >
              生成摘要
            </button>
          </div>

          <section
            className="wisp-result-section"
            aria-label="模型输出"
            aria-live="polite"
            aria-busy={isGenerating}
          >
            <aside className="wisp-result-note" aria-hidden="true">
              <span className="wisp-note-number">01</span>
              <span>{taskLabel}</span>
            </aside>

            <div className="wisp-result-main">
              {isHistoricalResult && currentTask ? (
                <div className="wisp-result-origin" role="status">
                  本结果来自：{getPageLocation(currentTask.ctx.url)}
                </div>
              ) : null}
              <header className="wisp-result-header">
                <span className="wisp-result-source" title={currentTask?.source}>
                  {currentTask
                    ? `${currentTask.source}${isHistoricalResult ? ' · 历史结果' : ''}`
                    : '等待生成'}
                </span>

                {isGenerating ? (
                  <button
                    className="wisp-btn-sm wisp-btn-danger"
                    disabled={isStopping}
                    onClick={() => void stop()}
                  >
                    {isStopping ? '正在停止…' : '停止'}
                  </button>
                ) : streamBuffer ? (
                  <div className="wisp-result-tools">
                    {copyNotice ? <span className="wisp-notice-pop" role="status">{copyNotice}</span> : null}
                    <button className="wisp-btn-sm" onClick={() => void handleCopyOutput()}>
                      复制
                    </button>
                    <button
                      className="wisp-btn-sm"
                      disabled={isHistoricalResult}
                      title={isHistoricalResult ? '请改读原页面后再重新生成' : undefined}
                      onClick={() => void handleRegenerate()}
                    >
                      重新生成
                    </button>
                  </div>
                ) : null}
              </header>

              <div className="wisp-result-body">
                <ConversationHistory entries={history} />

                {!currentTask ? (
                  <div className="wisp-state-empty">
                    <strong>生成结果会显示在这里</strong>
                    <span>可以先生成摘要，或在下方基于快照提问。</span>
                  </div>
                ) : null}

                {currentTask?.userInput ? (
                  <div className="wisp-current-question">
                    <span>你的问题</span>
                    <p>{currentTask.userInput}</p>
                  </div>
                ) : null}

                {currentTask?.status === 'loading' || currentTask?.status === 'success' ? (
                  <div className="wisp-state-loading">
                    <ProgressiveOutput
                      key={currentTask.id}
                      content={streamBuffer}
                      complete={currentTask.status === 'success'}
                      sourceChars={currentTask.contextChars ?? page.text.length}
                    />
                    {currentTask.status === 'success' && currentTask.truncated ? (
                      <div className="wisp-truncated-note" role="status">
                        回答达到长度上限，内容可能未完整结束。可以缩小问题范围后重试。
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {currentTask?.status === 'empty' ? (
                  <div className="wisp-state-empty">
                    <strong>模型没有返回内容</strong>
                    <span>可以重新生成或换个问题。</span>
                    <button className="wisp-btn-sm" onClick={() => void handleRegenerate()}>
                      重新生成
                    </button>
                  </div>
                ) : null}

                {currentTask?.status === 'cancelled' ? (
                  <div className="wisp-state-cancelled">
                    <div className="wisp-inline-notice">已停止生成</div>
                    {streamBuffer ? <StreamMarkdown content={streamBuffer} /> : null}
                  </div>
                ) : null}

                {currentTask?.status === 'error' ? (
                  <div className="wisp-state-error">
                    <strong>生成未完成</strong>
                    <span>{error?.message || '模型生成遇到错误。'}</span>
                    <button
                      className="wisp-btn-sm"
                      disabled={isHistoricalResult}
                      onClick={() => void handleRegenerate()}
                    >
                      重试
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </section>

          <div className="wisp-qa-area">
            <label htmlFor="wisp-qa-input">继续追问</label>
            <div className="wisp-qa-control">
              <input
                id="wisp-qa-input"
                type="text"
                className="wisp-qa-input"
                placeholder="基于这份快照提问…"
                value={qaInput}
                disabled={isGenerating}
                onChange={(event) => setQaInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void handleSendQa();
                  }
                }}
              />
              <button
                className="wisp-btn-send"
                aria-label="发送问题"
                disabled={!qaInput.trim() || isGenerating}
                onClick={() => void handleSendQa()}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 5.5 20 12 4 18.5l2.4-5.2L14 12l-7.6-1.3L4 5.5Z" />
                </svg>
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
};

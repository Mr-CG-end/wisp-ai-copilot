import React, { useEffect, useState } from 'react';
import { selectSummaryContext } from '../../../core/extract/summaryContext';
import { truncateForContext } from '../../../core/extract/truncate';
import { isCtxCurrent } from '../../../core/panel/taskGuard';
import {
  PERFORMANCE_CONFIGS,
  selectProfileAfterSample,
  type PerformanceConfig,
} from '../../../core/panel/performance';
import { selectTurns } from '../../../core/panel/thread';
import { appendMessage } from '../../../core/storage/cleanup';
import { DAY_MS, db, DEFAULT_RETENTION_DAYS } from '../../../core/storage/db';
import type { TaskContext, Uuid } from '../../../core/messaging/types';
import type { TaskType } from '../store';
import { usePanelStore } from '../store';
import type { usePageChannel } from '../usePageChannel';
import { useTaskRunner, type GenerationRunResult } from '../useTaskRunner';
import { SnapshotStamp } from './SnapshotStamp';
import { TurnView } from './Turn';

interface TaskPanelProps {
  pageChannel: ReturnType<typeof usePageChannel>;
}

function getPageHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '当前页面';
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

function prepareGenerationContext(
  taskType: TaskType,
  text: string,
  config: PerformanceConfig,
): {
  text: string;
  chars: number;
} {
  if (taskType === 'summary') {
    const context = selectSummaryContext(text, config.summaryContextChars);
    return { text: context.text, chars: context.selectedChars };
  }
  const context = truncateForContext(text, config.qaContextChars);
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
  const performanceProfile = usePanelStore((s) => s.performanceProfile);
  const setPerformanceProfile = usePanelStore((s) => s.setPerformanceProfile);
  const setPage = usePanelStore((s) => s.setPage);

  const { runGeneration, stop, isStopping } = useTaskRunner();
  const [qaInput, setQaInput] = useState('');
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const performanceConfig = PERFORMANCE_CONFIGS[performanceProfile];

  const turns = selectTurns(history, currentTask, streamBuffer);
  const [now, setNow] = useState(() => Date.now());

  // 凭证的相对时刻每 30s 刷新一次；只更新一个数字，不触发生成链路
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const isCrossTab = Boolean(activeTab && boundCtx && activeTab.tabId !== boundCtx.tabId);
  const isGenerating = currentTask?.status === 'loading';
  const isHistoricalResult = Boolean(currentTask && page && !isCtxCurrent(currentTask.ctx, page.ctx));
  const pageHost = page ? getPageHost(page.url) : '';

  // 快照过期 = 绑定页已导航或刷新（epoch 已变）；
  // 跨标签只是当前不在那个标签，快照仍然有效，由既有横幅表达，不动凭证。
  const isSnapshotStale = Boolean(page && boundCtx && page.ctx.epoch !== boundCtx.epoch);

  // 自动切换不弹提示，只更新顶栏文本。
  const calibratePerformance = (result: GenerationRunResult | null) => {
    const stats = result?.stats;
    if (!stats) return;
    setPerformanceProfile(selectProfileAfterSample(performanceProfile, {
      ttftMs: stats.ttftMs,
      tokensPerSec: stats.tokensPerSec,
      maxFrameGapMs: result.maxFrameGapMs,
    }));
  };

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
      readAt: Date.now(),
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
      readAt: Date.now(),
    });
  };

  const handleGenerateSummary = async () => {
    if (!page) return;
    const context = prepareGenerationContext('summary', page.text, performanceConfig);
    const result = await runGeneration({
      taskType: 'summary',
      untrustedData: context.text,
      maxNewTokens: performanceConfig.summaryMaxNewTokens,
      contextChars: context.chars,
      streamFlushIntervalMs: performanceConfig.streamFlushIntervalMs,
      ctx: page.ctx,
      source: page.title,
    });
    calibratePerformance(result);
    if (result?.status === 'success') {
      await persistGeneration(page, page.ctx, 'summary', '生成摘要', result.content)
        .catch((error) => console.error('[wisp] persist summary', error));
    }
  };

  const handleSendQa = async () => {
    if (!page || !qaInput.trim() || isGenerating) return;
    const input = qaInput.trim();
    const context = prepareGenerationContext('qa', page.text, performanceConfig);
    setQaInput('');
    const result = await runGeneration({
      taskType: 'qa',
      untrustedData: context.text,
      userInput: input,
      maxNewTokens: performanceConfig.qaMaxNewTokens,
      contextChars: context.chars,
      streamFlushIntervalMs: performanceConfig.streamFlushIntervalMs,
      ctx: page.ctx,
      source: page.title,
    });
    calibratePerformance(result);
    if (result?.status === 'success') {
      await persistGeneration(page, page.ctx, 'qa', input, result.content)
        .catch((error) => console.error('[wisp] persist qa', error));
    }
  };

  const handleCopyOutput = async (content: string) => {
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopyNotice('已复制');
    } catch {
      setCopyNotice('复制失败');
    }
    window.setTimeout(() => setCopyNotice(null), 1600);
  };

  const handleRegenerate = async () => {
    if (!currentTask || !page || isHistoricalResult) return;
    const context = prepareGenerationContext(currentTask.type, page.text, performanceConfig);
    const result = await runGeneration({
      taskType: currentTask.type,
      untrustedData: context.text,
      userInput: currentTask.userInput,
      maxNewTokens: currentTask.type === 'summary'
        ? performanceConfig.summaryMaxNewTokens
        : performanceConfig.qaMaxNewTokens,
      contextChars: context.chars,
      streamFlushIntervalMs: performanceConfig.streamFlushIntervalMs,
      ctx: page.ctx,
      source: page.title,
      archivePrevious: false,
    });
    calibratePerformance(result);
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

      {page ? (
        <>
          {/* 常驻凭证行：必须是 .wisp-task-panel 的直接子元素，sticky 的包含块才是整个面板 */}
          <div className="wisp-snapshot-header">
            <SnapshotStamp
              host={pageHost}
              readAt={page.readAt}
              now={now}
              stale={isSnapshotStale}
            />
            <div className="wisp-snapshot-host">{pageHost}</div>
          </div>

          <div className="wisp-page-detail">
            <div />
            <div className="wisp-page-info">
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
          </div>

          {/*
            唯一的 live region：只播报状态短语，不挂在正文容器上。
            流式正文若挂 live region，每次 flush 都会触发一次读屏播报。
          */}
          <div className="wisp-sr-live" role="status" aria-live="polite">
            {copyNotice ?? (isGenerating ? '正在生成' : currentTask?.status === 'success' ? '生成完成' : '')}
          </div>

          <div className="wisp-action-bar" aria-label="页面操作">
            <button
              className={`wisp-btn ${turns.length === 0 ? 'wisp-btn-primary' : 'wisp-btn-secondary'}`}
              disabled={isGenerating}
              onClick={() => void handleGenerateSummary()}
            >
              生成摘要
            </button>
            {copyNotice ? <span className="wisp-notice-pop" aria-hidden="true">{copyNotice}</span> : null}
          </div>

          {turns.length === 0 ? (
            <div className="wisp-state-empty">
              <strong>生成结果会显示在这里</strong>
              <span>可以先生成摘要，或在下方基于快照提问。</span>
            </div>
          ) : (
            <div className="wisp-turns">
              {turns.map((turn) => (
                <TurnView
                  key={turn.id}
                  turn={turn}
                  isStale={turn.sourceUrl !== page.ctx.url}
                  isStopping={isStopping}
                  canRegenerate={turn.isCurrent && turn.sourceUrl === page.ctx.url}
                  onCopy={() => void handleCopyOutput(turn.output)}
                  onRegenerate={() => void handleRegenerate()}
                  onStop={() => void stop()}
                />
              ))}
            </div>
          )}

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
    </div>
  );
};

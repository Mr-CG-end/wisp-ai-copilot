import React, { useEffect, useMemo, useState } from 'react';
import { defaultTargetLang, detectLang } from '../../../core/extract/selection';
import { assessSummaryReadiness } from '../../../core/extract/summaryReadiness';
import { selectSummaryContext } from '../../../core/extract/summaryContext';
import { truncateForContext } from '../../../core/extract/truncate';
import { isCtxCurrent } from '../../../core/panel/taskGuard';
import {
  PERFORMANCE_CONFIGS,
  selectProfileAfterSample,
  type PerformanceConfig,
} from '../../../core/panel/performance';
import { selectionBudget } from '../../../core/panel/selectionBudget';
import { selectTurns } from '../../../core/panel/thread';
import { appendMessage } from '../../../core/storage/cleanup';
import { DAY_MS, db, DEFAULT_RETENTION_DAYS } from '../../../core/storage/db';
import type { Lang, SelectionAction, TaskContext, Uuid } from '../../../core/messaging/types';
import type { CurrentTask, TaskType } from '../store';
import { usePanelStore } from '../store';
import type { usePageChannel } from '../usePageChannel';
import { useTaskRunner, type GenerationRunResult } from '../useTaskRunner';
import { SnapshotStamp } from './SnapshotStamp';
import { TurnView } from './Turn';
import { SelectionDiscovery } from './SelectionDiscovery';

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

/**
 * 划词轮次的来源标识。
 * ensureSession 需要一个 title，而划词场景压根没读过整页、拿不到页面标题，
 * 于是用「域名 · 选区前 20 字」——两段合起来足以在历史里认出这是哪一次划词。
 */
function selectionLabel(url: string, text: string): string {
  return `${getPageHost(url)} · ${text.replace(/\s+/g, ' ').trim().slice(0, 20)}`;
}

/**
 * 划词选区的原文语言，只用于把「译为原文语言」那一项置灰。
 *
 * 不存进轮次：它是 detectLang 对同一段文本的确定性结果，与 Content Script 当初
 * 随动作送来的那个 lang 必然相同（两边喂的都是 normalizeSelection 后的同一串），
 * 重算比多存一个字段便宜。other 返回 undefined —— 中英两项都不是原文语言，都可选。
 */
function selectionSourceLang(text: string | undefined): 'zh' | 'en' | undefined {
  if (!text) return undefined;
  const lang = detectLang(text);
  return lang === 'zh' || lang === 'en' ? lang : undefined;
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
    adoptCtx,
    boundCtx,
    consumePendingAction,
    lastError: pageError,
    pendingAction,
    readActivePage,
    readPage,
  } = pageChannel;
  const modelStatus = usePanelStore((s) => s.modelStatus);
  const page = usePanelStore((s) => s.page);
  const currentTask = usePanelStore((s) => s.currentTask);
  const streamBuffer = usePanelStore((s) => s.streamBuffer);
  const history = usePanelStore((s) => s.history);
  const performanceProfile = usePanelStore((s) => s.performanceProfile);
  const setPerformanceProfile = usePanelStore((s) => s.setPerformanceProfile);
  const setPage = usePanelStore((s) => s.setPage);

  const { runGeneration, stop, preemptCurrent, isStopping } = useTaskRunner();
  const [qaInput, setQaInput] = useState('');
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const performanceConfig = PERFORMANCE_CONFIGS[performanceProfile];

  const turns = selectTurns(history, currentTask, streamBuffer);
  const [now, setNow] = useState(() => Date.now());

  const summaryReadiness = useMemo(() => (
    page
      ? assessSummaryReadiness({
          text: page.text,
          title: page.title,
          url: page.url,
          method: page.method,
        })
      : null
  ), [page]);

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

  /**
   * 「当前轮还能不能重跑」。
   * 划词轮次没有页面快照可比，判据换成「绑定是否仍指向它来自的那一页」；
   * 快照轮次沿用原判据（同一份快照的 URL）。
   */
  const canRerunCurrent = !currentTask
    ? false
    : currentTask.selectionText
      ? isCtxCurrent(currentTask.ctx, boundCtx)
      : page !== null && currentTask.ctx.url === page.ctx.url;

  /**
   * 「读取当前页」在面板里有四个入口：跨标签横幅、页面错误横幅、无快照说明行、空态主操作。
   * 横幅在场时它自带的按钮就是这一刻唯一的入口，另外两处必须让位 ——
   * 否则同屏会出现两个字面完全一样的按钮，用户无从判断该点哪个。
   */
  const bannerOwnsReadAction = isCrossTab || Boolean(pageError);

  /**
   * 摘要轮失败或空返回时，「再做一次摘要」在动作条与该轮工具行里各有一个按钮。
   * 交给轮次里的「重新生成」独占：它就在结果旁边，语义也更准（重来的是这一轮）。
   *
   * 条件与下面传给 TurnView 的 canRegenerate 逐项对齐 —— 只有那个按钮确实可用时才让位，
   * 否则会把最后一个入口也一起藏掉。
   */
  const turnOwnsSummaryRetry = Boolean(
    currentTask
    && currentTask.type === 'summary'
    && (currentTask.status === 'error' || currentTask.status === 'empty')
    && canRerunCurrent
    && summaryReadiness?.decision !== 'reject',
  );
  const showSummaryButton = summaryReadiness?.decision !== 'reject' && !turnOwnsSummaryRetry;

  // Turn 投影（core/panel/thread.ts）不带划词字段，按 id 回查 store 里的原始轮次。
  const taskById = new Map<string, CurrentTask>();
  for (const entry of history) taskById.set(entry.id, entry);
  if (currentTask) taskById.set(currentTask.id, currentTask);

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
    // 不等 Worker 回话：那条消息排在当前这整段生成后面，await 它会让读取动作
    // 一起停摆十几秒，界面看起来像点了没反应。轮次转「已停止」是同步的，用户立刻看得到。
    if (isGenerating) preemptCurrent();
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
    if (isGenerating) preemptCurrent();
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
    if (!page || summaryReadiness?.decision === 'reject') return;
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

  /**
   * 划词任务的统一执行路径：首次投递、重新生成、改目标语言重跑都走这里。
   *
   * 预算用 selectionBudget 而不是 prepareGenerationContext 的 qa 分支：后者只截上下文，
   * 不会按选区规模放大输出上限，翻译和改写会被 qaMaxNewTokens 截在半句话上。
   */
  const runSelectionTask = async (input: {
    action: SelectionAction;
    text: string;
    ctx: TaskContext;
    targetLang?: Lang;
    archivePrevious?: boolean;
  }) => {
    const budget = selectionBudget(input.action, input.text, performanceConfig);
    const source = selectionLabel(input.ctx.url, input.text);
    const result = await runGeneration({
      taskType: input.action,
      untrustedData: budget.text,
      targetLang: input.targetLang,
      selectionText: input.text,
      maxNewTokens: budget.maxNewTokens,
      contextChars: budget.contextChars,
      streamFlushIntervalMs: performanceConfig.streamFlushIntervalMs,
      ctx: input.ctx,
      source,
      archivePrevious: input.archivePrevious,
    });
    calibratePerformance(result);
    if (result?.status === 'success') {
      // 落库沿用整页那条路径：会话按 tabId + url 复用，隐身窗口整体跳过。
      await persistGeneration({ title: source }, input.ctx, input.action, input.text, result.content)
        .catch((error) => console.error('[wisp] persist selection', error));
    }
  };

  /**
   * 划词动作的唯一执行入口。
   *
   * 放 effect 不放 render：render 阶段启动生成既违反 React 的纯度约定，也会在
   * StrictMode 下双跑。幂等由 consumePendingAction() 的「取走即清」兜底 ——
   * 它读的是 ref，StrictMode 第二次执行 effect 时直接拿到 null。
   *
   * 模型没就绪时不取走，动作留在 hook 里等待；App 在 modelStatus 转 ready 后
   * 才挂载本组件，届时本 effect 首次运行就会把它执行掉，动作不会丢。
   *
   * 抢占在途摘要不弹确认框（UISpec §5.12 口径一）：确认框会顶掉「点击到状态
   * ≤500ms」的指标，而被抢占的那一轮会以「已停止」留在轨迹上，内容不丢。
   *
   * 依赖里刻意不放 runSelectionTask / adoptCtx：前者每次 render 都是新引用，
   * effect 读到的已经是本次 render 的最新闭包，放进去只会让 effect 空转。
   */
  useEffect(() => {
    if (!pendingAction || modelStatus !== 'ready') return;
    const entry = consumePendingAction();
    if (!entry) return;
    // 走 hook 的 adoptCtx 而不是 store.setBoundCtx：后者只写 store，hook 内部的
    // boundCtxRef 会停在 null，EPOCH_INVALIDATED 的守卫从此永远提前返回，
    // 这个标签页刷新后划词任务的绑定再也不会被作废。
    //
    // 划词不建立 Port：选区文本已随消息送达，面板不需要再向该页面要任何东西，
    // 为它注入 CS / 连 Port 是多余的权限动作。代价是 PAGE_UNLOADING /
    // PAGE_NAVIGATED 这条 Port 通知对划词任务不可用，作废只能靠 SW 的
    // EPOCH_INVALIDATED —— tabs.onUpdated 与 CS 的 PAGE_NAVIGATED→SW 两条通道
    // 已覆盖刷新 / 跳转 / 关闭，够用。
    adoptCtx(entry.ctx);
    void runSelectionTask({
      action: entry.action,
      text: entry.text,
      ctx: entry.ctx,
      targetLang: entry.action === 'translate' ? defaultTargetLang(entry.lang) : undefined,
    });
  }, [pendingAction, modelStatus]);

  /** 改目标语言即重跑本轮，与「重新生成」同语义：替换当前轮，不在轨迹上新增一节。 */
  const handleChangeTargetLang = async (lang: 'zh' | 'en') => {
    if (!currentTask?.selectionText || !canRerunCurrent) return;
    await runSelectionTask({
      action: currentTask.type as SelectionAction,
      text: currentTask.selectionText,
      ctx: currentTask.ctx,
      targetLang: lang,
      archivePrevious: false,
    });
  };

  const handleRegenerate = async () => {
    if (!currentTask || !canRerunCurrent) return;
    if (currentTask.selectionText) {
      await runSelectionTask({
        action: currentTask.type as SelectionAction,
        text: currentTask.selectionText,
        ctx: currentTask.ctx,
        targetLang: currentTask.targetLang,
        archivePrevious: false,
      });
      return;
    }
    if (!page || isHistoricalResult) return;
    if (currentTask.type === 'summary' && summaryReadiness?.decision === 'reject') return;
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

      {pendingAction && modelStatus !== 'ready' ? (
        // 不挂 role：§5.12 口径二要求全面板只有一个 live region，下方状态行已承担播报。
        <div className="wisp-status-banner">模型尚未就绪，完成初始化后将继续该操作。</div>
      ) : null}

      {/*
        唯一的 live region：只播报状态短语，不挂在正文容器上。
        流式正文若挂 live region，每次 flush 都会触发一次读屏播报。
        它与页面快照无关，因此在三段布局之外常驻——划词结果也要能被播报。
      */}
      <div className="wisp-sr-live" role="status" aria-live="polite">
        {copyNotice ?? (isGenerating ? '正在生成' : currentTask?.status === 'success' ? '生成完成' : '')}
      </div>

      {/* —— (a) 快照区：有页面快照才存在 —— */}
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

          {showSummaryButton || copyNotice ? (
            <div className="wisp-action-bar" aria-label="页面操作">
              {showSummaryButton ? (
                <button
                  className={`wisp-btn ${turns.length === 0 ? 'wisp-btn-primary' : 'wisp-btn-secondary'}`}
                  disabled={isGenerating}
                  onClick={() => void handleGenerateSummary()}
                >
                  {summaryReadiness?.decision === 'warn' ? '仍然生成摘要' : '生成摘要'}
                </button>
              ) : null}
              {copyNotice ? <span className="wisp-notice-pop" aria-hidden="true">{copyNotice}</span> : null}
            </div>
          ) : null}

          {summaryReadiness?.decision === 'warn' ? (
            <div className="wisp-status-banner is-warning wisp-summary-readiness">
              <strong>这页内容比较零散</strong>
              <span>摘要可能遗漏上下文或混淆彼此独立的条目，请在生成后核对原文。</span>
            </div>
          ) : null}

          {summaryReadiness?.decision === 'reject' ? (
            <div className="wisp-status-banner is-warning wisp-summary-readiness">
              <strong>这页不适合生成文章摘要</strong>
              <span>
                {summaryReadiness.reason === 'activity_feed'
                  ? '当前读取到的主要是动态列表。为避免把彼此无关的条目拼成结论，Wisp 没有生成摘要。你仍可以划词总结具体内容，或基于快照提问。'
                  : summaryReadiness.reason === 'insufficient_content'
                    ? '当前读取到的正文太少，无法形成可靠摘要。可以重新读取页面、划词总结具体内容，或基于快照提问。'
                    : '当前读取到的内容过于零散，缺少可可靠概括的连续正文。可以划词总结具体内容，或基于快照提问。'}
              </span>
            </div>
          ) : null}
        </>
      ) : null}

      {/* 没有快照却已有轮次：这一轮只能来自划词，说清处理范围并给出补读整页的入口 */}
      {!page && turns.length > 0 ? (
        <div className="wisp-selection-only">
          <span>本轮来自划词选区，未读取整页。</span>
          {copyNotice ? <span className="wisp-notice-pop" aria-hidden="true">{copyNotice}</span> : null}
          {bannerOwnsReadAction ? null : (
            <button className="wisp-btn wisp-btn-secondary" onClick={() => void handleReadActivePage()}>
              读取当前页
            </button>
          )}
        </div>
      ) : null}

      {/* —— (b) 轨迹区：有轮次就渲染，与快照是否存在无关 —— */}
      {turns.length > 0 ? (
        <div className="wisp-turns">
          {turns.map((turn) => {
            const task = taskById.get(turn.id);
            return (
              <TurnView
                key={turn.id}
                turn={turn}
                // page 为 null 时「与当前快照不同」这句话不成立，一律不显示来源行
                isStale={page !== null && turn.sourceUrl !== page.ctx.url}
                isStopping={isStopping}
                canRegenerate={
                  turn.isCurrent
                  && canRerunCurrent
                  && !(turn.type === 'summary' && summaryReadiness?.decision === 'reject')
                }
                selectionText={task?.selectionText}
                targetLang={task?.targetLang === 'en' ? 'en' : 'zh'}
                sourceLang={selectionSourceLang(task?.selectionText)}
                onTargetLangChange={
                  turn.isCurrent && turn.type === 'translate' && task?.selectionText
                    ? (lang) => void handleChangeTargetLang(lang)
                    : undefined
                }
                onCopy={() => void handleCopyOutput(turn.output)}
                onRegenerate={() => void handleRegenerate()}
                onStop={() => void stop()}
              />
            );
          })}
        </div>
      ) : page ? (
        <div className="wisp-state-empty">
          <strong>生成结果会显示在这里</strong>
          <span>
            {summaryReadiness?.decision === 'reject'
              ? '仍可在下方基于快照提问，或划选具体内容处理。'
              : summaryReadiness?.decision === 'warn'
                ? '可以生成摘要，但内容比较零散，请结合原文核对；也可以在下方基于快照提问。'
                : '可以先生成摘要，或在下方基于快照提问。'}
          </span>
        </div>
      ) : (
        <div className="wisp-page-empty">
          <div className="wisp-page-empty-primary">
            <div>
              <strong>读取一份页面快照</strong>
              <span>只在你点击后提取正文，不会持续监视网页。</span>
            </div>
            {bannerOwnsReadAction ? null : (
              <button className="wisp-btn wisp-btn-primary" onClick={() => void handleReadActivePage()}>
                读取当前页
              </button>
            )}
          </div>
          <SelectionDiscovery />
        </div>
      )}

      {/* —— (c) 提问区：追问基于快照，没有快照就没有可问的对象 —— */}
      {page ? (
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
              <svg viewBox="0 0 24 24" aria-hidden="true" style={{ position: 'relative', left: '2px', transform: 'rotate(-45deg)', transformOrigin: 'center' }}>
                <path d="M4 5.5 20 12 4 18.5l2.4-5.2L14 12l-7.6-1.3L4 5.5Z" />
              </svg>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
};

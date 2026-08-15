import type { ShadowRootContentScriptUi } from 'wxt/utils/content-script-ui/shadow-root';
import { createToolbarHost, type ToolbarHost, type ToolbarProps } from '../components/selectionToolbar';
import { TOOLBAR_CSS } from '../components/selectionToolbarCss';
import { extractArticle } from '../core/extract/article';
import { detectLang, isSelectionUsable, normalizeSelection } from '../core/extract/selection';
import { isSensitiveSelection } from '../core/extract/sensitive';
import { shouldInvalidateNavigation } from '../core/messaging/navigation';
import { clampToolbarPosition, type ToolbarPositionInput } from '../core/panel/toolbarPosition';
import {
  isSelectionDiscoveryCompleted,
  markSelectionDiscoveryCompleted,
} from '../core/storage/uiHints';
import {
  PORT_NAME,
  type BackgroundToContent,
  type ContentToBackground,
  type ContentToPanel,
  type Lang,
  type PanelToContent,
  type SelectionAction,
} from '../core/messaging/types';

/**
 * 选区稳定判定的防抖窗口。阶段门要求「选区稳定后 ≤150ms 出现工具条」，
 * 这 150ms 里还要装下 Shadow Root 创建与 React 首次挂载，防抖必须显著小于它。
 */
const SELECTION_SETTLE_MS = 70;

/**
 * 面板无法程序化打开时的兜底提示（SW 的 sidePanel.open 失败后发 OPEN_PANEL_HINT）。
 * 不写「点击 Wisp 图标」：v0.1 还没有图标资产，用户认不出哪个是它。
 */
const OPEN_PANEL_HINT_TEXT = '点击浏览器工具栏上的扩展图标继续';
// 文案不提「启用」：常驻注入之后划词本来就一直可用，说「已启用」等于凭空造出一个
// 用户从没做过的动作，反而让人去找关掉它的开关。
const DISCOVERY_HINT_TITLE = '划选网页文字';
const DISCOVERY_HINT_DETAIL = 'Wisp 可以解释、总结、改写或翻译';
const DISCOVERY_HINT_MS = 4000;

export default defineContentScript({
  // 常驻注入（推翻设计文档 §3.2 的「按需注入」决策）。
  //
  // 原决策的理由是「有权限不等于该自动注入」。真机核对推翻了它：按需注入意味着
  // 划词只在「点过扩展图标的那一次页面加载」里可用 —— 不跨刷新、不跨标签页，
  // 用户在 chrome://extensions 启用了扩展却发现到处都不能划词，这不是可解释的行为。
  //
  // 主机权限本来就已经是全站 http(s)（见 wxt.config.ts），因此这条不新增任何安装提示；
  // 换来的代价是每个页面都要解析一次 content script，所以先做了工具条去 React
  // （200.09 kB → 60.36 kB）才开这一步。
  matches: ['http://*/*', 'https://*/*'],
  // 跨域 iframe 不保证支持（PRD F-03 边界），开了只会让广告框里也弹工具条
  allFrames: false,
  runAt: 'document_idle',
  main(ctx) {
    const w = window as unknown as { __wisp?: true };
    if (w.__wisp) return;
    w.__wisp = true;

    // —— Side Panel 的 Port。面板没打开时为 null，工具条链路不依赖它 —— //
    let panelPort: chrome.runtime.Port | null = null;
    const sendToPanel = (msg: ContentToPanel) => {
      try {
        panelPort?.postMessage(msg);
      } catch {
        /* 面板已关闭，忽略 */
      }
    };

    // ————————————————— 划词工具条 ————————————————— //

    let toolbarUi: ShadowRootContentScriptUi<ToolbarHost> | null = null;
    let toolbarUiPromise: Promise<ShadowRootContentScriptUi<ToolbarHost>> | null = null;
    /** 当前选区快照。按钮发出去的是它，不是点击那一刻的 window.getSelection()。 */
    let pending: { text: string; lang: Lang } | null = null;
    /** 就地反馈/提示播放中：其间不再重算选区，否则自己触发的 mouseup 会打断动效。 */
    let holding = false;
    /** 上一次的落点依据（视口坐标）；OPEN_PANEL_HINT 靠它回到工具条原位。 */
    let lastRect: ToolbarPositionInput['rect'] | null = null;
    let settleTimer = 0;
    let showSeq = 0;

    /**
     * Shadow Root 全页只建一次。
     *
     * createShadowRootUi 每次调用都会往 ctx.onInvalidated 挂一个 remove，
     * 「每次显示都新建」在反复划词后会累积几十个监听器与几十个 shadow host；
     * 复用同一个实例也天然满足「任意时刻只有一个工具条」。
     */
    function ensureToolbarUi(): Promise<ShadowRootContentScriptUi<ToolbarHost>> {
      if (!toolbarUiPromise) {
        toolbarUiPromise = createShadowRootUi<ToolbarHost>(ctx, {
          // 两段 kebab-case 是 attachShadow 对自定义元素名的硬性要求
          name: 'wisp-selection-toolbar',
          position: 'overlay',
          anchor: 'body',
          // 样式以字符串传入：这条路径直接写进 shadow 内 <style>.textContent，
          // 不 fetch、不依赖构建产物可达性（见 selectionToolbarCss.ts 顶部注释）。
          css: TOOLBAR_CSS,
          onMount(container) {
            // 定位用 fixed + 视口坐标：overlay 模式把 shadowHost 追加在 body 末尾，
            // 换成 absolute + scrollY 会以那个静态流位置为原点，工具条会掉到页面底部。
            container.style.position = 'fixed';
            container.style.margin = '0';
            container.style.zIndex = '2147483647';
            container.style.display = 'none';
            return createToolbarHost(container);
          },
          onRemove: (host) => host?.destroy(),
        })
          .then((ui) => {
            ui.mount();
            toolbarUi = ui;
            return ui;
          })
          .catch((error) => {
            // 清掉缓存，下一次划词还能再试（例如这一刻 body 恰好还不存在）
            toolbarUiPromise = null;
            throw error;
          });
      }
      return toolbarUiPromise;
    }

    /**
     * 先以不可见状态量出真实尺寸再落位：宽度由文字撑开，写死会在别的字体下裁掉字。
     *
     * 手写 DOM 的写入本身就是同步的，量之前不再需要逼一次同步提交
     * （原先这里是 flushSync —— React 18 默认的异步提交会让紧随其后的测量读到 0）。
     */
    function placeAt(
      ui: ShadowRootContentScriptUi<ToolbarHost>,
      rect: ToolbarPositionInput['rect'],
      props: ToolbarProps,
    ): void {
      const container = ui.uiContainer;
      container.style.display = 'block';
      container.style.visibility = 'hidden';
      container.style.left = '0';
      container.style.top = '0';
      ui.mounted?.render(props);
      const box = container.getBoundingClientRect();
      const { left, top } = clampToolbarPosition({
        rect,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        size: { width: box.width, height: box.height },
      });
      container.style.left = `${left}px`;
      container.style.top = `${top}px`;
      container.style.visibility = 'visible';
    }

    /** 首次启用提示没有选区锚点，固定在视口底部居中，且不参与宿主页面布局。 */
    function placeAtViewportBottom(
      ui: ShadowRootContentScriptUi<ToolbarHost>,
      props: ToolbarProps,
    ): void {
      const container = ui.uiContainer;
      container.style.display = 'block';
      container.style.visibility = 'hidden';
      container.style.left = '0';
      container.style.top = '0';
      ui.mounted?.render(props);
      const box = container.getBoundingClientRect();
      const margin = 12;
      const left = Math.max(margin, Math.min(
        (window.innerWidth - box.width) / 2,
        window.innerWidth - box.width - margin,
      ));
      const top = Math.max(margin, window.innerHeight - box.height - 24);
      container.style.left = `${left}px`;
      container.style.top = `${top}px`;
      container.style.visibility = 'visible';
    }

    /** 只收起 UI，不动 pending —— showToolbar() 依赖这一点。 */
    function teardownUi(): void {
      holding = false;
      if (!toolbarUi) return;
      toolbarUi.uiContainer.style.display = 'none';
      // 清空内容：不给宿主页面的 Tab 序列留下四个隐形按钮
      toolbarUi.mounted?.render(null);
    }

    /**
     * 对外的「隐藏工具条」：连同待发送的选区快照一起丢弃。
     *
     * showToolbar() 内部只能调 teardownUi()：那时 pending 刚被赋值，
     * 用 hide() 会把它清空，按钮点下去时 pending === null 直接 return ——
     * 工具条看起来完全正常，点击却毫无反应。
     */
    function hide(): void {
      teardownUi();
      pending = null;
    }

    /**
     * 上报走 chrome.runtime.sendMessage 而不是 Port：面板侧的 Port 是单槽位 + 8s 超时，
     * busy 时直接 reject PORT_BUSY，走 Port 会和 EXTRACT / GET_SELECTION 抢槽位。
     * SW 侧已实现 put pending + 广播 + sidePanel.open + 失败降级。
     */
    function sendAction(action: SelectionAction): void {
      // 组件已经切到反馈态，因此无论有没有快照可发都要先挡住选区重算，
      // 否则紧随其后的 mouseup 会把 1.5s 的动效顶掉
      holding = true;
      if (!pending) return;
      // 用户已经实际点击过一个有效动作，后续页面不再主动提示；写入失败不阻断任务。
      void markSelectionDiscoveryCompleted().catch(() => undefined);
      const msg: ContentToBackground = {
        type: 'TOOLBAR_ACTION',
        action,
        text: pending.text,
        url: location.href,
        lang: pending.lang,
      };
      void chrome.runtime.sendMessage(msg).catch(() => undefined);
    }

    async function showToolbar(rect: ToolbarPositionInput['rect']): Promise<void> {
      const seq = ++showSeq;
      let ui: ShadowRootContentScriptUi<ToolbarHost>;
      try {
        ui = await ensureToolbarUi();
      } catch (error) {
        console.error('[wisp] 划词工具条挂载失败', error);
        return;
      }
      // await 期间选区可能已变或已被判掉，只认最后一次请求
      if (seq !== showSeq || !pending) return;
      teardownUi();
      lastRect = rect;
      // 每次 render 都整棵重建，上一次的反馈态不会残留（原先靠 React key 换实例达成）
      placeAt(ui, rect, { onAction: sendAction, onDismiss: hide });
    }

    /** OPEN_PANEL_HINT 渲染在工具条原位：它是工具条的一个状态，不是另开一个浮层。 */
    function showHint(): void {
      const rect = lastRect;
      if (!rect) return; // 没弹过工具条就没有落点；这条提示只会紧跟一次点击到来
      void ensureToolbarUi()
        .then((ui) => {
          holding = true;
          showSeq += 1;
          placeAt(ui, rect, {
            hint: OPEN_PANEL_HINT_TEXT,
            onAction: sendAction,
            onDismiss: hide,
          });
        })
        .catch(() => undefined);
    }

    /**
     * 首次启用提示不设置 holding：用户在它显示期间划词，真实工具条会立即替换提示。
     * seq 防止 Shadow Root 首次挂载的 await 晚于一次真实选区，从而把工具条盖回提示。
     */
    function showSelectionDiscovery(): void {
      const seq = ++showSeq;
      void ensureToolbarUi()
        .then((ui) => {
          if (seq !== showSeq || pending) return;
          teardownUi();
          placeAtViewportBottom(ui, {
            hint: DISCOVERY_HINT_TITLE,
            hintDetail: DISCOVERY_HINT_DETAIL,
            hintDurationMs: DISCOVERY_HINT_MS,
            onAction: sendAction,
            onDismiss: () => {
              // 完整显示满一次就算「已发现」，从此不再出现。若用户在这 4 秒内划词，
              // 提示会被真实工具条顶掉、根本走不到这里 —— 那种情况由 sendAction
              // 里的同一个标记兜住。两条路都不走，就说明用户没看完，下个页面再提示一次。
              void markSelectionDiscoveryCompleted().catch(() => undefined);
              hide();
            },
          });
        })
        .catch(() => undefined);
    }

    /** 判定顺序不可调换：折叠 → 敏感 → 长度 → 落点。敏感命中时根本不读取文本。 */
    function handleSelectionSettled(): void {
      if (holding) return;
      // 焦点已经在工具条里（Tab 进了按钮）：此刻的选区读数不代表用户改了选择。
      // 这一条必须排在折叠判定之前，否则「聚焦按钮顺带清掉选区」会把工具条自己收走。
      if (toolbarUi && document.activeElement === toolbarUi.shadowHost) return;
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        hide();
        return;
      }
      if (isSensitiveSelection(selection)) {
        hide();
        return;
      }
      const text = normalizeSelection(selection.toString());
      if (!isSelectionUsable(text)) {
        hide();
        return;
      }
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        hide(); // 落在不可见节点上的选区没有可用落点
        return;
      }
      pending = { text, lang: detectLang(text) };
      void showToolbar(rect);
    }

    // ————————————————— 导航 ————————————————— //

    // SPA 的 pushState/replaceState 既不销毁 Content Script，也不一定触发
    // tabs.onUpdated(status:'loading') —— 少了这一路，SPA 换页后旧任务会被当成仍然有效。
    // Navigation API（Chrome 102+）覆盖 History 与 popstate 两种情况；popstate 作为兜底。
    // 这一段整体移出了 onConnect：它同时负责作废工具条，而工具条在面板没打开时也存在。
    let lastUrl = location.href;
    let lastScrollAt = Number.NEGATIVE_INFINITY;
    const notifyNavigation = (
      nextUrl: string,
      navigationType?: string,
      sameDocument?: boolean,
    ) => {
      const decision = {
        currentUrl: lastUrl,
        nextUrl,
        navigationType,
        sameDocument,
        msSinceScroll: performance.now() - lastScrollAt,
      };
      const invalidate = shouldInvalidateNavigation(decision);
      // 判定为真会一路作废到面板（PAGE_NAVIGATED → commitBoundCtx(null) → 在途轮次转失败），
      // 而站点在滚动或点击时顺手 replaceState/pushState 是很常见的事。四个输入连同结论
      // 一起打出来，才分得清「用户真的换页了」和「这条判据误报了」。
      if (import.meta.env.DEV) {
        console.debug('[wisp:diag] 导航判定', { ...decision, invalidate });
      }
      if (!invalidate) {
        lastUrl = nextUrl;
        return;
      }
      lastUrl = nextUrl;
      // 选区随导航一并作废。这同时堵住一个 epoch 时序漏洞：用户选中文本 → SPA 跳转 →
      // 再点工具条按钮，SW 填进 ctx 的会是跳转后的新 epoch，校验反而会误判通过。
      // 跳转即销毁工具条，这个场景根本无法发生。
      lastRect = null;
      hide();
      sendToPanel({ type: 'PAGE_NAVIGATED', url: nextUrl });
      const backgroundMessage: ContentToBackground = { type: 'PAGE_NAVIGATED', url: nextUrl };
      void chrome.runtime.sendMessage(backgroundMessage).catch(() => undefined);
    };
    let pendingNavigation: {
      url: string;
      navigationType?: string;
      sameDocument?: boolean;
    } | null = null;
    const onNavigate = (event: Event) => {
      const navigationEvent = event as Event & {
        destination?: { url?: string; sameDocument?: boolean };
        navigationType?: string;
      };
      pendingNavigation = {
        url: navigationEvent.destination?.url ?? location.href,
        navigationType: navigationEvent.navigationType,
        sameDocument: navigationEvent.destination?.sameDocument,
      };
    };
    const onNavigateSuccess = () => {
      const completed = pendingNavigation;
      pendingNavigation = null;
      notifyNavigation(
        completed?.url ?? location.href,
        completed?.navigationType,
        completed?.sameDocument,
      );
    };
    const onPopState = () => notifyNavigation(location.href, 'traverse', true);
    const nav = (window as unknown as { navigation?: EventTarget }).navigation;
    if (nav) {
      ctx.addEventListener(nav, 'navigate', onNavigate);
      ctx.addEventListener(nav, 'navigatesuccess', onNavigateSuccess);
    } else {
      ctx.addEventListener(window, 'popstate', onPopState);
    }
    ctx.addEventListener(window, 'pagehide', () => sendToPanel({ type: 'PAGE_UNLOADING' }), {
      once: true,
    });

    // ————————————————— 选区监听 ————————————————— //

    // 挂在 main() 顶层而不是 onConnect 回调里：面板没打开就没有 Port，
    // 挂在回调里等于「不开面板就永远不出工具条」。
    const scheduleSettle = () => {
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(handleSelectionSettled, SELECTION_SETTLE_MS);
    };
    ctx.addEventListener(document, 'selectionchange', scheduleSettle);
    // selectionchange 在拖选途中一路触发；mouseup / keyup 补的是「松手那一刻」，
    // 双击选词与 Shift+方向键都靠它们收尾。
    ctx.addEventListener(document, 'mouseup', scheduleSettle);
    ctx.addEventListener(document, 'keyup', scheduleSettle);
    ctx.addEventListener(document, 'keydown', (event) => {
      if (event.key === 'Escape') hide();
    });

    /** 滚动、缩放即隐藏（不跟随）：落点是视口坐标，视口一动就不再成立。 */
    const onViewportChange = () => {
      lastRect = null;
      hide();
    };
    // capture: true —— scroll 不冒泡，内层滚动容器的滚动只有捕获阶段收得到。
    // 顺带记下滚动时刻，供 shouldInvalidateNavigation 区分「滚动式 replaceState」。
    ctx.addEventListener(
      window,
      'scroll',
      () => {
        lastScrollAt = performance.now();
        onViewportChange();
      },
      { passive: true, capture: true },
    );
    ctx.addEventListener(window, 'resize', onViewportChange, { passive: true });

    // ————————————————— 消息 ————————————————— //

    chrome.runtime.onMessage.addListener((msg: BackgroundToContent, _sender, sendResponse) => {
      switch (msg?.type) {
        case 'PING':
          sendResponse({ type: 'PONG' });
          return false;
        case 'OPEN_PANEL_HINT':
          showHint();
          return false;
        default:
          return false;
      }
    });

    chrome.runtime.onConnect.addListener((port) => {
      if (port.name !== PORT_NAME) return;
      panelPort = port;
      port.onDisconnect.addListener(() => {
        if (panelPort === port) panelPort = null;
      });

      port.onMessage.addListener((msg: PanelToContent) => {
        const taskCtx = { tabId: -1, url: location.href, epoch: msg.epoch };

        if (msg.type === 'EXTRACT') {
          const article = extractArticle(document);
          if (!article) {
            sendToPanel({ type: 'ERROR', code: 'PAGE_NO_CONTENT', message: '当前页面没有可读正文' });
            return;
          }
          sendToPanel({
            type: 'EXTRACTED',
            ctx: taskCtx,
            title: article.title,
            text: article.text,
            charCount: article.charCount,
            truncated: false,
            method: article.method,
          });
          return;
        }

        if (msg.type === 'GET_SELECTION') {
          // 语言按真实文本判定，不再硬编码 'other'：Panel 拿到的 lang 直接决定翻译方向
          const text = normalizeSelection(window.getSelection()?.toString() ?? '');
          sendToPanel({ type: 'SELECTION', ctx: taskCtx, text, lang: detectLang(text) });
        }
      });
    });

    // ————————————————— 首次发现提示 ————————————————— //

    // 常驻注入之后，「点扩展图标」不再是启用动作，用户完全可能先划词、后才想到去点图标；
    // 把提示绑在那个时刻上等于把它藏起来。因此改由 CS 自己在页面加载时问一次 storage。
    // 一次异步 get 的成本可以忽略，而让 SW 推要每个页面唤醒一次 Service Worker。
    void isSelectionDiscoveryCompleted()
      .then((completed) => {
        if (!completed) showSelectionDiscovery();
      })
      .catch(() => undefined);
  },
});

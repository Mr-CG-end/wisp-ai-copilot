import { extractArticle } from '../core/extract/article';
import { shouldInvalidateNavigation } from '../core/messaging/navigation';
import {
  PORT_NAME,
  type ContentToBackground,
  type ContentToPanel,
  type PanelToContent,
} from '../core/messaging/types';

export default defineContentScript({
  registration: 'runtime',
  matches: [],
  main() {
    const w = window as unknown as { __wisp?: true };
    if (w.__wisp) return;
    w.__wisp = true;

    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg?.type === 'PING') sendResponse({ type: 'PONG' });
      return false;
    });

    chrome.runtime.onConnect.addListener((port) => {
      if (port.name !== PORT_NAME) return;

      const send = (msg: ContentToPanel) => {
        try {
          port.postMessage(msg);
        } catch {
          /* 面板已关闭，忽略 */
        }
      };

      const onPageHide = () => send({ type: 'PAGE_UNLOADING' });
      window.addEventListener('pagehide', onPageHide, { once: true });

      // SPA 的 pushState/replaceState 既不销毁 Content Script，也不一定触发
      // tabs.onUpdated(status:'loading') —— 少了这一路，SPA 换页后旧任务会被当成仍然有效。
      // Navigation API（Chrome 102+）覆盖 History 与 popstate 两种情况；popstate 作为兜底。
      let lastUrl = location.href;
      let lastScrollAt = Number.NEGATIVE_INFINITY;
      const onScroll = () => {
        lastScrollAt = performance.now();
      };
      const notifyNavigation = (
        nextUrl: string,
        navigationType?: string,
        sameDocument?: boolean,
      ) => {
        if (!shouldInvalidateNavigation({
          currentUrl: lastUrl,
          nextUrl,
          navigationType,
          sameDocument,
          msSinceScroll: performance.now() - lastScrollAt,
        })) {
          lastUrl = nextUrl;
          return;
        }
        lastUrl = nextUrl;
        send({ type: 'PAGE_NAVIGATED', url: nextUrl });
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
        nav.addEventListener('navigate', onNavigate);
        nav.addEventListener('navigatesuccess', onNavigateSuccess);
        window.addEventListener('scroll', onScroll, { passive: true });
      } else {
        window.addEventListener('popstate', onPopState);
      }

      port.onDisconnect.addListener(() => {
        window.removeEventListener('pagehide', onPageHide);
        window.removeEventListener('scroll', onScroll);
        window.removeEventListener('popstate', onPopState);
        nav?.removeEventListener('navigate', onNavigate);
        nav?.removeEventListener('navigatesuccess', onNavigateSuccess);
      });

      port.onMessage.addListener((msg: PanelToContent) => {
        const ctx = { tabId: -1, url: location.href, epoch: msg.epoch };

        if (msg.type === 'EXTRACT') {
          const article = extractArticle(document);
          if (!article) {
            send({ type: 'ERROR', code: 'PAGE_NO_CONTENT', message: '当前页面没有可读正文' });
            return;
          }
          send({
            type: 'EXTRACTED',
            ctx,
            title: article.title,
            text: article.text,
            charCount: article.charCount,
            truncated: false,
            method: article.method,
          });
          return;
        }

        if (msg.type === 'GET_SELECTION') {
          const raw = window.getSelection()?.toString() ?? '';
          send({ type: 'SELECTION', ctx, text: raw, lang: 'other' });
        }
      });
    });
  },
});

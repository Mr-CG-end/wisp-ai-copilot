import { extractArticle } from '../core/extract/article';
import { truncateForContext } from '../core/extract/truncate';
import { PORT_NAME, type ContentToPanel, type PanelToContent } from '../core/messaging/types';

/** 去掉 hash 的规范化 URL：SPA 的锚点跳转不算换页，不应作废在途任务。 */
function normalizedUrl(): string {
  const url = new URL(location.href);
  url.hash = '';
  return url.toString();
}

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
      let lastUrl = normalizedUrl();
      const onNavigated = () => {
        const next = normalizedUrl();
        if (next === lastUrl) return;          // 纯 hash 变化不算换页
        lastUrl = next;
        send({ type: 'PAGE_NAVIGATED', url: location.href });
      };
      const nav = (window as unknown as { navigation?: EventTarget }).navigation;
      nav?.addEventListener('navigatesuccess', onNavigated);
      window.addEventListener('popstate', onNavigated);

      port.onDisconnect.addListener(() => {
        window.removeEventListener('pagehide', onPageHide);
        window.removeEventListener('popstate', onNavigated);
        nav?.removeEventListener('navigatesuccess', onNavigated);
      });

      port.onMessage.addListener((msg: PanelToContent) => {
        const ctx = { tabId: -1, url: location.href, epoch: msg.epoch };

        if (msg.type === 'EXTRACT') {
          const article = extractArticle(document);
          if (!article) {
            send({ type: 'ERROR', code: 'PAGE_NO_CONTENT', message: '当前页面没有可读正文' });
            return;
          }
          const { text, truncated } = truncateForContext(article.text);
          send({
            type: 'EXTRACTED',
            ctx,
            title: article.title,
            text,
            charCount: article.charCount,
            truncated,
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

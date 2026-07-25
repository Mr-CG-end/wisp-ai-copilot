export interface NavigationDecision {
  currentUrl: string;
  nextUrl: string;
  navigationType?: string;
  sameDocument?: boolean;
  msSinceScroll?: number;
}

function withoutHash(raw: string): string {
  const url = new URL(raw);
  url.hash = '';
  return url.toString();
}

/**
 * 部分长文章站点会在滚动时用 replaceState 更新阅读位置。
 * 这种更新不应让已经读取的页面快照失效；真实 push/traverse 导航仍需作废旧任务。
 */
export function shouldInvalidateNavigation({
  currentUrl,
  nextUrl,
  navigationType,
  sameDocument = false,
  msSinceScroll = Number.POSITIVE_INFINITY,
}: NavigationDecision): boolean {
  if (withoutHash(currentUrl) === withoutHash(nextUrl)) return false;
  if (sameDocument && navigationType === 'replace' && msSinceScroll <= 600) return false;
  return true;
}

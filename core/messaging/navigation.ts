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

/**
 * 划词动作的「点击那一刻还在同一页」判据：比对 Content Script 自报的 url 与
 * Service Worker 侧 `sender.tab.url` 是否指向同一个页面。
 *
 * 只比 origin + pathname，忽略 hash 与 query：SPA 用 pushState 换页后
 * `sender.tab.url` 可能滞后一拍，严格相等会把大量正常点击误判成过期；
 * 而 hash / query 的变化本来就不改变正文，不该作废选区。
 *
 * 残余风险：跳转与点击落在同一帧内时，两边可能都已是新 URL，这道判据看不出来，
 * 结果是「用旧选区生成、来源标识指向新 URL」。不涉及安全红线 —— 文本是用户
 * 自己选的，既没有跨源读取也没有外发，最坏情况只是一次结果归属标错。
 */
export function isSamePageTarget(a: string, b: string): boolean {
  try {
    const left = new URL(a);
    const right = new URL(b);
    return left.origin === right.origin && left.pathname === right.pathname;
  } catch {
    // 非法 URL（扩展页、about: 之类）退化为字符串相等，不因解析失败而丢弃动作。
    return a === b;
  }
}

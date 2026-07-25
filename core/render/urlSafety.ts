/**
 * 校验并过滤 Markdown 链接 URL。
 * 允许协议：http:, https:, mailto: 以及页内锚点 #...
 * 拦截：javascript:, data:, vbscript:, 包含控制字符/空白符避开检测的恶意 URL 等。
 */
export function safeUrl(rawUrl: string): string {
  if (!rawUrl) return '';

  const trimmed = rawUrl.trim();
  if (trimmed.startsWith('#')) return trimmed;

  // 清除控制字符与制表符/换行
  const cleaned = trimmed.replace(/[\x00-\x1F\x7F-\x9F\s]/g, '');

  try {
    const parsed = new URL(cleaned, 'https://dummy-base.local');
    const protocol = parsed.protocol.toLowerCase();
    if (protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:') {
      return cleaned;
    }
    return '';
  } catch {
    return '';
  }
}

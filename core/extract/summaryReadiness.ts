export type SummaryReadiness =
  | { decision: 'allow'; signals: string[] }
  | { decision: 'warn'; reason: 'possibly_fragmented'; signals: string[] }
  | {
      decision: 'reject';
      reason: 'activity_feed' | 'fragmented_content' | 'insufficient_content';
      signals: string[];
    };

export interface SummaryReadinessInput {
  text: string;
  title: string;
  url: string;
  method: 'readability' | 'heuristic';
}

const MIN_SUMMARY_CHARS = 200;
const MIN_FRAGMENT_LINES = 8;
const SHORT_LINE_CHARS = 24;
const LONG_PROSE_CHARS = 80;
const SHORT_LINE_RATIO_THRESHOLD = 0.65;
const LONG_PROSE_RATIO_THRESHOLD = 0.35;
const ACTIVITY_MARKER_THRESHOLD = 3;

const ACTIVITY_PATTERNS = {
  contribution_date: /\bthis contribution was made on\b/i,
  created_item: /\bcreated (?:a|an) (?:pull request|issue)\b/i,
  changed_item: /\b(?:opened|closed|merged) (?:a|an|the)?\s*(?:pull request|issue)\b/i,
  commit_count: /^\d+\s+commits?\b/i,
  contribution_count: /^\d+\s+contributions?\b/i,
  committed_to: /^committed to\b/i,
} as const;

const STRUCTURE_PATTERNS = {
  date: /(?:\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}\b|\b20\d{2}[-/.年]\d{1,2})/i,
  count: /^\d+\s+(?:commits?|contributions?|issues?|pull requests?|results?|items?)\b/i,
  ui: /^(?:edit|skip to|learn how|show more|view all|medium-(?:low|high)|编辑|跳到|查看全部|加载更多)\b/i,
} as const;

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function isGitHubProfileUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') return false;
    const segments = url.pathname.split('/').filter(Boolean);
    return segments.length === 1;
  } catch {
    return false;
  }
}

function activityMetrics(lines: string[]): { count: number; categories: number } {
  let count = 0;
  const categories = new Set<string>();
  for (const line of lines) {
    for (const [category, pattern] of Object.entries(ACTIVITY_PATTERNS)) {
      if (!pattern.test(line)) continue;
      count += 1;
      categories.add(category);
      break;
    }
  }
  return { count, categories: categories.size };
}

function normalizeTemplate(line: string): string {
  return line
    .toLocaleLowerCase()
    .replace(/https?:\/\/\S+/g, '<url>')
    .replace(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/gi, '<month>')
    .replace(/\d+/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim();
}

function repeatedTemplateRatio(lines: string[]): number {
  const counts = new Map<string, number>();
  for (const line of lines) {
    const template = normalizeTemplate(line);
    if (template.length < 6) continue;
    counts.set(template, (counts.get(template) ?? 0) + 1);
  }
  const repeatedLines = [...counts.values()]
    .filter((count) => count >= 2)
    .reduce((total, count) => total + count, 0);
  return ratio(repeatedLines, lines.length);
}

function countStructureSignatures(lines: string[]): number {
  return Object.values(STRUCTURE_PATTERNS)
    .filter((pattern) => lines.some((line) => pattern.test(line)))
    .length;
}

function isSearchResultsUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return /(?:^|\/)search(?:\/|$)/i.test(url.pathname)
      || ((url.hostname.includes('google.') || url.hostname === 'www.bing.com')
        && url.searchParams.has('q'));
  } catch {
    return false;
  }
}

function isSearchResultsTitle(title: string): boolean {
  return /\bsearch results?\b|搜索结果|^search\s*[·|-]|[·|-]\s*(?:google\s+)?search$/i.test(title);
}

function countTitleSnippetPairs(lines: string[]): number {
  let pairs = 0;
  for (let index = 0; index < lines.length - 1; index += 1) {
    const title = lines[index];
    const snippet = lines[index + 1];
    if (title.length >= 6 && title.length <= 72 && snippet.length >= 50 && snippet.length <= 220) {
      pairs += 1;
      index += 1;
    }
  }
  return pairs;
}

/**
 * 在调用摘要模型前判断抽取材料是否具备连续正文的基本形状。
 *
 * 这是保守的质量门，不试图理解文章主题。自动拒绝必须同时具备多行碎片化与
 * 缺少长段正文两个信号；站点和抽取方式只作为诊断信号，不能单独决定结果。
 */
export function assessSummaryReadiness(input: SummaryReadinessInput): SummaryReadiness {
  const text = input.text.trim();
  const signals: string[] = [];

  if (text.length < MIN_SUMMARY_CHARS) {
    return {
      decision: 'reject',
      reason: 'insufficient_content',
      signals: [`content_chars:${text.length}`],
    };
  }

  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const contentChars = lines.reduce((total, line) => total + line.length, 0);
  const shortLineRatio = ratio(
    lines.filter((line) => line.length < SHORT_LINE_CHARS).length,
    lines.length,
  );
  const longProseRatio = ratio(
    lines
      .filter((line) => line.length >= LONG_PROSE_CHARS)
      .reduce((total, line) => total + line.length, 0),
    contentChars,
  );
  const activity = activityMetrics(lines);
  const templateRatio = repeatedTemplateRatio(lines);
  const structureSignatures = countStructureSignatures(lines);
  const githubProfile = isGitHubProfileUrl(input.url);
  const searchResultsPage = isSearchResultsUrl(input.url) || isSearchResultsTitle(input.title);
  const titleSnippetPairs = countTitleSnippetPairs(lines);

  if (shortLineRatio >= SHORT_LINE_RATIO_THRESHOLD) {
    signals.push(`short_line_ratio:${shortLineRatio.toFixed(2)}`);
  }
  if (longProseRatio < LONG_PROSE_RATIO_THRESHOLD) {
    signals.push(`long_prose_ratio:${longProseRatio.toFixed(2)}`);
  }
  if (activity.count > 0) signals.push(`activity_markers:${activity.count}`);
  if (activity.categories > 0) signals.push(`activity_marker_categories:${activity.categories}`);
  if (templateRatio >= 0.15) signals.push(`repeated_template_ratio:${templateRatio.toFixed(2)}`);
  if (structureSignatures > 0) signals.push(`structure_signatures:${structureSignatures}`);
  if (githubProfile) signals.push('github_profile_url');
  if (searchResultsPage) signals.push('search_results_page');
  if (titleSnippetPairs > 0) signals.push(`title_snippet_pairs:${titleSnippetPairs}`);
  if (input.method === 'heuristic') signals.push('heuristic_extraction');

  const fragmented = lines.length >= MIN_FRAGMENT_LINES
    && shortLineRatio >= SHORT_LINE_RATIO_THRESHOLD
    && longProseRatio < LONG_PROSE_RATIO_THRESHOLD;
  const activityFeed = activity.count >= ACTIVITY_MARKER_THRESHOLD
    && activity.categories >= 2
    && (githubProfile || fragmented);

  if (activityFeed) {
    return { decision: 'reject', reason: 'activity_feed', signals };
  }
  if (searchResultsPage && titleSnippetPairs >= 3) {
    return { decision: 'reject', reason: 'fragmented_content', signals };
  }

  // FAQ 天然由短问题和短答案交替组成。它确实可能是边界输入，但仍有明确语义结构，
  // 因此只警告，不把用户挡在摘要入口之外。
  const faqLike = /(?:\bfaq\b|frequently asked questions|常见问题|问答)/i
    .test(`${input.title}\n${lines.slice(0, 4).join('\n')}`);
  const hasOrthogonalFragmentSignal = templateRatio >= 0.15
    || activity.categories >= 2
    || structureSignatures >= 2;
  if (fragmented && hasOrthogonalFragmentSignal && !faqLike) {
    return { decision: 'reject', reason: 'fragmented_content', signals };
  }

  const possiblyFragmented = fragmented
    || (lines.length >= 8
      && shortLineRatio >= SHORT_LINE_RATIO_THRESHOLD
      && longProseRatio < 0.5);
  if (possiblyFragmented) {
    return { decision: 'warn', reason: 'possibly_fragmented', signals };
  }

  return { decision: 'allow', signals };
}

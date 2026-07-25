const CACHE_FAILURE_PATTERNS = [
  /local_files_only/i,
  /could not locate/i,
  /not found in.*cache/i,
  /missing.*(?:file|cache|model|tokenizer)/i,
  /cache.*(?:corrupt|incomplete|missing)/i,
];

export function isCacheRestoreFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return CACHE_FAILURE_PATTERNS.some((pattern) => pattern.test(message));
}

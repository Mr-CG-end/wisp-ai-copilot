import type { LoadProgress } from './contract';

type ProgressEvent = {
  status?: unknown;
  file?: unknown;
  loaded?: unknown;
  total?: unknown;
};

const MODEL_WEIGHT_RE = /\.onnx(?:_data)?$/i;

export function createModelProgress(onProgress: (progress: LoadProgress) => void) {
  const files = new Map<string, { loaded: number; total: number }>();
  let lastFile = '';
  let lastPct = 0;

  const snapshot = (pct: number): LoadProgress => {
    let loaded = 0;
    let total = 0;
    for (const file of files.values()) {
      loaded += file.loaded;
      total += file.total;
    }
    return { file: lastFile, loaded, total, pct };
  };

  return {
    onEvent(event: ProgressEvent): void {
      if (
        event.status !== 'progress' ||
        typeof event.file !== 'string' ||
        !MODEL_WEIGHT_RE.test(event.file) ||
        typeof event.loaded !== 'number' ||
        typeof event.total !== 'number' ||
        !Number.isFinite(event.loaded) ||
        !Number.isFinite(event.total) ||
        event.total <= 0
      ) {
        return;
      }

      lastFile = event.file;
      const previous = files.get(event.file);
      const total = Math.max(previous?.total ?? 0, event.total);
      const loaded = Math.min(total, Math.max(previous?.loaded ?? 0, event.loaded));
      files.set(event.file, { loaded, total });

      const current = snapshot(lastPct);
      const rawPct = current.total ? Math.floor((current.loaded / current.total) * 100) : 0;
      lastPct = Math.max(lastPct, Math.min(99, rawPct));
      onProgress({ ...current, pct: lastPct });
    },

    complete(): void {
      lastPct = 100;
      onProgress(snapshot(lastPct));
    },
  };
}

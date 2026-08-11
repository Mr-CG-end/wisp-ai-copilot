import type { LoadProgress } from './contract';

const DEFAULT_WINDOW_MS = 10_000;
const DEFAULT_MIN_SAMPLE_MS = 2_000;
const DEFAULT_STALL_MS = 15_000;

type Sample = {
  at: number;
  loaded: number;
};

export interface DownloadTelemetrySnapshot {
  loaded: number;
  total: number;
  bytesPerSecond: number | null;
  etaSeconds: number | null;
  stalled: boolean;
  preparing: boolean;
}

export interface DownloadTelemetry {
  update: (progress: LoadProgress, now: number) => DownloadTelemetrySnapshot;
  snapshot: (now: number) => DownloadTelemetrySnapshot;
}

export function createDownloadTelemetry(
  startedAt: number,
  options: {
    windowMs?: number;
    minSampleMs?: number;
    stallMs?: number;
  } = {},
): DownloadTelemetry {
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const minSampleMs = options.minSampleMs ?? DEFAULT_MIN_SAMPLE_MS;
  const stallMs = options.stallMs ?? DEFAULT_STALL_MS;
  const samples: Sample[] = [];
  let loaded = 0;
  let total = 0;
  let lastByteAt = startedAt;

  const pruneSamples = (now: number) => {
    const cutoff = now - windowMs;
    const firstWithinWindow = samples.findIndex((sample) => sample.at >= cutoff);
    if (firstWithinWindow > 0) {
      samples.splice(0, firstWithinWindow);
    } else if (firstWithinWindow === -1 && samples.length > 1) {
      samples.splice(0, samples.length - 1);
    }
  };

  const getSnapshot = (now: number): DownloadTelemetrySnapshot => {
    pruneSamples(now);
    const first = samples[0];
    const last = samples[samples.length - 1];
    const elapsedMs = first && last ? last.at - first.at : 0;
    const downloadedBytes = first && last ? last.loaded - first.loaded : 0;
    const bytesPerSecond = elapsedMs >= minSampleMs && downloadedBytes > 0
      ? downloadedBytes / (elapsedMs / 1000)
      : null;
    const preparing = total > 0 && loaded >= total;
    const stalled = !preparing && now - lastByteAt >= stallMs;
    const etaSeconds = bytesPerSecond && total > loaded
      ? (total - loaded) / bytesPerSecond
      : null;

    return {
      loaded,
      total,
      bytesPerSecond,
      etaSeconds,
      stalled,
      preparing,
    };
  };

  return {
    update(progress, now) {
      const nextTotal = Number.isFinite(progress.total) ? Math.max(0, progress.total) : 0;
      total = Math.max(total, nextTotal);
      const nextLoaded = Number.isFinite(progress.loaded)
        ? Math.max(0, Math.min(total || progress.loaded, progress.loaded))
        : loaded;
      if (nextLoaded > loaded) {
        loaded = nextLoaded;
        lastByteAt = now;
        samples.push({ at: now, loaded });
      }
      return getSnapshot(now);
    },

    snapshot(now) {
      return getSnapshot(now);
    },
  };
}

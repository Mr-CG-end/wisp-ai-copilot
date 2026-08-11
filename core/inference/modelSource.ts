export const DEFAULT_MODEL_SOURCE_ID = 'huggingface' as const;

export type ModelSourceId = typeof DEFAULT_MODEL_SOURCE_ID;

export interface ModelSource {
  readonly id: ModelSourceId;
  readonly remoteHost: string;
  readonly remotePathTemplate: string;
}

const MODEL_SOURCES: Readonly<Record<ModelSourceId, ModelSource>> = {
  huggingface: Object.freeze({
    id: 'huggingface',
    remoteHost: 'https://huggingface.co/',
    remotePathTemplate: '{model}/resolve/{revision}/',
  }),
};

export function isModelSourceId(value: unknown): value is ModelSourceId {
  return typeof value === 'string' && Object.hasOwn(MODEL_SOURCES, value);
}

export function getModelSource(sourceId: string): ModelSource {
  if (!isModelSourceId(sourceId)) {
    throw new Error(`UNKNOWN_MODEL_SOURCE:${sourceId}`);
  }
  return MODEL_SOURCES[sourceId];
}

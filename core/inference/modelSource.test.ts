import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MODEL_SOURCE_ID,
  getModelSource,
  isModelSourceId,
} from './modelSource';

describe('modelSource', () => {
  it('只注册受控的 Hugging Face 下载源', () => {
    expect(DEFAULT_MODEL_SOURCE_ID).toBe('huggingface');
    expect(getModelSource('huggingface')).toEqual({
      id: 'huggingface',
      remoteHost: 'https://huggingface.co/',
      remotePathTemplate: '{model}/resolve/{revision}/',
    });
  });

  it('拒绝未知下载源', () => {
    expect(isModelSourceId('mirror')).toBe(false);
    expect(() => getModelSource('mirror')).toThrow('UNKNOWN_MODEL_SOURCE:mirror');
  });
});

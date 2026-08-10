import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'core/**/*.test.ts',
      'components/**/*.test.ts',
      'components/**/*.test.tsx',
      'entrypoints/**/*.test.ts',
      'entrypoints/**/*.test.tsx',
      'tests/**/*.test.ts',
      // 评测类：语料未安装时整组跳过，不拖慢日常 npm test
      'core/**/*.bench.ts',
    ],
  },
});

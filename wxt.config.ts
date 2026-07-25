import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  webExt: {
    disabled: true,
  },
  manifest: ({ command }) => ({
    name: 'Wisp',
    description: 'Wisp 本地推理阶段一验证 / Wisp stage-1 inference spike',
    permissions: ['sidePanel', 'storage', 'activeTab', 'scripting'],
    host_permissions: [
      'https://huggingface.co/*',
      'https://cdn-lfs.huggingface.co/*',
      'https://cdn-lfs-us-1.huggingface.co/*',
      'https://us.aws.cdn.hf.co/*',
      'https://cas-bridge.xethub.hf.co/*',
    ],
    action: {},
    cross_origin_embedder_policy: {
      value: 'require-corp',
    },
    cross_origin_opener_policy: {
      value: 'same-origin',
    },
    content_security_policy: {
      extension_pages:
        `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; worker-src 'self'; connect-src 'self'${command === 'serve' ? ' http://localhost:* ws://localhost:*' : ''} https://huggingface.co https://cdn-lfs.huggingface.co https://cdn-lfs-us-1.huggingface.co https://us.aws.cdn.hf.co https://cas-bridge.xethub.hf.co`,
    },
  }),
});

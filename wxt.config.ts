import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Wisp',
    description: 'Wisp 本地推理阶段一验证 / Wisp stage-1 inference spike',
    permissions: ['sidePanel', 'storage'],
    action: {},
    content_security_policy: {
      extension_pages:
        "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; connect-src 'self' https://huggingface.co https://cdn-lfs.huggingface.co https://cdn-lfs-us-1.huggingface.co",
    },
  },
});

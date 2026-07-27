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
    // 全站常驻主机权限。安装对话框会明示「读取和更改您在所访问网站上的所有数据」，
    // 换来的是切标签页不必反复点扩展图标重新授权。
    // 只取 http(s)：不含 file://（另需用户单独开启）与其他协议。
    // 模型下载域名被 https://*/* 覆盖，出网范围仍由下方 CSP connect-src 白名单收口。
    host_permissions: ['http://*/*', 'https://*/*'],
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

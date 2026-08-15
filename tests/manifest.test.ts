import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 本文件断言的是**构建产物**，不是源码，因此它读到的永远是磁盘上那一份 manifest ——
 * 可能是上一次构建留下的。`npm run verify` 为此把 build 排在 test 之前；
 * 单独跑 `npm test` 时若刚改过 wxt.config.ts 或 entrypoint 的注册参数，
 * 请先 `npm run build`，否则这里比对的是旧产物。
 */
const MANIFEST_PATH = path.resolve(process.cwd(), '.output/chrome-mv3/manifest.json');
const hasManifest = existsSync(MANIFEST_PATH);

if (!hasManifest) {
  console.info(
    `\n[manifest] 未找到生产构建产物，已跳过。先运行 npm run build，`
    + `再运行 npm run test:manifest。当前查找路径：${MANIFEST_PATH}\n`,
  );
}

interface ExtensionManifest {
  permissions?: string[];
  host_permissions?: string[];
  content_scripts?: {
    matches?: string[];
    all_frames?: boolean;
    run_at?: string;
  }[];
  content_security_policy?: {
    extension_pages?: string;
  };
}

const manifest = hasManifest
  ? JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as ExtensionManifest
  : null;

const EXPECTED_PERMISSIONS = ['activeTab', 'scripting', 'sidePanel', 'storage'];
const EXPECTED_HOST_PERMISSIONS = ['http://*/*', 'https://*/*'];
const EXPECTED_CONNECT_SOURCES = [
  "'self'",
  'https://huggingface.co',
  'https://cdn-lfs.huggingface.co',
  'https://cdn-lfs-us-1.huggingface.co',
  'https://us.aws.cdn.hf.co',
  'https://cas-bridge.xethub.hf.co',
];

function connectSources(csp: string): string[] {
  const directive = csp
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('connect-src '));

  return directive?.split(/\s+/).slice(1) ?? [];
}

describe.skipIf(!hasManifest)('生产扩展 manifest', () => {
  it('权限范围与阶段门完全一致', () => {
    expect([...(manifest?.permissions ?? [])].sort()).toEqual(EXPECTED_PERMISSIONS);
    expect([...(manifest?.host_permissions ?? [])].sort()).toEqual(EXPECTED_HOST_PERMISSIONS);
  });

  it('不包含禁止权限或全协议主机匹配', () => {
    const granted = [
      ...(manifest?.permissions ?? []),
      ...(manifest?.host_permissions ?? []),
    ];

    expect(granted).not.toContain('tabs');
    expect(granted).not.toContain('webNavigation');
    expect(granted).not.toContain('<all_urls>');
  });

  /**
   * 划词常驻注入的三个参数写死在断言里：注入范围与主机权限一致（不多不少）、
   * 不进 iframe、不抢在 document_idle 之前。这三条任何一条被改动都是产品口径变更，
   * 应当先改这里再改实现。
   */
  it('划词 content script 常驻注入，范围与主机权限一致且不进 iframe', () => {
    const scripts = manifest?.content_scripts ?? [];
    expect(scripts).toHaveLength(1);
    expect([...(scripts[0].matches ?? [])].sort()).toEqual(EXPECTED_HOST_PERMISSIONS);
    expect(scripts[0].all_frames ?? false).toBe(false);
    expect(scripts[0].run_at).toBe('document_idle');
  });

  it('生产 CSP 只允许既定的五个模型下载主机', () => {
    const csp = manifest?.content_security_policy?.extension_pages ?? '';
    expect(connectSources(csp).sort()).toEqual([...EXPECTED_CONNECT_SOURCES].sort());
  });
});

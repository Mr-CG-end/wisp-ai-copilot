import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

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

  it('生产 CSP 只允许既定的五个模型下载主机', () => {
    const csp = manifest?.content_security_policy?.extension_pages ?? '';
    expect(connectSources(csp).sort()).toEqual([...EXPECTED_CONNECT_SOURCES].sort());
  });
});

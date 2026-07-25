import { describe, expect, it } from 'vitest';
import { safeUrl } from './urlSafety';

describe('safeUrl', () => {
  it('放行标准 http 与 https 链接', () => {
    expect(safeUrl('https://example.com/article?id=123')).toBe('https://example.com/article?id=123');
    expect(safeUrl('http://example.org')).toBe('http://example.org');
  });

  it('放行 mailto 链接', () => {
    expect(safeUrl('mailto:admin@example.com')).toBe('mailto:admin@example.com');
  });

  it('放行页内锚点', () => {
    expect(safeUrl('#section-2')).toBe('#section-2');
  });

  it('拦截 javascript 协议（含大小写与制表符变形）', () => {
    expect(safeUrl('javascript:alert(1)')).toBe('');
    expect(safeUrl('JAVASCRIPT:alert(1)')).toBe('');
    expect(safeUrl('java\nscript:alert(1)')).toBe('');
    expect(safeUrl('java\tscript:alert(1)')).toBe('');
  });

  it('拦截 data 协议与 vbscript 协议', () => {
    expect(safeUrl('data:text/html,<script>alert(1)</script>')).toBe('');
    expect(safeUrl('vbscript:msgbox(1)')).toBe('');
  });

  it('空或无法解析的 URL 返回空串', () => {
    expect(safeUrl('')).toBe('');
    expect(safeUrl('   ')).toBe('');
  });
});

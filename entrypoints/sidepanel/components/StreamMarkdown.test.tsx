// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { StreamMarkdown } from './StreamMarkdown';

// @ts-ignore
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('StreamMarkdown', () => {
  it('渲染正常加粗、列表与安全外链', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<StreamMarkdown content="**粗体** 与 [外链](https://example.com/article)" />);
    });

    expect(container.querySelector('strong')?.textContent).toBe('粗体');

    const link = container.querySelector('a');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe('https://example.com/article');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer nofollow');

    act(() => root.unmount());
    container.remove();
  });

  it('拦截 javascript 协议链接，不输出 a 标签', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<StreamMarkdown content="[恶意链接](javascript:alert(1))" />);
    });

    const link = container.querySelector('a');
    expect(link).toBeNull();
    expect(container.textContent).toContain('恶意链接');

    act(() => root.unmount());
    container.remove();
  });

  it('禁用图片节点，避免触发远程图片请求', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<StreamMarkdown content="![远程图片](https://example.com/track.png)" />);
    });

    const img = container.querySelector('img');
    expect(img).toBeNull();
    expect(container.textContent).toContain('[远程图片]');

    act(() => root.unmount());
    container.remove();
  });
});

// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { SelectionDiscovery } from './SelectionDiscovery';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('SelectionDiscovery', () => {
  it('说明划词入口并保持为不可点击的静态动作示意', async () => {
    const container = document.createElement('div');
    await act(async () => createRoot(container).render(<SelectionDiscovery />));

    expect(container.textContent).toContain('也可以直接划词');
    expect(container.textContent).toContain('选中文字，即可解释、总结、改写或翻译');
    expect(container.querySelectorAll('.wisp-selection-discovery-actions span')).toHaveLength(4);
    expect(container.querySelector('button')).toBeNull();
    expect(container.querySelector('.wisp-selection-discovery-actions')?.getAttribute('aria-hidden'))
      .toBe('true');
  });
});

import React from 'react';

/** 空状态里的长期能力提示；它只解释入口，不在面板里复制四个动作按钮。 */
export const SelectionDiscovery: React.FC = () => (
  <div className="wisp-selection-discovery">
    <div>
      <strong>也可以直接划词</strong>
      <span>在网页中选中文字，即可解释、总结、改写或翻译。</span>
    </div>
    <div className="wisp-selection-discovery-actions" aria-hidden="true">
      <span>解释</span><span>总结</span><span>改写</span><span>翻译</span>
    </div>
  </div>
);

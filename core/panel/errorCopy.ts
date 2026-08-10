import type { ErrorCode } from '../messaging/types';

/**
 * 错误的呈现层级。归位依据见审查报告 §4 的 P-3 与 UISpec §5.12：
 * 按「影响面」而不是按「严重程度」分类——同样是失败，挡住整个产品和挡住一轮生成
 * 需要完全不同的承载，机械地统一成一条小横幅会把整页态降级。
 */
export type ErrorTier = 'page' | 'banner' | 'turn' | 'inline';

export interface ErrorCopy {
  title: string;      // 一句话说清发生了什么，不用「错误」「失败」开头
  hint: string;       // 用户下一步能做什么；没有可做的就说明原因
  tier: ErrorTier;
  retryable: boolean;
}

/**
 * ErrorCode → 文案与分层的唯一映射表。
 *
 * 放 core 而不是组件层：TaskPanel / ModelSetup / SettingsPanel 三个上下文都要读它，
 * 落在任何一个组件里都会让另外两个反向依赖；放这里还能在 node 环境纯单测。
 *
 * 文案红线（阶段二计划 §2 快照语义）：正文只在 readPage() 那一刻取一次，
 * 之后一切生成读的是内存字符串。因此任何文案都不得暗示 Wisp 在持续读取或监视页面，
 * 「仍在…继续」「持续读取」「实时」一律禁止——errorCopy.test.ts 对全表做字符串断言。
 */
export const ERROR_COPY: Record<ErrorCode, ErrorCopy> = {
  // —— 整页态：模型不可用，不先解决就做不了任何事，必须替换主内容 —— //
  WEBGPU_UNAVAILABLE: {
    title: '当前设备无法使用 WebGPU',
    hint: '可以改用兼容模式运行，速度较慢但功能一致。',
    tier: 'page',
    // 不提供「重试同一条路」——按后端选择红线，必须由用户显式选择兼容模式。
    retryable: false,
  },
  OFFLINE_NO_MODEL: {
    title: '当前离线，本地还没有模型',
    hint: '首次使用需要联网下载一次模型，之后可以完全离线运行。',
    tier: 'page',
    retryable: true,
  },
  CACHE_CORRUPT: {
    title: '本地模型缓存不完整',
    hint: '清理这份缓存并重新下载即可恢复。',
    tier: 'page',
    retryable: true,
  },
  DOWNLOAD_FAILED: {
    title: '模型没有下载完整',
    hint: '检查网络连接后重试，已完成的文件不会重复下载。',
    tier: 'page',
    retryable: true,
  },
  STORAGE_FULL: {
    title: '磁盘空间不足以存放模型',
    hint: '在设置里清除数据，或腾出空间后重试。',
    tier: 'page',
    retryable: true,
  },

  // —— 页面横幅：功能仍可用，只是当前这一页不行 —— //
  PAGE_PERMISSION_REQUIRED: {
    title: '这个页面还没有授权给 Wisp',
    hint: '点击工具栏的 Wisp 图标授权当前页，然后重新读取。',
    tier: 'banner',
    retryable: true,
  },
  PAGE_INJECTION_BLOCKED: {
    title: '浏览器不允许在这个页面运行扩展',
    hint: '浏览器设置页和应用商店页是硬性限制，换一个普通网页即可。',
    tier: 'banner',
    // 与上一条的区别：那条点一下就能解决，这条点了也没用，因此不给重试。
    retryable: false,
  },
  PAGE_NO_CONTENT: {
    title: '这一页没有提取到正文',
    hint: '可以划词选中要处理的段落，或换一个内容页面重新读取。',
    tier: 'banner',
    retryable: true,
  },
  TAB_CHANGED: {
    title: '这份快照对应的页面已经变了',
    hint: '当前结果来自原来那份快照；需要新内容请改读当前页。',
    tier: 'banner',
    // 重来的入口是「改读当前页」而不是重试同一份快照，语义不同，不复用重试按钮。
    retryable: false,
  },

  // —— 轮次内：单轮生成失败，渲染在该轮纸面内，已有输出保留 —— //
  WORKER_ERROR: {
    title: '推理进程出了问题，这一轮没能完成',
    hint: '会话已保留，重新生成会自动重建推理进程。',
    tier: 'turn',
    retryable: true,
  },
  WEBGPU_CRASH: {
    title: '这一轮生成在显卡上中断了',
    hint: '问题已保留，可以重新生成，或改用兼容模式。',
    tier: 'turn',
    retryable: true,
  },

  // —— 行内：非阻断，跟在相关信息旁边说明一句 —— //
  PAGE_TOO_LONG: {
    title: '页面较长，只读取了开头一部分',
    hint: '上方标注了实际读取的字数；需要后面的内容可以划词单独处理。',
    tier: 'inline',
    // 不是失败，是如实交代处理范围，没有可重试的动作。
    retryable: false,
  },
  DOWNLOAD_CANCELLED: {
    title: '下载已取消',
    hint: '半成品缓存已清理，随时可以重新开始下载。',
    tier: 'inline',
    retryable: true,
  },
  FILL_FAILED: {
    // v0.2 F-04 预留，v0.1 不触发
    title: '草稿写入失败',
    hint: '已为你保留内容，可手动复制。',
    // 归行内：页面输入框写不进去不影响 Wisp 本身，且退路（手动复制）就在内容旁边。
    tier: 'inline',
    // 退路是复制而不是再写一次，不给重试按钮。
    retryable: false,
  },
};

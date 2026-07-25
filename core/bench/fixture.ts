// 固定 benchmark 输入（约 1000 中文字符，内容锁定），改动会被单测的哈希断言拦下。
export const BENCH_TEXT = `人工智能正在深刻改变 Web 应用的形态与架构。过去，大语言模型依赖云端 API 进行推理，虽然模型能力强大，但存在数据隐私泄露、网络延迟高、网络离线不可用以及云端推理算力成本昂贵等问题。随着 WebGPU 和 WebAssembly (WASM) 技术的成熟，在浏览器本地与边缘设备运行小参数语言模型（如 0.5B 到 1.5B 参数规模）已从概念变为现实。

WebGPU 是新一代 Web 图形与通用并行计算 API，相比传统的 WebGL，它提供了直接映射底层 GPU（如 DirectX 12、Vulkan、Metal）的能力，极大提升了矩阵乘法与并行张量计算的效率。配合现代量化技术（如 q4f16 和 q4f32），几百 MB 大小的轻量模型能够在几秒钟内完成加载，并在主流 PC 和现代智能终端上达到每秒数 token 到数十 token 的流式生成速度。

与此同时，WebAssembly 结合 SIMD 指令集和多线程技术，为缺乏 WebGPU 硬件加速的设备提供了可靠的 CPU 兼容退化方案。这种双后端协同机制，使得前端应用既能在高性能设备上获得极致速度，又能在兼容设备上保持全功能可用。

Wisp 是一款专为浏览器打造的本地 AI 阅读与提炼助手。它秉持“数据不出网”的 privacy-first 理念，通过在 Dedicated Web Worker 中运行 Transformers.js 与 ONNX Runtime Web，将文档总结、问答、解释与翻译等核心 AI 功能完全收拢在用户浏览器本地。无论是网页选区划词、PDF 资料分析，还是长文提炼，数据均无需上传至任何第三方服务器。

在基于 MV3（Manifest V3）的 Web Extension 架构下，为了保证 Side Panel 与后台 Service Worker 不因长时间推理而阻塞主线程，所有的张量计算与 Token 流式生成都在独立的 Worker 中高效完成。这种架构不仅消除了 DOM 渲染卡顿，还大幅降低了扩展的内存开销与离线启动时间。随着本地大模型效率与小模型能力的持续演进，端侧 AI 必将成为智能 Web 应用的标准基石。`;

export const BENCH_PARAMS = { maxNewTokens: 256, temperature: 0 } as const;

// djb2 简易哈希，纯函数、无依赖，供可复现性守卫
export function hashText(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

// 固化为字面量；BENCH_TEXT 的任何改动都必须显式更新该值与基准记录。
export const BENCH_TEXT_HASH = 958374825;

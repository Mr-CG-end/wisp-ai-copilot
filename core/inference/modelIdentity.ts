/**
 * 模型身份常量。原先住在 `entrypoints/sidepanel/components/ModelSetup.tsx`，
 * 设置页也要显示这几个值 —— 从一个 React 组件里 import 常量是反向依赖，
 * 因此下沉到 core。`ModelSetup.tsx` 保留 re-export，既有导入方不必改。
 */
export const MODEL_ID = 'onnx-community/Qwen3-0.6B-ONNX';
export const REVISION = 'da1453100cf3ff33ef56d17983fc7a8648706db6';

/**
 * 两个后端用的是**不同的量化文件**，因而在 Cache API 里是两组独立条目。
 * 「把首选后端改成兼容模式」在物理上等价于「再下载一次」，设置页的文案必须交代这一点。
 */
export const QUANT = { webgpu: 'q4f16' as const, wasm: 'q8' as const };

/**
 * 权重体积，用于下载前告知用户与显示进度。
 * 取 HuggingFace 上的实际字节数：q4f16 = 569,789,750 B ≈ 570 MB（WebGPU 默认路径）；
 * WASM 的 q8 是 617,687,575 B ≈ 618 MB，略大。这里按默认路径显示。
 * 原值 390 MB 少报了约 46%，而「下载前如实告知体积」是本产品的红线之一。
 */
export const MODEL_SIZE_MB = 570;

/**
 * 兼容模式（WASM）的权重体积，只用于设置页的后端说明。
 * 必须把量级写进「切换后需要另外下载」那句话：光说「需要另外下载」，
 * 用户会以为那是个几十兆的补包，而它其实是一次完整的巨型下载。
 */
export const WASM_MODEL_SIZE_MB = 618;

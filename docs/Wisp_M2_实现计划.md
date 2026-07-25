# Wisp M2 实现计划：网页问答闭环（Task 5～8）

> 状态：可执行
> 基线分支：`feat/stage2-spike`
> 基线提交：`fea1437`
> 范围：阶段二 M2，Task 5～8
> 前置条件：M1 页面读取通道已通过，提交为 `5db07a8`

## 1. M2 要交付的完整体验

M2 不再延续阶段一的调试界面，而是把已验证的推理 Worker 包装成可以演示的产品闭环。用户第一次打开 Wisp 时确认模型来源和下载体积，下载成功后即可生成摘要、针对页面快照追问并随时停止生成。模型缓存完整时，后续打开 Side Panel 应自动从本地恢复，不再要求用户点击“加载”。

M2 完成后必须能够连续演示以下路径：

1. 首次打开，确认后下载 WebGPU q4f16 模型。
2. 下载完成并通过一步生成自检，进入文章工作区。
3. 读取普通文章，显示标题、字数、截断范围和固定来源。
4. 生成摘要，输出经过安全 Markdown 渲染。
5. 针对同一页面快照追问，答案不混入其他标签页内容。
6. 生成中点击停止，保留已经生成的部分。
7. 关闭并重新打开 Side Panel，命中完整缓存后自动恢复模型，全程不下载权重。

阶段门为：初始化模型、摘要、追问、停止四条链路均可演示；切换标签页、刷新和 SPA 导航不串页；输出不会执行 HTML、脚本或远程图片请求。

## 2. 实现依据与冲突处理

实现时按以下优先级解释需求：

1. `docs/Wisp_需求文档.md`：产品边界、隐私和验收标准。
2. 本计划：M2 的接口、执行顺序和状态迁移。
3. `docs/ui/Wisp_M2_UISpec.md`：布局、视觉令牌、文案和响应式规则。
4. `docs/ui/wisp-m2-01-model-setup-v2.png`、`wisp-m2-02-model-states-v2.png`、`wisp-m2-direction-task-workspace-v2.png`、`wisp-m2-04-task-states-v2.png`：产品界面参考。
5. `docs/ui/wisp-m2-direction-showcase-v2.png`：作品集展示参考，不作为产品逐像素实现依据。
6. `docs/Wisp_阶段二开发计划.md`：阶段二全局依赖和 M3、M4 的后续接口。

如果旧计划与本计划在 Task 5～8 范围内冲突，以本计划为准。不得为了贴近展示图添加 PRD 中不存在的入口、历史、设置或虚构功能。

## 3. 执行规则与提交边界

Task 5、6、7、8 必须串行推进。后一个任务可以读取前一个任务的提交，但不得提前创建平行 Store、第二个 Worker 或另一套任务运行器。每个任务完成后独立提交，提交前至少执行：

```powershell
npm test
npx tsc --noEmit
npm run build:dev
```

Task 6 和 Task 8 还需要 Chrome 真机验收。涉及模型 Worker 时使用 `.output/chrome-mv3-dev` 静态构建，不使用 `npm run dev` 的跨来源热更新 Worker。

依赖安装统一使用 npm。不得引入 Tailwind、组件库、动画库或第二套状态管理方案。M2 使用 React、Zustand、普通 CSS、React Markdown 和现有推理内核完成。

## 4. 目标架构与所有权

```text
main.tsx
└─ InferenceProvider                 全应用唯一 Worker
   └─ App
      ├─ ModelSetup                  模型未就绪
      └─ TaskPanel                   模型已就绪
         ├─ usePageChannel           页面通道与候选页事务读取
         ├─ useTaskRunner            唯一生成、停止与迟到回调隔离
         └─ StreamMarkdown           唯一模型输出渲染出口

usePanelStore
├─ 模型状态
├─ 当前页面快照
├─ 当前任务与输出
└─ 可执行错误状态
```

Worker 由 `InferenceProvider` 创建。组件切换、标签页切换和任务切换都不得重建 Worker。Side Panel 真正关闭后允许释放显存；再次打开时自动从 Cache API 恢复模型。

页面正文仍遵守快照语义：只在用户启用页面或点击“重新读取”时提取一次，生成过程只读取内存字符串，不持续观察 DOM。

## 5. Task 5：统一状态容器与任务归属

### 5.1 文件

新增：

- `core/panel/taskGuard.ts`
- `core/panel/taskGuard.test.ts`
- `entrypoints/sidepanel/store.ts`
- `entrypoints/sidepanel/store.test.ts`

修改：

- `package.json`
- `package-lock.json`

安装 `zustand`，不增加其他状态依赖。

### 5.2 Store 契约

`usePanelStore` 是 M2 及后续任务的产品状态唯一来源。组件内部只允许保留输入框文本、焦点、按钮按下等短生命周期 UI 状态，不得复制模型状态、页面快照、任务状态或输出缓冲区。

```ts
export type AsyncStatus =
  | 'idle'
  | 'loading'
  | 'success'
  | 'empty'
  | 'error'
  | 'cancelled';

export type ModelStatus =
  | 'uninitialized'
  | 'checking-cache'
  | 'downloading'
  | 'loading'
  | 'ready'
  | 'needs-user-choice'
  | 'error';

export interface PageInfo {
  ctx: TaskContext;
  title: string;
  url: string;
  text: string;
  charCount: number;
  truncated: boolean;
  method: 'readability' | 'heuristic';
}

export interface CurrentTask {
  id: Uuid;
  type: TaskType;
  ctx: TaskContext;
  status: AsyncStatus;
  retryable: boolean;
  source: string;
}
```

`PageInfo.ctx` 不得省略。摘要和追问必须携带产生该快照时的 `tabId + epoch`，不能临时从当前标签页拼接上下文。

Store 至少提供：

- `setModelStatus`
- `setDownloadPct`
- `setBound`
- `setPage`
- `startTask`
- `appendStream`
- `finishTask`
- `cancelTask`
- `failTask`
- `setError`
- `reset`

状态迁移需满足：

- `startTask` 清空上一任务输出、统计和错误。
- `finishTask` 在输出去空白后为空时写入 `empty`，否则写入 `success`。
- `cancelTask` 保留 `streamBuffer`，只把任务改为 `cancelled`。
- 旧任务完成或失败时不得覆盖新任务。
- `setPage` 不自动清除旧结果；新任务开始时才清除。这样“改读当前页”成功后，旧结果仍能作为历史结果显示。

### 5.3 任务归属判据

`isCtxCurrent(ctx, bound)` 只比较 `tabId` 和 `epoch`。URL hash 变化不作废任务；标签变化或 epoch 变化必须判为失效。

### 5.4 自动化验收

`taskGuard.test.ts` 覆盖相同上下文、不同 tab、不同 epoch、未绑定和 hash 变化。

`store.test.ts` 至少覆盖：

- 空输出结束后进入 `empty`。
- 取消后保留部分输出。
- 新任务开始后清理旧输出。
- 无当前任务时调用结束、取消和失败不会制造伪任务。
- `reset` 恢复完整初始状态。

### 5.5 提交

```powershell
git commit -m "feat: 建立 M2 面板状态与任务归属守卫"
```

## 6. Task 6：首次确认、缓存自动恢复与唯一 Worker

### 6.1 文件

新增：

- `entrypoints/sidepanel/InferenceProvider.tsx`
- `entrypoints/sidepanel/components/ModelSetup.tsx`
- `entrypoints/sidepanel/style.css`
- `core/inference/modelCache.ts`
- `core/inference/modelCache.test.ts`

修改：

- `core/inference/contract.ts`
- `core/inference/cacheSelection.ts`
- `core/inference/cacheSelection.test.ts`
- `entrypoints/sidepanel/inference.worker.ts`
- `entrypoints/sidepanel/App.tsx`
- `entrypoints/sidepanel/main.tsx`

### 6.2 Worker 只能有一个

`main.tsx` 必须使用 `InferenceProvider` 包住 `App`。Task 6 完成后，除 `InferenceProvider` 外不得再调用 `useInference()`；其他组件统一使用 `useInferenceContext()`。

React Strict Mode 下的重复挂载不得触发两次自动初始化。`ModelSetup` 使用 attempt ID 与 `useRef` 启动锁，保证同一次挂载流程只有一个有效初始化任务。

### 6.3 缓存清单

成功完成自检后，在 `chrome.storage.local` 写入：

```ts
export interface ModelCacheManifest {
  schema: 1;
  modelId: string;
  revision: string;
  backend: 'webgpu' | 'wasm';
  dtype: 'q4f16' | 'q8';
  verifiedAt: number;
}
```

固定 key 为 `wisp:model-cache-manifest:v1`。清单只在 `api.init()` 完成一步生成自检后写入，不能在下载结束或进度达到 100% 时提前写。

挂载后的决策顺序必须固定：

```text
读取存储空间、WebGPU 能力、Cache API 条目和缓存清单
├─ 清单与 MODEL_ID / REVISION / dtype 完全匹配
│  └─ 自动 cache-only 初始化，不显示确认按钮
├─ 有旧版缓存条目但没有清单
│  └─ 显示“验证旧版本地缓存”按钮；不得自动联网补文件
└─ 没有有效缓存
   └─ 显示首次下载信息和“开始下载”
```

现有阶段一缓存没有清单，因此升级后的第一次允许用户点击一次“验证旧版本地缓存”。验证成功后写入清单，此后打开 Side Panel 自动恢复。

### 6.4 自动恢复不得联网

`InitConfig` 增加 `cacheOnly?: boolean`。Worker 在 `cacheOnly === true` 时向 tokenizer 和 model 的 `from_pretrained` 传入 `local_files_only: true`。自动恢复过程中不得下载缺失文件，不得把残缺缓存静默补齐。

缓存自动恢复的界面文案为“正在从本地缓存恢复模型…”，不显示下载体积和“开始下载”按钮。成功后直接进入 `ready`；失败时：

- 缺文件或缓存损坏：删除匹配清单和对应模型残留，显示 `CACHE_CORRUPT`，等待用户确认重新下载。
- WebGPU 适配器或自检失败：保留模型缓存，进入 `needs-user-choice`，由用户选择重试 WebGPU 或使用 WASM。
- 不得自动从 WebGPU 回退到 WASM。

### 6.5 首次下载

首次下载前必须展示模型名、来源、预计体积、可用空间和隐私说明。用户没有点击“开始下载”时不得调用 `api.init()`，也不得产生模型网络请求。

下载取消继续沿用 M1 已验证的 attempt 隔离：终止并重建 Worker，只删除本次新增且匹配 model ID 与 revision 的缓存条目，不能清除原有完整缓存。

WASM 由用户显式选择。WASM q8 自检成功后同样写入清单，后续自动按 `backend: 'wasm'` 恢复，不得擅自改回 WebGPU。

### 6.6 视觉实现

初始化页以 `docs/ui/Wisp_M2_UISpec.md` 和 `wisp-m2-01-model-setup-v2.png` 为准；下载、离线和 WebGPU 失败状态参考 `wisp-m2-02-model-states-v2.png`。

必须使用普通 CSS 实现暖象牙背景、深墨文字、苔绿单一强调色、44px 工具栏和紧凑桌面密度。不要把每行信息做成卡片，不要添加手机式底部导航、巨型按钮或装饰动画。

### 6.7 自动化与真机验收

纯逻辑测试覆盖：

- 清单完全匹配。
- model ID、revision、backend 或 dtype 不匹配。
- 有旧缓存但无清单。
- 清除缓存时同时删除清单。
- 自动恢复选择上次成功的后端。

Chrome 真机必须覆盖：

1. 无缓存时打开面板不产生模型请求，点击“开始下载”后才下载。
2. 首次下载完成后关闭并重开面板，自动进入本地恢复，无需点击。
3. 自动恢复期间 Network 没有权重请求。
4. 离线重开仍能自动恢复。
5. 缓存残缺时不无限加载、不自动联网补齐。
6. WebGPU 失败后只有明确选择 WASM 才切换。
7. 切换普通网页标签不重建 Worker、不重新加载模型。

### 6.8 提交

```powershell
git commit -m "feat: 实现模型首次确认与缓存自动恢复"
```

## 7. Task 7：模型输出的唯一安全渲染出口

### 7.1 文件

新增：

- `core/render/urlSafety.ts`
- `core/render/urlSafety.test.ts`
- `entrypoints/sidepanel/components/StreamMarkdown.tsx`
- `entrypoints/sidepanel/components/StreamMarkdown.test.tsx`

修改：

- `package.json`
- `package-lock.json`

安装 `react-markdown` 和 `rehype-sanitize`。不得安装 `rehype-raw`。

### 7.2 安全边界

`StreamMarkdown` 是模型输出唯一渲染出口。Task 8、12、13 不得直接渲染原始 HTML，也不得使用 `dangerouslySetInnerHTML`。

链接只允许 `http:`、`https:`、`mailto:` 和页内锚点。`javascript:`、`data:`、`vbscript:`、控制字符变体和无法解析的 URL 返回空串。

Markdown 图片必须禁用。模型输出中的：

```md
![tracker](https://example.com/track.png)
```

不能生成 `<img>`，避免模型文本触发未确认的远程请求。可以把 alt 文本渲染为普通文本，也可以完全移除图片节点。

外链使用 `target="_blank"` 和 `rel="noopener noreferrer nofollow"`。原始 `<script>`、`<iframe>`、`<object>`、事件属性和样式属性不得进入 DOM。

### 7.3 测试与真机验收

测试覆盖危险协议的大小写、前后空白和制表符变体，以及正常 HTTPS、mailto 和页内锚点。组件测试使用静态渲染或 jsdom，断言：

- 没有 `script`、`iframe`、`img`。
- `javascript:` 不成为 href。
- 正常链接包含安全 rel。
- 加粗、列表和行内代码正常输出。

真机检查危险输入不会弹窗、不会加载远程图片，Elements 中不存在危险节点。

### 7.4 提交

```powershell
git commit -m "feat: 增加安全 Markdown 流式渲染"
```

## 8. Task 8：摘要、追问、停止与事务式换页

### 8.1 文件

新增：

- `entrypoints/sidepanel/useTaskRunner.ts`
- `entrypoints/sidepanel/components/TaskPanel.tsx`

修改：

- `entrypoints/sidepanel/usePageChannel.ts`
- `entrypoints/sidepanel/App.tsx`
- `entrypoints/sidepanel/style.css`

Task 8 只能通过 `useInferenceContext()` 使用 Worker。

### 8.2 可复用任务运行器

生成与停止逻辑不得写成 `TaskPanel` 私有闭包。`useTaskRunner()` 对外提供：

```ts
interface TaskRunner {
  runGeneration(options: RunOptions): Promise<void>;
  stop(): Promise<void>;
  isStopping: boolean;
}
```

Task 12 的划词动作将直接复用同一个 Hook，不再复制生成循环。

运行器必须保证：

- 新任务开始前取消旧任务。
- 每个任务使用唯一 signal ID。
- token 回调先检查任务 ID，再检查 `isCtxCurrent`。
- 迟到 token、完成和失败回调不能改写新任务。
- 停止后立即写入 `cancelled`，保留已经生成的文本。
- Worker 真正结束后才清理 signal ID。

### 8.3 候选页面事务读取

现有 `bindActiveTab() → readPage()` 会在读取成功前修改内部绑定，不适合“改读当前页失败时保留旧页面”的产品语义。`usePageChannel` 增加：

```ts
readActivePage(): Promise<ExtractedPage | null>
```

该方法按事务执行：

1. 查询当前活动标签。
2. 确认 Content Script 可用。
3. 为候选标签建立临时 Port，不关闭当前 Port。
4. 在候选 Port 上执行正文提取。
5. 只有收到 `EXTRACTED` 后，才关闭旧 Port，并提交新的 `boundCtx`。
6. 注入或提取失败时断开候选 Port，保留旧 Port、旧 `boundCtx`、旧页面和旧结果。

候选 Port 使用独立请求槽，不能与当前 Port 共用 `RequestSlot`。事务成功后才把候选 Port 提升为正式 Port。

Task 8 的首次启用和“改读当前页”使用 `readActivePage()`；不得再写先修改绑定、失败后手工拼回 Store 的伪回滚。

“重新读取”只允许读取已经绑定的标签页。当前活动标签与 `boundCtx.tabId` 不同时，不得借“重新读取”静默切换来源，而是显示跨标签横幅并要求用户点击“改读当前页”。活动标签仍是原绑定页时，复用正式 Port 执行 `readPage('reread')`，成功后原子替换页面快照。

### 8.4 页面快照与结果来源

正文读取成功后创建 `PageInfo`，其中 `ctx` 必须直接来自 `EXTRACTED.ctx`。摘要与追问使用 `page.text` 和 `page.ctx`，不在生成前重新读取 DOM。

界面同时区分：

- 当前页面快照：浏览器上下文栏显示标题、域名、字数和读取范围。
- 当前结果来源：从 `currentTask.ctx/source` 读取。换页后旧结果保留时标注“历史”，不能冒充新页面结果。

切换标签本身不取消生成。用户点击“改读当前页”时立即停止旧任务；候选页读取失败仍保留旧绑定和结果，读取成功后才提交新页面并清空未发送的追问输入。

刷新原页面或发生 SPA 导航时，epoch 失效，停止接受后续 token，已生成部分保留并显示可执行错误。

### 8.5 产品动作

TaskPanel 提供：

- 首次启用或读取当前页。
- 重新读取。
- 生成摘要。
- 基于当前快照追问。
- 停止。
- 复制。
- 重新生成。
- 改读当前页。

复制失败必须显示错误，不得静默吞掉。追问输入为空时发送按钮禁用。

### 8.6 视觉与六态

工作区以 `wisp-m2-direction-task-workspace-v2.png` 为产品参考，任务状态以 `wisp-m2-04-task-states-v2.png` 为参考。必须覆盖 `idle/loading/success/empty/error/cancelled`：

- `loading` 显示流式插入光标和停止操作。
- `empty` 显示“模型没有返回内容”和重新生成。
- `cancelled` 保留部分内容并显示“已停止生成”。
- 跨标签页保留原来源，提供“改读当前页”。

结果区使用 `StreamMarkdown`，不得出现聊天头像、气泡、底部导航或阶段三入口。

### 8.7 真机验收

至少完成以下场景：

1. 长文章摘要、追问、复制和重新生成。
2. 停止后 500ms 内停字，1s 内任务结束。
3. 生成中切换标签，任务继续基于旧快照完成。
4. 改读普通页面成功，旧结果保留并标为历史。
5. 改读 `chrome://` 页面失败，旧绑定、旧 Port 和旧结果不变。
6. 原页面刷新或 SPA 导航后，旧 token 不再进入界面。
7. 生成中再次生成，输出不交错。
8. Service Worker 重启后 epoch 不倒退。
9. 模型已经 ready 时切换标签，不重新初始化 Worker。
10. 320px、400px、500px 宽度无横向滚动，键盘焦点清楚。

### 8.8 提交

```powershell
git commit -m "feat: 完成 M2 网页摘要与追问闭环"
```

## 9. M2 最终验收与交付记录

Task 8 提交后执行：

```powershell
npm test
npx tsc --noEmit
npm run build
npm run build:dev
git diff --check
git status --short
```

交付记录必须包含：

- 四个 Task 的提交哈希。
- 自动化测试文件数和测试项数。
- 首次下载、缓存自动恢复、离线恢复的真机结果。
- WebGPU 与显式 WASM 路径结果。
- 摘要、追问、停止、防串页和安全渲染结果。
- 尚未解决但不阻断 M2 阶段门的问题。

若任一阻断条件存在，不得进入 M3：

- 缓存命中后仍要求用户每次点击加载。
- 自动恢复产生模型权重网络请求。
- 同时存在两个推理 Worker。
- WebGPU 失败后静默切换 WASM。
- 切标签、刷新或 SPA 导航导致内容串页。
- 模型输出能够创建脚本、iframe 或远程图片请求。
- 停止后旧 token 继续写入结果。

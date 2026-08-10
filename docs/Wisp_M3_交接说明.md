# Wisp 阶段二 M3 交接说明

> 写给接手的执行者（人或 AI 代理）。目标是冷启动即可继续，不必重新推导已经定下的决策。
>
> 基线：分支 `feat/stage2-spike`，HEAD `ecbfe35`，已推送 `origin`，工作区干净。
> 验证状态：`npm test` = 39 文件 300 项通过 1 跳过；`npx tsc --noEmit` = 0；`npm run build` 通过。
> 跳过的那 1 项是 `core/bench/extractionCorpus.bench.ts`，需要外部 clone 语料（`git clone --depth 1 https://github.com/scrapinghub/article-extraction-benchmark bench-corpus`），未安装时整组跳过。**跳过不等于通过**，阶段门里要如实标注。

---

## 1. 先读这几份文档（顺序有意义）

| 文档 | 作用 |
|---|---|
| `docs/Wisp_阶段二开发计划.md` §0.1 / §0.1.1 / §0.1.2 | 进度表 + **三处已失效内容** + 真机核对安排。§0.1.1 与正文 §4 冲突时以 §0.1.1 为准 |
| `docs/Wisp_M3_真机核对清单.md` | 51 项真机核对，标 ★ 的影响阶段门。**由项目所有者执行，代理做不了** |
| `docs/回归集.md` | 15 站提取回归集骨架，待首轮实测填充 |
| `docs/ui/Wisp_M2_UISpec.md` v3.1 | UI 规范。§5.11 设置页、§5.12 错误分层矩阵是 W3 的直接施工依据 |
| `docs/Wisp_审查报告_设计文档与UI.md` | 外部审查报告，W3 的 P-3 分层表在 §4 |
| `AGENTS.md` | 仓库约定 |

---

## 2. 已完成（勿重做）

### W1 — 四个纯逻辑包（提交 `a23ef5b`～`6638fe5`）

- `docs/ui/Wisp_M2_UISpec.md` 升 v3.1，新增 §5.11 设置页规范、§5.12 错误分层矩阵
- `core/messaging/types.ts`：新增 `BackgroundToContent`（`PING` / `OPEN_PANEL_HINT`），`PendingActionEntry` 与 `PENDING_ACTION` 加 `lang`
- `core/panel/errorCopy.ts`：`ERROR_COPY: Record<ErrorCode, {title, hint, tier, retryable}>`，14 个码全覆盖，`tier: 'page'|'banner'|'turn'|'inline'`
- `core/storage/settings.ts`：`Settings = { backend, retentionDays, modelId }`（**无 `outputLength`**）、`usage.ts`（`collectUsage` / `formatUsageLine`）、`modelCache.countModelCacheEntries`
- `core/extract/selection.ts`、`sensitive.ts`、`core/panel/selectionBudget.ts`、`toolbarPosition.ts`
- `store.ts` 归档判据修正 + `CurrentTask` 加 `targetLang` / `selectionText`

### W2 — 设置页 / 工具条 / 划词交付（提交 `700d69f`～`983fcbd`）

- `entrypoints/background.ts`：`sidePanel.open()` 重排到手势同步段；`isSamePageTarget` 双保险
- `entrypoints/sidepanel/usePageChannel.ts`：`PANEL_READY` 握手、`PENDING_ACTION` 消费、按 id 去重、`adoptCtx`
- `entrypoints/sidepanel/components/TaskPanel.tsx`：拆三段（快照区 / 轨迹区 / 提问区），无快照时也能渲染轨迹
- `entrypoints/content.ts`：选区监听移出 `onConnect`，`createShadowRootUi` + 内联 CSS 字符串
- `components/SelectionToolbar.tsx` / `selectionToolbarCss.ts`
- `entrypoints/sidepanel/components/SettingsPanel.tsx` + `App.tsx` 视图优先切换 + `core/inference/modelIdentity.ts`

### 收尾（提交 `f9252ee`、`ecbfe35`）

- 补齐 `.wisp-turn-selection` / `.wisp-turn-lang` / `.wisp-selection-only` 三处样式
- 建立 `docs/回归集.md` 骨架

---

## 3. 不可再议的决策（改动前先看这里）

| 决策 | 依据 | 说明 |
|---|---|---|
| **`outputLength` 已裁撤** | 设计文档 §2.2、计划 §0.1.1 R1 | 不要建 `core/panel/outputLength.ts`，`Settings` 不加该字段，输出上限完全由 `core/panel/performance.ts` 的档位自动决定。计划文档 Task 10 Step 2/5/8 已失效 |
| **「后端切换」不可裁剪** | 审查报告 §1.4-D、计划 §0.1.1 R2 | WASM 是集显用户的正当选择。选项下必须两句话：不占显卡因而网页更流畅；用不同量化文件，切换需另外下载 618 MB。**缺第二句会让一次点击触发巨型下载** |
| **快照语义** | 计划 §2 | 正文只在 `readPage()` 那一刻取一次。任何文案不得暗示持续读取或监视页面，禁用「仍在…继续」「持续读取」「实时」「监视」。`errorCopy.test.ts` 对全表做字符串断言 |
| **WebGPU 失败不自动回落 WASM** | 设计文档 §2.3 | 只进 `needs-user-choice` 由用户显式选择 |
| **划词抢占在途生成不弹确认框** | UISpec §5.12 口径① | 确认框会顶掉「点击到状态 ≤500ms」指标；被抢占的轮次以「已停止」留在轨迹上不会丢 |
| **工具条只在已启用页面出现** | PRD F-03 原文 | CS 是 `registration:'runtime'` + `matches:[]`，按需注入且不跨刷新存活。**已确认接受**，写进 README 已知限制，不要为此改注册方式 |
| **不录制演示视频** | 项目所有者决定 | 阶段门原文的「六步 Demo 可无剪辑连续录制」改为手动连跑 10 轮走查，README 如实记录未录制 |
| **提交不加任何尾行** | AGENTS.md、计划 §2 | 无 `Co-Authored-By`、无生成器署名。作者 `Mr-CG-end`。Conventional Commit + 中文描述 |

---

## 4. 待办：W3 错误分层收口与可访问性

**这是下一波的主体。以下现状均已核实（`ecbfe35` 时点），可直接用。**

### 4.1 五个 `ErrorCode` 从未被写入

`PAGE_TOO_LONG`、`WEBGPU_CRASH`、`OFFLINE_NO_MODEL`、`STORAGE_FULL`、`FILL_FAILED`。用
`grep -rn "<CODE>" --include=*.ts --include=*.tsx core entrypoints | grep -v "errorCopy\|messaging/types"` 验证，五个都是 0 命中。

前四个**不只是文案问题，是行为缺口**：

- `OFFLINE_NO_MODEL` —— 见 §5 D1，判据必须等真机复现出真实错误消息再写，**现在写正则是猜**
- `WEBGPU_CRASH` —— `generate` 抛错且 message 命中 `device lost` / `GPUDevice` 时应归此码而非笼统的 `WORKER_ERROR`，提示里给「切换兼容模式」的出路
- `STORAGE_FULL` —— 下载失败命中 `QuotaExceededError`，或下载前 `estimate` 剩余空间不足
- `PAGE_TOO_LONG` —— 截断时的行内交代，不是失败
- `FILL_FAILED` 是 v0.2 F-04 预留，v0.1 不触发，保留即可

建议新建 `core/inference/errorClassify.ts`（纯函数，可单测）承载分类判据。

### 4.2 错误文案仍散在三处硬编码（共 14 处）

- `entrypoints/sidepanel/usePageChannel.ts` 8 处（`:52`、`:113`、`:142`、`:170`、`:241`、`:263`、`:295`、`:320`）
- `entrypoints/sidepanel/components/ModelSetup.tsx` 5 处（`:160`、`:171`、`:260`、`:309`、`:332`）
- `entrypoints/sidepanel/useTaskRunner.ts` 1 处（`:231`）

`ERROR_COPY` 目前只有 `SettingsPanel.tsx:115` 一个消费者。全部改为读 `ERROR_COPY[code]`。

### 4.3 `StatusBanner` 组件尚不存在

四处横幅仍是内联 div。建议 props：

```ts
{ code: ErrorCode | null; tone?: 'error'|'warning'|'success'|'info';
  message?: string; onRetry?: () => void; action?: { label; onClick } }
```

分层不由调用方决定，由 `ERROR_COPY[code].tier` 决定。`StatusBanner` **只承载 `banner` 与 `inline` 两层**；传入 `tier === 'page'` 的五个码时开发构建 `console.warn` + 单测断言失败——把整页态压成一条小横幅是 §5.12 的明文禁令。`tier === 'turn'` 由 `Turn.tsx` 现有的 `.wisp-state-error` 承担，但文案改读 `ERROR_COPY`。

`retryable` 且传了 `onRetry` 才显示重试按钮——顺便让 `ErrorState.retryable` 这个「存在但渲染层从不读」的字段第一次生效。

### 4.4 播报重复隐患

UISpec §5.12 口径②要求**全面板只有一个 `aria-live` 区域**。当前违反：

- `TaskPanel.tsx:414` 的 `.wisp-sr-live`（`role="status" aria-live="polite"`）与同屏的 `role="status"` 横幅（`:381` 跨标签、`:406` 模型未就绪）共存
- `ModelSetup.tsx` 四处 `<section aria-live="polite">`（`:371`、`:391`、`:429`、`:453`）
- `SettingsPanel.tsx:367-368` 又有一处
- `App.tsx:69` 有一个 `role="status"` 横幅

同屏冲突时横幅应退化为无 `role` 的静态文本，由状态行统一播报。

### 4.5 其余 W3 项

- 键盘全流程走查（打开面板 → 初始化 → 启用页面 → 摘要 → 停止 → 复制 → 打开设置 → 返回），每步焦点可见
- `prefers-reduced-motion: reduce` 下进度条与加载态无动画
- **「不监视」措辞逐句核**：通读所有涉及页面来源的文案（含设置页隐私八条、划词来源行），这是阶段门 Pass 条件里明文列出的一项
- `style.css:31` 仍是 `body { min-width: 280px }`，而 UISpec §7 响应式下限档是 320px。280–319px 区间无规范无验收，需对齐

---

## 5. 待办：两条待复现的疑似缺陷（先复现，不要先改代码）

### D1 —— 离线时可能误删已下好的权重 ★

`entrypoints/sidepanel/components/ModelSetup.tsx:122-143` 的 cacheOnly 失败路径：

```
if (!isCacheRestoreFailure(e) && manifest!.backend === 'webgpu') → needs-user-choice（不清缓存）
否则 → clearCacheManifest() + purgeModelCacheEntries()  ← 会删掉权重
```

`core/inference/restoreFailure.ts` 的 `isCacheRestoreFailure` 只匹配 cache 类文案（`local_files_only` / `could not locate` 等），离线的网络错误不匹配 → `!isCacheRestoreFailure(e)` 为真 → 但该分支**只对 webgpu 放行**，`manifest.backend === 'wasm'` 会掉进清缓存分支。

**复现步骤**：断网 → 让首选后端为兼容模式且本地已有 WASM 权重 → 重开面板触发 cacheOnly 恢复。记录：报的是哪个错误码、缓存条目数清除前后各是多少、错误消息原文。**拿到错误消息原文之后**再写 `OFFLINE_NO_MODEL` 的判据。

### D2 —— `sidePanel.open()` 能否跨 CS→SW 继承手势 ★

即核对清单 A1。`await hydrated` 已经挪走（`background.ts:147-179`，open 在同步段），所以这次测的是真实结论而不是自己造成的假象。三选一结果都要如实记录，(B) 的话要贴 rejection 消息原文——这条直接决定设计文档 §10 仅存三处未决之一。

---

## 6. 待办：W4 回归集与阶段门

- `docs/回归集.md` 的 15 站表格待首轮实测填充。通过线 ≥12/15；11 判 Conditional；≤10 **判 Fail**
- 唯一补救：失败集中在 SPA 首屏未渲染时，在 CS 提取路径加一次 `requestAnimationFrame` 后重试再复测
- 时延指标（工具条 ≤150ms、点击到状态 ≤500ms、停止 ≤500ms/1s）：口径同阶段一，10 次 + P50/P95
- **跨上下文计时不能直接相减 `performance.now()`** —— CS 与 Panel 是两个 `timeOrigin`，必须用 `performance.timeOrigin + performance.now()` 合成绝对时间。这条不写清楚，「点击到状态 ≤500ms」这个数字没有意义
- README 回填 v0.1 实测章节与阶段门结论；设计文档 §6 补实测列、§10 勾掉已验证的 🔬 项

---

## 7. 待办：P8 扩展图标（需要资产）

`wxt.config.ts` 无 `icons`、无 `action.default_icon`，工具栏显示浏览器默认拼图；manifest description 仍是阶段一的「Wisp 本地推理阶段一验证 / Wisp stage-1 inference spike」。

需要 16/32/48/128 四档 PNG，建议暖象牙圆角方底 + 苔绿 W 或一条微光轨迹曲线。**PNG 资产需项目所有者提供**。在图标落地前，划词手势退路文案写的是「点击浏览器工具栏上的扩展图标」，不依赖图标识别度。

---

## 8. 施工时容易踩的坑（都是本轮实测踩到或避开的）

1. **`boundCtx` 有两份** —— `usePageChannel` 的 `boundCtxRef`/state 与 store 的 `boundCtx`，由 `commitBoundCtx` 同写。**绕过 hook 直接 `store.setBoundCtx()` 会让 `boundCtxRef` 停在 null**，于是 `EPOCH_INVALIDATED` 的守卫永远提前返回，该标签页刷新后任务绑定再也不会被作废。要绑定就走 `adoptCtx`。
2. **`hide()` 与 `teardownUi()` 不能混用**（`entrypoints/content.ts`）—— `showToolbar()` 内部只能调 `teardownUi()`。用 `hide()` 会清空刚赋值的 `pending`，工具条看起来正常但点击毫无反应。
3. **`createShadowRootUi` 的 overlay 定位陷阱** —— shadowHost 被设成 `position:relative` 并追加到 `document.body` 末尾。必须用 `position:fixed` + 视口坐标；`absolute` + `scrollY` 会让工具条掉到页面底部。
4. **WXT 自动加的 `:host{all:initial !important}`** 会盖掉 `applyPosition` 写的普通行内样式，需在 CSS 里重新钉死 `:host{display:block;width:0;height:0}`。
5. **`SYSTEM_PROMPT` 是 `Record<string, string>`** —— 缺 key 不报编译错，Worker 侧静默兜底成摘要提示词。新增 taskType 时 TypeScript 不会提醒你补 prompt。
6. **单活跃任务是抢占式** —— `useTaskRunner` 入口 `await stop()` 旧任务，不是拒绝新任务。
7. **`retentionDays === 0` 是合法值** —— 表示「关标签页即清」。任何校验用 `??` 不能用 `||`，否则会被当 falsy 打回 7。
8. **Port 是单槽位 + 8s 超时** —— busy 时直接 reject `PORT_BUSY`。`TOOLBAR_ACTION` 走 `chrome.runtime.sendMessage` 绕开这个约束，**保持现状不要改走 Port**。
9. **异步竞态的统一手法是 `attemptRef` 单调递增** + 每个 await 后比对。不要引入第三种手法。
10. **content script 体积** —— 引入 React 后从 40.6 kB 涨到 198.5 kB（gzip 64.6 kB）。退路明确且有界：工具条只有四个按钮两个状态、不依赖 React 的任何调度能力，改手写 DOM 可压回 ~45 kB。**没有实测数字之前不要改**（核对清单 B17 在量），两条阶段门时延指标都在注入之后计时，不受这段影响。

---

## 9. 并行施工的文件所有权

若继续用多代理并行，热点文件必须互斥。W3 的问题在于它要同时改 `TaskPanel.tsx` / `ModelSetup.tsx` / `SettingsPanel.tsx` / `Turn.tsx` / `usePageChannel.ts` / `style.css`，**不建议拆开并行**，单包独占更省事。

若必须拆，唯一安全的切法是：`core/inference/errorClassify.ts`（纯逻辑 + 单测）与 `StatusBanner.tsx`（纯组件 + 单测）先并行落地，UI 接线再串行做。

并行时代理**不要执行 git commit** —— 多路写同一个 index 会互相踩，且审查关卡应落在提交之前。

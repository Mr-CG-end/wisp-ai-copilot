# Wisp 收口计划：生成期负载、UI 高优先级偏差与设计文档契约回写

> 状态：可执行
> 基线分支：`feat/stage2-spike`
> 基线提交：`67387ea`（Task 9 会话存储已落地）
> 范围：当前工作区未提交改动的收口 + 两项已核实的 UI 高优先级偏差 + 设计文档契约回写
> 依据：`docs/Wisp_审查报告_设计文档与UI.md`
> 前置条件：无。四个任务彼此独立，可并行也可按序执行

## 1. 本次要解决什么

三件事，共同点是**都必须在 Task 11（划词工具条）开工前完成**：

1. **宿主页面在生成期间持续卡顿**。根因是推理与浏览器合成器争抢同一块集成显卡。无法根除，只能压负载。当前工作区已有的性能档位改动方向正确，但把打字机动画留在了均衡档、并把档位标签放错了位置，需要收口。
2. **两项已核实的 UI 高优先级偏差**。来源标识滚动后离开视口（违反「来源必须常驻」的产品语义）；流式期间渲染的是 Markdown 源码（违反「StreamMarkdown 是唯一渲染出口」的硬约束）。
3. **设计文档的消息契约、推理契约、面板状态三块已大面积滞后于实现**。Task 11/12 的划词链路要直接读 §2.1 施工，滞后契约会直接导致返工。

不在本次范围：设置页 / 划词工具条 / 错误矩阵三块规范空白（属 Task 10~13）、UISpec 升版、扩展图标资产、深色模式定版、十余项低优先级令牌偏差（裁决建议见 §8，供后续 UISpec 升版取用）。

## 2. 实现依据与冲突处理

解释顺序沿用 M2 实现计划：

1. `docs/Wisp_需求文档.md`：产品边界、隐私和验收标准
2. 本计划：本次四个任务的改动范围与验证口径
3. `docs/Wisp_M2_实现计划.md`：M2 既有硬约束（唯一 Worker、唯一渲染出口、store 是产品状态唯一来源）
4. `docs/ui/Wisp_M2_UISpec.md`：布局、视觉令牌、文案

设计文档回写以**代码为准**——`core/messaging/types.ts`、`core/inference/contract.ts`、`entrypoints/sidepanel/store.ts` 是契约真源，文档向它们看齐，不反向改代码。

## 3. 执行规则与提交边界

四个任务各自独立提交。每个任务提交前执行：

```powershell
npm test
npx tsc --noEmit
npm run build:dev
```

Task A 与 Task B 涉及生成链路与布局，还需 Chrome 真机验收：加载 `.output/chrome-mv3-dev` 静态构建，不使用 `npm run dev` 的跨来源热更新 Worker。

不引入新依赖。不重构本次改动范围之外的代码。

---

## 4. Task A：生成期负载收口

合并三项审查发现：卡顿优化 §1.4-B/C、UI 规划 P-4、UI 偏差 U-2。这三项在实现上高度收敛——删掉打字机动画同时解决了「违反唯一渲染出口」「每帧重排加剧 GPU 负载」两个问题，并让 `PerformanceConfig` 少一个字段。

### 4.1 文件

修改：

- `core/panel/performance.ts`
- `core/panel/performance.test.ts`
- `entrypoints/sidepanel/store.ts`
- `entrypoints/sidepanel/store.test.ts`
- `entrypoints/sidepanel/App.tsx`
- `entrypoints/sidepanel/components/TaskPanel.tsx`
- `entrypoints/sidepanel/style.css`

### 4.2 删除打字机动画，流式期间改走 StreamMarkdown

**为什么删**，三条理由缺一不可：

- 生成期间渲染的是 `content.slice(0, visibleLength)` 纯文本，用户会看到 `##`、`**` 等源码符号，完成瞬间才切换为渲染态、版式跳变。这违反 M2 实现计划「`StreamMarkdown` 是模型输出唯一渲染出口」与阶段二计划「禁止直接渲染原始文本」两条硬约束。
- 动画以 60fps 逐帧 `setVisibleLength`，每帧触发一次增长中文本块的重排。面板虽是独立渲染进程，但与宿主网页共用同一个 GPU 进程做合成，在集显上直接叠加到卡顿上。
- 流式输出**本身已经是逐步到达的**。28 tok/s 下文本增长足够平滑，动画不带来可感知收益——它补的是一个并不存在的间隙。

**改法**：`ProgressiveOutput` 去掉 `animate` prop、`visibleLength` state 与整个 `requestAnimationFrame` 循环，收敛为：

```tsx
const ProgressiveOutput: React.FC<{
  content: string;
  complete: boolean;
  sourceChars: number;
}> = ({ content, complete, sourceChars }) => {
  if (!content) return <GenerationPrelude sourceChars={sourceChars} />;
  return (
    <div className="wisp-progressive-output">
      <StreamMarkdown content={content} />
      {complete ? null : <span className="wisp-cursor" aria-hidden="true" />}
    </div>
  );
};
```

配套：

- `style.css` 删除 `.wisp-stream-text`（第 864-867 行，随动画一起失去用途）
- 光标从「inline 跟在文字后」变为「Markdown 块之后的独立元素」。先用上面的简单写法；若真机上光标脱离最后一行显得突兀，改用 `.wisp-progressive-output.is-streaming .wisp-markdown-container > :last-child::after` 伪元素跟随最后一个块，不要为此引入测量逻辑。
- `prefers-reduced-motion` 分支不再需要在此组件内单独处理——全局媒体查询（`style.css:1197`）已覆盖光标闪烁。

**已知取舍**：流式期间会重复解析增长中的 Markdown（按 `streamFlushIntervalMs` 节流，省资源档 120ms、均衡档 60ms，即每秒 8~16 次），且可能短暂渲染未闭合的语法（如尚未配对的 `**`）。react-markdown 对未闭合语法降级为字面量，可接受。相比原先每秒 60 次的全文本重排，总成本更低。

### 4.3 从 `PerformanceConfig` 删除 `animateStreamingText`

字段随动画一起删除：`core/panel/performance.ts` 的接口与两档配置各删一行，`performance.test.ts` 删除 `expect(saver.animateStreamingText).toBe(false)` 断言。

### 4.4 简化档位初选（删死代码，行为不变）

`selectInitialPerformanceProfile` 的判据 `deviceMemoryGb <= 8 || hardwareConcurrency <= 8` **在所有 Chrome 上恒为真**——`navigator.deviceMemory` 的规范取值集合是 0.25/0.5/1/2/4/8，上限就是 8，16GB 设备也报 8。函数注释显示作者已知这一点并有意借此保守起步，但代码的实际效果比注释暗示的更绝对：`balanced` 在初选阶段不可达，只能由 `selectProfileAfterSample` 按实测升档。

`backend === 'wasm'` 那条分支同样冗余——初始既然一律 `resource-saver`，WASM 想升到 `balanced` 需要 `tokensPerSec >= 18`，而实测 WASM 只有 8.2 tok/s，永远达不到。

**改法**（删除，不是改逻辑，行为完全不变）：

- 删除 `selectInitialPerformanceProfile` 与 `DeviceSignals` 接口
- `PERFORMANCE_CONFIGS` 上方补一行注释：一律从省资源档起步，由 `selectProfileAfterSample` 按真实速度与帧间隔升档
- `performance.test.ts` 删除整个 `describe('selectInitialPerformanceProfile')` 块
- `TaskPanel.tsx` 删除 `navigator.deviceMemory` / `hardwareConcurrency` 探测，初始值直接取 `'resource-saver'`

### 4.5 档位状态提升到 store，标签从页面栏归位到顶栏

**为什么提升到 store**：档位直接决定送入模型的上下文预算（1000↔1400 字）与输出上限，属产品状态而非「输入框文本、焦点、按钮按下」这类短生命周期 UI 状态，按 M2 实现计划的 store 契约就该进 `usePanelStore`。而且 Task A 要让 `App.tsx` 的顶栏读到它，本来也需要一个跨组件的来源。

`store.ts` 增加：

```ts
performanceProfile: PerformanceProfile;              // 默认 'resource-saver'
setPerformanceProfile: (profile: PerformanceProfile) => void;
```

`store.test.ts` 补一条：默认值为 `'resource-saver'`，`setPerformanceProfile` 生效且不影响其他字段。

**为什么标签要从页面栏搬走**：`wisp-page-meta` 那一行按 UISpec §5.5 只承载**页面快照事实**（字数、提取范围、重新读取），档位是运行时属性。更要紧的是档位会在每次生成后被自动校准悄悄切换，直接改变送入模型的内容规模，埋在元信息行里用户几乎不会察觉。320px 下这个标签还会把 meta 行挤到第三行，撞上 UISpec §7 的密度约定。

改法：

- `TaskPanel.tsx` 从 `wisp-page-meta` 删除档位标签及其分隔点
- `App.tsx` 的 `statusLabel` 就绪态扩展为第三段：省资源档显示 `本地 · WebGPU · 省资源`，均衡档**不显示第三段**（保持 `本地 · WebGPU`）——只在偏离默认时发声，顶栏保持安静
- 自动切换不弹提示，只更新顶栏文本

**保留不动**：上下文栏的「已读取前 N 字」必须始终等于本次实际送入模型的字符数（现已如此）。这是档位对用户唯一必须可见的后果。

### 4.6 校准口径注记

`maxFrameGapMs` 测的是**面板自己的 rAF 帧间隔**。改走流式 Markdown 后，该指标会同时包含面板的 Markdown 解析成本，不再是纯粹的 GPU 争用信号——`selectProfileAfterSample` 的 80ms 降档阈值有可能被面板渲染而非 GPU 争用触发。

本次**不改阈值**（降档的方向无论如何是对的），但在 `performance.ts` 的 `PerformanceSample` 上补一行注释写明这一点，避免后续把它当成 GPU 争用的精确度量。

### 4.7 验证

```powershell
npm test
npx tsc --noEmit
npm run build:dev
```

Chrome 真机（加载 `.output/chrome-mv3-dev`）：

- [ ] 生成摘要期间，输出以 Markdown 层级呈现，全程看不到 `##` / `**` 源码符号
- [ ] 生成完成瞬间无版式跳变
- [ ] 页面栏第三行只剩「字数 · 提取范围 · 重新读取」
- [ ] 顶栏显示 `本地 · WebGPU · 省资源`；若某次生成后升到均衡档，第三段消失
- [ ] 在长文章页生成时，主观对比宿主页面滚动流畅度（与改动前对照）

提交：`perf: 收敛生成期渲染负载并统一档位来源`

---

## 5. Task B：来源标识常驻

> **本任务已取消**，被 `docs/superpowers/specs/2026-07-27-wisp-thread-ui-design.md` §5.2「只 sticky 快照凭证」取代——顶部固定占用 78px 优于本方案的 132px。下文保留备查。

对应 U-1。UISpec §5.5 要求上下文栏「位于工具栏下方并始终可见」，§2 更把「只要存在页面快照，来源标识必须常驻」列为产品语义。但 `.wisp-page-bar` 无 `sticky`——而顶栏与底部提问栏都有——长输出或多轮历史滚动后，来源标识完全离开视口。

### 5.1 文件

修改：`entrypoints/sidepanel/style.css`

### 5.2 改法

`.wisp-page-bar`（第 587 行起）增加：

```css
position: sticky;
top: 44px;          /* 顶栏高度 */
z-index: 1;         /* 低于顶栏的 z-index: 2 */
```

背景已是 `color-mix(in srgb, var(--wisp-surface) 62%, var(--wisp-bg))`，两侧均为不透明色，无需额外处理透明度。

**已知代价**：顶部固定占用从 44px 增至约 132px（顶栏 44 + 上下文栏 88）。在较矮的浏览器窗口里这个比例偏高。更精细的方案是用 `IntersectionObserver` 哨兵在滚动后切换到单行压缩态，但那要引入 JS 与新的状态，成本明显更高。**本次先做简单方案**，压缩态列为 M4 收口时按真机观感再评估的选项——不预先实现。

### 5.3 验证

```powershell
npm test
npx tsc --noEmit
npm run build:dev
```

Chrome 真机，320 / 360 / 500 三种宽度各截图：

- [ ] 滚动到长输出底部时，来源栏仍固定可见
- [ ] 来源栏不遮挡结果区内容，与底部提问栏无重叠
- [ ] 无横向滚动
- [ ] 顶栏与来源栏之间无缝隙、无穿透（z-index 层次正确）

提交：`fix: 让页面来源标识在滚动时常驻`

---

## 6. Task C：正文提取降级路径守卫

对应审查报告 §1.5。`extractArticle` 用 `MAX_DOM_NODES = 12000` 挡住了 readability 处理巨型页面，但超限后走的降级路径 `heuristicText` 依然 `doc.cloneNode(true)` **全量克隆整个巨型 DOM**——上限挡住了 readability，没挡住降级路径自身的成本。该函数在宿主页面主线程同步执行，几万节点的页面上会造成明显的一次性冻结。

用户本次反馈的不是这个场景，但这是真实缺陷，且与 Task A 同属「别让插件卡住用户的页面」。

### 6.1 文件

修改：`core/extract/article.ts`、`core/extract/article.test.ts`

### 6.2 改法

`heuristicText` 改为**完全不克隆**：用 `document.createTreeWalker` 遍历文本节点，遇到 `STRIP_SELECTOR` 匹配的元素时整棵子树跳过（`NodeFilter.FILTER_REJECT`），累加文本。

要点：

- 不克隆、不修改宿主 document——原实现靠「在克隆上删节点」保证不污染页面，TreeWalker 天然只读，这个保证更强
- 保留原有的 `main` → `article` → `body` 根节点定位顺序，从定位到的根开始遍历
- 累计字符数达到一个上限即提前退出（建议与既有截断预算同量级，取整数常量并注释理由）——巨型页面本来也只有前若干字会被送进模型
- `normalizeText` 与返回结构不变

### 6.3 验证

```powershell
npm test
npx tsc --noEmit
```

`article.test.ts` 补充用例：

- [ ] 降级路径跳过 `script` / `style` / `nav` / `footer` 等 STRIP_SELECTOR 元素内的文本
- [ ] 调用后宿主 `document` 未被修改（断言被跳过的元素仍在 DOM 中）
- [ ] 超长文档在字符上限处截断，仍返回 `method: 'heuristic'`
- [ ] `main` / `article` / `body` 三种根节点定位顺序保持原行为

提交：`perf: 正文提取降级路径不再克隆整棵 DOM`

---

## 7. Task D：设计文档契约回写

纯文档任务，不动代码。以 `core/messaging/types.ts`、`core/inference/contract.ts`、`entrypoints/sidepanel/store.ts` 为真源逐节对读回写。

### 7.1 文件

修改：`docs/Wisp_设计文档.md`、`docs/Wisp_阶段二开发计划.md`

### 7.2 `docs/Wisp_设计文档.md` 逐节改动

| 节 | 改动 | 对应发现 |
|---|---|---|
| 文档信息表 | 状态从「草案，等待阶段一技术验证回填实测数据」改为反映实测已回填、阶段门 Pass；更新日期改为回写当日 | D-13 |
| §1.3 目录结构 | `core/` 补 `panel/`、`render/`、`bench/`；删除根级 `components/` 与 `assets/`（组件实际在 `entrypoints/sidepanel/components/`）；sidepanel 条目补 store 与 hooks 文件 | D-10 |
| §2.1 消息协议 | 四组 union 全部按 `types.ts` 重写：`EXTRACT`/`GET_SELECTION` 补 `epoch`；`PanelToContent` 删 `PING`；`EXTRACTED` 去 `url`、加 `method`；新增 `PAGE_NAVIGATED` 并写明动机（SPA History 导航不销毁 CS、也不一定触发 `tabs.onUpdated`）；`TOOLBAR_ACTION` 改为 `{action,text,url,lang}` 并说明 `ctx` 由 SW 权威组装的理由（CS 不可信、也拿不到 epoch）；`ACTIVE_TAB` 去 `url` 并写明权限理由；`PENDING_ACTION` 加 `id`；`PanelToBackground` 补 `ENSURE_CONTENT_SCRIPT` 与 `TAB_CLOSED_CLEANUP` | D-1~D-3 |
| §2.1 新增小节 | 「runtime 响应体」：`ActiveTabInfo` / `EnsureContentScriptResult` / `PanelReadyResult` / `PendingActionEntry`，说明这几条走 `sendResponse` 而非广播 | D-3 |
| §2.1 握手段落 | 改写为双路径投递 + `id` 去重：面板已开时收到 `TOOLBAR_ACTION` 即广播，冷启动时经 `PANEL_READY` 的 `sendResponse` 拉取；补 `sidePanel.open()` 失败时的 `OPEN_PANEL_HINT` 降级路径（并说明该 SW→CS 消息目前不在任何 union 内） | D-4 |
| §2.1 epoch 权威 | 触发源写明为 `tabs.onUpdated(status:'loading')` + CS 上报 `PAGE_NAVIGATED` 双通道（`webNavigation` 是独立权限，未申请）；补 epoch 经 `chrome.storage.session` 持久化以跨 SW 回收 | B2 |
| §2.2 新增小节 | 「性能档位」：两档配置表、一律省资源档起步、按 `GenStats` + `maxFrameGapMs` 校准的阈值；并注明 `maxFrameGapMs` 是面板帧间隔而非纯 GPU 争用信号 | D-7 |
| §2.2 Settings | 校准：`outputLength` 从未实现，与档位机制职责重叠——裁决为**由档位机制取代**，`Settings` 接口标注为 Task 10 落地时按实际需要重定义；当前 `chrome.storage.local` 只有裸键 `retentionDays` | D-7 |
| §2.2 隐身模式 | 改为「隐身上下文完全跳过会话持久化，不建内存会话对象」；`Session.incognito` 标注为保留字段、当前恒为 false | D-11 |
| §2.2 级联清理 | 代码块补齐 `selectExpiredSessionIds` / `purgeExpired` / `purgeByTab` / `appendMessage` 签名，并说明 `appendMessage` 是 Panel 侧写消息的唯一入口（同事务维护 `updatedAt`） | D-12 |
| §2.3 | `LoadProgress` 加 `pct`（注明自检通过才为 100）；`InitConfig` 加 `cacheOnly`（缓存命中时离线自动恢复，禁联网重下）；`getStatus` 补三个诊断字段 | D-5 |
| §3.3 | `PanelState` 按 `store.ts` 重写（7 态 `modelStatus`、`modelBackend`、`downloadPct`、`page` 增 `ctx`/`text`/`method`、`currentTask` 增四字段、`error.retryable`、`performanceProfile`）；**明确写出**：store 中没有 `session`，会话不进 UI store，Panel 生成成功后 `ensureSession` + `appendMessage` 直接落 Dexie，UI 只保留最近 20 条 `TaskHistoryEntry` | D-6 |
| §3.3 补段 | Worker 所有权：`InferenceProvider` 是全应用唯一持有者，组件/标签/任务切换均不重建；`StreamMarkdown` 是模型输出唯一渲染出口 | D-16 |
| §4.1 | 时序图拆成「首次下载」与「缓存自动恢复」两条路径，补 `ModelCacheManifest` 与 `cacheOnly` / `local_files_only` 约定 | D-9 |
| §4.3 | 时序图改为双路径投递 | D-4 |
| §5 | `ErrorCode` 补 `PAGE_PERMISSION_REQUIRED`；异常矩阵加一行（触发点：`ENSURE_CONTENT_SCRIPT` 注入被拒且判定为缺 activeTab 授权；产品行为：引导点击工具栏图标授权，与 `PAGE_INJECTION_BLOCKED` 的浏览器硬限制区分） | D-8 |
| §8.2 | 样式行改为「Panel 用普通 CSS；工具条独立 CSS 注入 Shadow Root」；测试行改为「Vitest（现行）；Playwright E2E 推迟至阶段三评估」；§3.3 删去 `rehype-highlight` 或标注为未引入 | B3、D-15、D-17 |
| §10 与正文 | 对每个已 `[x]` 的验证项，把正文对应位置的 🔬 改写为「已验证：结论摘要（见 §10）」。🔬 只保留三项真未决：工具条 150ms、readability 成功率、手势跨消息往返 | D-14 |

### 7.3 `docs/Wisp_阶段二开发计划.md` 改动

- §0.1 进度表：Task 9 已由 `67387ea` 完成，补一行状态与证据；「Task 9～14 待执行」改为「Task 10～14 待执行」
- §2.1 有意偏差表：B1 / B2 / B3 三处本次一并回写完毕，逐条标注「已回写」并注明回写提交
- Task 14 Step 6 相应减负：原定的「阶段末回写设计文档」只剩校对，不再有待回写内容

### 7.4 验证

文档任务无法跑测试，验证方式是逐项对读：

- [ ] §2.1 的四组 union 与 `core/messaging/types.ts` 逐字段一致（含注释所述动机）
- [ ] §2.3 的 `InferenceApi` 与 `core/inference/contract.ts` 逐字段一致
- [ ] §3.3 的 `PanelState` 与 `entrypoints/sidepanel/store.ts` 逐字段一致
- [ ] §5 `ErrorCode` 枚举与 `types.ts:19-24` 逐项一致
- [ ] 全文 🔬 计数为 3，且三处均为真未决项
- [ ] `docs/Wisp_阶段二开发计划.md` §2.1 三处偏差均已标注「已回写」

提交：`docs: 回写设计文档契约与阶段状态`

---

## 8. 附录：UI 偏差逐项裁决建议（本次不实施）

供 UISpec 升版时取用。原则：**有实际使用理由的保留实现、回改规范；纯粹漂移的回归规范。**

| 编号 | 项目 | 裁决 | 理由 |
|---|---|---|---|
| U-3 | 结果操作栏位置 | **规范让步** | 「停止」必须在长输出流式滚动时无需下拉即可点到。规范的「输出下方」在短输出时成立，长输出时反而劣化。UISpec §5.7 改为「操作栏位于输出区顶部工具行」 |
| U-4 | 边注栏 54px vs 28px | **规范让步** | 28px 是英文语境下的数值；中文任务标签（「摘要」「翻译」）竖排在 28px 内过于局促。规范改为 54px / 320px 档 42px |
| U-5 | 发送按钮 36×38 | **实现让步** | 规范要求方形是对的，取输入框高度做成 38×38 即可 |
| U-6 | 按钮 13px；`btn-sm` 28px/6px/12px | **各让一步** | `.wisp-btn` 回归 14px；`btn-sm` 保留并在规范补「小型按钮」层级——结果区工具行确实需要更紧凑的一档 |
| U-7 | 初始化大标题 24px | **规范补层级** | 初始化页是全屏单栏，24px 层级合理 |
| U-8 | favicon 30px vs 20px | **规范让步** | 88px 高的上下文栏中 30px 比例更稳。同时明文规定不发起网络请求获取真实 favicon，守住四项权限红线 |
| U-9 | 主体间距 12px vs 16px | **规范让步** | 任务工作区按工具密度设计，规范补「任务工作区允许 12px 紧凑间距」 |
| U-10 | 进度文案 `38.0%` 左右分列 | **实现让步** | 改为整数百分比、`·` 连接的单行，与规范示例一致 |
| U-11 | 提问栏背景 `--wisp-bg`、阴影 0.06 | **实现让步** | 背景改 `--wisp-surface`；阴影透明度对齐 0.09，规范注明向上投影变体 |
| U-12 | 多处 11px、一处 10px | **各让一步** | 规范补「微文本 11px」层级；10px 那一处直接取消 |
| U-13 | muted 对比度 4.39:1 | **两边同改** | 这是规范自身令牌与无障碍要求的矛盾。`--wisp-text-muted` 加深至约 `#5F675E`（过 AA），规范 §4.1 同步改值 |
| U-14 | `aria-live` 范围过宽 | **实现让步** | 收窄到状态行，正文容器不设 live region，完成时用 `role="status"` 播报一次。流式每 60ms 触发一次读屏播报是实打实的可用性缺陷 |
| U-15 | 会话历史与 M2 禁令 | **规范澄清** | 禁令仅指「跨会话历史浏览页」。规范补「当前会话多轮展示」的组件定义 |
| U-16 | 归档条目无状态标记 | **实现让步** | 归档时保留 status，历史条目 header 渲染「已停止 / 未完成」——被中断的半截回答不能与完整回答长得一样 |
| U-17 | 两个横幅样式逐字重复 | **实现让步** | 合并为共享 class |
| U-18 | 微光轨迹用法越界 | **规范澄清** | 说明初始化页的引导装饰线与品牌微光轨迹是否同一语汇 |
| U-19 | 占位文本规范内部冲突 | **规范自我统一** | 保留「基于这份快照提问…」，同步改 §5.3 与 §6.3 样例 |

## 9. 完成判定

Task A / C / D 三个任务全部提交（Task B 已取消，见 §5），且：

- `npm test` / `npx tsc --noEmit` / `npm run build:dev` 全绿
- Task A、B 的真机验收清单逐项勾选
- 设计文档 §2.1 / §2.3 / §3.3 与代码逐字段一致（Task 11 可直接照 §2.1 施工）
- 工作区无未提交改动

达成后即可开工 Task 10。

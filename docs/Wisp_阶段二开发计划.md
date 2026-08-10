# Wisp —— 阶段二 v0.1 MVP 开发计划（对应 PRD v0.3 §13 阶段二 · Design v0.2）

> 本文是 `Wisp_需求文档.md`（PRD v0.3）阶段二、`Wisp_设计文档.md`（Design v0.2）v0.1 详设的落地计划。阶段一 Spike 已判定 **通过 (Pass)**，本阶段把已验证的推理内核包装成可演示的 v0.1 MVP：**F-01 首次初始化与模型管理 + F-02 网页提取/摘要/问答 + F-03 划词即时操作**，外加消息通道、会话存储、设置与错误矩阵。

> **M2 执行入口**：Task 5～8 已在 `Wisp_M2_实现计划.md` 中收口为可独立委派的实施计划。两份文档在 M2 范围内冲突时，以该独立计划为准；Task 9～14 继续以本文为准。
>
> **给执行者（含 AI 代理）**：本文按任务顺序逐个执行，步骤用 `- [ ]` 复选框标记进度。纯逻辑任务先写失败测试再实现（TDD），浏览器行为任务写完代码后按验收清单在 Chrome 真机核对。每个任务末尾独立提交。

| 文档信息 | 内容 |
|---|---|
| 状态 | 可执行（v0.1.1 闭合首轮审查的 5 个阻断问题与 3 个验收缺口；v0.1.2 闭合次轮审查的产品语义与裁剪一致性问题） |
| 版本 | v0.1.2 |
| 范围 | 阶段二 v0.1 MVP（PRD §3 P0 全量 · §4 F-01～F-03 验收标准 · §13 阶段二通过条件） |
| 上游 | PRD v0.3（`Wisp_需求文档.md`）· 设计文档 v0.2（`Wisp_设计文档.md`）· 阶段一计划（`Wisp_阶段一技术验证计划.md`） |
| 作者 | Mr-CG-end |
| 创建日期 | 2026-07-25 |
| 更新日期 | 2026-07-25 |
| 交付物 | 可载入 Chrome 的 v0.1 扩展：初始化模型 → 读取网页 → 流式摘要/追问 → 划词四操作 → 会话与设置管理；固定回归集实测数据回填 README |
| 执行约定 | TDD（纯逻辑先测后写）· 频繁小步提交 · 提交不加署名尾行，作者 Mr-CG-end |
| 阶段门 | F-01～F-03 验收通过 + PRD §14.1 六步 Demo 可无剪辑连续录制 |

> **v0.1.1 修订（吸收外部审查第一轮）**：修复划词工具条 `pending` 被 `hide()` 清空导致点击无动作、面板已打开时 `PENDING_ACTION` 无生产端、`bindActiveTab → readPage` 的 React state 竞态、生成任务并发覆盖状态四处阻断缺陷；`epoch` 改为跨 Service Worker 重启持久化并补 SPA History 导航检测；工具条防抖 180ms → 70ms 以满足 ≤150ms 指标；补齐 P0「基础隐私说明」交付项；性能测量口径统一为 10 次 + P50/P95（与阶段一一致）；新增 §0 里程碑与裁剪顺序。

> **v0.1.2 修订（吸收外部审查第二轮，产品语义）**：把**快照语义**确立为贯穿全阶段的核心约定（正文只在 `readPage()` 那一刻取一次，此后生成读内存字符串，不再触碰页面），并据此校正三处：① 来源标识改为**常驻**，不再只在生成中或切标签时出现；② 横幅文案禁止「仍在…继续」这类暗示持续读取页面的措辞，改为「正在基于《标题》的已读取内容生成」；③ 「改读当前页」补齐五项状态迁移规定（停旧任务 / 保留旧结果并标注 / 切换会话 / 清空追问输入 / 读取失败不改变绑定）。同时消除裁剪表与阶段门的矛盾：四个划词动作改为不可裁剪，并明确"裁剪表外的任何 F-01～F-03 内容被砍即降为 Conditional"；新增验收项全部改写为「场景 → 预期结果」表格。

---

## 0. 里程碑、进度与裁剪顺序

### 0.1 当前进度

| 阶段 | 状态 | 证据 |
|---|---|---|
| Task 1～4 (M1) | 已完成 | 单测 11/11 覆盖，Types/SW/Extract/Port 页面读取链路打通且 WXT 打包无错 |
| Task 5～8 (M2) | 已完成 | 状态容器 (ce1f5f3) + 缓存恢复 (d1e6d52) + 安全渲染 (91f60c6) + 摘要追问 (871e69d)，单测 18/18 (91 项) 全绿，WXT 生产/开发构建均打通 |
| Task 9 | 已完成 | 会话存储与级联清理 (67387ea)：Dexie `sessions`/`messages` + `appendMessage` 同事务维护 `updatedAt`，隐身上下文完全跳过持久化 |
| M2 收口 | 已完成 | 生成期渲染负载收敛与档位统一 (d9cb8f0) + 正文提取降级路径不再克隆 DOM (4c46fa4) + 设计文档契约回写 (f5b64b4)。详见 `Wisp_M2收口与设计文档回写计划.md`；其中 Task B（来源标识常驻）已取消，由轨迹 UI 的「只 sticky 快照凭证」取代 |
| 轨迹 UI 重构 | 已完成 | 计划外插入的一轮 UI 升级，11 个提交 (2253101～e427c7a)：新增纯函数投影层 `core/panel/thread.ts` 把 store 三字段合成轮次数组，渲染层拆出 `Thread`/`Turn`/`SnapshotStamp`，`PageInfo` 增 `readAt`，UISpec 升 v3。依据 `docs/superpowers/specs/2026-07-27-wisp-thread-ui-design.md`，实施脚本见 `docs/superpowers/plans/2026-07-27-wisp-thread-ui.md` |
| 审查报告后续修复 | 已完成 | 8 个提交 (25d8fb8～aa82727)：摘要选段排除无语义短行与预留开头预算、摘要提示词先给主旨句并匹配正文语言、正文抽取保留块级边界、接入正文抽取质量评测（需外部语料，未安装时整组跳过）、申请常驻主机权限并修正模型体积显示 |
| 测试基线 | — | 31 文件 176 项通过 1 项跳过（跳过的是需外部 clone 语料的抽取评测 bench），`tsc --noEmit` 与 `build:dev` 均通过 |
| M3 第一波 (W1) | 已完成 | 四个纯逻辑包并行落地，5 个提交 (a23ef5b～6638fe5)：① UISpec 升 v3.1 补 §5.11 设置页与 §5.12 错误分层矩阵；② `BackgroundToContent` 消息契约 + `PendingActionEntry.lang` 透传 + `core/panel/errorCopy.ts` 十四码文案分层表；③ `core/storage/settings.ts`（三字段，无 `outputLength`）+ `usage.ts` + `countModelCacheEntries`；④ `core/extract/selection.ts`/`sensitive.ts` + `core/panel/selectionBudget.ts`/`toolbarPosition.ts`；⑤ store 归档判据修正。测试 38 文件 280 项通过 1 跳过，`tsc --noEmit` 退出码 0 |
| M3 第二波 (W2) | 代码已落地，**待真机核对** | 三个包并行，3 个提交 (700d69f～983fcbd)：① F-03 划词交付握手——`sidePanel.open()` 重排到手势同步段、`PANEL_READY` 握手与两路投递按 id 去重、`adoptCtx` 统一绑定提交、TaskPanel 拆三段使无快照时也能渲染轨迹；② Shadow DOM 工具条——`createShadowRootUi` + 内联 CSS 字符串（零 WAR）、`position:fixed` 视口坐标、选区监听移出 `onConnect`；③ 设置页——视图优先切换、后端首选项与重新加载、行内两步确认的清除数据、隐私说明八条。测试 39 文件 300 项通过 1 跳过，`tsc --noEmit` 与 `npm run build` 均通过。**约 45 项真机核对未执行**，见 §0.1.2 |
| Task 10～14 | 部分执行 | 已按 M3/M4 方案重划分为 9 个工作包，W1/W2 代码完成，W3（错误分层收口与可访问性）、W4（回归集与阶段门）待启动。本文三处失效内容见下方 §0.1.1 |

> 执行时每完成一个任务，在此表补一行状态与证据（沿用阶段一文档的进度同步方式）；Task 14 完成后在本节写入阶段门结论。

### 0.1.2 W2 的真机核对

W2 的三个包共欠 46 项真机核对，已整理成 `docs/Wisp_M3_真机核对清单.md`（按划词交付 / 工具条 / 设置页 / 待复现缺陷 / 待补资产 五组，标 ★ 的会影响阶段门判定）。其中 A1 的结果直接决定设计文档 §10 仅存三处未决之一（`sidePanel.open()` 能否跨 CS→SW 继承手势）——`sidePanel.open()` 已重排到手势同步段，因此这次测得的是真实结论，不再是 `await hydrated` 造成的假象。

**提取回归集探底并入同一轮测试**：`docs/回归集.md`（15 站骨架，8 中 + 2 英 + 5 SPA，按 DOM 结构脏度排序）已建好，与 W2 真机核对合并执行。提前到此处而非留到 Task 14，是因为提取成功率 <70% 直接判 Fail，而唯一的补救（CS 里加一次 rAF 后重试）需要时间——等 W3 之后再探底就来不及了。

**演示视频不录制**，阶段门原文的「六步 Demo 可无剪辑连续录制」改为开发者手动连跑 10 轮走查，README 如实记录未录制。

### 0.1.1 Task 10～14 的三处失效内容（执行前必读）

本文定稿于 2026-07-25，此后设计文档回写与外部审查推翻了其中三处。**§4 的 Task 10～14 与下表冲突时，以下表为准。**

| # | 本文原文 | 现行做法 | 依据 |
|---|---|---|---|
| R1 | Task 10 Step 2/5/8 创建 `core/panel/outputLength.ts` 与 `maxNewTokensFor()`，`Settings` 含 `outputLength` 字段，并改 `TaskPanel.tsx` 接入 | **整体裁撤**。该模块不建，`Settings` 只保留 `backend` / `retentionDays` / `modelId`，Task 10 完全不改 `TaskPanel.tsx` | `Wisp_设计文档.md` §2.2「`outputLength` 已删除，由性能档位机制取代……保留两套并存只会产生『用户选了 long 但档位把它压回 256』这类无法解释的行为」 |
| R2 | §0.3 把 Task 10 的「后端切换」下拉列为**可裁剪 1** | **不可裁剪**。且 WASM 选项下必须补两句说明：不占显卡因而网页更流畅；与 WebGPU 用不同量化文件，切换需另外下载约 618 MB | 审查报告 §1.4-D 把 WASM 从「故障兜底」升格为集显用户的正当选择；第二句是防止一次点击触发巨型下载 |
| R3 | Task 10 Step 7 调用 `selectModelCacheUrls` 统计缓存条目数 | 该函数**不存在**（实际导出是语义不同的 `snapshotModelCacheUrls`）。需在 `core/inference/modelCache.ts` 新增 `countModelCacheEntries` | 代码核实 |

> 另有两条待复现的疑似缺陷，进入 M3 施工前先按「先复现再定根因」处理，不基于假设改代码：① `ModelSetup.tsx` 的 cacheOnly 失败路径在 `manifest.backend === 'wasm'` 时会走到 `purgeModelCacheEntries`，可能删掉已下好的权重；② `background.ts` 的 `TOOLBAR_ACTION` 把 `sidePanel.open()` 包在 `void hydrated.then()` 里，这个 await 可能就是手势丢失的元凶——必须先改成同步调用再验证「手势能否跨 CS→SW」，否则测出的是自己造成的假结论。

### 0.2 里程碑分组与每组阶段门

单人约一周周期，按四个里程碑推进。**每组末尾是一个可停可交的状态**——若时间不足，可以在任一里程碑收尾处停下交付，而不是留下 14 个半成品。

| 里程碑 | 任务 | 组内阶段门（达成即可进入下一组） | 建议投入 |
|---|---|---|---|
| M1 通道打通 | 1、2、3、4 | 侧边栏能读到任意普通文章页的标题与正文，受限页面有明确提示 | 约 1.5 天 |
| M2 网页问答闭环 | 5、6、7、8 | 初始化模型 → 摘要 → 追问 → 停止 全链路可演示，输出经安全渲染 | 约 2 天 |
| M3 划词与数据管理 | 9、10、11、12 | 划词四操作可用；会话按策略保留/清理；设置与隐私说明齐备 | 约 2 天 |
| M4 收口与实测 | 13、14 | 六态矩阵无缺口；回归集与阶段门数据回填 | 约 1.5 天 |

### 0.3 时间不足时的裁剪顺序

从后往前砍，**红线项不可裁剪**：

| 优先级 | 内容 | 裁剪后果 |
|---|---|---|
| 可裁剪 1 | Task 10 的「后端切换」下拉（保留输出长度/保留时长/清除数据/隐私说明） | 用户无法手动指定后端，仍可在 WebGPU 失败时显式选 WASM。不属于 F-01～F-03 验收标准，**仍可判 Pass** |
| 可裁剪 2 | Task 9 的隐身模式分支（改为隐身下直接禁用写入并提示） | 行为更保守，不违反隐私承诺。PRD §4 F-07 允许"默认禁用持久化"，**仍可判 Pass** |
| **不可裁剪** | **F-03 的四个划词动作**、安全渲染（Task 7）、防串页闭环与快照语义（Task 5/8）、敏感字段守卫（Task 11）、最小权限（Task 2）、清除数据与隐私说明（Task 10）、六态覆盖（Task 13） | 前者是 PRD F-03 的明文范围，其余触及 §7 失败线 |

> **为什么四个划词动作不可裁**：`SYSTEM_PROMPT.rewrite` 在阶段一就已写好，UI 层只是动作数组里多一项，增量成本接近于零；而裁掉它就不能再声称"F-03 验收通过"，要么降为 Conditional，要么反过来改 PRD——用几分钟的工作量换文档层面的连锁修改，不划算。
>
> **裁剪与阶段门的一致性规则**：上表「可裁剪」项均**不在** PRD §4 F-01～F-03 的验收标准内，因此裁掉后仍可判 Pass，只需在 README 记录。**任何未列入上表的内容都不得自行裁剪**——若执行中发现必须砍掉某个 F-01～F-03 范围内的东西，阶段门直接降为 Conditional（见 §7），不存在"砍了还算全部通过"的选项。

---

## 1. 背景与目标

阶段一已经证明推理内核成立：WebGPU q4f16 下感知 TTFT P95 1.62s、28.4 tok/s、停止 <350ms、10× 无崩溃，ORT 本地打包与离线二次启动均通过。**剩下的风险不在模型，而在浏览器扩展的工程装配**：MV3 三上下文之间的消息可靠性、`activeTab` 最小权限下的注入时机、防串页、Shadow DOM 工具条、以及"每个异步动作都要有六态"的产品完成度。

**目标（一句话）**：把阶段一的 Worker 内核装进真实产品外壳，使一个不读 README 的新用户能完成"初始化模型 → 在陌生长网页上生成摘要并追问 → 划词解释"，全程无崩溃、无上下文串页、无未确认的网页写入。

**非目标（本阶段明确不做）**：本地 RAG（F-05）、OCR（F-06）、一键起草填入（F-04）、模型切换、会话导出、Playwright E2E。这些属于阶段三及以后，本阶段不预留实现，只在类型与存储 schema 上不制造阻碍。

## 2. 技术栈与全局约束

**继承阶段一**：WXT 0.20(MV3) · React 18 · TypeScript · Vite · `@huggingface/transformers` 3.x · ONNX Runtime Web · Comlink · Vitest。推理 Worker、`core/inference/**`、`core/bench/**` 原样保留，本阶段不重写。

**本阶段新增依赖**（安装后由 `package-lock.json` 固定确切版本；一律使用当前稳定版，不用 `next`/预发布）：

| 依赖 | 用途 | 引入任务 |
|---|---|---|
| `dexie` | IndexedDB schema/迁移/事务（会话与消息） | Task 9 |
| `zustand` | Side Panel 六态状态容器 | Task 5 |
| `@mozilla/readability` | 网页正文提取 | Task 3 |
| `react-markdown` | 模型输出流式渲染 | Task 7 |
| `rehype-sanitize` | Markdown 白名单清理（安全红线） | Task 7 |
| `jsdom`（dev） | `core/extract/**` 的 DOM 单测环境 | Task 3 |
| `fake-indexeddb`（dev） | `core/storage/**` 的级联删除单测 | Task 9 |

**样式方案**：Side Panel 使用普通 CSS（`entrypoints/sidepanel/style.css` + 组件级 class），**不引入 Tailwind**——省掉一套构建配置，也避开"Tailwind 全局样式进不了 Shadow Root"的问题；划词工具条的样式由 WXT `createShadowRootUi` 注入的独立 CSS 承载。这是对设计文档 §8.2 的有意偏差，理由记入 §2.1。

**全局约束（每个任务隐式包含；数值/命名照抄不改写）**：

- **权限范围（v0.1 已变更）**：`permissions` 为 `['sidePanel', 'storage', 'activeTab', 'scripting']`，**外加 `host_permissions: ['http://*/*', 'https://*/*']`**。原红线「不申请全站访问」因体验代价过高被放弃，决策记录见 PRD §8.1；仍**不申请 `tabs`、不申请 `webNavigation`、不用 `<all_urls>`**。Content Script 保持 `registration: 'runtime'` + `matches: []`，不生成静态全站注册——有权限不等于自动注入。
- **信任边界**：网页正文、选区一律为不可信数据，只经 `buildUserContent()` 的 `<material>` 围栏 + `sanitizeUntrusted()` 转义进入 user 消息，**永不拼进 system 消息**。页面里的任何文字不得触发点击、填表、下载、权限申请。
- **安全渲染**：模型输出只经 `react-markdown` + `rehype-sanitize` 渲染，禁用原始 HTML；链接经 `safeUrl()` 过滤（仅 `http:`/`https:`/`mailto:`），外链一律 `rel="noopener noreferrer nofollow" target="_blank"`。任何位置不得使用 `dangerouslySetInnerHTML`。
- **防串页闭环（四道，缺一不可）**：① SW 是 `epoch` 唯一权威且跨 SW 重启持久化；② Port 断连与 `PAGE_UNLOADING` 覆盖整页导航与标签关闭；③ CS 的 `PAGE_NAVIGATED` 覆盖 SPA 的 History 导航；④ Panel 应用任何 `onToken`/提取结果前必须过 `isCtxCurrent(ctx, boundCtx)`，不符即丢弃并 `cancel()`。
- **单活跃任务不变式**：任一时刻只有一个生成任务在跑。启动新任务前必须 `cancel()` 旧任务；所有 token/完成/失败/清理回调都要先校验 `currentTask.id === 本任务 signalId`，旧任务的迟到回调不得改写新任务状态。
- **快照语义（贯穿全阶段的核心约定）**：`readPage()` 返回的是**那一刻的正文快照**，之后一切生成都基于这份快照，Wisp **不会**在生成期间再去读页面。因此原页面随后刷新、跳转、关闭甚至标签被销毁，都不影响已在跑的生成——它读的是内存里的字符串，不是活的 DOM。
  - 由此推出切标签的产品语义（D1·A2，不是缺陷）：切到别的标签**不**自动解绑、**不**取消在途任务。
  - 也由此推出 UI 的表述红线：**任何文案都不得暗示"仍在读取某个页面"**。正确说法是「正在基于《标题》的已读取内容生成」，错误说法是「任务仍在《标题》继续」。
- **来源标识常驻**：只要 `page !== null`，结果区顶部就必须持续显示内容来自哪个页面——不只在生成中，也不只在切标签时。摘要读完、追问、复制、重新生成的每一刻，用户都应能一眼看到当前结果的依据是哪一页。切标签只是**追加**一条「改读当前页」的操作入口，不替代来源标识。
- **后端选择红线（继承阶段一）**：WebGPU 初始化或自检失败**绝不自动回退 WASM**，只进 `needs-user-choice` 由用户显式选择；切后端/失败/取消前必须 `dispose()`。
- **无远程代码**：所有 JS/WASM 本地打包；`connect-src` 白名单维持阶段一实测的 5 个模型下载主机，本阶段**不新增任何出网主机**。
- **六态覆盖**：每个异步功能覆盖 `idle | loading | success | empty | error | cancelled` 并带 `retryable`，缺一即验收不通过。
- **模型常量**：`MODEL_ID = 'onnx-community/Qwen3-0.6B-ONNX'`，`REVISION = 'da1453100cf3ff33ef56d17983fc7a8648706db6'`（沿用阶段一锁定 sha，本阶段不改，避免缓存键变化重下 390MB）。
- **性能对标**：划词工具条出现 ≤ 150ms（选区稳定后）；从点击工具条到 Side Panel 显示任务状态 ≤ 500ms；正文提取一次性耗时 ≤ 1s（超 `MAX_DOM_NODES` 走启发式）；生成侧指标沿用阶段一已达标值。
- **Git**：提交**不加 `Co-Authored-By` 尾行**，作者为仓库配置的 `Mr-CG-end`；频繁小步提交。

### 2.1 与设计文档 v0.2 的有意偏差（三处，**均已回写**）

> 三处偏差已于提交 `docs: 回写设计文档契约与阶段状态` 一并写入 `Wisp_设计文档.md`，设计文档现已与实现一致，不再是"偏差"。本表保留备查。

| # | 设计文档原文 | 本计划做法 | 理由 | 回写状态 |
|---|---|---|---|---|
| B1 | §2.1 `BackgroundToPanel.ACTIVE_TAB` 带 `url` | `ACTIVE_TAB` 只带 `{tabId, epoch}`，`url` 由 Content Script 在 `EXTRACTED`/`SELECTION` 中回传 | ~~读取 `tab.url` 需要 `tabs` 或 host 权限，与「不申请 `<all_urls>`」冲突~~ **原权限理由已随 v0.1 申请常驻主机权限而失效**；实现保留不变，改以「CS 的 `location.href` 更准确（SPA 导航后 `tab.url` 可能滞后）、真源唯一」为理由 | ✅ 已回写 §2.1 |
| B2 | §3.1 用 `webNavigation.onCommitted` 触发 `epoch++` | 用 `chrome.tabs.onUpdated` 的 `changeInfo.status === 'loading'` 触发 | `webNavigation` 是独立权限，`tabs.onUpdated` 事件本身无需权限即可监听（只是 `url` 字段会缺省，而 B1 已不依赖它） | ✅ 已回写 §2.1（并补上 CS 上报 `PAGE_NAVIGATED` 这条 SPA 通道） |
| B3 | §8.2 Panel 用 Tailwind | Panel 用普通 CSS | 单人一周周期下，多一套构建配置与 Shadow Root 样式注入方案不划算；样式量级（一个侧边栏 + 一条工具条）不需要原子化 CSS | ✅ 已回写 §8.2 |

## 3. 文件结构（先锁定分解边界）

```text
wisp/
├─ wxt.config.ts                          # 权限/CSP/COOP-COEP（Task 2 扩权限）
├─ entrypoints/
│  ├─ background.ts                       # SW：epoch 权威 / 注入协调 / pendingAction / 生命周期清理（Task 2,9,12）
│  ├─ content.ts                          # CS：Port 服务端 / 提取 / 选区 / 工具条挂载（Task 4,11）
│  └─ sidepanel/
│     ├─ index.html / main.tsx / style.css
│     ├─ App.tsx                          # 外壳与路由（初始化页 ↔ 工作页 ↔ 设置页）（Task 6,8,10）
│     ├─ store.ts                         # Zustand PanelState（Task 5）
│     ├─ usePageChannel.ts                # Port 生命周期 + SW runtime 订阅（Task 4,8,12）
│     ├─ useInference.ts                  # 阶段一既有，不改
│     ├─ inference.worker.ts              # 阶段一既有，不改
│     └─ components/
│        ├─ ModelSetup.tsx                # F-01 初始化/进度/取消/缓存管理（Task 6）
│        ├─ StreamMarkdown.tsx            # 安全 Markdown 流式渲染（Task 7）
│        ├─ TaskPanel.tsx                 # F-02 摘要/追问/停止/重生成（Task 8）
│        ├─ SettingsPanel.tsx             # 设置 + 存储用量 + 清除数据（Task 10）
│        └─ StatusBanner.tsx              # 六态/错误矩阵/切标签横幅（Task 13）
├─ components/
│  ├─ SelectionToolbar.tsx                # Shadow DOM 划词工具条（Task 11）
│  └─ selectionToolbar.css                # 工具条样式（随 Shadow Root 注入）（Task 11）
└─ core/
   ├─ messaging/
   │  ├─ types.ts                         # 消息信封 + TaskContext + ErrorCode（Task 1）
   │  ├─ epoch.ts(+test)                  # EpochRegistry（Task 1）
   │  └─ pending.ts(+test)                # PendingActionStore（Task 1）
   ├─ extract/
   │  ├─ article.ts(+test)                # readability 封装 + 启发式兜底 + DOM 上限（Task 3）
   │  ├─ truncate.ts(+test)               # 确定性截断（Task 3）
   │  ├─ selection.ts(+test)              # 选区守卫 + 语言判定（Task 11）
   │  └─ sensitive.ts(+test)              # 敏感字段判定（Task 11）
   ├─ panel/
   │  ├─ taskGuard.ts(+test)              # ctx/epoch 有效性校验（Task 5）
   │  └─ outputLength.ts(+test)           # 设置 → maxNewTokens 映射（Task 10）
   ├─ render/
   │  └─ urlSafety.ts(+test)              # 危险链接过滤（Task 7）
   ├─ storage/
   │  ├─ db.ts                            # Dexie schema（Task 9）
   │  ├─ cleanup.ts(+test)                # 级联删除 + TTL 选择（Task 9）
   │  └─ settings.ts(+test)               # 设置默认值与合并（Task 10）
   ├─ inference/                          # 阶段一既有；仅 cacheSelection.ts 增一个导出（Task 6）
   └─ bench/                              # 阶段一既有，不改
```

- `core/**` 不 import 任何 WXT/DOM/chrome API（`extract/**` 例外：接收调用方传入的 `Document`/`Element`，自身不碰全局 `window`/`document`），保证 node/jsdom 下可纯单测。
- `entrypoints/**` 与 `components/**` 只做上下文绑定与装配。
- 需要 DOM 的测试文件首行加 `// @vitest-environment jsdom`，不改全局 `vitest.config.ts`。

> **代码呈现约定**：纯逻辑模块给完整代码与测试；UI/装配层给关键函数、完整 props 与接口签名，省略纯样式性 JSX，避免文档与源码长期漂移。

---

## 4. 任务分解

### Task 1: 消息契约 + epoch 权威 + 划词待投递缓存（纯逻辑 TDD）

**Files**：
- Create: `core/messaging/types.ts`
- Create: `core/messaging/epoch.ts` / `core/messaging/epoch.test.ts`
- Create: `core/messaging/pending.ts` / `core/messaging/pending.test.ts`

**Interfaces**：
- Produces：`TaskContext`、`ErrorCode`、四组消息联合类型、`EpochRegistry`（`get/bump/forget/isCurrent`）、`PendingActionStore`（`put/take`）。Task 2、4、5、8、11、12、13 全部依赖本任务的类型名，签名以此为准。

- [ ] **Step 1：写 `core/messaging/types.ts`（仅类型，无测试）**

```ts
import type { Lang, SelectionAction, Uuid } from '../inference/contract';

export type { Lang, SelectionAction, Uuid };

/**
 * Side Panel ↔ Content Script 的 Port 名。
 * 放在 core 而不是 content.ts —— Panel 若从 content entrypoint 导入常量，
 * 会把 defineContentScript 的副作用与 readability 一起打进 Panel bundle。
 */
export const PORT_NAME = 'wisp-page';

/** 任务归属：Panel 应用任何页面数据或流式结果前都要校验它仍然当前。 */
export interface TaskContext {
  tabId: number;
  url: string;      // 由 Content Script 用 location.href 填写（见计划 §2.1 B1）
  epoch: number;    // 由 Service Worker 递增
}

export type ErrorCode =
  | 'PAGE_INJECTION_BLOCKED' | 'PAGE_NO_CONTENT' | 'PAGE_TOO_LONG'
  | 'WEBGPU_UNAVAILABLE' | 'WEBGPU_CRASH'
  | 'DOWNLOAD_FAILED' | 'DOWNLOAD_CANCELLED' | 'CACHE_CORRUPT'
  | 'OFFLINE_NO_MODEL' | 'STORAGE_FULL' | 'TAB_CHANGED'
  | 'WORKER_ERROR' | 'FILL_FAILED';

// —— Port：Side Panel → Content Script —— //
export type PanelToContent =
  | { type: 'EXTRACT'; reason: 'initial' | 'reread'; epoch: number }
  | { type: 'GET_SELECTION'; epoch: number };

// —— Port：Content Script → Side Panel —— //
export type ContentToPanel =
  | { type: 'EXTRACTED'; ctx: TaskContext; title: string; text: string;
      charCount: number; truncated: boolean; method: 'readability' | 'heuristic' }
  | { type: 'SELECTION'; ctx: TaskContext; text: string; lang: Lang }
  | { type: 'PAGE_UNLOADING' }
  // SPA 的 History 导航不销毁 Content Script，也不一定触发 tabs.onUpdated(status:'loading')，
  // 因此由 CS 自己上报「同一文档内换了页面」，Panel 据此作废旧任务（见 Task 4 Step 1b）。
  | { type: 'PAGE_NAVIGATED'; url: string }
  | { type: 'ERROR'; code: ErrorCode; message: string };

// —— runtime：Content Script → Service Worker —— //
export type ContentToBackground =
  | { type: 'PING' }                                    // SW 探活，CS 回 { type: 'PONG' }
  | { type: 'TOOLBAR_ACTION'; action: SelectionAction; text: string; url: string; lang: Lang };

// —— runtime：Side Panel → Service Worker —— //
export type PanelToBackground =
  | { type: 'PANEL_READY' }
  | { type: 'REQUEST_ACTIVE_TAB' }
  | { type: 'ENSURE_CONTENT_SCRIPT'; tabId: number }
  | { type: 'TAB_CLOSED_CLEANUP'; tabId: number };      // 预留给 Task 9 的手动清理触发

// —— runtime：Service Worker → Side Panel（广播）—— //
export type BackgroundToPanel =
  | { type: 'ACTIVE_TAB'; tabId: number; epoch: number }
  // 面板已打开时的主投递路径；面板冷启动时走 PANEL_READY 拉取。两条路径都带 id，Panel 按 id 去重。
  | { type: 'PENDING_ACTION'; id: Uuid; action: SelectionAction; text: string; ctx: TaskContext }
  | { type: 'EPOCH_INVALIDATED'; tabId: number; epoch: number };

// —— runtime 响应体（sendResponse 的形状，Panel 侧按此解构）—— //
export interface ActiveTabInfo { tabId: number; epoch: number; }
export type EnsureContentScriptResult =
  | { ok: true; epoch: number }
  | { ok: false; code: ErrorCode; message: string };
export interface PanelReadyResult {
  active: ActiveTabInfo | null;
  pending: PendingActionEntry | null;
}

/** 划词动作的投递单元；`id` 让「广播」与「PANEL_READY 拉取」两条路径可以安全去重。 */
export interface PendingActionEntry {
  id: Uuid;
  action: SelectionAction;
  text: string;
  ctx: TaskContext;
}
```

- [ ] **Step 2：写 `core/messaging/epoch.test.ts`（失败测试）**

```ts
import { describe, expect, it } from 'vitest';
import { EpochRegistry } from './epoch';

describe('EpochRegistry', () => {
  it('未知标签页的 epoch 为 0', () => {
    expect(new EpochRegistry().get(7)).toBe(0);
  });

  it('bump 递增并返回新值，各标签页互不影响', () => {
    const r = new EpochRegistry();
    expect(r.bump(1)).toBe(1);
    expect(r.bump(1)).toBe(2);
    expect(r.get(2)).toBe(0);
  });

  it('isCurrent 只在 tabId 与 epoch 都匹配时为真', () => {
    const r = new EpochRegistry();
    r.bump(3);
    expect(r.isCurrent({ tabId: 3, epoch: 1 })).toBe(true);
    expect(r.isCurrent({ tabId: 3, epoch: 0 })).toBe(false);
    expect(r.isCurrent({ tabId: 4, epoch: 1 })).toBe(false);
  });

  it('forget 后重新计数从 1 开始', () => {
    const r = new EpochRegistry();
    r.bump(5);
    r.forget(5);
    expect(r.get(5)).toBe(0);
    expect(r.bump(5)).toBe(1);
  });

  it('toJSON/restore 可跨 Service Worker 重启还原计数', () => {
    const before = new EpochRegistry();
    before.bump(1);
    before.bump(1);
    before.bump(2);

    const after = new EpochRegistry();
    after.restore(before.toJSON());
    expect(after.get(1)).toBe(2);
    expect(after.get(2)).toBe(1);
    expect(after.bump(1)).toBe(3);          // 恢复后继续递增，不倒退
  });

  it('restore 取较大值合并，恢复不会覆盖更新的内存值', () => {
    const r = new EpochRegistry();
    r.bump(1);
    r.bump(1);
    r.bump(1);                               // 内存已到 3
    r.restore({ '1': 1 });                   // 落盘的是旧值 1
    expect(r.get(1)).toBe(3);
  });

  it('restore 容忍 undefined 与脏数据', () => {
    const r = new EpochRegistry();
    r.restore(undefined);
    r.restore({ notANumber: Number.NaN, '3': 2 } as Record<string, number>);
    expect(r.get(3)).toBe(2);
  });
});
```

- [ ] **Step 3：写 `core/messaging/pending.test.ts`（失败测试）**

```ts
import { describe, expect, it } from 'vitest';
import { PendingActionStore, PENDING_TTL_MS } from './pending';

const ctx = { tabId: 1, url: 'https://example.com/a', epoch: 2 };
const entry = { id: 'act-1', action: 'explain' as const, text: '选中的文字', ctx };

describe('PendingActionStore', () => {
  it('put 后可在 TTL 内取出一次', () => {
    const s = new PendingActionStore();
    s.put(entry, 1000);
    expect(s.take(1000 + PENDING_TTL_MS - 1)).toEqual(entry);
  });

  it('取出后即清空，二次 take 为 null', () => {
    const s = new PendingActionStore();
    s.put(entry, 0);
    s.take(0);
    expect(s.take(0)).toBeNull();
  });

  it('超过 TTL 返回 null 且不残留', () => {
    const s = new PendingActionStore();
    s.put(entry, 0);
    expect(s.take(PENDING_TTL_MS + 1)).toBeNull();
    expect(s.take(0)).toBeNull();
  });

  it('新 put 覆盖旧的待投递动作', () => {
    const s = new PendingActionStore();
    s.put(entry, 0);
    const next = { ...entry, action: 'translate' as const, text: '另一段' };
    s.put(next, 0);
    expect(s.take(0)).toEqual(next);
  });

  it('未 put 时 take 为 null', () => {
    expect(new PendingActionStore().take(0)).toBeNull();
  });
});
```

- [ ] **Step 4：运行测试确认失败**

Run: `npm test`
Expected: FAIL，`Failed to resolve import "./epoch"` / `"./pending"`

- [ ] **Step 5：实现 `core/messaging/epoch.ts`**

```ts
/** chrome.storage.session 中存放 epoch 快照的键；由 Service Worker 侧读写。 */
export const EPOCH_STORAGE_KEY = 'wisp:epochs';

/** epoch 权威：只在 Service Worker 中实例化一份。类本身不碰 chrome.*，便于纯单测。 */
export class EpochRegistry {
  private map = new Map<number, number>();

  get(tabId: number): number {
    return this.map.get(tabId) ?? 0;
  }

  bump(tabId: number): number {
    const next = this.get(tabId) + 1;
    this.map.set(tabId, next);
    return next;
  }

  forget(tabId: number): void {
    this.map.delete(tabId);
  }

  isCurrent(ref: { tabId: number; epoch: number }): boolean {
    return this.get(ref.tabId) === ref.epoch;
  }

  /** 导出快照，供 SW 写入 chrome.storage.session。 */
  toJSON(): Record<string, number> {
    return Object.fromEntries([...this.map].map(([tabId, epoch]) => [String(tabId), epoch]));
  }

  /**
   * 从快照恢复。MV3 Service Worker 空闲即被回收，重启后内存 Map 归零——
   * 若不恢复，epoch 会倒退回 0，导致 Panel 已持有的 ctx 被误判失效。
   * 取较大值合并：恢复动作永远不会让计数倒退。
   */
  restore(data: Record<string, number> | undefined): void {
    if (!data) return;
    for (const [key, value] of Object.entries(data)) {
      const tabId = Number(key);
      if (!Number.isInteger(tabId) || !Number.isFinite(value)) continue;
      this.map.set(tabId, Math.max(this.get(tabId), value));
    }
  }
}
```

- [ ] **Step 6：实现 `core/messaging/pending.ts`**

```ts
import type { PendingActionEntry } from './types';

export const PENDING_TTL_MS = 30_000;

/** 划词动作在 sidePanel.open() 与面板挂载之间的中转站；单槽位，带过期。 */
export class PendingActionStore {
  private entry: PendingActionEntry | null = null;
  private expiresAt = 0;

  put(entry: PendingActionEntry, now: number, ttlMs: number = PENDING_TTL_MS): void {
    this.entry = entry;
    this.expiresAt = now + ttlMs;
  }

  take(now: number): PendingActionEntry | null {
    const entry = this.entry;
    this.entry = null;
    if (!entry || now >= this.expiresAt) return null;
    return entry;
  }
}
```

- [ ] **Step 7：运行测试确认通过**

Run: `npm test`
Expected: PASS，`epoch.test.ts` 4 项 + `pending.test.ts` 5 项全绿，阶段一既有测试不受影响

- [ ] **Step 8：提交**

```bash
git add core/messaging
git commit -m "feat: 消息契约、epoch 权威与划词待投递缓存（单测覆盖）"
```

---

### Task 2: Service Worker —— epoch 广播 / 按需注入协调 / 面板握手

**Files**：
- Modify: `entrypoints/background.ts`（全量重写，当前仅 7 行）
- Modify: `wxt.config.ts:12`（`permissions` 增加 `activeTab`、`scripting`）

**Interfaces**：
- Consumes：`EpochRegistry`、`PendingActionStore`、Task 1 全部消息类型。
- Produces：SW 对 `PANEL_READY` / `REQUEST_ACTIVE_TAB` / `ENSURE_CONTENT_SCRIPT` 的响应契约（`PanelReadyResult` / `ActiveTabInfo` / `EnsureContentScriptResult`），Task 4 与 Task 12 的 Panel 侧按此调用。

- [ ] **Step 1：扩展 `wxt.config.ts` 权限**

把 `permissions: ['sidePanel', 'storage']` 改为：

```ts
    permissions: ['sidePanel', 'storage', 'activeTab', 'scripting'],
```

其余字段（`host_permissions`、`content_security_policy`、COOP/COEP）**保持不变**。

- [ ] **Step 2：重写 `entrypoints/background.ts`**

```ts
import { EPOCH_STORAGE_KEY, EpochRegistry } from '../core/messaging/epoch';
import { PendingActionStore } from '../core/messaging/pending';
import type {
  ActiveTabInfo,
  BackgroundToPanel,
  ContentToBackground,
  EnsureContentScriptResult,
  PanelReadyResult,
  PanelToBackground,
} from '../core/messaging/types';

/** WXT 把 entrypoints/content.ts 编译到该路径；executeScript 注入用。 */
const CONTENT_SCRIPT_FILE = 'content-scripts/content.js';

export default defineBackground(() => {
  const epochs = new EpochRegistry();
  const pending = new PendingActionStore();

  // MV3 Service Worker 空闲即回收。epoch 存 chrome.storage.session：
  // 它跨 SW 重启保留、随浏览器会话结束清空 —— 与 tabId 的生命周期正好对齐。
  const hydrated = chrome.storage.session
    .get(EPOCH_STORAGE_KEY)
    .then((data) => epochs.restore(data?.[EPOCH_STORAGE_KEY]))
    .catch((error) => console.error('[wisp] epoch restore', error));

  function persistEpochs(): void {
    void chrome.storage.session
      .set({ [EPOCH_STORAGE_KEY]: epochs.toJSON() })
      .catch((error) => console.error('[wisp] epoch persist', error));
  }

  /** 面板可能没开，广播失败是正常情况，静默吞掉。 */
  function broadcast(msg: BackgroundToPanel): void {
    chrome.runtime.sendMessage(msg).catch(() => undefined);
  }

  chrome.action.onClicked.addListener((tab) => {
    if (tab.windowId === undefined) return;
    chrome.sidePanel
      .open({ windowId: tab.windowId })
      .catch((error) => console.error('[wisp] sidePanel.open', error));
  });

  // 导航开始即作废该标签页的在途任务（计划 §2.1 B2：不使用 webNavigation 权限）。
  // SPA 的 History 导航不一定触发本事件，由 Content Script 的 PAGE_NAVIGATED 补齐（Task 4）。
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status !== 'loading') return;
    void hydrated.then(() => {
      const epoch = epochs.bump(tabId);
      persistEpochs();
      broadcast({ type: 'EPOCH_INVALIDATED', tabId, epoch });
    });
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    void hydrated.then(() => {
      epochs.forget(tabId);
      persistEpochs();
      broadcast({ type: 'EPOCH_INVALIDATED', tabId, epoch: -1 });
    });
  });

  chrome.tabs.onActivated.addListener(({ tabId }) => {
    void hydrated.then(() => broadcast({ type: 'ACTIVE_TAB', tabId, epoch: epochs.get(tabId) }));
  });

  async function queryActiveTab(): Promise<ActiveTabInfo | null> {
    await hydrated;
    // Service Worker 没有「当前窗口」概念，必须用 lastFocusedWindow
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab?.id) return null;
    return { tabId: tab.id, epoch: epochs.get(tab.id) };
  }

  /** 先探活再注入，避免重复注入；注入失败即视为受限页面。 */
  async function ensureContentScript(tabId: number): Promise<EnsureContentScriptResult> {
    await hydrated;
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'PING' });
      return { ok: true, epoch: epochs.get(tabId) };
    } catch {
      /* 尚未注入，继续走 executeScript */
    }
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: [CONTENT_SCRIPT_FILE] });
      return { ok: true, epoch: epochs.get(tabId) };
    } catch (error) {
      return {
        ok: false,
        code: 'PAGE_INJECTION_BLOCKED',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  chrome.runtime.onMessage.addListener(
    (msg: PanelToBackground | ContentToBackground, sender, sendResponse) => {
      switch (msg.type) {
        case 'PANEL_READY': {
          void (async () => {
            const result: PanelReadyResult = {
              active: await queryActiveTab(),
              pending: pending.take(Date.now()),
            };
            sendResponse(result);
          })();
          return true;
        }
        case 'REQUEST_ACTIVE_TAB': {
          void queryActiveTab().then(sendResponse);
          return true;
        }
        case 'ENSURE_CONTENT_SCRIPT': {
          void ensureContentScript(msg.tabId).then(sendResponse);
          return true;
        }
        case 'TOOLBAR_ACTION': {
          const tabId = sender.tab?.id;
          if (tabId === undefined) return false;
          void hydrated.then(() => {
            const entry = {
              id: crypto.randomUUID(),
              action: msg.action,
              text: msg.text,
              ctx: { tabId, url: msg.url, epoch: epochs.get(tabId) },
            };
            pending.put(entry, Date.now());
            // 两条投递路径，缺一不可：
            //  ① 广播 —— 面板已经打开时它不会重新挂载，不会再发 PANEL_READY；
            //  ② 缓存 —— 面板尚未打开时由挂载后的 PANEL_READY 取走。
            // Panel 按 entry.id 去重，两条路径同时到达也只执行一次。
            broadcast({ type: 'PENDING_ACTION', ...entry });
            chrome.sidePanel
              .open({ tabId })
              .catch(() => {
                // 手势不可跨 CS→SW 时的退路：让 CS 提示用户点击工具栏图标（Task 12 Step 4）
                chrome.tabs.sendMessage(tabId, { type: 'OPEN_PANEL_HINT' }).catch(() => undefined);
              });
          });
          return false;
        }
        default:
          return false;
      }
    },
  );
});
```

> `TOOLBAR_ACTION` 分支里 `sidePanel.open()` 能否继承 Content Script 的用户手势，是设计文档 §4.3 标记的 🔬 项，Task 12 真机验证并记录结论与退路。

- [ ] **Step 3：类型检查与构建**

Run: `npx tsc --noEmit && npm run build`
Expected: 两条命令均退出码 0

- [ ] **Step 4：真机验收（`npm run build:dev` 后加载 `.output/chrome-mv3-dev`）**

  - 点击工具栏 Wisp 图标 → 侧边栏打开，SW 控制台无报错。
  - 打开 SW 的 DevTools，在当前标签页导航一次 → 控制台可见 `EPOCH_INVALIDATED` 广播失败被静默（面板未监听时无红色未捕获错误）。
  - `chrome://extensions` 上查看 manifest：`permissions` 恰为 `sidePanel/storage/activeTab/scripting` 四项；`host_permissions` 恰为 `http://*/*` 与 `https://*/*` 两项（v0.1 变更，见 §2）；无 `tabs`、无 `webNavigation`、无 `<all_urls>`。

- [ ] **Step 5：提交**

```bash
git add wxt.config.ts entrypoints/background.ts
git commit -m "feat: SW 承担 epoch 权威、按需注入协调与面板握手"
```

---

### Task 3: 正文提取与确定性截断（纯逻辑 TDD，jsdom）

**Files**：
- Create: `core/extract/article.ts` / `core/extract/article.test.ts`
- Create: `core/extract/truncate.ts` / `core/extract/truncate.test.ts`
- Modify: `package.json`（新增依赖 `@mozilla/readability`，devDep `jsdom`）

**Interfaces**：
- Produces：`extractArticle(doc: Document): ExtractResult | null`、`ExtractResult`、`MAX_DOM_NODES`、`MIN_ARTICLE_CHARS`；`truncateForContext(text, budget): TruncateResult`、`CONTEXT_CHAR_BUDGET`。Task 4 的 Content Script 直接调用这两个函数。

- [ ] **Step 1：安装依赖**

```bash
npm install @mozilla/readability
npm install -D jsdom
```

- [ ] **Step 2：写 `core/extract/truncate.test.ts`（失败测试）**

```ts
import { describe, expect, it } from 'vitest';
import { truncateForContext } from './truncate';

describe('truncateForContext', () => {
  it('未超预算时原样返回', () => {
    const r = truncateForContext('第一段\n第二段', 100);
    expect(r).toEqual({ text: '第一段\n第二段', truncated: false, keptChars: 7 });
  });

  it('超预算时按段落边界从头部保留', () => {
    const text = ['一'.repeat(10), '二'.repeat(10), '三'.repeat(10)].join('\n');
    const r = truncateForContext(text, 21);
    expect(r.text).toBe(`${'一'.repeat(10)}\n${'二'.repeat(10)}`);
    expect(r.truncated).toBe(true);
    expect(r.keptChars).toBe(21);
  });

  it('首段本身超预算时按字符硬截断', () => {
    const r = truncateForContext('长'.repeat(50), 10);
    expect(r.text).toBe('长'.repeat(10));
    expect(r.truncated).toBe(true);
    expect(r.keptChars).toBe(10);
  });

  it('相同输入两次调用结果完全一致（确定性）', () => {
    const text = Array.from({ length: 30 }, (_, i) => `段落${i}内容`).join('\n');
    expect(truncateForContext(text, 40)).toEqual(truncateForContext(text, 40));
  });
});
```

- [ ] **Step 3：写 `core/extract/article.test.ts`（失败测试）**

```ts
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { extractArticle, MAX_DOM_NODES } from './article';

function docFrom(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

const BODY_TEXT = '这是一篇测试文章的正文内容，用来验证提取逻辑是否可靠。'.repeat(12);

describe('extractArticle', () => {
  it('提取文章正文且不含导航与页脚', () => {
    const doc = docFrom(`
      <html><head><title>测试标题</title></head><body>
        <nav><a href="/a">导航链接甲</a><a href="/b">导航链接乙</a></nav>
        <article><h1>测试标题</h1><p>${BODY_TEXT}</p></article>
        <footer>页脚版权声明</footer>
      </body></html>`);
    const r = extractArticle(doc);
    expect(r).not.toBeNull();
    expect(r!.text).toContain('这是一篇测试文章的正文内容');
    expect(r!.text).not.toContain('导航链接甲');
    expect(r!.text).not.toContain('页脚版权声明');
    expect(r!.charCount).toBe(r!.text.length);
  });

  it('正文过短返回 null（对应 PAGE_NO_CONTENT）', () => {
    expect(extractArticle(docFrom('<html><body><p>太短</p></body></html>'))).toBeNull();
  });

  it('不修改传入的 document（内部走 clone）', () => {
    const doc = docFrom(`<html><body><nav>导航</nav><article><p>${BODY_TEXT}</p></article></body></html>`);
    const before = doc.body.innerHTML;
    extractArticle(doc);
    expect(doc.body.innerHTML).toBe(before);
  });

  it('DOM 规模超上限时降级为启发式提取', () => {
    const filler = '<span>x</span>'.repeat(MAX_DOM_NODES + 10);
    const doc = docFrom(`<html><body><main><p>${BODY_TEXT}</p></main>${filler}</body></html>`);
    const r = extractArticle(doc);
    expect(r).not.toBeNull();
    expect(r!.method).toBe('heuristic');
    expect(r!.text).toContain('这是一篇测试文章的正文内容');
  });

  it('折叠连续空白，不产生大段空行', () => {
    const doc = docFrom(`<html><body><article><p>${BODY_TEXT}</p>\n\n\n<p>   尾段   </p></article></body></html>`);
    const r = extractArticle(doc);
    expect(r!.text).not.toMatch(/\n{3,}/);
    expect(r!.text).not.toMatch(/ {3,}/);
  });
});
```

- [ ] **Step 4：运行测试确认失败**

Run: `npm test`
Expected: FAIL，`Failed to resolve import "./truncate"` / `"./article"`

- [ ] **Step 5：实现 `core/extract/truncate.ts`**

```ts
/** 中文正文的上下文字符预算。Task 14 若实测感知 TTFT P95 > 4s，按 §7 规则下调到 2000 并记入 README。 */
export const CONTEXT_CHAR_BUDGET = 3000;

export interface TruncateResult {
  text: string;
  truncated: boolean;
  keptChars: number;
}

/**
 * 确定性截断：头部优先、段落边界对齐、无随机与无时间依赖。
 * 相同输入必然得到相同输出，保证跨次实测可比。
 */
export function truncateForContext(text: string, budget: number = CONTEXT_CHAR_BUDGET): TruncateResult {
  if (text.length <= budget) {
    return { text, truncated: false, keptChars: text.length };
  }

  const paragraphs = text.split('\n');
  const kept: string[] = [];
  let used = 0;
  for (const paragraph of paragraphs) {
    const cost = kept.length === 0 ? paragraph.length : paragraph.length + 1;
    if (used + cost > budget) break;
    kept.push(paragraph);
    used += cost;
  }

  if (kept.length === 0) {
    return { text: text.slice(0, budget), truncated: true, keptChars: budget };
  }
  return { text: kept.join('\n'), truncated: true, keptChars: used };
}
```

- [ ] **Step 6：实现 `core/extract/article.ts`**

```ts
import { Readability } from '@mozilla/readability';

/** 超过该 DOM 节点数不跑 readability（它是同步单次操作，无法分片）。 */
export const MAX_DOM_NODES = 12_000;
/** 低于该字符数视为「页面无正文」。 */
export const MIN_ARTICLE_CHARS = 200;

const STRIP_SELECTOR = 'script,style,noscript,template,nav,header,footer,aside,form,iframe';

export interface ExtractResult {
  title: string;
  text: string;
  charCount: number;
  method: 'readability' | 'heuristic';
}

function normalizeText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function heuristicText(doc: Document): string {
  const clone = doc.cloneNode(true) as Document;
  clone.querySelectorAll(STRIP_SELECTOR).forEach((el) => el.remove());
  const root = clone.querySelector('main') ?? clone.querySelector('article') ?? clone.body;
  return normalizeText(root?.textContent ?? '');
}

/**
 * 正文提取：readability 优先，DOM 过大或结果过短时降级启发式。
 * 不修改调用方的 document —— 两条路径都在 clone 上操作。
 */
export function extractArticle(doc: Document): ExtractResult | null {
  const nodeCount = doc.getElementsByTagName('*').length;

  if (nodeCount <= MAX_DOM_NODES) {
    let parsed: ReturnType<Readability['parse']> = null;
    try {
      parsed = new Readability(doc.cloneNode(true) as Document).parse();
    } catch {
      parsed = null;
    }
    const text = normalizeText(parsed?.textContent ?? '');
    if (text.length >= MIN_ARTICLE_CHARS) {
      return {
        title: parsed?.title || doc.title || '',
        text,
        charCount: text.length,
        method: 'readability',
      };
    }
  }

  const fallback = heuristicText(doc);
  if (fallback.length < MIN_ARTICLE_CHARS) return null;
  return { title: doc.title || '', text: fallback, charCount: fallback.length, method: 'heuristic' };
}
```

- [ ] **Step 7：运行测试确认通过**

Run: `npm test`
Expected: PASS，`truncate.test.ts` 4 项 + `article.test.ts` 5 项全绿

- [ ] **Step 8：提交**

```bash
git add package.json package-lock.json core/extract
git commit -m "feat: readability 正文提取与确定性上下文截断（单测覆盖）"
```

---

### Task 4: Content Script + Port 通道，面板可读取当前页

**Files**：
- Create: `entrypoints/content.ts`
- Create: `entrypoints/sidepanel/usePageChannel.ts`
- Modify: `entrypoints/sidepanel/App.tsx`（临时接一个「读取本页」按钮验证链路，Task 8 会被产品 UI 取代）

**Interfaces**：
- Consumes：`extractArticle`、`truncateForContext`、Task 1 消息类型、Task 2 的 `ENSURE_CONTENT_SCRIPT` / `REQUEST_ACTIVE_TAB` 响应。
- Produces：`usePageChannel()` 返回 `{ activeTab, boundCtx, bindActiveTab(), readPage(reason), requestSelection(), lastError }`；Task 8、11、12 复用它。

- [ ] **Step 1：写 `entrypoints/content.ts`**

```ts
import { extractArticle } from '../core/extract/article';
import { truncateForContext } from '../core/extract/truncate';
import { PORT_NAME, type ContentToPanel, type PanelToContent } from '../core/messaging/types';

/** 去掉 hash 的规范化 URL：SPA 的锚点跳转不算换页，不应作废在途任务。 */
function normalizedUrl(): string {
  const url = new URL(location.href);
  url.hash = '';
  return url.toString();
}

export default defineContentScript({
  registration: 'runtime',
  matches: [],
  main() {
    const w = window as unknown as { __wisp?: true };
    if (w.__wisp) return;
    w.__wisp = true;

    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg?.type === 'PING') sendResponse({ type: 'PONG' });
      return false;
    });

    chrome.runtime.onConnect.addListener((port) => {
      if (port.name !== PORT_NAME) return;

      const send = (msg: ContentToPanel) => {
        try {
          port.postMessage(msg);
        } catch {
          /* 面板已关闭，忽略 */
        }
      };

      const onPageHide = () => send({ type: 'PAGE_UNLOADING' });
      window.addEventListener('pagehide', onPageHide, { once: true });

      // SPA 的 pushState/replaceState 既不销毁 Content Script，也不一定触发
      // tabs.onUpdated(status:'loading') —— 少了这一路，SPA 换页后旧任务会被当成仍然有效。
      // Navigation API（Chrome 102+）覆盖 History 与 popstate 两种情况；popstate 作为兜底。
      let lastUrl = normalizedUrl();
      const onNavigated = () => {
        const next = normalizedUrl();
        if (next === lastUrl) return;          // 纯 hash 变化不算换页
        lastUrl = next;
        send({ type: 'PAGE_NAVIGATED', url: location.href });
      };
      const nav = (window as unknown as { navigation?: EventTarget }).navigation;
      nav?.addEventListener('navigatesuccess', onNavigated);
      window.addEventListener('popstate', onNavigated);

      port.onDisconnect.addListener(() => {
        window.removeEventListener('pagehide', onPageHide);
        window.removeEventListener('popstate', onNavigated);
        nav?.removeEventListener('navigatesuccess', onNavigated);
      });

      port.onMessage.addListener((msg: PanelToContent) => {
        const ctx = { tabId: -1, url: location.href, epoch: msg.epoch };

        if (msg.type === 'EXTRACT') {
          const article = extractArticle(document);
          if (!article) {
            send({ type: 'ERROR', code: 'PAGE_NO_CONTENT', message: '当前页面没有可读正文' });
            return;
          }
          const { text, truncated } = truncateForContext(article.text);
          send({
            type: 'EXTRACTED',
            ctx,
            title: article.title,
            text,
            charCount: article.charCount,
            truncated,
            method: article.method,
          });
          return;
        }

        if (msg.type === 'GET_SELECTION') {
          const raw = window.getSelection()?.toString() ?? '';
          send({ type: 'SELECTION', ctx, text: raw, lang: 'other' });
        }
      });
    });
  },
});
```

> `ctx.tabId` 由 Content Script 填 `-1`：CS 不知道自己的 tabId，Panel 在收到消息时用绑定的 tabId 覆盖（见 Step 2）。`charCount` 是**截断前**的原文规模，UI 用它显示「本页共 N 字，已分析前 M 字」。选区语言在 Task 11 接入 `detectLang` 后替换 `'other'`。

- [ ] **Step 2：写 `entrypoints/sidepanel/usePageChannel.ts`**

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ActiveTabInfo,
  BackgroundToPanel,
  ContentToPanel,
  EnsureContentScriptResult,
  ErrorCode,
  PanelToContent,
  TaskContext,
} from '../../core/messaging/types';
import { PORT_NAME } from '../../core/messaging/types';

export interface PageChannelError {
  code: ErrorCode;
  message: string;
}

export function usePageChannel() {
  const portRef = useRef<chrome.runtime.Port | null>(null);
  const waiterRef = useRef<((msg: ContentToPanel) => void) | null>(null);
  /** boundCtx 的同步镜像：同一个事件循环内 bind→read 时 React state 还没提交。 */
  const boundCtxRef = useRef<TaskContext | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTabInfo | null>(null);
  const [boundCtx, setBoundCtx] = useState<TaskContext | null>(null);
  const [lastError, setLastError] = useState<PageChannelError | null>(null);

  const closePort = useCallback(() => {
    portRef.current?.disconnect();
    portRef.current = null;
    waiterRef.current = null;
    boundCtxRef.current = null;
  }, []);

  useEffect(() => {
    const onMessage = (msg: BackgroundToPanel) => {
      if (msg.type === 'ACTIVE_TAB') setActiveTab({ tabId: msg.tabId, epoch: msg.epoch });
      if (msg.type === 'EPOCH_INVALIDATED') {
        setBoundCtx((prev) => {
          if (prev && prev.tabId === msg.tabId) {
            setLastError({ code: 'TAB_CHANGED', message: '页面已导航或关闭，旧任务已作废' });
            return null;
          }
          return prev;
        });
      }
    };
    chrome.runtime.onMessage.addListener(onMessage);
    void chrome.runtime.sendMessage({ type: 'REQUEST_ACTIVE_TAB' }).then((info: ActiveTabInfo | null) => {
      if (info) setActiveTab(info);
    });
    return () => {
      chrome.runtime.onMessage.removeListener(onMessage);
      closePort();
    };
  }, [closePort]);

  /**
   * 用户显式「在本页启用 Wisp」：注入 CS 并建立 Port。
   * 返回新的 TaskContext 而不是 boolean —— 调用方紧接着要 readPage()，
   * 此时 setBoundCtx 还没被 React 提交，闭包里的 boundCtx 仍是旧值（null）。
   * 把 ctx 沿调用链显式传下去，不依赖刚 set 的 state。
   */
  const bindActiveTab = useCallback(async (): Promise<TaskContext | null> => {
    setLastError(null);
    const info: ActiveTabInfo | null = await chrome.runtime.sendMessage({ type: 'REQUEST_ACTIVE_TAB' });
    if (!info) {
      setLastError({ code: 'PAGE_INJECTION_BLOCKED', message: '没有可用的活动标签页' });
      return null;
    }
    const ensured: EnsureContentScriptResult = await chrome.runtime.sendMessage({
      type: 'ENSURE_CONTENT_SCRIPT',
      tabId: info.tabId,
    });
    if (!ensured.ok) {
      setLastError({
        code: ensured.code,
        message: '该页面不允许扩展读取（浏览器内置页、应用商店等）。请点击工具栏 Wisp 图标授权当前页面，或换一个普通网页。',
      });
      return null;
    }

    closePort();
    const port = chrome.tabs.connect(info.tabId, { name: PORT_NAME });
    port.onMessage.addListener((msg: ContentToPanel) => {
      if (msg.type === 'PAGE_UNLOADING' || msg.type === 'PAGE_NAVIGATED') {
        setBoundCtx(null);
        setLastError({ code: 'TAB_CHANGED', message: '页面已跳转，旧任务已作废，可重新读取本页' });
        return;
      }
      waiterRef.current?.(msg);
    });
    port.onDisconnect.addListener(() => {
      portRef.current = null;
      setBoundCtx(null);
    });
    portRef.current = port;

    const ctx: TaskContext = { tabId: info.tabId, url: '', epoch: ensured.epoch };
    setActiveTab(info);
    setBoundCtx(ctx);
    boundCtxRef.current = ctx;        // 供本轮同步链路使用，不等 React 提交
    return ctx;
  }, [closePort]);

  /** 发一条 Port 消息并等待对应回复；同一时刻只允许一个在途请求。 */
  const request = useCallback(
    (msg: PanelToContent, timeoutMs = 8000): Promise<ContentToPanel> =>
      new Promise((resolve, reject) => {
        const port = portRef.current;
        if (!port) {
          reject(new Error('PORT_CLOSED'));
          return;
        }
        const timer = setTimeout(() => {
          waiterRef.current = null;
          reject(new Error('PORT_TIMEOUT'));
        }, timeoutMs);
        waiterRef.current = (reply) => {
          clearTimeout(timer);
          waiterRef.current = null;
          resolve(reply);
        };
        port.postMessage(msg);
      }),
    [],
  );

  /** `ctx` 可由调用方显式传入（刚 bind 完的那一轮），否则用当前绑定。 */
  const readPage = useCallback(
    async (reason: 'initial' | 'reread', ctx?: TaskContext) => {
      const bound = ctx ?? boundCtxRef.current;
      if (!bound) throw new Error('NOT_BOUND');
      const reply = await request({ type: 'EXTRACT', reason, epoch: bound.epoch });
      if (reply.type === 'ERROR') {
        setLastError({ code: reply.code, message: reply.message });
        return null;
      }
      if (reply.type !== 'EXTRACTED') return null;
      const next: TaskContext = { ...reply.ctx, tabId: bound.tabId };
      setBoundCtx(next);
      boundCtxRef.current = next;
      return { ...reply, ctx: next };
    },
    [request],
  );

  const requestSelection = useCallback(
    async (ctx?: TaskContext) => {
      const bound = ctx ?? boundCtxRef.current;
      if (!bound) throw new Error('NOT_BOUND');
      const reply = await request({ type: 'GET_SELECTION', epoch: bound.epoch });
      return reply.type === 'SELECTION' ? { ...reply, ctx: { ...reply.ctx, tabId: bound.tabId } } : null;
    },
    [request],
  );

  return { activeTab, boundCtx, bindActiveTab, readPage, requestSelection, lastError, setLastError };
}
```

> `boundCtxRef` 与 `boundCtx` state 始终同步更新：ref 供同一轮同步调用链读取，state 供渲染。凡是"先 bind 再立刻用"的路径，一律走 `bindActiveTab()` 的返回值或 ref，**不要读 state**。

- [ ] **Step 3：在 `App.tsx` 顶部临时接入验证按钮**

在现有 spike UI 的 `<h2>` 下方插入（Task 8 会整体替换本段）：

```tsx
  const page = usePageChannel();
  const [pageInfo, setPageInfo] = useState<string>('');

  const handleReadPage = async () => {
    const ctx = await page.bindActiveTab();
    if (!ctx) return;
    const extracted = await page.readPage('initial', ctx);   // 显式传 ctx，不等 React state 提交
    setPageInfo(
      extracted
        ? `${extracted.title} | 原文 ${extracted.charCount} 字 | 送模型 ${extracted.text.length} 字 | 截断=${extracted.truncated} | ${extracted.method}`
        : '未提取到正文',
    );
  };
```

```tsx
      <div style={{ marginBottom: 12 }}>
        <button onClick={handleReadPage}>读取本页（链路验证）</button>
        {pageInfo && <span style={{ marginLeft: 8, fontSize: 12 }}>{pageInfo}</span>}
        {page.lastError && <span style={{ marginLeft: 8, color: '#d32f2f' }}>{page.lastError.message}</span>}
      </div>
```

- [ ] **Step 4：构建并真机验收**

Run: `npx tsc --noEmit && npm run build:dev`，重新加载 `.output/chrome-mv3-dev`

  - 在一篇普通文章页点击 Wisp 图标 → 侧边栏 →「读取本页」→ 显示标题、原文字数、送模型字数、`readability`。
  - 在 `chrome://extensions` 页重复上述操作 → 显示受限页面提示文案，无未捕获异常。
  - 读取成功后刷新该页 → 面板出现「页面已导航或关闭，旧任务已作废」。
  - 连续点击「读取本页」3 次 → 每次都成功，SW 控制台无重复注入报错（哨兵与 PING 探活生效）。

- [ ] **Step 5：提交**

```bash
git add entrypoints/content.ts entrypoints/sidepanel/usePageChannel.ts entrypoints/sidepanel/App.tsx
git commit -m "feat: Content Script 按需注入与 Port 页面读取链路"
```

---

### Task 5: Zustand 面板状态容器 + 任务归属校验（含纯逻辑 TDD）

**Files**：
- Create: `core/panel/taskGuard.ts` / `core/panel/taskGuard.test.ts`
- Create: `entrypoints/sidepanel/store.ts`
- Modify: `package.json`（新增依赖 `zustand`）

**Interfaces**：
- Consumes：`TaskContext`、`ErrorCode`、`GenStats`。
- Produces：`isCtxCurrent(ctx, bound)`；`usePanelStore` 及其 `PanelState` 字段与 action 名（`setModelStatus/setBound/setPage/startTask/appendStream/finishTask/failTask/cancelTask/setError/reset`）。Task 6、8、10、11、12、13 全部通过这些 action 改状态，不得在组件里另建平行 state。

- [ ] **Step 1：安装依赖**

```bash
npm install zustand
```

- [ ] **Step 2：写 `core/panel/taskGuard.test.ts`（失败测试）**

```ts
import { describe, expect, it } from 'vitest';
import { isCtxCurrent } from './taskGuard';

const bound = { tabId: 3, url: 'https://example.com/a', epoch: 2 };

describe('isCtxCurrent', () => {
  it('tabId 与 epoch 都一致时有效', () => {
    expect(isCtxCurrent({ ...bound }, bound)).toBe(true);
  });

  it('url 变化但 tabId/epoch 一致时仍有效（同页锚点跳转）', () => {
    expect(isCtxCurrent({ ...bound, url: 'https://example.com/a#x' }, bound)).toBe(true);
  });

  it('epoch 落后时无效（页面已导航）', () => {
    expect(isCtxCurrent({ ...bound, epoch: 1 }, bound)).toBe(false);
  });

  it('tabId 不同则无效（防串页）', () => {
    expect(isCtxCurrent({ ...bound, tabId: 4 }, bound)).toBe(false);
  });

  it('未绑定标签页时一律无效', () => {
    expect(isCtxCurrent({ ...bound }, null)).toBe(false);
  });
});
```

- [ ] **Step 3：运行测试确认失败**

Run: `npm test`
Expected: FAIL，`Failed to resolve import "./taskGuard"`

- [ ] **Step 4：实现 `core/panel/taskGuard.ts`**

```ts
import type { TaskContext } from '../messaging/types';

/**
 * 防串页闭环的末端判据：只有 tabId 与 epoch 同时匹配当前绑定，
 * 页面数据与流式 token 才允许应用到 UI。url 变化不参与判定
 * （同页锚点跳转不递增 epoch，不应误杀在途任务）。
 */
export function isCtxCurrent(ctx: TaskContext, bound: TaskContext | null): boolean {
  return bound !== null && ctx.tabId === bound.tabId && ctx.epoch === bound.epoch;
}
```

- [ ] **Step 5：运行测试确认通过**

Run: `npm test`
Expected: PASS，`taskGuard.test.ts` 5 项全绿

- [ ] **Step 6：实现 `entrypoints/sidepanel/store.ts`**

```ts
import { create } from 'zustand';
import type { ErrorCode, TaskContext, Uuid } from '../../core/messaging/types';
import type { GenStats } from '../../core/inference/contract';

export type AsyncStatus = 'idle' | 'loading' | 'success' | 'empty' | 'error' | 'cancelled';
export type ModelStatus = 'uninitialized' | 'downloading' | 'loading' | 'ready' | 'error';
export type TaskType = 'summary' | 'qa' | 'explain' | 'summarize' | 'rewrite' | 'translate';

export interface PageInfo {
  title: string;
  url: string;
  text: string;          // 已截断、可直接送模型的正文
  charCount: number;     // 截断前原文规模
  truncated: boolean;
  method: 'readability' | 'heuristic';
}

export interface CurrentTask {
  id: Uuid;
  type: TaskType;
  ctx: TaskContext;
  status: AsyncStatus;
  retryable: boolean;
  source: string;        // 任务的输入摘要（页面标题或选区前 40 字），用于结果页回显
}

export interface PanelError {
  code: ErrorCode;
  message: string;
}

interface PanelState {
  modelStatus: ModelStatus;
  backend: 'webgpu' | 'wasm' | null;
  downloadPct: number;
  boundCtx: TaskContext | null;
  page: PageInfo | null;
  currentTask: CurrentTask | null;
  streamBuffer: string;
  lastStats: GenStats | null;
  error: PanelError | null;

  setModelStatus: (status: ModelStatus, backend?: 'webgpu' | 'wasm' | null) => void;
  setDownloadPct: (pct: number) => void;
  setBound: (ctx: TaskContext | null) => void;
  setPage: (page: PageInfo | null) => void;
  startTask: (task: CurrentTask) => void;
  appendStream: (delta: string) => void;
  finishTask: (stats: GenStats) => void;
  cancelTask: () => void;
  failTask: (error: PanelError) => void;
  setError: (error: PanelError | null) => void;
  reset: () => void;
}

const INITIAL = {
  modelStatus: 'uninitialized' as ModelStatus,
  backend: null,
  downloadPct: 0,
  boundCtx: null,
  page: null,
  currentTask: null,
  streamBuffer: '',
  lastStats: null,
  error: null,
};

export const usePanelStore = create<PanelState>((set) => ({
  ...INITIAL,

  setModelStatus: (modelStatus, backend) =>
    set((s) => ({ modelStatus, backend: backend === undefined ? s.backend : backend })),
  setDownloadPct: (downloadPct) => set({ downloadPct }),
  setBound: (boundCtx) => set({ boundCtx }),
  setPage: (page) => set({ page }),

  startTask: (currentTask) => set({ currentTask, streamBuffer: '', lastStats: null, error: null }),
  appendStream: (delta) => set((s) => ({ streamBuffer: s.streamBuffer + delta })),

  finishTask: (stats) =>
    set((s) => ({
      lastStats: stats,
      currentTask: s.currentTask
        ? {
            ...s.currentTask,
            status: s.streamBuffer.trim().length === 0 ? 'empty' : 'success',
            retryable: true,
          }
        : null,
    })),

  cancelTask: () =>
    set((s) => ({
      currentTask: s.currentTask ? { ...s.currentTask, status: 'cancelled', retryable: true } : null,
    })),

  failTask: (error) =>
    set((s) => ({
      error,
      currentTask: s.currentTask ? { ...s.currentTask, status: 'error', retryable: true } : null,
    })),

  setError: (error) => set({ error }),
  reset: () => set({ ...INITIAL }),
}));
```

> `finishTask` 里把「跑完但一个字都没输出」判为 `empty` 而非 `success`——这是 PRD §9.3 六态里最容易被漏掉的一态，在此一次性收口。

- [ ] **Step 7：类型检查**

Run: `npx tsc --noEmit`
Expected: 退出码 0

- [ ] **Step 8：提交**

```bash
git add package.json package-lock.json core/panel entrypoints/sidepanel/store.ts
git commit -m "feat: 面板六态状态容器与任务归属校验（单测覆盖）"
```

---

### Task 6: F-01 初始化与模型管理 UI

**Files**：
- Create: `entrypoints/sidepanel/InferenceProvider.tsx`
- Create: `entrypoints/sidepanel/components/ModelSetup.tsx`
- Create: `entrypoints/sidepanel/style.css`
- Modify: `core/inference/cacheSelection.ts` / `core/inference/cacheSelection.test.ts`（新增 `selectModelCacheUrls`）
- Modify: `entrypoints/sidepanel/App.tsx`（用 `ModelSetup` 替换 spike 的加载区）
- Modify: `entrypoints/sidepanel/main.tsx`（引入 `style.css`）

**Interfaces**：
- Consumes：`useInference()`（阶段一既有）、`usePanelStore`、`InitConfig/InitResult/LoadProgress`、`selectNewModelCacheUrls`。
- Produces：`<InferenceProvider>` 与 `useInferenceContext()`；`selectModelCacheUrls(urls, modelId)`；`<ModelSetup onReady={() => void} />`；模块常量 `MODEL_ID`、`REVISION`、`MODEL_DOWNLOAD_MB`。Task 8、10、12、13 一律通过 `useInferenceContext()` 取 Worker，**不得再直接调用 `useInference()`**。

- [ ] **Step 0：建立 `InferenceProvider`，保证全应用只有一个 Worker**

`useInference()` 的 Worker 句柄存在组件自己的 `useRef` 里——若 `ModelSetup` 与 `TaskPanel` 各调一次，会各自创建一个 Worker，模型被加载两遍、显存翻倍。Worker 必须提升到 App 之上：

```tsx
import { createContext, useContext, type ReactNode } from 'react';
import { useInference } from './useInference';

type InferenceHandle = ReturnType<typeof useInference>;

const InferenceContext = createContext<InferenceHandle | null>(null);

export function InferenceProvider({ children }: { children: ReactNode }) {
  const handle = useInference();
  return <InferenceContext.Provider value={handle}>{children}</InferenceContext.Provider>;
}

/** 全应用唯一的 Worker 入口。任何组件都不要再直接调用 useInference()。 */
export function useInferenceContext(): InferenceHandle {
  const handle = useContext(InferenceContext);
  if (!handle) throw new Error('useInferenceContext 必须在 InferenceProvider 内使用');
  return handle;
}
```

`main.tsx` 中用它包裹 `<App />`：

```tsx
root.render(
  <React.StrictMode>
    <InferenceProvider>
      <App />
    </InferenceProvider>
  </React.StrictMode>,
);
```

> Provider 位于 `App` 之上，所以 `App` 在 `ModelSetup` 与 `TaskPanel` 之间切换时不会卸载 Worker，模型保持已加载状态。

- [ ] **Step 1：写 `selectModelCacheUrls` 的失败测试**

在 `core/inference/cacheSelection.test.ts` 末尾追加：

```ts
import { selectModelCacheUrls } from './cacheSelection';

describe('selectModelCacheUrls', () => {
  const urls = [
    'https://huggingface.co/onnx-community/Qwen3-0.6B-ONNX/resolve/abc123/onnx/model_q4f16.onnx',
    'https://huggingface.co/onnx-community/Qwen3-0.6B-ONNX/resolve/abc123/tokenizer.json',
    'https://huggingface.co/onnx-community/other-model/resolve/abc123/model.onnx',
  ];

  it('只选中目标模型的缓存条目', () => {
    const selected = selectModelCacheUrls(urls, 'onnx-community/Qwen3-0.6B-ONNX');
    expect(selected).toHaveLength(2);
    expect(selected.every((u) => u.includes('Qwen3-0.6B-ONNX'))).toBe(true);
  });

  it('无匹配时返回空数组', () => {
    expect(selectModelCacheUrls(urls, 'onnx-community/not-cached')).toEqual([]);
  });
});
```

- [ ] **Step 2：运行测试确认失败**

Run: `npm test`
Expected: FAIL，`selectModelCacheUrls is not a function`

- [ ] **Step 3：实现 `selectModelCacheUrls`**

在 `core/inference/cacheSelection.ts` 追加（复用文件内既有的 modelId 匹配写法）：

```ts
/** 「删除该模型缓存」用：选中属于目标模型的全部缓存条目，不看 revision。 */
export function selectModelCacheUrls(urls: readonly string[], modelId: string): string[] {
  return urls.filter((url) => url.includes(modelId));
}
```

- [ ] **Step 4：运行测试确认通过**

Run: `npm test`
Expected: PASS，`cacheSelection.test.ts` 新增 2 项通过

- [ ] **Step 5：写 `entrypoints/sidepanel/components/ModelSetup.tsx`**

把 App.tsx 里既有的 `runInit` / `handleCancelDownload` / `snapshotModelCache` / `clearNewModelCacheEntries` 迁进本组件（逻辑保持阶段一已验收的行为：attempt 隔离、只清本次新增缓存、不自动回退），并补齐 F-01 缺失的产品要素：

```tsx
import { useEffect, useReducer, useRef, useState } from 'react';
import * as Comlink from 'comlink';
import { reduce } from '../../../core/inference/backend';
import { selectModelCacheUrls, selectNewModelCacheUrls } from '../../../core/inference/cacheSelection';
import type { LoadProgress } from '../../../core/inference/contract';
import { usePanelStore } from '../store';
import { useInferenceContext } from '../InferenceProvider';

export const MODEL_ID = 'onnx-community/Qwen3-0.6B-ONNX';
export const REVISION = 'da1453100cf3ff33ef56d17983fc7a8648706db6';
export const MODEL_DOWNLOAD_MB = 390;          // 阶段一实测 q4f16 权重规模
const REQUIRED_FREE_BYTES = 700 * 1024 * 1024; // 权重 + 缓存冗余的下限预检
const TRANSFORMERS_CACHE = 'transformers-cache';

interface StorageInfo { usageMb: number; quotaMb: number; freeMb: number; }
interface Props { onReady: () => void; }

export function ModelSetup({ onReady }: Props) { /* … */ }
```

组件必须覆盖以下 F-01 要素（每条对应 PRD §4 F-01 验收标准一行）：

1. **预检展示**：挂载时并行读 `navigator.storage.estimate()` 与 `'gpu' in navigator`，展示「模型名 / 来源 huggingface.co / 预计下载 390MB / 当前可用空间」，`free < REQUIRED_FREE_BYTES` 时显示 `STORAGE_FULL` 提示并把「开始下载」置灰，同时给出「清理模型缓存」入口。
2. **确认后才下载**：未点击「开始下载」不得发起任何网络请求。
3. **下载态**：进度条（`LoadProgress.pct`，单调不倒退）+ 「已下载 x% · 约 y MB / 390 MB」+ 「取消」按钮。
4. **取消**：沿用阶段一 `handleCancelDownload`（attempt 失效 → `recreate()` → 只清本次新增条目），状态回到可重试，错误码 `DOWNLOAD_CANCELLED`。
5. **失败重试**：`init` 抛错 → `dispatch({t:'init-fail'})`；WebGPU 失败进 `needs-user-choice` 并展示「使用 WASM 兼容模式（速度约为 WebGPU 的 1/3）」按钮；WASM 失败进 `error` 并展示原始原因与「重试」。
6. **缓存命中**：初始化前用 `caches.open(TRANSFORMERS_CACHE)` + `selectModelCacheUrls` 判断是否已有该模型条目，有则文案改为「从本地缓存加载」，不显示下载体积。
7. **离线且未缓存**：`navigator.onLine === false` 且无缓存条目 → 直接显示 `OFFLINE_NO_MODEL`「需要联网完成首次下载」，不进入 `initializing`。
8. **删除模型缓存**：按钮 → `selectModelCacheUrls` 选中条目 → `cache.delete` 逐条删除 → 重新探测并显示实际剩余条目数。
9. **就绪**：`ready` 后调用 `onReady()`，并把 `modelStatus/backend` 写入 `usePanelStore`。
10. **缓存被驱逐/损坏**（设计文档 §2.2）：初始化抛错且当时判定为"有缓存条目"时，说明浏览器驱逐了部分条目 —— 用 `selectModelCacheUrls` 清掉该模型的残留条目，报 `CACHE_CORRUPT` 并回到初始化页（显示需重新下载的体积），**不得停在无限加载**。
11. **revision/量化格式变更提示**：本阶段 `REVISION` 与 `q4f16/q8` 固定不变，该路径不会触发；在代码里以一行注释标注 `// PRD F-01：revision/量化变更时需先提示用户，v0.1 常量固定故不触发`，留待后续版本实现。

状态与 store 的对应关系（不得另立平行 state）：

```ts
  // initializing → 'loading'；有下载进度事件后 → 'downloading'；ready → 'ready'；error → 'error'
  const setModelStatus = usePanelStore((s) => s.setModelStatus);
  const setDownloadPct = usePanelStore((s) => s.setDownloadPct);
```

- [ ] **Step 6：写 `entrypoints/sidepanel/style.css` 并在 `main.tsx` 引入**

侧边栏宽度按 320–500px 弹性布局；只定义本阶段用到的类：`.wisp-root/.wisp-section/.wisp-btn/.wisp-btn--danger/.wisp-progress/.wisp-banner/.wisp-banner--error/.wisp-meta/.wisp-output`。要求：

```css
@media (prefers-reduced-motion: reduce) {
  * { animation: none !important; transition: none !important; }
}
.wisp-btn:focus-visible { outline: 2px solid #1a73e8; outline-offset: 2px; }
```

- [ ] **Step 7：构建并真机验收 F-01 五条路径**

Run: `npx tsc --noEmit && npm run build:dev`，重新加载扩展

  - **首次下载**：清空 `transformers-cache` → 打开面板 → 显示体积/来源/可用空间 → 点「开始下载」→ 进度单调递增 → 自检 → `ready（webgpu）`。
  - **缓存命中**：关闭并重开面板 → 文案为「从本地缓存加载」→ 秒级到 `ready`，Network 无权重请求。
  - **离线启动**：DevTools Network 勾 `Offline` → 重开面板 → 加载 → `ready` 且无网络请求；再清空缓存并保持 Offline → 显示「需要联网完成首次下载」。
  - **下载失败**：下载途中 DevTools 切 Offline → 显示失败文件与原因 + 「重试」可用。
  - **存储不足**：DevTools Application → Storage 配额调低（或临时把 `REQUIRED_FREE_BYTES` 调到超过实际可用值验证后改回）→ 显示用量与清理入口，「开始下载」置灰。
  - **删除模型缓存**：点击后 `navigator.storage.estimate()` 用量下降，重新加载会重新下载。

- [ ] **Step 8：提交**

```bash
git add core/inference/cacheSelection.ts core/inference/cacheSelection.test.ts entrypoints/sidepanel
git commit -m "feat: F-01 模型初始化、下载管理与缓存清理界面"
```

---

### Task 7: 安全 Markdown 流式渲染

**Files**：
- Create: `core/render/urlSafety.ts` / `core/render/urlSafety.test.ts`
- Create: `entrypoints/sidepanel/components/StreamMarkdown.tsx`
- Modify: `package.json`（新增依赖 `react-markdown`、`rehype-sanitize`）

**Interfaces**：
- Produces：`safeUrl(url: string): string`（不安全时返回空串）；`<StreamMarkdown text={string} />`。Task 8、12、13 一律用 `StreamMarkdown` 呈现模型输出，禁止直接渲染原始文本或 HTML。

- [ ] **Step 1：安装依赖**

```bash
npm install react-markdown rehype-sanitize
```

- [ ] **Step 2：写 `core/render/urlSafety.test.ts`（失败测试）**

```ts
import { describe, expect, it } from 'vitest';
import { safeUrl } from './urlSafety';

describe('safeUrl', () => {
  it('放行 http/https/mailto', () => {
    expect(safeUrl('https://example.com/a')).toBe('https://example.com/a');
    expect(safeUrl('http://example.com')).toBe('http://example.com');
    expect(safeUrl('mailto:a@example.com')).toBe('mailto:a@example.com');
  });

  it('放行相对链接（按 https 基址解析）', () => {
    expect(safeUrl('/docs/a')).toBe('/docs/a');
    expect(safeUrl('#anchor')).toBe('#anchor');
  });

  it('拦截 javascript: 及其大小写与空白变体', () => {
    expect(safeUrl('javascript:alert(1)')).toBe('');
    expect(safeUrl('JavaScript:alert(1)')).toBe('');
    expect(safeUrl('  javascript:alert(1)')).toBe('');
    expect(safeUrl('java\tscript:alert(1)')).toBe('');
  });

  it('拦截 data: 与 vbscript:', () => {
    expect(safeUrl('data:text/html,<script>alert(1)</script>')).toBe('');
    expect(safeUrl('vbscript:msgbox(1)')).toBe('');
  });

  it('无法解析的输入返回空串', () => {
    expect(safeUrl('')).toBe('');
    expect(safeUrl('http://[::1')).toBe('');
  });
});
```

- [ ] **Step 3：运行测试确认失败**

Run: `npm test`
Expected: FAIL，`Failed to resolve import "./urlSafety"`

- [ ] **Step 4：实现 `core/render/urlSafety.ts`**

```ts
const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);
const BASE = 'https://wisp.invalid/';

/**
 * 模型输出中的链接过滤：只放行 http/https/mailto 与相对链接。
 * 返回空串表示「不可作为 href 使用」，react-markdown 会因此去掉该链接。
 */
export function safeUrl(url: string): string {
  const raw = url.trim();
  if (raw === '') return '';
  // 去掉 URL 解析器会忽略的制表/换行，防止 "java\tscript:" 绕过
  const normalized = raw.replace(/[\t\n\r]/g, '');
  try {
    const parsed = new URL(normalized, BASE);
    return SAFE_PROTOCOLS.has(parsed.protocol) ? url : '';
  } catch {
    return '';
  }
}
```

- [ ] **Step 5：运行测试确认通过**

Run: `npm test`
Expected: PASS，`urlSafety.test.ts` 5 项全绿

- [ ] **Step 6：实现 `entrypoints/sidepanel/components/StreamMarkdown.tsx`**

```tsx
import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import { safeUrl } from '../../../core/render/urlSafety';

interface Props {
  text: string;
}

/**
 * 模型输出的唯一渲染出口：
 * - rehype-sanitize 默认白名单，原始 HTML 一律丢弃；
 * - urlTransform 过滤 javascript:/data: 等危险协议；
 * - 外链强制 noopener/noreferrer/nofollow。
 * 任何地方都不得使用 dangerouslySetInnerHTML。
 */
export function StreamMarkdown({ text }: Props) {
  return (
    <div className="wisp-output">
      <ReactMarkdown
        rehypePlugins={[rehypeSanitize]}
        urlTransform={safeUrl}
        components={{
          a: ({ children, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer nofollow">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
```

- [ ] **Step 7：真机验收渲染安全**

Run: `npm run build:dev`，重新加载扩展。在 spike 输入框粘贴以下文本走一次「总结」，或临时把它直接喂给 `StreamMarkdown` 渲染核对：

```text
[点我](javascript:alert(1)) 与 <img src=x onerror=alert(1)> 与 <script>alert(1)</script>

正常链接 [示例](https://example.com) 与 **加粗** 与 `代码`
```

  - 页面上不出现弹窗；`javascript:` 链接渲染为无 href 的纯文本；`<img>`/`<script>` 不进入 DOM（Elements 面板核对）。
  - 正常链接可点击，属性含 `rel="noopener noreferrer nofollow"` 与 `target="_blank"`。
  - 加粗与行内代码正常渲染。

- [ ] **Step 8：提交**

```bash
git add package.json package-lock.json core/render entrypoints/sidepanel/components/StreamMarkdown.tsx
git commit -m "feat: 安全 Markdown 流式渲染与危险链接过滤（单测覆盖）"
```

---

### Task 8: F-02 摘要与追问主链路（含防串页闭环）

**Files**：
- Create: `entrypoints/sidepanel/components/TaskPanel.tsx`
- Modify: `entrypoints/sidepanel/App.tsx`（清空 spike UI，改为 `ModelSetup` + `TaskPanel` 的产品外壳）

**Interfaces**：
- Consumes：`usePageChannel()`、`usePanelStore`、`useInferenceContext()`、`isCtxCurrent`、`StreamMarkdown`、`truncateForContext` 的产出（`page.text` 已截断）。
- Produces：`<TaskPanel />`；`runGeneration(type, opts)` 内部函数的行为契约（生成前 `startTask`，token 前校验 `isCtxCurrent`，结束写 `finishTask`）。Task 12 复用同一函数处理划词任务。

- [ ] **Step 1：写 `TaskPanel.tsx` 的生成主循环**

```tsx
import { useCallback, useRef, useState } from 'react';
import * as Comlink from 'comlink';
import type { GenStats } from '../../../core/inference/contract';
import { isCtxCurrent } from '../../../core/panel/taskGuard';
import type { TaskContext } from '../../../core/messaging/types';
import { usePanelStore, type TaskType } from '../store';
import { useInferenceContext } from '../InferenceProvider';
import { StreamMarkdown } from './StreamMarkdown';

interface RunOptions {
  type: TaskType;
  ctx: TaskContext;
  untrustedData: string;
  userInput?: string;
  targetLang?: 'zh' | 'en';
  source: string;
  maxNewTokens: number;
}

/**
 * 产品路径统一用 temperature 0.7：摘要与问答需要一定自然度，
 * 阶段一 fixture 用的 temperature 0 只服务于跨次可比的基准测量，两者不混用。
 */
const TEMPERATURE = 0.7;

export function TaskPanel() {
  const { getApi } = useInferenceContext();
  const store = usePanelStore();
  const signalIdRef = useRef<string | null>(null);
  const [isStopping, setIsStopping] = useState(false);

  const runGeneration = useCallback(
    async (opts: RunOptions) => {
      // 单活跃任务不变式：新任务开始前先中断旧任务，避免两条流交替写同一个 streamBuffer
      const previous = signalIdRef.current;
      if (previous) {
        const api = await getApi();
        api.cancel(previous);
      }

      const signalId = crypto.randomUUID();
      signalIdRef.current = signalId;
      store.startTask({
        id: signalId,
        type: opts.type,
        ctx: opts.ctx,
        status: 'loading',
        retryable: false,
        source: opts.source,
      });

      /** 本任务是否仍是当前任务。旧任务的回调一律不得改写新任务的状态。 */
      const isMine = () => usePanelStore.getState().currentTask?.id === signalId;

      try {
        const api = await getApi();
        const stats: GenStats = await api.generate(
          {
            taskType: opts.type,
            untrustedData: opts.untrustedData,
            userInput: opts.userInput,
            targetLang: opts.targetLang,
            params: { maxNewTokens: opts.maxNewTokens, temperature: TEMPERATURE },
          },
          signalId,
          Comlink.proxy((delta: string) => {
            if (!isMine()) {
              void getApi().then((a) => a.cancel(signalId));   // 迟到的旧任务，丢弃并中断
              return;
            }
            // 防串页闭环末端：ctx 失效即丢弃 token 并中断 Worker
            const bound = usePanelStore.getState().boundCtx;
            if (!isCtxCurrent(opts.ctx, bound)) {
              void getApi().then((a) => a.cancel(signalId));
              return;
            }
            store.appendStream(delta);
          }),
        );
        // 用户已点停止时保留 cancelled 态，不要覆盖成 success/empty
        if (isMine() && usePanelStore.getState().currentTask?.status !== 'cancelled') {
          store.finishTask(stats);
        }
      } catch (error) {
        if (isMine()) store.failTask({ code: 'WORKER_ERROR', message: String(error) });
      } finally {
        // 只有本任务仍是当前任务时才清；否则会把接任者的 signalId 抹掉
        if (signalIdRef.current === signalId) {
          signalIdRef.current = null;
          setIsStopping(false);
        }
      }
    },
    [getApi, store],
  );

  const stop = useCallback(async () => {
    const id = signalIdRef.current;
    if (!id || isStopping) return;
    setIsStopping(true);
    store.cancelTask();
    const api = await getApi();
    api.cancel(id);
  }, [getApi, isStopping, store]);

  /* 摘要 / 追问 / 重新生成 / 复制 的按钮区与结果区见 Step 2、3 */
}
```

- [ ] **Step 2：接入 F-02 的四个用户动作**

| 动作 | 触发条件 | 行为 |
|---|---|---|
| 在本页启用 Wisp | `boundCtx === null` | `const ctx = await bindActiveTab()`；`ctx` 非空则 `readPage('initial', ctx)` → `setPage`。**必须把 ctx 传下去**，此刻 `boundCtx` state 尚未提交 |
| 重新读取页面 | 已绑定 | `readPage('reread')` → 覆盖 `page`，清空 `streamBuffer` |
| 生成摘要 | `modelStatus==='ready' && page !== null` | `runGeneration({ type:'summary', untrustedData: page.text, source: page.title, ctx: page 对应 ctx })` |
| 追问 | 同上 + 输入框非空 | `runGeneration({ type:'qa', untrustedData: page.text, userInput: 问题, source: 问题 })` |

结果区固定展示：`<StreamMarkdown text={streamBuffer} />` + 「停止 / 复制 / 重新生成」+ 六态提示：

```tsx
  const statusText: Record<AsyncStatus, string> = {
    idle: '',
    loading: '正在生成…',
    success: '',
    empty: '模型没有返回内容，可重新生成或换个问题',
    error: store.error?.message ?? '生成失败',
    cancelled: '已停止生成',
  };
```

- [ ] **Step 3：常驻来源标识、超长提示与切标签横幅**

**(a) 来源标识（`page !== null` 时常驻，不受切标签影响）**：

```tsx
  <p className="wisp-meta">
    内容来自：{store.page.title || '（无标题）'} · 本页 {store.page.charCount} 字
    {store.page.truncated
      ? ` · 仅分析了前 ${store.page.text.length} 字（PAGE_TOO_LONG）`
      : ' · 已全文分析'}
    {store.page.method === 'heuristic' ? ' · 简易提取' : ''}
  </p>
```

**(b) 切标签横幅（`activeTab.tabId !== boundCtx.tabId` 时追加在来源标识下方）**——文案必须体现快照语义，不得暗示还在读原页面：

```tsx
  const banner = isGenerating
    ? `正在基于《${store.page.title}》的已读取内容生成`
    : `当前结果来自《${store.page.title}》，你正在看另一个标签页`;
  // 两种情况都带同一个操作入口：[改读当前页]
```

**(c) 「改读当前页」的状态迁移（逐条明确，不留歧义）**：

| 项目 | 规定行为 | 理由 |
|---|---|---|
| 在途生成 | 立即 `cancel()` 并置 `cancelled` | 用户已经不看那一页了，继续烧算力没意义 |
| 已生成内容 | **保留**，并把来源标识固定为旧页面标题（加"（历史）"后缀） | 用户可能正要复制它；直接清空是数据丢失 |
| 会话 | 新页面读取成功后创建/切换到该页会话（`ensureSession` 按 tabId+url 判定） | 与 F-07「按 tabId + URL 关联」一致 |
| 未发送的追问输入 | **清空** | 那句提问是针对旧页面提的，留着会被误发到新上下文 |
| 新页面读取失败 | **不改变绑定**，保持旧 `boundCtx` 与旧结果，只显示错误横幅 | 悄悄解绑会让用户面对一个既没有旧内容也没有新内容的空面板 |

```ts
  const handleRebind = async () => {
    const previousPage = usePanelStore.getState().page;
    await stop();                                   // 取消在途生成（幂等，无任务时是空操作）
    const ctx = await page.bindActiveTab();
    if (!ctx) return;                               // 绑定失败：一切保持原样，错误已由 lastError 呈现
    const extracted = await page.readPage('initial', ctx);
    if (!extracted) {                               // 读取失败：回退到旧绑定，不留半绑定状态
      store.setBound(previousPage ? usePanelStore.getState().boundCtx : null);
      return;
    }
    setUserInput('');                               // 旧页面的提问不带到新页面
    store.setPage({ /* 由 extracted 组装 */ });
    store.setBound(extracted.ctx);
  };
```

- [ ] **Step 4：重写 `App.tsx` 为产品外壳**

删除阶段一 spike 的全部 UI（后端按钮组、fixture 载入、GenStats 调试块、Task 4 的临时「读取本页」按钮），保留结构：

```tsx
export function App() {
  const modelStatus = usePanelStore((s) => s.modelStatus);
  return (
    <main className="wisp-root">
      <header className="wisp-section">Wisp</header>
      {modelStatus !== 'ready' ? <ModelSetup onReady={() => undefined} /> : <TaskPanel />}
    </main>
  );
}
```

> Worker 由 `main.tsx` 里的 `<InferenceProvider>`（Task 6 Step 0）持有，位于 `App` 之上，所以这里在 `ModelSetup` 与 `TaskPanel` 之间切换不会销毁 Worker、不会让已加载的模型掉线。设置页入口在 Task 10 接入。

> 阶段一的 `core/bench/fixture.ts` 与其单测**保留不删**（Task 14 复测需要），只是不再出现在产品 UI 上。

- [ ] **Step 5：构建并真机验收 F-02**

Run: `npx tsc --noEmit && npm run build:dev`，重新加载扩展

  - 在一篇长文章页：启用 → 显示标题与字数 → 生成摘要流式输出 → 中途「停止」，500ms 内停字、1s 内任务结束、状态显示「已停止生成」。
  - 「重新生成」可再次产出；「复制」把结果写入剪贴板。
  - 追问一个页面内问题，答案与页面相关；追问一个页面外问题，模型给出「资料未提供」类回答而非编造。
  - 超长页（> 3000 字）出现「仅分析了前 N 字」。
下列每条都写明了**预期结果**，观察到的行为与预期不符即验收不通过（不要只跑一遍场景就打勾）：

| 场景 | 预期结果 |
|---|---|
| 生成途中切到另一标签页 | 生成**继续**并正常完成（快照语义）；来源标识仍显示原页面标题；追加横幅「正在基于《原标题》的已读取内容生成 · 改读当前页」；新标签页内容绝不混入结果 |
| 摘要完成后切到另一标签页 | 来源标识**持续可见**（不因为生成结束就消失）；横幅变为「当前结果来自《原标题》，你正在看另一个标签页」；此时追问仍基于原页面快照 |
| 点击「改读当前页」（新页可读） | 在途生成立即停止并显示"已停止"；旧结果**保留**且来源标识标注为历史；追问输入框清空；读取新页成功后来源标识切换到新页面；会话切换到新页面 |
| 点击「改读当前页」（新页受限，如 `chrome://`） | 显示受限页面错误横幅；**绑定与结果保持不变**，仍是旧页面；不出现"既无旧内容也无新内容"的空面板 |
| 生成途中刷新原页面 | 出现「页面已跳转，旧任务已作废」；token 停止追加；结果区保留已生成的部分 |
| SPA 站内路由切换（不整页刷新） | 与刷新同样作废旧上下文并提示可重新读取。`tabs.onUpdated` 覆盖不到这一路，靠 CS 的 `PAGE_NAVIGATED` —— **v0.1.1 新增必测项** |
| 生成途中再次点击「生成摘要」 | 旧任务被 `cancel`；结果区**只**显示新任务输出，不出现两段文字交错；旧任务的完成/失败回调不改写新任务状态 |
| `chrome://extensions` 手动「结束服务工作进程」后立即生成 | 任务正常执行；**不**出现莫名的「任务已作废」（epoch 由 `chrome.storage.session` 恢复，未倒退回 0） |

- [ ] **Step 6：提交**

```bash
git add entrypoints/sidepanel
git commit -m "feat: F-02 网页摘要与追问主链路，含防串页闭环"
```

---

### Task 9: 会话存储、级联清理与隐身模式

**Files**：
- Create: `core/storage/db.ts`
- Create: `core/storage/cleanup.ts` / `core/storage/cleanup.test.ts`
- Modify: `entrypoints/background.ts`（启动 TTL 清扫 + `tabs.onRemoved` 清理）
- Modify: `entrypoints/sidepanel/components/TaskPanel.tsx`（生成结束写入会话）
- Modify: `package.json`（新增依赖 `dexie`，devDep `fake-indexeddb`）

**Interfaces**：
- Consumes：`Settings.retentionDays`（Task 10 定义默认值，本任务先用常量 `DEFAULT_RETENTION_DAYS = 7`）。
- Produces：`WispDB`、`Session`、`Message`、`selectExpiredSessionIds(sessions, now)`、`purgeSessions(db, ids)`、`purgeExpired(db, now)`、`purgeByTab(db, tabId)`、`appendMessage(db, sessionId, role, content, taskType)`。

- [ ] **Step 1：安装依赖**

```bash
npm install dexie
npm install -D fake-indexeddb
```

- [ ] **Step 2：写 `core/storage/db.ts`**

```ts
import Dexie, { type Table } from 'dexie';
import type { SelectionAction, Uuid } from '../messaging/types';

export const DEFAULT_RETENTION_DAYS = 7;
export const DAY_MS = 86_400_000;

export interface Session {
  id: Uuid;
  tabId: number;
  url: string;
  title: string;
  incognito: boolean;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
}

export interface Message {
  id: Uuid;
  sessionId: Uuid;
  role: 'user' | 'assistant';
  content: string;
  taskType?: SelectionAction | 'summary' | 'qa';
  createdAt: number;
}

export class WispDB extends Dexie {
  sessions!: Table<Session, Uuid>;
  messages!: Table<Message, Uuid>;

  constructor(name = 'wisp') {
    super(name);
    this.version(1).stores({
      sessions: 'id, tabId, url, expiresAt',
      messages: 'id, sessionId, createdAt',
    });
  }
}

/** SW 与 Panel 各自持有一个连接；Dexie 会共用同一个 IndexedDB 数据库。 */
export const db = new WispDB();
```

- [ ] **Step 3：写 `core/storage/cleanup.test.ts`（失败测试）**

```ts
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { WispDB, type Session } from './db';
import { appendMessage, purgeByTab, purgeExpired, purgeSessions, selectExpiredSessionIds } from './cleanup';

function session(id: string, tabId: number, expiresAt: number): Session {
  return { id, tabId, url: `https://example.com/${id}`, title: id, incognito: false,
           createdAt: 0, updatedAt: 0, expiresAt };
}

let db: WispDB;

beforeEach(async () => {
  db = new WispDB(`wisp-test-${Math.random()}`);
  await db.open();
  await db.sessions.bulkAdd([session('a', 1, 100), session('b', 1, 500), session('c', 2, 100)]);
  await appendMessage(db, 'a', 'user', '问题 a', 'qa');
  await appendMessage(db, 'a', 'assistant', '回答 a', 'qa');
  await appendMessage(db, 'b', 'user', '问题 b', 'summary');
  await appendMessage(db, 'c', 'user', '问题 c', 'summary');
});

describe('selectExpiredSessionIds', () => {
  it('只选出 expiresAt 已过的会话', () => {
    const rows = [session('a', 1, 100), session('b', 1, 500)];
    expect(selectExpiredSessionIds(rows, 200)).toEqual(['a']);
  });

  it('边界值 expiresAt === now 视为已过期', () => {
    expect(selectExpiredSessionIds([session('a', 1, 100)], 100)).toEqual(['a']);
  });

  it('无过期会话时返回空数组', () => {
    expect(selectExpiredSessionIds([session('b', 1, 500)], 200)).toEqual([]);
  });
});

describe('purgeSessions', () => {
  it('级联删除消息，不留孤儿', async () => {
    await purgeSessions(db, ['a']);
    expect(await db.sessions.get('a')).toBeUndefined();
    expect(await db.messages.where('sessionId').equals('a').count()).toBe(0);
    expect(await db.messages.where('sessionId').equals('b').count()).toBe(1);
  });

  it('传空数组时不动任何数据', async () => {
    await purgeSessions(db, []);
    expect(await db.sessions.count()).toBe(3);
    expect(await db.messages.count()).toBe(4);
  });
});

describe('purgeExpired', () => {
  it('按 now 清理过期会话及其消息并返回条数', async () => {
    expect(await purgeExpired(db, 200)).toBe(2);
    expect(await db.sessions.count()).toBe(1);
    expect(await db.messages.count()).toBe(1);
  });
});

describe('purgeByTab', () => {
  it('只清理指定标签页的会话', async () => {
    expect(await purgeByTab(db, 1)).toBe(2);
    expect((await db.sessions.toArray()).map((s) => s.id)).toEqual(['c']);
    expect(await db.messages.count()).toBe(1);
  });
});
```

- [ ] **Step 4：运行测试确认失败**

Run: `npm test`
Expected: FAIL，`Failed to resolve import "./cleanup"`

- [ ] **Step 5：实现 `core/storage/cleanup.ts`**

```ts
import type { WispDB, Message, Session } from './db';
import type { SelectionAction, Uuid } from '../messaging/types';

export function selectExpiredSessionIds(
  sessions: readonly Pick<Session, 'id' | 'expiresAt'>[],
  now: number,
): Uuid[] {
  return sessions.filter((s) => s.expiresAt <= now).map((s) => s.id);
}

/** Dexie 无级联删除：必须在同一事务里先删消息再删会话，否则留孤儿 messages。 */
export async function purgeSessions(db: WispDB, ids: readonly Uuid[]): Promise<void> {
  if (ids.length === 0) return;
  await db.transaction('rw', db.sessions, db.messages, async () => {
    await db.messages.where('sessionId').anyOf(ids as Uuid[]).delete();
    await db.sessions.bulkDelete(ids as Uuid[]);
  });
}

export async function purgeExpired(db: WispDB, now: number): Promise<number> {
  const rows = await db.sessions.where('expiresAt').belowOrEqual(now).toArray();
  const ids = rows.map((s) => s.id);
  await purgeSessions(db, ids);
  return ids.length;
}

export async function purgeByTab(db: WispDB, tabId: number): Promise<number> {
  const rows = await db.sessions.where('tabId').equals(tabId).toArray();
  const ids = rows.map((s) => s.id);
  await purgeSessions(db, ids);
  return ids.length;
}

export async function appendMessage(
  db: WispDB,
  sessionId: Uuid,
  role: Message['role'],
  content: string,
  taskType?: SelectionAction | 'summary' | 'qa',
): Promise<Uuid> {
  const id = crypto.randomUUID();
  await db.transaction('rw', db.sessions, db.messages, async () => {
    await db.messages.add({ id, sessionId, role, content, taskType, createdAt: Date.now() });
    await db.sessions.update(sessionId, { updatedAt: Date.now() });
  });
  return id;
}
```

- [ ] **Step 6：运行测试确认通过**

Run: `npm test`
Expected: PASS，`cleanup.test.ts` 8 项全绿

- [ ] **Step 7：SW 接入生命周期清理**

在 `entrypoints/background.ts` 顶部补 import：

```ts
import { db, DEFAULT_RETENTION_DAYS } from '../core/storage/db';
import { purgeByTab, purgeExpired } from '../core/storage/cleanup';
```

并在 `defineBackground` 内追加：

```ts
  // 启动 TTL 清扫：SW 每次被唤醒都便宜地扫一次过期会话
  void purgeExpired(db, Date.now()).catch((error) => console.error('[wisp] purgeExpired', error));

  chrome.tabs.onRemoved.addListener((tabId) => {
    void (async () => {
      const { retentionDays = DEFAULT_RETENTION_DAYS } = await chrome.storage.local.get('retentionDays');
      if (retentionDays === 0) await purgeByTab(db, tabId);
    })().catch((error) => console.error('[wisp] purgeByTab', error));
  });
```

> 与既有的 `chrome.tabs.onRemoved`（`epochs.forget` + 广播）合并为一个监听器，不要注册两次。

- [ ] **Step 8：Panel 接入会话写入（隐身模式不落盘）**

在 `TaskPanel.tsx` 中：

```ts
const INCOGNITO = chrome.extension.inIncognitoContext;

async function ensureSession(page: PageInfo, ctx: TaskContext): Promise<Uuid | null> {
  if (INCOGNITO) return null;                    // 隐身会话只存在于内存
  const existing = await db.sessions.where('tabId').equals(ctx.tabId).first();
  if (existing && existing.url === ctx.url) return existing.id;
  const id = crypto.randomUUID();
  const now = Date.now();
  const { retentionDays = DEFAULT_RETENTION_DAYS } = await chrome.storage.local.get('retentionDays');
  await db.sessions.add({
    id, tabId: ctx.tabId, url: ctx.url, title: page.title, incognito: false,
    createdAt: now, updatedAt: now,
    expiresAt: retentionDays === 0 ? now + DAY_MS : now + retentionDays * DAY_MS,
  });
  return id;
}
```

生成成功（`finishTask` 之后）写入两条消息：用户侧记 `userInput ?? '生成摘要'`，助手侧记 `streamBuffer`。取消或失败的任务**不写入**。

**导航后旧会话的处理（PRD §4 F-07）**：`ensureSession` 在 `tabId` 命中但 `url` 不同时**不复用旧会话**，而是新建一条 —— 旧会话原样保留在库中直到 TTL 到期。UI 侧在结果区顶部按 `currentTask.ctx.url !== page.url` 显示「本结果来自：{旧 URL 的 host + 路径}」，让"结果来自旧页面"这件事对用户可见，而不是悄悄混在当前页上下文里。

- [ ] **Step 9：真机验收**

Run: `npm run build:dev`，重新加载扩展

  - 生成一次摘要 → DevTools Application → IndexedDB → `wisp` → `sessions` 1 条、`messages` 2 条。
  - 设置 `retentionDays=0`（先手工 `chrome.storage.local.set({retentionDays:0})`）→ 关闭该标签页 → 会话与消息一并消失，无孤儿 `messages`。
  - 隐身窗口（需在扩展详情页勾选「在无痕模式下启用」）中生成一次 → IndexedDB 无新增记录。

- [ ] **Step 10：提交**

```bash
git add package.json package-lock.json core/storage entrypoints
git commit -m "feat: 会话存储、级联清理与隐身模式不落盘（单测覆盖）"
```

---

### Task 10: 设置、存储用量与清除数据

> ⚠️ **本任务的 Step 2 / 5 / 8 已失效**：`outputLength` 模块整体裁撤，`Settings` 不含该字段，本任务不改 `TaskPanel.tsx`；「后端切换」不再是可裁剪项；`selectModelCacheUrls` 不存在。三条修正见 §0.1.1（R1/R2/R3），与下文冲突时以 §0.1.1 为准。

**Files**：
- Create: `core/storage/settings.ts` / `core/storage/settings.test.ts`
- Create: `core/panel/outputLength.ts` / `core/panel/outputLength.test.ts`
- Create: `entrypoints/sidepanel/components/SettingsPanel.tsx`
- Modify: `entrypoints/sidepanel/App.tsx`（接入设置页切换）
- Modify: `entrypoints/sidepanel/components/TaskPanel.tsx`（`maxNewTokens` 改由设置决定）

**Interfaces**：
- Produces：`Settings`、`DEFAULT_SETTINGS`、`mergeSettings(stored)`、`loadSettings()`、`saveSettings(patch)`；`maxNewTokensFor(outputLength)`；`<SettingsPanel />`。Task 8 的 `runGeneration` 改用 `maxNewTokensFor(settings.outputLength)`。

- [ ] **Step 1：写 `core/storage/settings.test.ts`（失败测试）**

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, mergeSettings } from './settings';

describe('mergeSettings', () => {
  it('空存储返回默认设置', () => {
    expect(mergeSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  it('保留合法的已存值', () => {
    expect(mergeSettings({ outputLength: 'long', retentionDays: 0 })).toEqual({
      ...DEFAULT_SETTINGS,
      outputLength: 'long',
      retentionDays: 0,
    });
  });

  it('丢弃非法值，回落到默认', () => {
    expect(mergeSettings({ backend: 'cuda', outputLength: 'huge', retentionDays: 99 })).toEqual(
      DEFAULT_SETTINGS,
    );
  });

  it('默认值符合 PRD：auto / medium / 7 天', () => {
    expect(DEFAULT_SETTINGS.backend).toBe('auto');
    expect(DEFAULT_SETTINGS.outputLength).toBe('medium');
    expect(DEFAULT_SETTINGS.retentionDays).toBe(7);
  });
});
```

- [ ] **Step 2：写 `core/panel/outputLength.test.ts`（失败测试）**

```ts
import { describe, expect, it } from 'vitest';
import { maxNewTokensFor } from './outputLength';

describe('maxNewTokensFor', () => {
  it('三档输出长度映射到确定的 token 上限', () => {
    expect(maxNewTokensFor('short')).toBe(128);
    expect(maxNewTokensFor('medium')).toBe(256);
    expect(maxNewTokensFor('long')).toBe(512);
  });

  it('medium 与阶段一基准的 maxNewTokens 对齐', () => {
    expect(maxNewTokensFor('medium')).toBe(256);
  });
});
```

- [ ] **Step 3：运行测试确认失败**

Run: `npm test`
Expected: FAIL，`Failed to resolve import "./settings"` / `"./outputLength"`

- [ ] **Step 4：实现 `core/storage/settings.ts`**

```ts
export interface Settings {
  backend: 'auto' | 'webgpu' | 'wasm';
  outputLength: 'short' | 'medium' | 'long';
  retentionDays: 7 | 0;
  modelId: string;
}

export const DEFAULT_SETTINGS: Settings = {
  backend: 'auto',
  outputLength: 'medium',
  retentionDays: 7,
  modelId: 'onnx-community/Qwen3-0.6B-ONNX',
};

const BACKENDS = ['auto', 'webgpu', 'wasm'] as const;
const LENGTHS = ['short', 'medium', 'long'] as const;

/** 存储里的值可能来自旧版本或被手工改坏，非法值一律回落默认。 */
export function mergeSettings(stored: Record<string, unknown>): Settings {
  const backend = BACKENDS.find((b) => b === stored.backend) ?? DEFAULT_SETTINGS.backend;
  const outputLength = LENGTHS.find((l) => l === stored.outputLength) ?? DEFAULT_SETTINGS.outputLength;
  const retentionDays = stored.retentionDays === 0 || stored.retentionDays === 7
    ? (stored.retentionDays as 7 | 0)
    : DEFAULT_SETTINGS.retentionDays;
  const modelId = typeof stored.modelId === 'string' && stored.modelId.length > 0
    ? stored.modelId
    : DEFAULT_SETTINGS.modelId;
  return { backend, outputLength, retentionDays, modelId };
}

export async function loadSettings(): Promise<Settings> {
  return mergeSettings(await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS)));
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = mergeSettings({ ...(await loadSettings()), ...patch });
  await chrome.storage.local.set(next);
  return next;
}
```

- [ ] **Step 5：实现 `core/panel/outputLength.ts`**

```ts
import type { Settings } from '../storage/settings';

const TOKENS: Record<Settings['outputLength'], number> = {
  short: 128,
  medium: 256,   // 与阶段一基准 BENCH_PARAMS 一致，保证实测数据可比
  long: 512,
};

export function maxNewTokensFor(outputLength: Settings['outputLength']): number {
  return TOKENS[outputLength];
}
```

- [ ] **Step 6：运行测试确认通过**

Run: `npm test`
Expected: PASS，`settings.test.ts` 4 项 + `outputLength.test.ts` 2 项全绿

- [ ] **Step 7：实现 `SettingsPanel.tsx`**

必须包含以下五组（对应 PRD §3 P0「基础隐私说明」、§4 F-07 与 §7）：

1. **模型与后端**：显示当前 `modelStatus` / `backend` / `MODEL_ID` / `REVISION` 前 7 位；`backend` 三选一（改动仅影响下次初始化，当前会话需点「重新加载模型」生效）。
2. **输出长度**：`short/medium/long` 三选一，写入设置后对下一次生成生效。
3. **数据用量**：`navigator.storage.estimate()` 的 usage/quota（MB）+ 会话数（`db.sessions.count()`）+ 模型缓存条目数（`selectModelCacheUrls`）。
4. **清除数据**（三个独立按钮，各自二次确认）：

```ts
async function clearModelCache(): Promise<string> { /* 删 transformers-cache 中该模型条目 */ }
async function clearSessions(): Promise<string> { /* purgeSessions(db, 全部 id) */ }
async function clearAll(): Promise<string> {
  await clearModelCache();
  await clearSessions();
  await chrome.storage.local.clear();
  // PRD §7：清除后必须再次探测并显示实际结果，而不是宣称成功
  const after = await navigator.storage.estimate();
  const cacheLeft = (await caches.has('transformers-cache'))
    ? (await (await caches.open('transformers-cache')).keys()).length
    : 0;
  const sessionsLeft = await db.sessions.count();
  return `清理完成：剩余缓存条目 ${cacheLeft} 个、会话 ${sessionsLeft} 条、占用约 ${Math.round((after.usage ?? 0) / 1048576)}MB`;
}
```

5. **基础隐私说明**（PRD §3 P0 明列，§8.2 规定内容）：设置页底部一个可展开的「隐私与权限」区块，文案逐条写明，不用泛泛的"我们重视您的隐私"：

```tsx
const PRIVACY_NOTICE = [
  '本地运行：网页正文、选区、提问与回答全部在你的浏览器内处理，不发送到任何服务器。',
  '唯一的出网行为：你点击「开始下载」后，从 huggingface.co 及其 CDN 下载模型权重与分词器。除此之外没有任何业务请求。',
  '无账户、无遥测、无广告 SDK、无远程错误日志。',
  '本地保存的内容：会话与消息存在浏览器 IndexedDB（默认 7 天，可改为「关闭标签页即删除」）；模型权重存在 Cache API；设置存在扩展存储。三者都可在上方一键清除。',
  '本地数据不做应用层加密，无法防止使用同一操作系统账户的其他人读取。',
  '权限用途：sidePanel 显示界面 · scripting 注入读取脚本 · storage 保存设置 · 网站访问权限用于读取你正在看的网页正文。',
  '虽然拥有网站访问权限，但正文只在你点击「读取当前页」或使用划词时读取一次，之后使用内存快照，不会持续监视网页。',
  '不读取也不写入密码、验证码、支付与身份认证字段；不会自动点击页面上的任何按钮。',
];
```

同一份文案后续复用为 Chrome Web Store 的 Data Usage 说明底稿（阶段四）。

- [ ] **Step 8：把 `maxNewTokens` 接到设置**

在 `TaskPanel.tsx` 里读设置并替换 Task 8 中写死的值：

```ts
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  useEffect(() => { void loadSettings().then(setSettings); }, []);
  // runGeneration 调用处：maxNewTokens: maxNewTokensFor(settings.outputLength)
```

- [ ] **Step 9：构建并真机验收**

Run: `npx tsc --noEmit && npm run build:dev`，重新加载扩展

  - 改「输出长度」为 short → 下一次摘要明显更短且 `GenStats.truncated` 行为一致。
  - 改「保留时长」为「不保留」→ 关闭标签页后会话消失（复核 Task 9 路径）。
  - 「清除全部数据」→ 提示里的剩余条目数、会话数、占用为**再次探测**的真实值；随后重开面板回到初始化页，不出现无限加载。

- [ ] **Step 10：提交**

```bash
git add core/storage/settings.ts core/storage/settings.test.ts core/panel entrypoints/sidepanel
git commit -m "feat: 设置、存储用量与清除数据入口（单测覆盖）"
```

---

### Task 11: 划词选区判定与 Shadow DOM 工具条

**Files**：
- Create: `core/extract/selection.ts` / `core/extract/selection.test.ts`
- Create: `core/extract/sensitive.ts` / `core/extract/sensitive.test.ts`
- Create: `components/SelectionToolbar.tsx` / `components/selectionToolbar.css`
- Modify: `entrypoints/content.ts`（挂载工具条 + 选区监听）

**Interfaces**：
- Produces：`MIN_SELECTION`、`MAX_SELECTION`、`normalizeSelection(raw)`、`isSelectionUsable(text)`、`detectLang(text)`、`defaultTargetLang(lang)`、`isSensitiveTarget(el)`；`<SelectionToolbar onAction={(action) => void} />`。Task 12 消费工具条发出的 `TOOLBAR_ACTION`。

- [ ] **Step 1：写 `core/extract/selection.test.ts`（失败测试）**

```ts
import { describe, expect, it } from 'vitest';
import {
  MAX_SELECTION, MIN_SELECTION, defaultTargetLang, detectLang, isSelectionUsable, normalizeSelection,
} from './selection';

describe('normalizeSelection', () => {
  it('去首尾空白并折叠内部连续空白', () => {
    expect(normalizeSelection('  你好   世界 \n\n 再见  ')).toBe('你好 世界\n再见');
  });
});

describe('isSelectionUsable', () => {
  it('低于下限不可用', () => {
    expect(isSelectionUsable('一')).toBe(false);
    expect(isSelectionUsable('')).toBe(false);
  });
  it('区间内可用', () => {
    expect(isSelectionUsable('你好')).toBe(true);
    expect(MIN_SELECTION).toBe(2);
  });
  it('超过上限不可用', () => {
    expect(isSelectionUsable('字'.repeat(MAX_SELECTION + 1))).toBe(false);
    expect(MAX_SELECTION).toBe(4000);
  });
});

describe('detectLang', () => {
  it('含较多汉字判为 zh', () => {
    expect(detectLang('这是一段中文文本')).toBe('zh');
  });
  it('纯英文判为 en', () => {
    expect(detectLang('This is an English sentence.')).toBe('en');
  });
  it('中英混排以汉字占比为准', () => {
    expect(detectLang('这段文本 mixes 中文 and English 内容')).toBe('zh');
  });
  it('无字母无汉字判为 other', () => {
    expect(detectLang('123 456 !!!')).toBe('other');
  });
});

describe('defaultTargetLang', () => {
  it('中文选区默认译成英文，其余默认译成中文', () => {
    expect(defaultTargetLang('zh')).toBe('en');
    expect(defaultTargetLang('en')).toBe('zh');
    expect(defaultTargetLang('other')).toBe('zh');
  });
});
```

- [ ] **Step 2：写 `core/extract/sensitive.test.ts`（失败测试）**

```ts
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { isSensitiveTarget } from './sensitive';

function el(html: string): Element {
  const host = document.createElement('div');
  host.innerHTML = html;
  return host.firstElementChild!;
}

describe('isSensitiveTarget', () => {
  it('密码框敏感', () => {
    expect(isSensitiveTarget(el('<input type="password">'))).toBe(true);
  });

  it('按 autocomplete 识别一次性验证码与银行卡', () => {
    expect(isSensitiveTarget(el('<input autocomplete="one-time-code">'))).toBe(true);
    expect(isSensitiveTarget(el('<input autocomplete="cc-number">'))).toBe(true);
  });

  it('按 name/id/aria-label 的中英文关键词识别', () => {
    expect(isSensitiveTarget(el('<input name="verifyCode">'))).toBe(true);
    expect(isSensitiveTarget(el('<input id="cvv">'))).toBe(true);
    expect(isSensitiveTarget(el('<input aria-label="支付密码">'))).toBe(true);
  });

  it('祖先链上的敏感容器也算敏感', () => {
    const form = el('<form data-sensitive="true"><div><span id="t">文本</span></div></form>');
    expect(isSensitiveTarget(form.querySelector('#t'))).toBe(true);
  });

  it('普通文本与普通输入框不敏感', () => {
    expect(isSensitiveTarget(el('<p>普通正文</p>'))).toBe(false);
    expect(isSensitiveTarget(el('<input type="text" name="nickname">'))).toBe(false);
  });

  it('null 不敏感', () => {
    expect(isSensitiveTarget(null)).toBe(false);
  });
});
```

- [ ] **Step 3：运行测试确认失败**

Run: `npm test`
Expected: FAIL，两个模块均无法解析

- [ ] **Step 4：实现 `core/extract/selection.ts`**

```ts
import type { Lang } from '../messaging/types';

export const MIN_SELECTION = 2;
export const MAX_SELECTION = 4000;

export function normalizeSelection(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

export function isSelectionUsable(text: string): boolean {
  return text.length >= MIN_SELECTION && text.length <= MAX_SELECTION;
}

/** 汉字占比 ≥ 15% 判 zh；否则看拉丁字母是否占多数判 en；都不满足为 other。 */
export function detectLang(text: string): Lang {
  const total = text.replace(/\s/g, '').length;
  if (total === 0) return 'other';
  const han = (text.match(/[一-鿿]/g) ?? []).length;
  if (han / total >= 0.15) return 'zh';
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  return latin / total >= 0.5 ? 'en' : 'other';
}

export function defaultTargetLang(lang: Lang): 'zh' | 'en' {
  return lang === 'zh' ? 'en' : 'zh';
}
```

- [ ] **Step 5：实现 `core/extract/sensitive.ts`**

```ts
const SENSITIVE_TEXT = /password|passwd|pwd|secret|cvv|cvc|creditcard|cardnumber|otp|verif|captcha|token|密码|验证码|银行卡|信用卡|支付|身份证/i;
const SENSITIVE_AUTOCOMPLETE = /^(current-password|new-password|one-time-code|cc-)/i;
const SENSITIVE_TYPES = new Set(['password']);

function attrsOf(el: Element): string {
  return [
    el.getAttribute('name'),
    el.getAttribute('id'),
    el.getAttribute('aria-label'),
    el.getAttribute('placeholder'),
    el.getAttribute('class'),
  ]
    .filter(Boolean)
    .join(' ');
}

function selfIsSensitive(el: Element): boolean {
  if (el.hasAttribute('data-sensitive')) return true;
  const type = el.getAttribute('type');
  if (type && SENSITIVE_TYPES.has(type.toLowerCase())) return true;
  const autocomplete = el.getAttribute('autocomplete');
  if (autocomplete && SENSITIVE_AUTOCOMPLETE.test(autocomplete)) return true;
  return SENSITIVE_TEXT.test(attrsOf(el));
}

/**
 * 敏感区域判定：命中即不显示工具条、不读取选区。
 * 判定沿祖先链上溯，覆盖「选区落在敏感表单内的说明文字上」这种情况。
 */
export function isSensitiveTarget(el: Element | null): boolean {
  let node: Element | null = el;
  while (node) {
    if (selfIsSensitive(node)) return true;
    node = node.parentElement;
  }
  return false;
}
```

- [ ] **Step 6：运行测试确认通过**

Run: `npm test`
Expected: PASS，`selection.test.ts` 9 项 + `sensitive.test.ts` 6 项全绿

- [ ] **Step 7：实现 `components/SelectionToolbar.tsx` 与样式**

```tsx
import type { SelectionAction } from '../core/messaging/types';

const ACTIONS: { action: SelectionAction; label: string }[] = [
  { action: 'explain', label: '解释' },
  { action: 'summarize', label: '总结' },
  { action: 'rewrite', label: '改写' },
  { action: 'translate', label: '翻译' },
];

interface Props {
  onAction: (action: SelectionAction) => void;
}

export function SelectionToolbar({ onAction }: Props) {
  return (
    <div className="wisp-toolbar" role="toolbar" aria-label="Wisp 划词操作">
      {ACTIONS.map(({ action, label }) => (
        <button key={action} type="button" className="wisp-toolbar__btn"
                onMouseDown={(e) => e.preventDefault()}   // 保住选区，别让按钮抢焦点
                onClick={() => onAction(action)}>
          {label}
        </button>
      ))}
    </div>
  );
}
```

`components/selectionToolbar.css`：只用绝对定位与自有类名，不设置任何影响宿主布局的全局样式；含 `:focus-visible` 焦点环与 `prefers-reduced-motion` 分支。

- [ ] **Step 8：在 `entrypoints/content.ts` 中挂载工具条**

```ts
import ReactDOM from 'react-dom/client';
import { SelectionToolbar } from '../components/SelectionToolbar';
import { defaultTargetLang, detectLang, isSelectionUsable, normalizeSelection } from '../core/extract/selection';
import { isSensitiveTarget } from '../core/extract/sensitive';
import './../components/selectionToolbar.css';

/**
 * 选区稳定判定的防抖窗口。阶段门要求「选区稳定后 ≤150ms 出现工具条」，
 * 这 150ms 里还要装下 Shadow Root 创建与 React 挂载，防抖必须显著小于它。
 */
const SELECTION_DEBOUNCE_MS = 70;

// main(ctx) 内：
    let ui: Awaited<ReturnType<typeof createShadowRootUi>> | null = null;
    let root: ReactDOM.Root | null = null;
    let pending: { text: string; lang: Lang } | null = null;
    let settleTimer = 0;

    /** 只拆 UI，不碰 pending —— pending 的生命周期由 handleSelectionSettled 决定。 */
    const teardownUi = () => { ui?.remove(); ui = null; root = null; };
    /** 对外的「隐藏工具条」：连同待发送的选区一起丢弃。 */
    const hide = () => { teardownUi(); pending = null; };

    async function showAt(rect: DOMRect) {
      teardownUi();                       // 注意：不是 hide()，否则会清掉刚设好的 pending
      ui = await createShadowRootUi(ctx, {
        name: 'wisp-selection-toolbar',
        position: 'overlay',
        anchor: 'body',
        onMount(container) {
          container.style.position = 'absolute';
          container.style.left = `${rect.left + window.scrollX}px`;
          container.style.top = `${rect.bottom + window.scrollY + 6}px`;
          container.style.zIndex = '2147483647';
          root = ReactDOM.createRoot(container);
          root.render(<SelectionToolbar onAction={(action) => {
            if (!pending) return;
            chrome.runtime.sendMessage({
              type: 'TOOLBAR_ACTION', action, text: pending.text, url: location.href, lang: pending.lang,
            });
            hide();
          }} />);
          return root;
        },
        onRemove: (r) => r?.unmount(),
      });
      ui.mount();
    }

    document.addEventListener('selectionchange', () => {
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(handleSelectionSettled, SELECTION_DEBOUNCE_MS);
    });
    window.addEventListener('scroll', hide, { passive: true });
    window.addEventListener('resize', hide, { passive: true });
```

> `hide()` 与 `teardownUi()` 的区别是这段代码唯一容易写错的地方：`showAt()` 必须用 `teardownUi()`，因为调用它时 `pending` 刚被赋值，用 `hide()` 会把它清空，导致按钮点下去时 `pending === null` 直接 return —— 工具条看起来正常，点击却毫无反应。

`handleSelectionSettled()` 的判定顺序（顺序不可调换）：

1. `selection.isCollapsed` 或无 range → `hide()`。
2. `isSensitiveTarget(range.commonAncestorContainer 所在 Element)` 为真 → `hide()`，**不读取文本**。
3. `normalizeSelection` → `isSelectionUsable` 为假 → `hide()`。
4. 通过 → 先 `pending = { text, lang: detectLang(text) }`，再 `void showAt(range.getBoundingClientRect())`。
   顺序不可颠倒，且 `showAt` 内部只能调 `teardownUi()`。

`GET_SELECTION` 的回复此时改用真实语言：`send({ type:'SELECTION', ctx, text: normalizeSelection(raw), lang: detectLang(raw) })`。

- [ ] **Step 9：构建并真机验收**

Run: `npx tsc --noEmit && npm run build:dev`，重新加载扩展

  - 普通文章页鼠标选中一段话 → 约 150ms 内工具条出现在选区下方；键盘（Shift+方向键）选择同样触发。
  - 滚动、缩放、点击空白处 → 工具条消失；页面布局无跳动（对比前后截图）。
  - 宿主页面的 CSS 不影响工具条（在一个自带 `button{}` 全局样式的站点上核对）。
  - 在登录页密码框内选中提示文字 → 工具条不出现。
  - 选中 1 个字符或超过 4000 字符 → 工具条不出现。
  - 同一页面反复选择 → 任意时刻只有一个工具条实例（Elements 面板核对 `wisp-selection-toolbar` 只有一个）。

- [ ] **Step 10：提交**

```bash
git add core/extract/selection.ts core/extract/selection.test.ts core/extract/sensitive.ts core/extract/sensitive.test.ts components entrypoints/content.ts
git commit -m "feat: 划词选区判定、敏感字段守卫与 Shadow DOM 工具条（单测覆盖）"
```

---

### Task 12: F-03 划词动作可靠交付握手（含 🔬 手势验证）

**Files**：
- Modify: `entrypoints/sidepanel/usePageChannel.ts`（`PANEL_READY` 握手 + 消费 `PENDING_ACTION`）
- Modify: `entrypoints/sidepanel/components/TaskPanel.tsx`（划词任务走同一 `runGeneration`）
- Modify: `entrypoints/content.ts`（手势退路提示）

**Interfaces**：
- Consumes：Task 2 的 `PANEL_READY` → `PanelReadyResult`、`PENDING_ACTION` 广播；Task 8 的 `runGeneration`；Task 11 的 `defaultTargetLang`。
- Produces：`usePageChannel()` 增加 `pendingAction` 与 `consumePendingAction()`。

- [ ] **Step 1：在 `usePageChannel` 中补握手**

划词动作有**两条投递路径**，取决于面板当时是否已经打开：

| 面板状态 | 路径 | 说明 |
|---|---|---|
| 未打开 | SW 缓存 → `sidePanel.open()` → 面板挂载 → `PANEL_READY` 拉取 | 冷启动补偿 |
| 已打开 | SW `PENDING_ACTION` 广播直达 | 面板不会重新挂载，**不会**再发 `PANEL_READY` |

两条路径可能同时命中同一个动作，因此按 `entry.id` 去重：

```ts
  const [pendingAction, setPendingAction] = useState<PendingActionEntry | null>(null);
  const seenActionIdsRef = useRef<Set<Uuid>>(new Set());

  /** 同一个 id 只接受一次，广播与 PANEL_READY 拉取重复到达也不会执行两遍。 */
  const acceptPendingAction = useCallback((entry: PendingActionEntry | null) => {
    if (!entry || seenActionIdsRef.current.has(entry.id)) return;
    seenActionIdsRef.current.add(entry.id);
    setPendingAction(entry);
  }, []);

  useEffect(() => {
    // 面板挂载完成 → 拉取待投递动作 + 当前活动标签
    void chrome.runtime.sendMessage({ type: 'PANEL_READY' }).then((res: PanelReadyResult) => {
      if (res?.active) setActiveTab(res.active);
      acceptPendingAction(res?.pending ?? null);
    });
  }, [acceptPendingAction]);

  const consumePendingAction = useCallback((): PendingActionEntry | null => {
    const entry = pendingAction;
    setPendingAction(null);
    return entry;
  }, [pendingAction]);
```

并在既有的 `onMessage` 里追加：

```ts
      if (msg.type === 'PENDING_ACTION') {
        acceptPendingAction({ id: msg.id, action: msg.action, text: msg.text, ctx: msg.ctx });
      }
```

把 `pendingAction` 与 `consumePendingAction` 一并加进 hook 的返回对象。

> `seenActionIdsRef` 只增不减，但一次面板会话内划词次数有限（每次是一个 UUID），内存可忽略；面板关闭即随组件销毁。

- [ ] **Step 2：`TaskPanel` 消费划词动作**

```ts
  const modelStatus = usePanelStore((s) => s.modelStatus);   // 用选择器订阅，避免依赖整个 store 对象

  useEffect(() => {
    if (!page.pendingAction || modelStatus !== 'ready') return;   // 未就绪时保留待投递动作，见下
    const entry = page.consumePendingAction();
    if (!entry) return;
    store.setBound(entry.ctx);
    void runGeneration({
      type: entry.action,
      ctx: entry.ctx,
      untrustedData: entry.text,
      targetLang: entry.action === 'translate' ? defaultTargetLang(detectLang(entry.text)) : undefined,
      source: entry.text.slice(0, 40),
      maxNewTokens: maxNewTokensFor(settings.outputLength),
    });
  }, [page.pendingAction, modelStatus, runGeneration, settings.outputLength]);
```

结果区顶部固定回显「原选区 + 任务类型」；`translate` 任务额外提供目标语言下拉，改动后按新 `targetLang` 重新生成（PRD F-03 第 4 条）。

**模型未就绪时**：不丢弃动作——把 `pendingAction` 暂存并显示「模型尚未就绪，完成初始化后将继续该操作」，`modelStatus` 转 `ready` 时自动执行。

- [ ] **Step 3：🔬 验证 `sidePanel.open()` 的跨上下文手势**

Run: `npm run build:dev`，重新加载扩展。在一篇普通文章页选中文字并点击「解释」，记录以下三种结果之一：

| 观察结果 | 结论 | 处理 |
|---|---|---|
| 面板自动打开并执行解释 | 手势可跨 CS→SW 往返 | 记入设计文档 §10，标为已验证 |
| 面板未打开，SW 控制台报 `sidePanel.open() may only be called in response to a user gesture` | 手势不可跨 | 走 Step 4 退路 |
| 面板已打开时正常执行，未打开时失败 | 部分可用 | 同样走 Step 4 退路，但保留已打开时的直通路径 |

- [ ] **Step 4：实现手势失败的退路（无论 Step 3 结果如何都要实现）**

SW 侧的 `sidePanel.open().catch(...)` 已在 Task 2 写好：被拒绝时**不清空** `pendingAction`（它带 30s TTL），转而通知 CS。本步只需实现 CS 侧：

收到 `{ type: 'OPEN_PANEL_HINT' }` → 在原工具条位置显示一行提示「请点击工具栏上的 Wisp 图标继续」，3 秒后自动消失。用户随后点击图标 → 面板挂载 → `PANEL_READY` 取回 30s 内的 `pendingAction` → 动作照常执行。

> 这条退路让 F-03 在手势不可跨的浏览器版本上依然完整可用，只是多一次点击；实测结论与所需点击数记入 README。

- [ ] **Step 5：真机验收 F-03**

| 场景 | 预期结果 |
|---|---|
| **面板未打开时**划词 | 面板打开 → 自动执行该动作一次（走 `PANEL_READY` 拉取路径） |
| **面板已打开时**划词 | 直接接管执行一次，面板不重复打开（走 `PENDING_ACTION` 广播路径）。**v0.1.1 新增必测项**，两条路径都要过 |
| 任一路径下的同一个动作 | 结果区**只启动一次**生成，不出现两次执行或结果被覆盖（`seenActionIdsRef` 按 `entry.id` 去重生效） |
| 划词时模型尚未就绪 | 动作**不丢失**，显示「模型尚未就绪，完成初始化后将继续该操作」；`modelStatus` 转 `ready` 后自动执行一次 |
| 划词后立刻切标签 | 划词任务基于选区文本快照继续完成；来源标识显示选区出处 |

  - 四个动作（解释/总结/改写/翻译）分别执行一次，结果与选区相关且流式输出。
  - 从点击工具条到 Side Panel **显示任务状态**（不是显示完整结果）计时 ≤ 500ms —— 用面板上 `performance.now()` 打点或屏幕录制逐帧核对，记录 5 次取中位数。
  - 翻译：中文选区默认译英，英文选区默认译中；结果页改目标语言后重新生成生效。
  - 面板已打开时划词 → 直接接管，不重复打开。
  - 划词任务执行中切换标签页 → 任务按防串页规则作废。

- [ ] **Step 6：提交**

```bash
git add entrypoints
git commit -m "feat: F-03 划词动作可靠交付握手与手势退路"
```

---

### Task 13: 错误矩阵收口与可访问性

**Files**：
- Create: `entrypoints/sidepanel/components/StatusBanner.tsx`
- Modify: `entrypoints/sidepanel/components/{ModelSetup,TaskPanel,SettingsPanel}.tsx`（统一走 `StatusBanner`）
- Modify: `entrypoints/sidepanel/style.css`

**Interfaces**：
- Consumes：`ErrorCode`、`usePanelStore.error`、`AsyncStatus`。
- Produces：`ERROR_COPY: Record<ErrorCode, { title: string; hint: string; retryable: boolean }>`、`<StatusBanner />`。

- [ ] **Step 1：写 `ERROR_COPY` 全量文案**

设计文档 §5 的 13 个错误码**一个不落**，每条给「标题 + 用户可执行的下一步 + 是否可重试」。示例三条，其余照此补齐：

```ts
export const ERROR_COPY: Record<ErrorCode, { title: string; hint: string; retryable: boolean }> = {
  PAGE_INJECTION_BLOCKED: { title: '此页面不允许读取', hint: '浏览器内置页、应用商店等受保护页面无法读取。请换一个普通网页，或点击工具栏 Wisp 图标授权当前页。', retryable: true },
  PAGE_NO_CONTENT:        { title: '没找到可读正文', hint: '这个页面可能主要是图片或交互内容。可以选中一段文字后使用划词功能。', retryable: true },
  PAGE_TOO_LONG:          { title: '仅分析了部分内容', hint: '页面超出模型可处理长度，已按顺序保留开头部分。', retryable: false },
  /* WEBGPU_UNAVAILABLE / WEBGPU_CRASH / DOWNLOAD_FAILED / DOWNLOAD_CANCELLED / CACHE_CORRUPT /
     OFFLINE_NO_MODEL / STORAGE_FULL / TAB_CHANGED / WORKER_ERROR / FILL_FAILED 同样逐条给出 */
};
```

> `FILL_FAILED` 属于 v0.2 的填入功能，本阶段不会触发，但类型要求覆盖——文案写「草稿写入失败，已为你保留内容，可手动复制」，并在注释标注 `// v0.2 F-04 预留，v0.1 不触发`。

- [ ] **Step 2：实现 `<StatusBanner />`**

```tsx
interface Props {
  code: ErrorCode | null;
  message?: string;          // 技术细节（如 Worker 原始错误），折叠在「详情」里
  onRetry?: () => void;
}
```

要求：`role="status"` + `aria-live="polite"`；`retryable` 且传了 `onRetry` 时显示「重试」按钮；技术细节用 `<details>` 折叠，默认不展示给普通用户。

- [ ] **Step 3：可访问性收口**

  - 所有按钮有可见文本或 `aria-label`；图标按钮必须补 `aria-label`。
  - Tab 顺序符合视觉顺序；`:focus-visible` 焦点环全局生效（Task 6 已加基线，此处逐个组件核对）。
  - 流式输出容器 `aria-live="polite"`、`aria-busy={isGenerating}`。
  - `prefers-reduced-motion: reduce` 下无动画（Task 6 的 CSS 已覆盖，此处核对进度条与加载态）。
  - 不显示原始思维链——`enable_thinking:false` + `ThinkFilter` 已在 Worker 层保证，UI 层只显示「读取页面 / 加载模型 / 生成回答」三种过程态。
  - **来源标识与横幅逐条核对措辞**：通读所有涉及页面来源的文案，确认没有任何一句暗示"Wisp 正在读取/监视某个页面"。判据是 §2 的快照语义 —— 正文只在 `readPage()` 那一刻取一次，此后生成读的是内存字符串。凡出现「仍在…继续」「持续读取」「实时」这类措辞即为不通过。

- [ ] **Step 4：真机验收六态矩阵**

对下列每个功能逐一走一遍六态并记录是否有专用界面（缺一即不通过）：

| 功能 | idle | loading | success | empty | error | cancelled |
|---|---|---|---|---|---|---|
| 模型初始化 | 初始化页 | 进度条 | 就绪条 | — | 失败原因+重试 | 取消后可重下 |
| 读取页面 | 「在本页启用」 | 读取中 | 标题+字数 | 无正文提示 | 受限页面提示 | — |
| 摘要/追问 | 按钮可点 | 流式中 | 结果 | 空输出提示 | 错误横幅+重试 | 已停止 |
| 划词动作 | — | 流式中 | 结果 | 空输出提示 | 错误横幅+重试 | 已停止 |
| 清除数据 | 按钮 | 清理中 | 实测结果 | — | 失败原因 | — |

- [ ] **Step 5：键盘全流程走查**

不使用鼠标，仅用 Tab/Shift+Tab/Enter/Space 完成：打开面板 → 初始化模型 → 启用页面 → 生成摘要 → 停止 → 复制 → 打开设置 → 返回。每一步焦点可见。

- [ ] **Step 6：提交**

```bash
git add entrypoints/sidepanel
git commit -m "feat: 错误矩阵文案收口与可访问性走查"
```

---

### Task 14: 固定回归集、离线测试与阶段门结论

**Files**：
- Create: `docs/回归集.md`（固定 10 篇文章页 + 5 个 SPA 的 URL 与预期）
- Modify: `README.md`（新增 v0.1 实测章节与阶段门结论）
- Modify: `docs/Wisp_设计文档.md`（§6 补 v0.1 实测列、§10 勾选 F-02/F-03 相关 🔬 项、§2.1/§3.1/§8.2 记录本计划 §2.1 的三处偏差）
- Modify: `docs/Wisp_阶段二开发计划.md`（本文：回填 §0 进度表与结论）

- [ ] **Step 1：建立固定回归集**

在 `docs/回归集.md` 记录 15 个 URL（10 普通文章页 + 5 SPA），每条含：URL、抓取日期、预期标题、预期正文首句、判定标准（提取到主要正文且不含导航菜单堆叠）。选站要求覆盖：中文长文、英文长文、技术文档、新闻站、博客、以及 5 个典型 SPA（文档站、知乎类、Medium 类等）。

- [ ] **Step 2：跑提取回归并记录**

逐个打开 15 个页面 →「在本页启用」→ 记录：是否提取成功、提取方式（readability/heuristic）、原文字数、提取耗时（`performance.now()` 打点）、失败样例说明。

**通过线（PRD §4 F-02）**：≥ 80%（15 个中至少 12 个）提取到主要正文且无明显导航堆叠。未达标时先看失败样例是否集中在 SPA 首屏未渲染，若是则在 CS 中加一次 `requestAnimationFrame` 后重试再复测，并把结论记入 README。

- [ ] **Step 3：跑 F-03 时延与 F-02 停止时延（口径同阶段一：10 次 + P50/P95）**

每项**连续测 10 次**，记录全部原始值，按阶段一协议计算 P50（升序第 5 位）与 P95（升序第 10 位）。**判定看 P95**——5 次取中位数会让接近一半操作严重超标仍判通过。

  - 工具条出现时延（选区稳定 → 工具条可见）：P50 / P95，判定 **P95 ≤ 150ms**。
  - 划词点击 → 面板显示任务状态：P50 / P95，判定 **P95 ≤ 500ms**。
  - 生成中停止：P50 / P95 的停字与结束耗时，判定 **P95 ≤ 500ms / ≤ 1s**。
  - 正文提取耗时：即 Step 2 的 15 个页面各一次，记录 P50 与最差值，判定 **最差 ≤ 1s**。

测量起点的口径必须写进 README，否则数字不可复现：
  - 「选区稳定」= `selectionchange` 停止触发的时刻（即防抖计时器启动点），**不含**用户拖拽选择本身的时长；
  - 「工具条可见」= 工具条首帧渲染完成，用 `requestAnimationFrame` 双帧回调打点；
  - 「面板显示任务状态」= 面板上出现"正在生成…"或选区回显的首帧，同样用双 rAF 打点。

- [ ] **Step 4：离线与稳定性测试**

  - **离线**：模型已缓存 → DevTools Network 勾 `Offline` → 关闭并重开面板 → 加载模型 → 在一个已打开的普通网页上生成一次摘要，全程无网络请求（Network 面板核对为 0 条 Wisp 发起的请求）。
  - **10× 稳定**：按 PRD §14.1 的六步 Demo 连续跑 10 轮，记录崩溃、串页、Worker 掉线次数，目标全为 0。

- [ ] **Step 5：回填 README**

新增章节，表格列出：

在 README 末尾追加一章（README 当前有 4 章，这是新的第 5 章，与本计划的章节号无关）：

```markdown
## 5. 阶段二 v0.1 实测（环境同 §1）

| 指标 | 实测值 | 目标 | 判定 |
|---|---|---|---|
| 正文提取成功率 | x/15 = xx% | ≥ 80% | |
| 提取耗时（P50 / 最差） | xx ms / xx ms | 最差 ≤ 1s | |
| 划词工具条出现 | P50 xx ms / P95 xx ms | P95 ≤ 150ms | |
| 点击工具条 → 面板显示任务状态 | P50 xx ms / P95 xx ms | P95 ≤ 500ms | |
| 停止生成（停字） | P50 xx ms / P95 xx ms | P95 ≤ 500ms | |
| 停止生成（任务结束） | P50 xx ms / P95 xx ms | P95 ≤ 1s | |
| 缓存后可用时间 | P50 xx s / P95 xx s | P50 ≤ 10s / P95 ≤ 20s | |
| 离线二次启动 | 通过/失败，Wisp 发起请求 x 条 | 0 条 | |
| 六步 Demo 连跑 10 轮 | 崩溃 x / 串页 x / 掉线 x | 全 0 | |
| sidePanel.open() 跨手势 | 可用 / 需退路（多一次点击） | 如实记录 | |
| Release 包体积 | x.xx MB | 记录 | |

测量口径：每项连续 10 次，P50 = 升序第 5 位，P95 = 升序第 10 位；起点定义见下方说明。
```

同时记录失败样例与已知限制（哪些站点提取失败、原因）。

- [ ] **Step 6：回填设计文档**（已大幅减负——契约回写已提前完成，此处只剩实测数据与校对）

  - §6 表格「阶段一 Spike 实测值」列右侧补「v0.1 实测值」，填入划词工具条、主线程响应等本阶段才有数据的行。
  - §10 勾选：`sidePanel.open()` 手势（记录实测结论）、`@mozilla/readability` 提取成功率（填实测比例）。这两项连同工具条 150ms，正是设计文档当前仅存的三处 🔬。
  - ~~§2.1 / §3.1 / §8.2 各加一行注记，指向本计划 §2.1 的三处偏差（B1/B2/B3）及理由~~ —— **已完成**，B1/B2/B3 已直接回写进设计文档正文（见本文 §2.1）；消息契约、推理契约、面板状态三块也已同步，本步只需校对。

- [ ] **Step 7：按 §7 判定阶段门并写入 README 与本文 §0**

- [ ] **Step 8：提交**

```bash
git add README.md docs
git commit -m "docs: 阶段二 v0.1 实测数据与阶段门结论"
```

---

## 5. PRD / 设计文档覆盖对照（自查）

| 需求项（PRD §3 P0 / §4 验收标准 / 设计文档） | 由哪个任务交付 |
|---|---|
| MV3 骨架、Side Panel、Content Script、消息通道 | Task 1、2、4 |
| Worker 加载 Qwen3-0.6B / WebGPU / 显式切 WASM | Task 6（复用阶段一 Worker） |
| 首次下载进度、取消、失败重试、缓存状态 | Task 6 |
| 网页正文提取、摘要、问答、流式、取消 | Task 3、4、8 |
| 划词工具条：解释/总结/改写/翻译 | Task 11、12 |
| 加载/空/错误/离线/不支持页面提示（六态） | Task 5、13 |
| 权限范围与说明 | Task 2（四项 `permissions` + 常驻 `http(s)://*/*` 主机权限；无 `tabs`／`webNavigation`／`<all_urls>`。原「最小权限」口径已按 PRD §8.1 决策记录调整） |
| 基础隐私说明 | Task 10 Step 7 第 5 组（`PRIVACY_NOTICE` 七条，含出网行为与本地保留披露） |
| 清除本地数据入口 | Task 10 Step 7 第 4 组（三个独立按钮 + 清理后复测实际结果） |
| F-02 提取成功率 ≥ 80%（10 文章页 + 5 SPA） | Task 14 |
| F-02 停止 500ms 停字 / 1s 结束 | Task 8（实现）、Task 14（实测） |
| F-02 切标签不串页 | Task 5（判据）、Task 8（闭环）、Task 14（实测） |
| F-03 工具条 ≤ 150ms、点击 → 状态 ≤ 500ms | Task 11、12（实现）、Task 14（实测） |
| F-03 敏感字段不弹工具条、样式隔离、单实例 | Task 11 |
| F-07 会话按 tabId+URL、保留策略、隐身 | Task 9 |
| F-07 设置：后端/输出长度/用量/清除 | Task 10 |
| 设计文档 §5 错误矩阵 13 个错误码全覆盖 | Task 13 |
| 设计文档 §9 安全渲染、危险链接过滤 | Task 7 |
| 设计文档 §9 不可信数据隔离 | 阶段一 `chatTemplate.ts` 既有，Task 8/12 只经 `untrustedData` 传入 |
| PRD §9.3 可访问性与 `prefers-reduced-motion` | Task 6（CSS 基线）、Task 13（走查） |
| PRD §14.1 六步 Demo 可无剪辑录制 | Task 14 |
| F-04 起草填入 / F-05 RAG / F-06 OCR | **不在本阶段**，留待阶段三 |

## 6. 端到端验证（整套 v0.1 验收）

1. `npm test` → 纯逻辑模块全绿：阶段一既有 7 个测试文件（其中 `cacheSelection.test.ts` 由 Task 6 扩充）+ 本阶段新增 `epoch / pending / truncate / article / taskGuard / urlSafety / cleanup / settings / outputLength / selection / sensitive` 共 11 个测试文件。
2. `npx tsc --noEmit` → 无类型错误。
3. `npm run build` → `.output/chrome-mv3/` 生成；核对 `assets/` 内含本地 ORT `.mjs/.wasm`；核对 `manifest.json`：`permissions` 恰为四项，`host_permissions` 恰为 `http://*/*` 与 `https://*/*`，无 `tabs`／`webNavigation`／`<all_urls>`。
4. `npm run build:dev` 后加载扩展，按 PRD §14.1 六步 Demo 连续走一遍：离线展示后端 → 长网页流式摘要并中途停止 → 重新生成并追问 + 超长提示 → 划词解释（样式隔离）→ 受限页面错误态 → Network 面板确认零业务请求。
5. 回归集 15 页提取成功率 ≥ 80%；六步 Demo 连跑 10 轮 0 崩溃 0 串页。
6. 实测数据回填 README 与设计文档，按 §7 给出阶段门判定。

## 7. 阶段门判定标准（通过 / 条件通过 / 失败）

在**推荐设备（同阶段一 README §1）· WebGPU 路径**下：

- **通过（Pass，进入阶段三 v0.2a）**：F-01～F-03 验收标准全部满足 —— 提取成功率 ≥ 80%、停止 P95 ≤ 500ms/1s、工具条 P95 ≤ 150ms、点击到状态 P95 ≤ 500ms、离线二次启动零请求、划词四动作齐备、**任务来源标识全程可见且无"仍在读取页面"式误导文案**、六步 Demo 连跑 10 轮 0 崩溃 0 串页 0 未确认写入，且 Demo 可无剪辑录制。§0.3 表内的「可裁剪」项裁掉后仍可判 Pass（需在 README 记录）。
- **条件通过（Conditional，带已知限制进入阶段三）**：核心链路完整但单项略欠 —— 如提取成功率 70%～80%（失败集中在 SPA 且已记录样例）、`sidePanel.open()` 手势不可跨需多一次点击、或**砍掉了任何未列入 §0.3 可裁剪表的 F-01～F-03 范围内容**（例如少一个划词动作）。必须在 README 明确记录限制与影响范围，且不得涉及安全红线。
- **失败（Fail，不进阶段三）**：出现下列任一即失败 —— 提取成功率 < 70%；Demo 10 轮中出现崩溃或上下文串页；模型输出可执行 HTML/JS（安全红线）；未经确认修改了网页内容；`connect-src` 白名单外的出网请求。

> 若 Task 14 实测感知 TTFT P95 > 4s（本阶段正文预算 3000 字符大于阶段一基准的 928 字符），把 `CONTEXT_CHAR_BUDGET` 下调到 2000 后复测，并在 README 记录调整前后的数据；这属于预期内的参数校准，不单独判失败。

## 8. 执行方式

按 Task 1 → 14 顺序执行，不跳序：Task 1～5 建地基（消息层、提取、状态），Task 6～10 交付 F-01/F-02 与数据管理，Task 11～13 交付 F-03 与产品完成度，Task 14 收口实测与阶段门。

- 纯逻辑任务（1、3、5、7、9、10、11 的 core 部分）走 TDD，可完全自动化验证（`npm test`）。
- 浏览器行为任务（2、4、6、8、12、13）写完代码后必须在本机 Chrome 真机按验收清单核对；无 Worker 的纯 UI 改动可用 `npm run dev` 热更新，**涉及推理 Worker 的验收一律用 `npm run build:dev` 后重载扩展**（MV3 不允许 localhost 跨来源 Worker，这是阶段一已确认的约束）。
- 每个任务末尾独立提交，提交不加署名尾行。任一任务的真机验收未通过，先修复再进入下一任务，避免错误叠加。

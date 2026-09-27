# ZZZ 伤害计算器

绝区零（ZZZ）伤害计算器：**全部已收录角色**（数量以 `docs/implementation-status.md` 为准）的资源回复/消耗、属性 buff、招式调用、命座、额外能力的完备计算。
技术栈：Vue 3 + TypeScript + Vite + Naive UI + Pinia + Vitest。
核心口径：**整局总量**（不算逐帧时间轴，算"整局回复量 vs 整局消耗量"），用户可调覆盖率/占比参数。

---

## 1. 快速开始

```bash
npm install
npm run dev        # 开发服务器
npm run build      # 类型检查 + 产物构建
npm run preview    # 预览产物
```

## 2. 检查与验收命令

```bash
npm run verify          # 一条链验收：check-guards + check-tokens + validate:data + validate:specs + verify:recording + vitest + build（build 内含 vue-tsc 类型检查）
npm run check           # check-guards + check-tokens + validate:data + validate:specs + vitest（快速环，改完必跑）
npm run typecheck       # vue-tsc -p tsconfig.app.json --noEmit（单独跑更快；verify 链内已由 build 覆盖）
npm run build
npm run validate:specs # spec 结构/状态/倍率行引用校验（全角色 spec，含自定义模块死数据强制检查）
npm run specs:coverage # 全角色覆盖矩阵（转模/资源/融合/事件/验证数）
npm run docs:status    # 重新生成 docs/implementation-status.md（CI 会检查漂移，漏跑即红）
```

数据/爬取类命令见 `package.json` 的 scripts（specs:new / specs:import / specs:bootstrap 等）。

> 测试约定：新测试一律用 `src/test/harness.ts`（`setupHarness` / `mockStaticFetch` / `setTeam`）装配
> pinia + 三文件 fetch stub + 队伍，禁止复制样板；全局回归网 = `src/composables/__tests__/allAgentsSweep.test.ts`
> （全角色 × 命座 0/6 不变量）。

## 3. 角色录入（唯一高频工作流）

新增角色或补机制：

1. 生成骨架：`npm run specs:new -- <agentId> --write`（或复制 `src/specs/template.json`，其 `_comment` 字段带字段说明）。
2. **先看完整角色模板**：`src/specs/agents/1451.json`（卢西娅·艾洛温）——梦境值计划/追加攻击/[合唱]行修正/4命帷幕喧响/6命转模/回血接入伊德海莉的全口径示例。
3. 填写 `attributeConversions` / `resources` / `events` / `verifications` / `notes`。**标注约定**（`[猜测·高/中/低]` / `[已确认]`）见 `src/specs/template.json` 的 `_comment` 与 `scripts/validate-specs.mjs` 头注释。
4. 用户确认的数值 → 写入 `verifications`（panel → expected），vitest 自动执行，成为回归测试。
5. 需要 TS 机制模块的角色：新建 `src/mechanics/agents/<id>.ts`（钩子清单与职责见 `src/mechanics/types.ts` 的 `AgentMechanicModule` JSDoc），并在 `src/mechanics/index.ts` 注册；模块头注释按 JSDoc 要求写完整口径。
6. **每个录入的机制必须补一条生效测试**（防死数据铁律）——防死数据清单、字段→消费者映射、常见坑见 `docs/AGENT_RECORDING_SOP.md`（AI 录入必读）。
7. 同步 `public/static/character-mechanics.json` / `character-constellations.json` 的实现状态与 codePaths。
8. 跑验收：`npm run validate:specs && npm run check && npm run typecheck && npm run build && npm run docs:status`。

**进度数字一律看 `docs/implementation-status.md`（自动生成），不要手写"已实现 N 个角色"。**

## 4. 目录结构

```
src/
  core/            计算引擎（resource 资源池 / stunPool 失衡 / anomalyPool 异常 / damage 伤害 / buff / panel / stunAxis*）
  composables/     useResourceCalc.ts 总管线（双层不动点、伤害池、失衡轴、章鱼自动轴）+ resourceCalc/helpers.ts（computePanel* 等）
  mechanics/       agents/*.ts 每角色机制模块（钩子注入）；types.ts 钩子接口；registry.ts 注册表
  specs/           声明式 spec（agents/*.json + 解释器 mechanics.ts / resources.ts / runtime.ts / verify.ts）
  stores/          config.ts（队伍/敌人/失衡轴/设置，含 autoYidhariAxis）+ catalog.ts（只读数据）
  views/           页面（队伍/属性/倍率表/资源池/资源利用率/失衡轴 + 开发：公式字段/音擎字段/逻辑编辑/机制表）
  components/      FinalPanel.vue（最终面板与乘区，局外→局内同源）、StatPanel.vue 等
  data/            stunAxisPresets/（失衡轴预设 JSON，含 chapter 字段）+ 预设匹配逻辑
public/static/     catalog.json（编译期数据快照，倍率表唯一事实来源）、teammate-buffs.json（全队拐力）、character-*.json（状态表）
scripts/           validate / specs / docs:status / 数据导入等
data/raw/          nanoka 原始数据（含 nanoka_missing/）
```

## 5. 数据源与关键口径（细节在各自主档，本节只做索引——同一事实不在这里重写一遍）

| 主题 | 唯一事实源 | 细节在哪 |
|---|---|---|
| 角色/音擎基础属性 + 完整倍率表 | `public/static/catalog.json`（编译期快照；**改数值 = 改 `scripts/` 导入/爬取脚本重跑，勿手改 JSON**） | `docs/DATA_FETCHING.md`（抓取/导入约定、版本 hash 坑） |
| Boss 预设（各期血量/失衡/防御/抗性/默认交互） | `public/static/boss-presets.json` ← `scripts/{fetch,import}-nanoka-bosses.mjs` 的 `BOSS_DEFAULTS` | `docs/FEATURES_GUIDE.md` §1 |
| 预设队伍 + 限定金口径 | `src/data/teamPresets/*.json`（`auto-` 为唯一来源，同名/同成员集合只留一条） | `docs/FEATURES_GUIDE.md` §2–3 |
| 全队拐力 | `public/static/teammate-buffs.json`（采集）+ spec `teamBuffs`（人工）→ `stores/catalog.ts` 合并 | `docs/AGENT_RECORDING_SOP.md` §6.1 |
| 实战归档（**只作单条部署对照，不作误差判据**，用户裁决 2026-09） | `public/static/run-archive.json` ← `scripts/{fetch,import}-zzz-run-archive.mjs` | `docs/FEATURES_GUIDE.md` §7 |
| 动作时间公式 / 合轴率 / 失衡轴 | 招式时间口径在 `scripts/import-nanoka-missing.mjs`（真源，勿在文档抄公式）· `comboAlignRatio` 进 catalog · `src/data/stunAxisPresets/` | `docs/ENGINE_PIPELINE_GUIDE.md` §1 与 §4 坑 21 |

## 6. 文档（62 份，其余知识在代码注释 / spec / 测试里）

| 文档 | 定位 |
| --- | --- |
| `docs/ARCHITECTURE.md` | **代码架构地图（AI 导航）**：五层心智模型、一次计算生命周期、核心类型地图、任务→文件决策树、数据流速查（动手前必读） |
| `docs/ARCHITECTURE-OVERVIEW.md` | **架构全景（实测版，R6 第 1 步）**：脚本测得的各层规模与依赖边、与 ARCHITECTURE.md §0 的差异 A1–A5（core 经 `@/mechanics` index 形成模块环、stores 直接调引擎、data 层读全局可变状态等）、效果管线函数级图、R6 候选 C1–C4；ARCHITECTURE.md 是规划，本文件是现状 |
| `docs/ENTITY_CARDS.md` | **实体卡（AI 陈述性知识层）**：音擎/角色/驱动盘等实体的完整结构与权威指针表 + 事故登记；配套查证工具 `node scripts/resolve.mjs` 与引擎探针 `npm run probe:panel`（跨实体断言/派生数值必用） |
| `docs/ENGINE_PIPELINE_GUIDE.md` | **引擎管线导读**：一轮计算的数据流、模块钩子调用顺序、常见坑（AI 录入排查用） |
| `docs/AGENT_RECORDING_SOP.md` | **角色录入 SOP（AI 快速上手）**：spec 字段→消费者→生效测试清单、防死数据铁律、踩坑清单 |
| `docs/MECHANIC_PATTERNS.md` | **机制模式目录**：游戏文本 → 计算逻辑的翻译词典——九个计算维度、确定性四级（L0 直读/L1 直译/L2 近似/L3 凹分拍板）、凹分思想提炼路径（录新角色先做模式匹配） |
| `docs/GAME_TERM_TO_CODE_FIELD.md` | 中文游戏术语 → 计算器字段映射（AI 录入时查字段用） |
| `docs/MECHANICS_IMPLEMENTATION.md` | **逐角色机制档案**（录角色前先 grep 该角色段）：当前实现状态行 + 只有档案知道的用户裁决与未建模项 + 实现指针；§0 特化中英映射表、§3.05 名词缺口挂账。机制细节以 `src/specs/agents/<id>.json` notes 与模块头注释为唯一事实源，档案不复述它们 |
| `docs/FEATURES_GUIDE.md` | **Boss 选择 + 队伍对比功能手册**：操作方式、数据管道命令、修改入口表、口径与验证命令（新功能必更新） |
| `docs/UI_THEME_GUIDE.md` | **UI 主题系统指南**：明暗双主题三层颜色体系（--app-*/--wa-* 色阶）、切换机制、SVG 填坑、ZZZ 品牌色板、改 UI 前必读 |
| `docs/mcp-ui-shell-polish.md` | **UI 外壳美术打磨记录**：顶栏纹理/霓虹导轨/品牌高光、分段导航胶囊化、全局焦点环与卡片层次；新增 `--shell-*`/`--brand-*`/`--dev-*` 令牌与三条基线的棘轮归因 |
| `docs/implementation-status.md` | **自动生成**，全角色覆盖矩阵（唯一权威进度，勿手改） |
| `docs/mechanism-reference.md` | 游戏底层机制理论（啵啵獭 10 期）：**只留尚未建模的理论存量**（秽盾/接战状态/精英怪档/待实测系数）；已进引擎的公式与倍率表以 `src/core/**` 为唯一事实源，本文只给指针 |
| `docs/DATA_FETCHING.md` | 数据抓取/导入约定（nanoka 等数据源的管道与字段口径） |
| `docs/multiplier-record.md` | **自动生成**倍率表系数演算记录（`npm run gen:multiplier-record`），供倍率系数页核对 |
| `docs/AGENT_ID_BURNDOWN_LOG.md` | **agentId 清偿编年史**（从 `scripts/check-guards.mjs` 搬出的 `AGENT_BRANCH_BASELINE` 沿革：逐轮对账/逐队归因/实验过程）；当前读数与判据仍以该脚本为唯一事实源 |
| `docs/mcp-guard18-and-1031-recording.md` | **架构升级与清债交付备忘**：判据 18（招式伤害属性 ↔ nanoka raw 散文对账）防护落地、1031 妮可契约录入与 legacy 销号 |
| `docs/mcp-backlog-triage-t1-debt3.md` | **Backlog 积压治理与结案备忘**：T1（trackStunCount 冗余字段核销）与债 3（秽盾机制裁决与登记簿注销）的技术审计、落地方案与护栏对账 |
| `docs/mcp-agent-development-roadmap.md` | **Agent 全生命周期长远开发体系与演进路线图**：双 Agent 融合架构、角色 6 阶段研发 SOP、契约与 AST 自治、WSL/网络环境实战避坑与四期里程碑 |
| `docs/mcp-agent-work-plan.md` | **本轮多 Agent 工作安排**：三条并行工作线、独立集成验收、可转交任务书、文件边界与证伪闸门；启动前须复核基线 |
| `docs/mcp-lead-agent-handoff.md` | **高级总协调模型执行交接**：完整意图、现场与权限、模型路由核验、工人派单模板、证据复核和集成闭环；可直接转交执行 |
| `docs/mcp-local-subagent-channel.md` | **MCP 本地子代理通道**：Streamable HTTP 客户端、WSL/headless 临时配置、原生 subagent 只读派发契约与实际路由验收 |
| `docs/mcp-dead-channel-cli.md` | **T2 死通道按需工作台**：既有 LanguageService 判据的 CLI 入口、只读/惰性契约、子代理审查与正反控验收 |
| `docs/mcp-altaxes-test-budget.md` | **altAxes 慢测试提速**：耗时分解（G2 联合搜索占 2/3）、`baseGoals` 选项、断言收紧与预算回到 300s，不放宽超时 |
| `docs/mcp-engine-perf.md` | **引擎性能活文档**：现状读数、等价验证手段（全库 dump / profile / 纯度探针）、已落地手段及其前提、否决记录、剩余热点；每轮更新本文不新开 |
| `docs/mcp-calc-core-architecture.md` | **计算核心架构优化**：五个结构问题诊断（阶段闭包共享可变态 / 引擎层角色特判 / 求解器绑 Vue / 公式副本 / 职责混装）、目标形态、零行为搬迁通用验收（dump A/B）与 CC-* 分批任务卡；活文档，卡做完改状态 |
| `docs/round2-intent-charter.md` | **下一轮委托：意图与验收闸门**（云端作者）：为什么做/何时值得做/什么不能做、六条长期意图、证伪闸门两行、权限与升级条件；不含现场操作参数，配套 field-sheet 由首席现场填写 |
| `docs/round2-field-sheet.md` | **下一轮现场执行单（已填写）**：本轮现场事实与授权、操作能力（workflow 路由现场核验）、现场选题与每条任务证伪闸门/白名单、首席派发回收检查与最终回报 |
| `docs/cloud-guidance-model-playbook.md` | **云端指导模型协作指南**：astra 类模型的最大贡献点（意图→闸门）与帮倒忙区（现场操作手册）、两轮实测对照、点修 vs 泛化阈值与基线全盲验收等待补闸门、何时需要云端再来一轮 |
| `docs/mcp-calc-logic-debt1-retirement.md` | **计算逻辑与技术债清偿备忘**：债 1 批 1-3 全局实数化收敛重构核销、全量 105 组队伍预设与 62 位角色全命座计算测试覆盖与黄金快照零漂移验证 |
| `docs/mcp-guard18-reconcile-and-open-items.md` | **护栏 18 模块化接线与 Backlog 待办消减备忘**：判据 18 与 move-element-reconcile 闭环（反空洞/行级未定义/orphan 对账）、R25-J2 诊断量残留读法防线与坑 42 固化 |
| `docs/mcp-3d-visualization-and-interaction.md` | **3D 双变量联合响应面与伤害构成立体交互演进备忘**：基于 Canvas 的 3D 双变量响应曲面（光照/网格/等高线/探针）与 3D 团队伤害构成立体环图落地 |
| `docs/mcp-layer-inversion-claret.md` | **录入层 → 编排层值倒置修复备忘**（R35-J2）：克拉蕾模块唯一反向值边的取证（SCC / 判据 7·12 盲区）、下沉 `data/moveTableQueries.ts` 的选项裁决、判据 19 `layer-inversion` 成对口径与三组注入反验、`timeGolden`/`allAgentsSweep` 零 delta 实测 |
| `docs/mcp-debt2-blade1-feasibility-v4.md` | **协作者 WIP 接管备忘**：债 2 刀 1（截断入口容差与折叠环同源，消灭假截断）+ 降配搜索 v4（绝对可行优先）的拆分落地、`timeGolden`/`timeFillRatchet` 逐队 delta 归因表、满套件 4 红收口、未合入的债 2 批 2-1 半成品去向与正解 |
| `docs/mcp-outer-feedback-regression.md` | **外层反馈回归（R67-J1）**：当前快照/二周期相位修复、机制测试正反对照、12 场景 A/B 与数值影响；逐字段证据 `docs/mcp-outer-feedback-deltas.csv` |
| `docs/mcp-substat-contract.md` | **副词条契约（R28-J2）**：合法池 mode 可观测性、步长/步数/混合结算与白名单反控；不以等价注入冒充缺测 |
| `docs/mcp-workspace-integrity.md` | **共享工作区完整性**：Git 路径无损读取、收工快照与归属分离、隔离 CLI 回归及兼容策略 |
| `docs/mcp-cc17-axis-overlay-consume.md` | **CC-17 设计稿**：axis overlay 消费端能力化（按槽归属 + `directRowBonus`），修可琳 `basic_attack` 轴模式泄漏；含接口/逐模块迁移表/零差论证/测试 |
| `docs/mcp-cc18-extra-direct-rows.md` | **CC-18 设计稿**：角色专属附加直伤行迁模块能力 `extraDirectRows`（18a 柏妮思 + 半月 C6 摧岳附伤；18b 琉音、18c 柏妮思异常侧立项） |
| `docs/mcp-cc19-extra-anomaly-rows.md` | **CC-19 设计稿**：异常尾段角色块迁模块能力 `extraAnomalyRows`（分组 + 顺序键保 rowsnap 行序；19a 柏妮思 C6 灼烧迸发 = 原 18c，19b 爱丽丝/简，19c 蕾米埃尔） |
| `docs/mcp-cc35d-gift-chain.md` | **CC-35d 设计稿**：诺玛 / 琉音「装配后赠送行」去角色化（A 诺玛模块能力 `chainGift` + `resourceCalc/chainGift.ts`；B1 出口改名 / B2 伤害池跳行能力 / B3 好评转大去身份查找） |
| `docs/mcp-cc36-velina-anomaly.md` | **CC-36 设计稿与实施记录**：维琳娜在 core / 编排层的残留去角色化（36a 风蚀量改名；36b 1 命乱流抗性无视 → 面板字段 `turbulenceResIgnore`、6 命风化加成 → 模块能力 `windAnomalyBonus`）；含 `as any` 访问改名踩坑 |
| `docs/mcp-cc38-alice.md` | **CC-38 设计稿与实施记录**：爱丽丝在 core / 编排层的残留去角色化（spark 局部量改名；模块能力 `giftedPolarAssaultCount`；异常池输出 `aliceCoweringDot` → `coweringDot`，推翻 CC-24「不改」口径）；判据 22 22→7 |
| `docs/mcp-cc39b-stun-window-end.md` | **CC-39b 设计稿与实施记录**：「结束失衡窗口的轴块」统一能力 `endsStunWindow` / `axisMoveActionTime`，单一派发点 `resourceCalc/helpers.ts`；含 perf 语料对决算截断零覆盖的坑与 CC-39c 待补快照 |
| `docs/mcp-logic-editor-state-safety.md` | **逻辑编辑器配置安全**：导入/缓存/草稿同源校验、存储失败提示、有效倍率快照隔离与兼容性回归 |
| `docs/mcp-logic-editor-history.md` | **逻辑编辑器可逆试改**：会话级撤销/重做、无效草稿恢复、独立快照与输入框快捷键边界 |
| `docs/mcp-r65j1-decibel-cap-verdict.md` | **R65-J1 首案裁决备忘**：橘福福「喧响上限+1000」在整局总量口径下零消费者（不是缺口）；证据链、护栏判据 decibelCapVerdict.test.ts 与未来喧响时间轨接入时的重裁决步骤 |
| `docs/mcp-calibration-atoms.md` | **校准原子测量清单 v1（方向 B 第 1 刀，CC-97）**：13 个引擎级局部可观测量（A1 局内攻击力%基底 / 防御区 / 失衡易伤 / 异常倍率与时长 / 紊乱公式 / 贯穿力 / 弹刀喧响 / 特殊虚耀 / 余火标度）的比值法测量步骤、引擎当前口径出处与预测值、录入格式与 v2 开工粒度 |
| `docs/mcp-timeline-shadow-kernel.md` | **事件时间轴影子内核设计稿与进度账本（R4 · 方向 A 第 1 刀）**：两条轨（失衡、喧响）的现状、D1–D7 决定（重放收敛产物、零入边、闸门规避）、3 支对账队伍、归因分类 E / U / B、分步验收 |
| `docs/mcp-r5-spec-impl-reconciliation.md` | **R5 规格-实现对账：差异清单与进度账本**：catalog.json 215 种字段 × 引擎读取点的粗筛方法与局限、S/D/M 字段分类框架、零读取候选 Z1–Z13 与已知差异 K0（basis）、「读了但语义不同」排查入口、差异条目格式 |
| `docs/mcp-r6-refactor-list.md` | **R6 第 2 步：重构机会清单（做 / 不做）**：全景 C1–C7 与 A3、helpers 壳逐条给类别、出处、收益、影响面、风险与结论；C1（core 只经 registry 查询）已完成，C7 分刀步骤可直接开工 |
| `docs/mcp-working-model.md` | **工作方式、分工与规则体系（R8 答复，现行口径）**：废除固定的 lead/worker 分工（单一执行者 + 按需外包机械活）；判据三分（保留 / 降级为只防增加 / 废弃）与执行项 W1–W4；工作方式改为「画地图 → 对账与找机会 → 集中重构」；R 顺序调整的理由与回退点；不采纳的建议 |
| `docs/mcp-mechanic-dataization-census.md` | **机制模块数据化盘点（方向 C 第 1 刀，CC-98）**：62 个模块 / 62 份 spec 一一对应；按「spec 生成不了的过程类能力数」分 A2 / B30 / C29；spec 的 4 种原语缺口 G1–G4；5 个纯 spec 候选；第 2 刀被方向 A 事件钩子阻塞 |
| `docs/LONG-TERM-DIRECTIONS.md` | **R3 长期方向提案（只提案不实施，待用户挑选）**：A 事件时间轴内核替代整局总量+不动点 / B 受控实测校准集（真值锚）/ C 机制即数据 + 版本流水线 / D 统一决策层 / E 口径与数据版本绑定；各方向的根本问题、时机、收益、不可逆点、切刀与是否与当前重构冲突，结尾给推荐顺序 |
| `docs/mcp-dev-process-speed.md` | **R2 开发流程提速（先量再改）**：一张卡的时间花在哪（实测表）、验证为何必要、已落地的零强度损失优化（tsc 增量 17→1.5s、零差四路并行 176→51s `.zc/perf/zd.sh`、文档与 verify 重叠）、**会削弱保证的选项清单（待用户裁决）** |
| `docs/mcp-worker-task-queue.md` | **交接与执行纪律（活文档，原「低级模型任务队列」，2026-09-27 W3 压缩）**：置顶顺序、§0 子代理派发纪律与 R2 收尾流程、§1 长期规则（从历史交接提炼）、§2 最近一轮交接与已知坑（每轮替换，不追加）；压缩前全文见 `git show 8a8db00:docs/mcp-worker-task-queue.md` |
| `docs/mcp-drift-triage.md` | **drift 待复核队列分诊**：CC 批次触发 102 条 ⟳ 的成因、四态复核判据（still-holds / drifted / broken-anchor / needs-user）、W13–W15 工人分批与主代理落盘纪律（按批 commit、同文件同批清、禁止无归因刷日期） |
| `docs/mcp-liuyin-promote-source.md` | **琉音转大次数唯一来源（W21 阻塞项 lead 设计）**：同轮四读数（floor / 计划值结转 / 池不动点 / 轴声明）的证据表、planned≠pool 的口径根因、单源 = 答案层 `promote` 滞后注入的通道设计、轴模式闸门（待用户）、否决记录与证伪闸门；拆卡 W25/W26 |
| `docs/mcp-r22d1-batch12-field-census.md` | **R22-D1 批 1-2 裁决不做 + 核心角色字段普查计划（handoff）**：批 1-2（billy/yeshuguang 终局旗标并入通用骨架）判不做理由、核心 `CharacterOperationConfig` 角色字段 census 方案（字段→写入方/读取方） |
| `docs/mcp-cinema-uplift-multi-metric.md` | **命座提升率多指标栏（R1）口径决策与交接**：失衡栏为什么用 `totalStunBuildUp` 而非被 `stunCountLock` 锁死的 `stunCount`（3 队 × 6 级引擎探针实测表）、方案 A 否决理由、显示口径与「显示位四舍五入为 0 即 `—`」的共同判据、七道闸门 + 两次负控 + 实机 DOM 读回证据、令牌棘轮与守卫 hint 漂移发现、三个回退点 |
| `docs/mcp-core-agent-math-census.md` | **core/** 角色专属数学盘点（CC-70）**：不靠 agentId、但按某角色机制写的 core 逻辑逐项裁定留/迁——维琳娜气旋事件已迁模块（CC-71）、core 的 C2 风蚀默认值已删（CC-72），帷幕/风蚀派发器/真元/加农转子裁定留 core 及理由、复现 grep |
| `docs/REQUIREMENTS.md` | **用户需求唯一入口**：用户经助手写入的 `R<编号>` 需求；每轮开工先读、优先于自选待办，做完标 `[done <commit>]` 不删条目 |

> 项目知识以代码为唯一事实来源：角色口径在 spec `notes` + 模块头注释，用户确认数值在 `verifications`（测试固化），引擎规则在 core/ 注释与测试。删掉的文档不再重建（2026-09-14 删 `architecture-review-2026-09-11.md` 点时间快照：已落地结论长在代码与护栏里，未落地 4 条曾迁账本 Open 段，现随账本瘦身统一收在 `.claude/OPEN-ITEMS.md`）。
> 文档数量以本表为准（48 份），新增文档需同步本表。

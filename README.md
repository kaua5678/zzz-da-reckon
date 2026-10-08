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
npm run validate:specs # spec 语义校验（文件名 = agentId、id 唯一、招式引用、enemy 字段的 target、自定义模块死数据 / 死口径）；字段形状归 validate:data 的 JSON 契约
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

## 6. 文档（92 份，其余知识在代码注释 / spec / 测试里）

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
| `docs/mcp-ui-number-format-sweep.md` | **界面长浮点普查 + ui-check「未格式化数值」闸门**（r716–r718）：页头页签 + 页内子页签普查方法、源头表与 fmt 口径、闸门阈值（≥7 位小数，依据 src/data 字面量实测）与防线测试、月城柳 `as` 断言漏 fields 的根因、zd 逐叶归因 |
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
| `docs/mcp-d2-cfg-fields.md` | **D2 公共接口去巨型化（类型层）**：单模块私有成员用 `declare module` 扩充随模块走（`CharacterOperationConfig` / `ModuleFeedback`），约定、结果、剩余公共字段的下一步与字段矩阵；脚本 `scripts/d2-*.py`，锁 `src/types/__tests__/privateCfgFields.test.ts`（CC-359/360） |
| `docs/mcp-nextround-writeback.md` | **nextRoundFeedback cfg 写回判死**（r397 CC-371）：静态 + 动态判死依据、删掉的死通道（`lucyCheerSpinsEstimate` / `targetCfgOf`）、「深冻结调用全部已注册钩子」只读锁及其反证坑、同病其他落点（phoenix panel 夹带等） |
| `docs/round2-intent-charter.md` | **下一轮委托：意图与验收闸门**（云端作者）：为什么做/何时值得做/什么不能做、六条长期意图、证伪闸门两行、权限与升级条件；不含现场操作参数，配套 field-sheet 由首席现场填写 |
| `docs/round2-field-sheet.md` | **下一轮现场执行单（已填写）**：本轮现场事实与授权、操作能力（workflow 路由现场核验）、现场选题与每条任务证伪闸门/白名单、首席派发回收检查与最终回报 |
| `docs/cloud-guidance-model-playbook.md` | **云端指导模型协作指南**：astra 类模型的最大贡献点（意图→闸门）与帮倒忙区（现场操作手册）、两轮实测对照、点修 vs 泛化阈值与基线全盲验收等待补闸门、何时需要云端再来一轮 |
| `docs/mcp-calc-logic-debt1-retirement.md` | **计算逻辑与技术债清偿备忘**：债 1 批 1-3 全局实数化收敛重构核销、全量 105 组队伍预设与 62 位角色全命座计算测试覆盖与黄金快照零漂移验证 |
| `docs/mcp-guard18-reconcile-and-open-items.md` | **护栏 18 模块化接线与 Backlog 待办消减备忘**：判据 18 与 move-element-reconcile 闭环（反空洞/行级未定义/orphan 对账）、R25-J2 诊断量残留读法防线与坑 42 固化 |
| `docs/mcp-3d-visualization-and-interaction.md` | **3D 双变量联合响应面与伤害构成立体交互演进备忘**：基于 Canvas 的 3D 双变量响应曲面（光照/网格/等高线/探针）与 3D 团队伤害构成立体环图落地 |
| `docs/mcp-layer-inversion-claret.md` | **录入层 → 编排层值倒置修复备忘**（R35-J2）：克拉蕾模块唯一反向值边的取证（SCC / 判据 7·12 盲区）、下沉 `data/moveTableQueries.ts` 的选项裁决、判据 19 `layer-inversion` 成对口径与三组注入反验、`timeGolden`/`allAgentsSweep` 零 delta 实测 |
| `docs/mcp-debt2-blade1-feasibility-v4.md` | **协作者 WIP 接管备忘**：债 2 刀 1（截断入口容差与折叠环同源，消灭假截断）+ 降配搜索 v4（绝对可行优先）的拆分落地、`timeGolden`/`timeFillRatchet` 逐队 delta 归因表、满套件 4 红收口、未合入的债 2 批 2-1 半成品去向与正解 |
| `docs/mcp-outer-feedback-regression.md` | **外层反馈回归（R67-J1）**：当前快照/二周期相位修复、机制测试正反对照、12 场景 A/B 与数值影响；逐字段证据 `docs/mcp-outer-feedback-deltas.csv` |
| `docs/mcp-outer-fixedpoint-continuity.md` | **外层不动点连续性（CC-136 起）**：输入微动导致环内选点跳成员的扫描复现、根因（检出相位 / 两两比较不传递）、逐级筛选 + ③′ 方案、逐条影响；第二种不连续判定为物理失衡次数的整数台阶（护栏 `outerContinuity.test.ts`） |
| `docs/mcp-integer-cycle-stop.md` | **内层真整数环停点（CC-326，第 344 轮）**：停点由「JSON 字典序最小成员」改为「不透支成员中次数最多者」（= 整数取整 ⌊x*⌋，相位无关）；透支量定义、414 例探针（旧规则 52% 取中透支成员、终局非收敛 18/18 透支 → 0）、36 例伤害 delta 表、与 r343「Σ最小」否决的区别、20 轮后回落未动与后续 |
| `docs/mcp-fold-loop-stop.md` | **S2 折叠环停点（第 348 轮）**：出口普查（残差达标 / 停滞 / 跑满，414 例）；停滞计数跨运行不归零是承重行为（归零试验让合轴吸收率 1 的留白门变红，决定不改）；候选 F2「停滞出口取残差最小的一轮」的做法与代价 |
| `docs/mcp-wengine-coverage-timing.md` | **音擎叠层自动覆盖率的读取时序缺陷（第 700 轮）**：同步读（队伍对比 / 难度曲线）不等 `flush:'post'` 回填，105 支预设里带嵌合编译器的 7 支被高估 1.8–5.8%；只改结算侧只补上 37%，因为资源侧异常池在池内用面板算紊乱 / 乱流伤害；§6 是 T10 可直接开工的步骤（紊乱 / 乱流照 CC-D2 搬到结算侧，再拆面板） |
| `docs/mcp-bridge-prompt-slim.md` | **搭桥提示词精简（REQUIREMENTS R9，第 700 轮）**：autopilot 每轮实发段从 29,512 B 压到 13,655 B（46.3%），内嵌完整客户端换成约 30 行的引导客户端，完整版存档在第二节；52 条规则逐条对照、删除类别与例子、替换与回退方法。产物在桌面 `bridge-prompt-arena.slim.md`，原文件未动 |
| `docs/mcp-stun-dual-source.md` | **失衡双源测量（第 162 轮；§16 CC-151 / CC-148 收尾；§17 CC-153；§18 CC-154；§19 CC-155；§20 CC-157 结案；§21 CC-149 定位 / CC-158；§22 CC-158 折叠残差）**：规划失衡 vs 物理次数；去掉外层第二次折算的原型不落地；主因 = 必要时间约束（78/104 队、17 队规划 0），合轴抵扣假设已否定；§4 窗口内连携只解释一小部分，真因 = 外层约束与池口径互斥，21/104 队有失衡没连携；§5 CC-140 physical 计数模式（缺省 off，打开后 21→6）；§6 CC-141 赠送供给漏改计数通道已修（physical 超预算 13→3 队）；§7 CC-143 S3 降配第三层「缓解档」（physical 截断 177→41s）；§8 CC-142 轴模式分窗读计数通道（有失衡没连携 6→4，剩 4 队是希希芙轴没写连携），切默认 = CC-144；§12 CC-146 共存吸引子（折叠环 pass0 注入种子一律弃用）；§13 CC-144 已切 physical 缺省；§14 CC-148 迁移进度与 CC-149（physical 下合轴率单调破缺）；§15 CC-150 physical 外层 2-环池同源（更正 §13.1） |
| `docs/mcp-cc144-team-deltas.md` | **CC-144 逐队归因表（第 172 轮）**：缺省 off→physical 全库 104 队的伤害变化、规划失衡 P / 物理次数 K、连携秒数、截断与次数；U 76（K>P 补上少算的失衡事件）/ X 19（连携占前台挤出高收益动作）/ Z 9 |
| `docs/mcp-substat-contract.md` | **副词条契约（R28-J2）**：合法池 mode 可观测性、步长/步数/混合结算与白名单反控；不以等价注入冒充缺测 |
| `docs/mcp-workspace-integrity.md` | **共享工作区完整性**：Git 路径无损读取、收工快照与归属分离、隔离 CLI 回归及兼容策略 |
| `docs/mcp-cc17-axis-overlay-consume.md` | **CC-17 设计稿**：axis overlay 消费端能力化（按槽归属 + `directRowBonus`），修可琳 `basic_attack` 轴模式泄漏；含接口/逐模块迁移表/零差论证/测试 |
| `docs/mcp-cc437-axis-overlay-opaque.md` | **CC-437 设计稿**（r466 设计，r467–r473 a→g 全部落地，形状锁 `axisOverlayOpaqueCc437.test.ts`）：轴窗口 overlay 改为模块私有、编排层不透明——`AgentAxisOverlays` / `AxisScalarOverlays` 的 9 个角色前缀字段写读都在各自模块内（逐处核过），改成 `AgentAxisOverlay` brand + `axisOverlayChannel<T>()`；分 7 步（队列 §3 T15）各自 zd 0；含零差论证与不做的边界 |
| `docs/mcp-t16-banyue-rage-window.md` | **T16 分诊稿（r475，判定不做）**：般岳怒相增益「轴内精确覆盖」——纠正卡面事实（触发源是**每次强特/支援突击** 30s 刷新，不是焚身），量化覆盖率 ≈ 0.95～1 ⇒ 现有 `rageGainCoverage` 滑块已是正确近似；行级贯穿力 flat 通道 + 轴态 panel 停加的代价不值。§3 留了可开工的备选路线（a 零差通道 / b 般岳迁入），只在出现第二个行级贯穿力需求时再做。 |
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
| `docs/mcp-module-state.md` | **模块私有状态借道共享 cfg：测量与决策（第 307 轮）**：agents 写入的 cfg 键按读者 × 钩子层级分类（`scripts/cfg-key-census.cjs`）；结论是不做私有状态袋、不做类型搬家，附重开条件 |
| `docs/mcp-spec-resources-audit.md` | **spec resources / events 与手写模块对账（全景 §6.4，CC-120）**：10 份 resources、3 份 events 经变异法证明不参与计算（仅展示）；120 条数值逐条对照（81 一致 / 4 不一致 / 34 模块未建模），1581 耀变系数 0.1→0.2 已修；决定不迁移及理由 |
| `docs/mcp-working-model.md` | **工作方式、分工与规则体系（R8 答复，现行口径）**：废除固定的 lead/worker 分工（单一执行者 + 按需外包机械活）；判据三分（保留 / 降级为只防增加 / 废弃）与执行项 W1–W4；工作方式改为「画地图 → 对账与找机会 → 集中重构」；R 顺序调整的理由与回退点；不采纳的建议 |
| `docs/mcp-mechanic-dataization-census.md` | **机制模块数据化盘点（方向 C 第 1 刀，CC-98）**：62 个模块 / 62 份 spec 一一对应；按「spec 生成不了的过程类能力数」分 A2 / B30 / C29；spec 的 4 种原语缺口 G1–G4；5 个纯 spec 候选；第 2 刀被方向 A 事件钩子阻塞 |
| `docs/LONG-TERM-DIRECTIONS.md` | **R3 长期方向提案（只提案不实施，待用户挑选）**：A 事件时间轴内核替代整局总量+不动点 / B 受控实测校准集（真值锚）/ C 机制即数据 + 版本流水线 / D 统一决策层 / E 口径与数据版本绑定；各方向的根本问题、时机、收益、不可逆点、切刀与是否与当前重构冲突，结尾给推荐顺序 |
| `docs/mcp-dev-process-speed.md` | **R2 开发流程提速（先量再改）**：一张卡的时间花在哪（实测表）、验证为何必要、已落地的零强度损失优化（tsc 增量 17→1.5s、零差四路并行 176→51s `.zc/perf/zd.sh`、文档与 verify 重叠）、**会削弱保证的选项清单（待用户裁决）** |
| `docs/mcp-worker-task-queue.md` | **交接与执行纪律（活文档，原「低级模型任务队列」，2026-09-27 W3 压缩）**：置顶顺序、§0 子代理派发纪律与 R2 收尾流程、§1 长期规则（从历史交接提炼）、§2 最近一轮交接与已知坑（每轮替换，不追加）；压缩前全文见 `git show 8a8db00:docs/mcp-worker-task-queue.md` |
| `docs/mcp-combo-align-ledger-census.md` | **合轴率账本归属普查（T19 阶段 0，纯读）**：实测 166 队后把立卡的「53 模块写行上比例」收敛为 **5 模块 / 8 组合**（绝大多数模块写的是 `0`）；5 家**全部**有 credit 产出口（同源或有意的 NET 约定）⇒ 活跃缺陷 0；阶段 1 两候选收益 ≈ 0 建议不立项，替代方案 = 加一条 check-guards 判据防未来 |
| `docs/mcp-drift-triage.md` | **drift 待复核队列分诊**：CC 批次触发 102 条 ⟳ 的成因、四态复核判据（still-holds / drifted / broken-anchor / needs-user）、W13–W15 工人分批与主代理落盘纪律（按批 commit、同文件同批清、禁止无归因刷日期） |
| `docs/mcp-dead-export-census.md` | **死导出普查与判据推广（r721）· 兼容门面收口（r722）**：死导出判据的三个盲区（测试引用算活 / 只扫 core / 转出与默认导出没人管）、全 src 128 条无生产消费导出的逐条裁决（删 / 搬测试侧 / 登记测试接口）、`scanDeadExports` 的口径与不做的事；r722 拆分 / 下沉留下的 14 个兼容门面 60 条转出迁导入方后删除、转出口径与入口白名单、属性级存活普查结论（不做） |
| `docs/mcp-dead-nullish-census.md` | **死兜底普查与判据 28（r723）**：TS 类型检查器判定的「左侧类型不含 null/undefined 的 `a ?? b`」871 处按类普查；cfg 袋子 19 个恒写字段改必填、引擎内部契约上 800 处删除、战斗时间单一通道（r6 §8.0 #13）；外部数据类型的信任边界豁免表（r723 为 126 处，r724 剩 59 处，§4.1）；r725 起由 JSON 类型契约（`scripts/lib/json-contract.mjs`，validate:data 按代码转型用的 TS 类型校验全部 JSON 入口）取代、豁免清零，首跑 31 处类型与数据漂移的处理见 §4.2；r726 战斗时间单一来源（函数入参的 180 缺省清零，战斗时间 ≠ 180 的探针归因见 §4.3）；r727 形状校验单一来源（预设加载器的运行时类型守卫与 validate-specs 的形状检查删除，§4.4）；r728 对象形状只由声明类型表达（类型字面量断言 43 处去掉、判据 27 加形态，§4.5）；r731 判据 28 扩到可选链 `?.`（首扫 244 处全部收口，可选链替判据 17 躲过的两处槽位下标一并修掉，§4.6）；r732 起判调用结果（普查 0 处，§4.7）；判据 28 的规则 / 自证 / 成本；测试夹具改法与不做的事 |
| `docs/mcp-type-restatement.md` | **类型只声明一次与判据 29（r729；r732 加字面量副本）**：TS 类型检查器普查的恒等断言（`x as T` 里 x 已是 T，或 T 只多 undefined）41 处与结构副本（类型字面量与具名类型逐字段相同）14 处全部去掉，outerExit 联合起名 `OuterExit`；判据 29 的口径（只比较类型不受断言影响的表达式、按类型对象判同一、元素访问加 undefined 不报、副本门槛 3 个成员）与自证，与判据 28 共用 program；r732 判据 29 加形态 ③ 字面量副本（≥3 个成员的同一形状写了两处以上），28 组 76 处起名收口，钩子形状的名字放 typesHooks.ts（§9）；§6 的三个候选（字面量副本、死可选链、紊乱 / 乱流公式表）已由 r730–r732 收完 |
| `docs/mcp-gold-greedy.md` | **逐金贪婪只留一份实现（r733）**：队伍对比与时间线两份逐金贪婪的差异表；共用 `composables/goldGreedy.ts#takeBestGoldStep` 的改法与保留的语义（候选顺序、并列取先、收敛过滤留在调用方）；顺带修的「自动下位限定槽位重复买同一把」及其可达性；改前 / 改后探针；不做清单 |
| `docs/mcp-limited-gold.md` | **限定金数只算一处（r734）**：归档 `memberLimitedGold` 与计算器侧 teamGoldOf / baseGoldOf / baseGoldOfTeam 四份公式的对照；收成 teamGoldOf 逐槽交给 memberLimitedGold 的改法（空槽不计、store 音擎别名解析留在 teamGoldOf）；删 isLimitedAgent 别名；不可能输入上的差异；改前 / 改后探针与 goldSteps 普查；不做清单；下一轮候选（下位音擎择优两份实现） |
| `docs/mcp-downgrade-wengine.md` | **下位音擎择优只留一份实现（r735）**：队伍对比自动下位与自由对比无专武档两份试穿择优的对照；收成 downgradeWEngine.ts（DOWNGRADE_MODS / downgradeCandidateOf / wearBestWEngine）的改法；试算次数改由实际试算返回；行为差异；改前 / 改后探针、反例与下位池普查；不做清单；下一轮候选（一次性探针 freeCompareDowngradeProbe） |
| `docs/mcp-default-suite-probes.md` | **默认套件只放断言（r736）与门控探针体检（r737）**：普查 25 个名含 probe / diag / debug / repro 的测试文件与 17 个无门控却有打印的测试文件；删 3 个一次性探针（zzz_ysg_probe / diag-stun / freeCompareDowngradeProbe）的依据与结论去向；panelProbe 改 it.runIf；vitest 基线归因；不做清单；r737 门控探针体检（16 个带 env 实跑，删 4 个已烂或已被取代的）与门控探针索引（§8.3） |
| `docs/mcp-frontline-row-seconds.md` | **前台行时长只算一处（r738）、截断预算不再往返（r739）、kept 由截断结果直接给出（r740）、截断槽账契约收口（r741）**：5 处「Σ前台行 totalTime」与三种负值口径的对照；totalTime 生产方逐个核对 + 插桩实测（全套测试与零差矩阵都没有负行）；收成 `types/resource/execution.ts#frontlineRowSeconds`、删死钳位、slotNetFrontline 去 tally 出参；逐位不变的理由；r739 拆出 truncateMoveRows、rowTimeLimit 契约收紧（§9）；r740 kept 直接给出、cut 去死钳位，两种平A行时长核实为不同的量（§10）；r741 count = 0 行与槽账消费方的不可达分支删掉、契约写到类型（§11）；§11.7 的候选 r742 已做（见 mcp-basic-pool-carve.md） |
| `docs/mcp-basic-pool-carve.md` | **平A池 carve 只留一份实现（r742）**：7 处手写的「从 basic_attack 聚合行挤时间」收成 `moduleExecRow#carveBasicPool`，回能缩不缩由调用方显式传（纯重构，zd 0/0）；核对回能口径发现艾莲循环行按表回填能量、池能量却不缩，按规则 10 修正（3 支 1191 预设 + 单人 c0–c6 的差异表与归因）；§7 的候选 r743 已做：两份派发前行快照改为逐行拷贝（§8）；r744 钩子入参按契约收窄（§9）；r745 结果钩子的两份快照改必填（§10）；r746 卢西娅追加攻击上限的形参收窄（§11）；r747 effectiveTime 时间 helper 的形参收窄（§12）；r748 countFrontActions 与 computeJufufuCycle 的入参收窄（§13）；r749 设置项缺省值只留在声明、删 cfgMechanicSettingRaw（§14）；r750 删机制设置的 cfg 镜像字段（§15）；r751 雨果 / 柚叶两个带第二写入方的设置字段与钩子读取器的默认值（§16）；r752 编排层不再按 id 读模块设置，琉音 60 档上限改由转大钩子自己读（§17），下一轮候选（jufufuAdjustableRate 的重复默认值） |
| `docs/mcp-liuyin-promote-source.md` | **琉音转大次数唯一来源（W21 阻塞项 lead 设计）**：同轮四读数（floor / 计划值结转 / 池不动点 / 轴声明）的证据表、planned≠pool 的口径根因、单源 = 答案层 `promote` 滞后注入的通道设计、轴模式闸门（待用户）、否决记录与证伪闸门；拆卡 W25/W26 |
| `docs/mcp-r22d1-batch12-field-census.md` | **R22-D1 批 1-2 裁决不做 + 核心角色字段普查计划（handoff）**：批 1-2（billy/yeshuguang 终局旗标并入通用骨架）判不做理由、核心 `CharacterOperationConfig` 角色字段 census 方案（字段→写入方/读取方） |
| `docs/mcp-cinema-uplift-multi-metric.md` | **命座提升率多指标栏（R1）口径决策与交接**：失衡栏为什么用 `totalStunBuildUp` 而非被 `stunCountLock` 锁死的 `stunCount`（3 队 × 6 级引擎探针实测表）、方案 A 否决理由、显示口径与「显示位四舍五入为 0 即 `—`」的共同判据、七道闸门 + 两次负控 + 实机 DOM 读回证据、令牌棘轮与守卫 hint 漂移发现、三个回退点 |
| `docs/mcp-core-agent-math-census.md` | **core/** 角色专属数学盘点（CC-70）**：不靠 agentId、但按某角色机制写的 core 逻辑逐项裁定留/迁——维琳娜气旋事件已迁模块（CC-71）、core 的 C2 风蚀默认值已删（CC-72），帷幕/风蚀派发器/真元/加农转子裁定留 core 及理由、复现 grep |
| `docs/mcp-panel-fields.md` | **PanelValues 未声明字段盘点（r400 CC-374；r402 CC-376 完成：签名收紧为模板签名，§6 为新增字段规则）**：删签名跑 tsc 的精确清单（`scripts/audit-panel-fields.mjs`）、四类访问（定向属性键 / 通用属性未声明 / 模块私有 / 动态键网关）各自归宿、命座自检被零读者字段短路的发现与 9 个删除、去掉 `[key: string]: number` 的四阶段执行卡 |
| `docs/mcp-write-only-props.md` | **接口属性「只写不读」普查（CC-190）**：为什么按名字的死通道扫描抓不到（CC-189 `gold`）、TS 符号引用 + 名字兜底两段法（`scripts/audit-write-only-props.cjs`）、已删的 5 个假契约字段与爱丽丝 6 命常量双源、T1 cfg 死暂存 / T2 结果死字段待办表（低级模型可做，逐批 zd 零差）、T3 数据类型字段不做理由 |
| `docs/mcp-pending-triage-2026-09-30.md` | **命座/机制 pending 待办分诊（loop 档）**：106 unique 条目分三类（1 A 已立卡暂缓 / 105 B 档案段已含口径 / 3 C 记录性死数据 / 1 FIX 错位已修）；B 类零改动是正确结果（42/42 角色档案段已写明「未建模/近似」口径） |
| `docs/mcp-boss-room-context.md` | **Boss 房间上下文与危局 buff 牌条件（第 360 轮，CC-341）**：buff 牌 `cond`（特性限定 / 人数分档）原被关卡固有 buff 与实战部署页当期牌两个写入方丢弃（40003 两期强攻限定对任何队满额生效），改为随行写入、管线按当前队伍唯一解析（`utils/phaseBuff.ts`）；`applyBossPreset` 13 处调用只有 3 处写关卡固有 buff、抽卡规划 / 角色兑现曲线 `periodViews` 死参的调用点表与 CC-342 候选（房间上下文写入单源化）；testOnly 关卡牌与解析器两处近似（待裁决 / 数据侧） |
| `docs/mcp-analyzer-scenario-isolation.md` | **分析器独立场景（数据隔离，第 369 轮起，CC-343）**：分析器改写 UI store + 手列快照恢复的三类缺陷（漏字段泄漏 / yield 暴露中间态 / calc 与 store 隐式耦合）；出生态 `createConfigModel(catalog, initialState)` 为什么必须在 watcher 注册前写入（朴素注水反例）、`createResourceCalc` 工厂与 `createAnalysisScenario` / `withAnalysisScenario`；第 1 阶段验证（试点角色兑现曲线 A/B 逐字节相同）；7 个待迁分析器的迁移表与配方、删 `configSnapshot` / 接 `batchTask` 的后续阶段、决定与回退点 |
| `docs/REQUIREMENTS.md` | **用户需求唯一入口**：用户经助手写入的 `R<编号>` 需求；每轮开工先读、优先于自选待办，做完标 `[done <commit>]` 不删条目 |
| `docs/proposals/pull-value-optimization.md` | **抽卡规划价值：思想与口径**（部分落地）：价值如何定义与量纲、期望值口径（用户裁决 2026-09-01，模拟抽卡已删）；本文只谈"怎么想"，实施事实以 `pullValue.ts` / `pullPlannerEngine.ts` / `data/filmEconomy.ts` 为准 |

> 项目知识以代码为唯一事实来源：角色口径在 spec `notes` + 模块头注释，用户确认数值在 `verifications`（测试固化），引擎规则在 core/ 注释与测试。删掉的文档不再重建（2026-09-14 删 `architecture-review-2026-09-11.md` 点时间快照：已落地结论长在代码与护栏里，未落地 4 条曾迁账本 Open 段，现随账本瘦身统一收在 `.claude/OPEN-ITEMS.md`）。
> 文档数量以本表为准（92 份，与节标题一致），新增文档需同步本表。
> **判据 9 已递归到子目录**（`docs/**/*.md`）：子目录里的文档同样必须登记，路径按 `docs/<相对路径>` 写
> （2026-10-06 修：`docs/proposals/pull-value-optimization.md` 曾因 glob 只扫顶层而长期不在表内 = agent 找不到）。

# AGENTS.md

> 本仓库：ZZZ 伤害计算器（Vue 3 + TypeScript + Vite + Naive UI + Pinia + Vitest）。
> **任何改动前必读本文件；"这代码怎么跑 / 该改哪"先查下面的导航文档，不要从零翻目录。**

## 0. 任务分级：先认档，再按档读文档

| 档 | 适用 | 必读 | 可跳过 |
|---|---|---|---|
| `fast` | 改 UI / 文案 / 单条测试 / 单文件小修 | 本文件 §1 + 目标文件头注释 | docs 全套（涉及页面时扫一眼对应 .vue 与 AppHeader） |
| `full` | 录角色 / 补机制 / 改引擎 / 排查 buff 没生效 | 本文件 §1 + `docs/ARCHITECTURE.md` §3 + 对应管线文档 | `docs/mechanism-reference.md` 纯参考可不读 |
| `loop` | 跨多文件重构 / 批量迁移 / 数据管道改动 | `full` 全部 + 本文件 §4 长任务账本 | — |

`full` / `loop` 档的阅读顺序（动手前至少扫完 1-2）：

1. `docs/ARCHITECTURE.md` —— **代码架构地图**：五层心智模型、一次计算生命周期、核心类型地图、**任务 → 文件决策树**、数据流速查（"拿到任务该读哪些文件"先看这）
2. `docs/ENGINE_PIPELINE_GUIDE.md` —— 一轮计算的数据流、模块钩子调用顺序、常见坑（applyPanel 拿不到 settings、enrich 回填覆盖、moveId 匹配等）
3. `docs/AGENT_RECORDING_SOP.md` —— 角色录入 SOP：spec 字段→消费者→生效测试清单、防死数据铁律、**命座提升率丢失根因表**

辅助：`docs/GAME_TERM_TO_CODE_FIELD.md`（中文术语→字段）、`docs/MECHANIC_PATTERNS.md`（**机制模式目录：录新角色前先做模式匹配**）、`docs/MECHANICS_IMPLEMENTATION.md`（角色机制档案）、`README.md` §3（录入工作流）。

### 录入角色 / 补机制：角色档案必读（仅此类任务）

**任务是「录入新角色 / 给已有角色补机制 / 核对角色机制口径」时，动手前必须读 `docs/MECHANICS_IMPLEMENTATION.md` 中该角色的档案段**（`grep -n "角色名\|agentId" docs/MECHANICS_IMPLEMENTATION.md` 定位）：

- 档案段记录了该角色**已确认的口径**（资源循环、触发条件、乘区归属、命座语义）与**明确未建模项**——不读它 = 凭印象实现 = 必然踩坑（2026-08 薇薇安实证：档案已写「额外能力侵蚀+12% / 异放 / 预言DoT 未建模」，未读档案的 AI 重新"发现"了这些并做错口径）。
- 档案段首行有「**当前实现状态**」标注（`[已实现]` / `[部分实现]` / `[未建模]` + 实现位置），以它为准核对现状，不要凭 spec status 或记忆判断。
- 补机制时**同步更新档案段**（改完机制 → 更新实现状态行 + 关键口径），保持档案 = 当前事实源。

**其他任务（改引擎 / 排查 / UI）不需要读档案**——按任务决策树进对应层即可，档案只服务角色录入。

> ⚠️ 例外：`docs/MECHANICS_IMPLEMENTATION.md` 未收录的角色（新角色刚导入、档案还没建），以 `src/specs/agents/<id>.json` 的 notes + raw 数据为准，并在录入时**新建档案段**。

## 1. 硬性规则

1. **基线先绿再动手**：改代码前跑 `npm run check` 确认通过；改完跑 check + `npm run typecheck` + `npm run build`（验收命令见 §3）。
2. **数值唯一事实源 = `public/static/catalog.json`**：改数值走 `scripts/` 导入/爬取脚本重跑，不要手改 JSON 本体。
3. **执行行匹配一律用 `moveId`**，不按 name/note（`enrichExecutionPlan` 会从倍率表回填覆盖它们）。
4. **自定义 TS 模块角色**（`src/mechanics/agents/*.ts` 注册过）的 spec 字段是死数据：adjustable 滑块/attributeConversions 必须在模块里实现，spec 只作记录（`validate:specs` 已强制：模块角色的 attributeConversions 必须可证明被消费——模块显式调用 `applySpecAttributeConversions` 或条目 note 标注「实现位置：」，否则校验失败）。
5. **每个录入的机制 = spec 字段 + 生效测试**；命座效果录完跑一次「资源利用率页·命座提升率」确认无橙色「⚠无变化」警示（效果未接进计算的信号）。该自检已有自动化护栏兜底：`allAgentsSweep` 断言「声明已实现命座的角色 C6 伤害 > C0 伤害」，逐级三态判据在 `composables/cinemaUplift.ts`（页面与测试同源）——但页面自检仍要跑，它能定位到具体是哪一级。
6. **跨角色/队伍级机制走 `applyTeamConfig` 钩子**（三阶段 build/converge/postRound，见 `docs/ENGINE_PIPELINE_GUIDE.md` §2），禁止往 `useResourceCalc` 新增 `agentId === 'xxxx'` 分支；面板阶段的覆盖率滑块直接读 `AgentPanelInput.settings`，不要经 panel 字段走私（曾致般岳滑块静默失效）。
7. **spec 文件名必须是 `<agentId>.json`**（`validate:specs` 强制）：拼音 slug 会与别的角色撞车（`juhufu`=朱鸢 vs `jufufu`=橘福福），改错文件代价极高。
8. **知识单一事实源在代码**：改代码时同步更新受影响的文档（`docs/` 清单见 README §6）；不要新建"复述代码"的文档，优先更新决策树条目。
9. **完成必须声明 verifier + coverage**：每个改动结束时，回复里写明——由哪个命令/测试证明它生效（verifier），以及影响范围（哪些角色/页面/文件）。没有测试覆盖的改动先补测试，不算完成。
10. **check 失败先诊断再动手**：先读失败断言/错误文件，写一句根因，再修。禁止不读输出直接重跑或直接改测试；若根因指向测试本身，先复核口径再改。**红基线不允许过夜**：曾有一条 `yixuanSmoke` 断言被当成"既存红"跨多个任务放着，而 CI 里文档漂移检查排在 `npm run verify` 之后同一 job——一红全哑、护栏整张失效（该 job 已拆开）。
11. **跨文件常量只从单一来源引用**：能量/喧响/倍率/异常等共享数值必须引用 `core/`、类型定义或 `statMeta` 中的常量，禁止在模块/页面里复制字面量；改口径先改源，再跑 check。跨角色回能只改 `calcCrossAgentEnergy`（单一事实源）。

## 2. 常见任务入口（完整决策树见 docs/ARCHITECTURE.md §3）

| 任务 | 改哪 |
|---|---|
| 录新角色 / 补机制 | `src/specs/agents/<agentId>.json`（文件名必须=agentId）+ `src/mechanics/agents/<id>.ts`（注册进 `src/mechanics/index.ts`） |
| **跨角色 / 队伍级联动** | 角色模块自己的 `applyTeamConfig`（三阶段）；派发器在 `resourceCalc/helpers.ts`，勿动 `useResourceCalc` |
| **加一个可调滑块** | 模块 `settings` 声明 + 面板阶段读 `AgentPanelInput.settings`；必须补「改滑块→结果确实变」生效测试 |
| 改伤害公式 / 乘区 | `src/core/damage.ts`（乘区顺序 = 代码顺序） |
| 改资源池 / 失衡 / 异常 | `src/core/resource*.ts`、`src/core/stunPool/`、`src/core/anomalyPool/`；跨角色回能只改 `calcCrossAgentEnergy` |
| 改面板 / 转模 / 局外局内 | `src/composables/resourceCalc/helpers.ts`（computePanelPhases） |
| 改失衡轴 / 自动轴 / 预设 | `src/data/stunAxisPresets.ts` + `src/data/stunAxisPresets/*.json` |
| 排查 buff / 命座没生效 | `docs/AGENT_RECORDING_SOP.md` §3.5 根因表；页面「命座提升率」自检 |

## 3. 验收命令

```bash
npm run verify        # validate:data + validate:specs + vitest + typecheck + build（一条链，无重复执行）
npm run docs:status   # 重新生成 docs/implementation-status.md（CI 会检查漂移，漏跑即红）
```

新测试一律用 `src/test/harness.ts`（`setupHarness` / `mockStaticFetch` / `setTeam`），禁止复制三文件 fetch stub；全局回归网 = `src/composables/__tests__/allAgentsSweep.test.ts`（60 角色 × 命座 0/6 不变量）。

## 4. 长任务账本（loop 档）

`loop` 档任务开工时，在当前工作区维护 `.claude/task-ledger.md`（已 gitignore，不提交；属于工作状态，不是项目知识）。固定四段：

- `Goal`：完成定义（用户可验证的结果）
- `Next`：当前唯一的下一个动作
- `Checkpoint`：已完成且已通过验证的步骤（每条写 verifier + coverage）
- `Open`：未决问题与待确认口径

每完成一个文件/模块，更新一次 `Next`；跨会话/长间隔恢复时先读账本再接续。短任务不建账本。

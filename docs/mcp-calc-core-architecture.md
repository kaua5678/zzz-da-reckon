# 计算核心架构优化（诊断 · 目标形态 · 分批任务卡）

> 2026-09-24 lead 会话（远程 MCP）。调研由 4 个 dsflash 工人（`dsh --profile headless`，
> 路由 `wb/deepseek-v4.1-flash`@high，见 `~/.dsh/profiles/headless/cordis.patch.yml`）只读完成，
> lead 对每条入文结论做了独立抽查（标 ✔ 的是 lead 亲自复现过的读数）。工人原始报告在仓库外
> `/home/kaua/calc-arch/{A-resource,B-damagePool,C-outer,D-guards}.md`（不入库，过期即删）。
>
> **本文件是活文档**：任务卡做完一张就把状态改成 `done <commit>`，**不要**追加编年叙事（进 git log）。
> 口径冲突时以代码与 `core/resource.ts#calcTeamResources` 函数头阶段表为准。

## 0. 给执行者（低级模型）的读法

1. 先读 §4「通用验收」——每张卡都引用它，卡里不重复。
2. 只领 §5 里状态为 `ready` 的卡；`design` 卡需要 lead 先把设计写进本文件，`decide` 卡需要用户点头。
3. 一张卡 = 一个提交；同一文件不并行派两张卡（AGENTS §5-3）。开工 `zc claim`，收工 `zc done`。
4. **零行为搬迁卡的唯一判据是「逐位零差异」**：timeGolden / timeFillRatchet 不许重生成，全库 dump A/B 必须 0 差异。
   任何差异 = 搬错了，回炉；**不许**为了变绿去改基线、删断言、调 `frozen`（AGENTS §5 接活方 3）。

## 1. 现状读数（2026-09-24，HEAD `312f2a8` + 批 0）

| 文件 | 行数 | 关键结构 |
|---|---:|---|
| `src/core/resource.ts` | 1705 | `calcTeamResources` 单函数 **247–1287 ≈ 1040 行** ✔；S1–S4 是它体内的闭包（`runInnerLoop` 356 / `runFoldLoop` 432 / `runBillyFinalize` 608 / `runTailPipeline` 677–1107 / `stageAssembleSlot` 929–1095），共享 **~15 个可变 `let`**（`converged`/`iter`/`timeBudget*`×5/`refundFrozen`/`bestExcess`/`stagnantPasses`/`states`…）✔；1288–1705 是招式表查询 `find*`（与资源循环无关） ✔ |
| `src/composables/resourceCalc/damagePool.ts` | 1703 | 编排层伤害行生成；与 core 有 3 类同形公式重复（§2 P4） |
| `src/composables/resourceCalc/convergence.ts` | 1505 | `runCalcRound` 单闭包 ≈1045 行、**33 个局部 `let`**（工人 C） |
| `src/composables/useResourceCalc.ts` | 1189 | `computeCalcOutput` 406 行（外层不动点 + S3 可行化）**活在 Vue composable 里** ⇒ 求解器离开 Vue 无法调用 |

护栏读数（`npm run check-guards` 21/21 ✔）：core agentId 棘轮 **6/6**、core→角色模块 import **5/5**、编排层 agentId **1/1**。

core 的 6 行角色判定 ✔：`resource.ts:615`(1531) `:864`(1451) `:1224`(1531) `:1225`(1051)，`resource/helpers.ts:155`(1471) `:303`(1451)。
core 的 5 处角色模块 import ✔：`resource.ts:8` / `resource/helpers.ts:16` → `luciaElowen`；`resource/helpers.ts:17` → `banyue`；
`anomalyPool.ts:10` / `anomalyPool/helpers.ts:55` → `velina`。

## 2. 诊断：五个结构问题

**P1 · 阶段只在注释里存在，不在代码边界里。** 阶段表（S0–S5）写得很好，但 S1–S4 是同一函数里的闭包，
靠隐式共享可变量通信（例：`runFoldLoop` 写 `timeBudgetPasses/…/refundFrozen`，`runTailPipeline` 写 `states/converged`）。
后果：任何阶段都不能单测、不能单独 profile；截断重折环（R37-J2②）只能靠「重置诊断量 + 重入闭包」实现（`resetDiagnostics` 1134）。

**P2 · 引擎层不是角色无关的。** 能力查询模式已经存在且好用（`crossAgentSupply`：模块声明 `kind`，
引擎 `getAgentMechanic(cfg.agentId)?.crossAgentSupply` 按能力查），但还有 4 个角色没迁：
1531/1051「终局整数重推」、1451「帷幕触发」、1471「强特次数由循环决定」、velina「侵蚀状态模拟」。

**P3 · 编排层求解器与 Vue 响应式绑死。** 外层不动点 / 降配 / 轴退化全在 `useResourceCalc()` 体内，
自由对比、时间图表、选第三人都只能「写 store → 读 computed」绕一圈（ARCHITECTURE §3「引擎没有单角色求值入口」）。
`runCalcRound` 本身已是工厂 + 显式 threads（好），但契约里曾挂着 8 个从未读取的下游 computed（**批 0 已删**）。

**P4 · 公式在编排层有副本（规则 11）。** 均经 lead 复现 ✔：
- 贯穿力 `atk*0.3 + hp*0.1 + sheerForceFlat`：`core/damage.ts:186`（**未导出**）+ `mechanics/agents/norma.ts:100` 私有副本 + `damagePool.ts:1067` 内联；
  `damagePool.ts:1020` 的内联版**缺 `sheerForceFlat`** —— ✅ **CC-D1 已裁决 = 真缺陷，2026-09-25 已修**
  （改引 `calcPenetrationPower`；实测：琉音「命破队友 400% 贯穿力」行在面板 sheerForceFlat 781.6→0 时
  delta=0，修复后 auto-1371/1051/1531-1481-1451 各 +0.58%~+0.60%、banyue-liuyin-lucia +1.00%）。
- 强击 713：`damagePool.ts:1245/1402/1429` 裸字面量，而 `ANOMALY_SINGLE_HIT_MULTIPLIER` 已被同文件 import。
- 标准 DoT：~~core `calcStandardDotDamage` 产出 `standardDotDamage`，生产零消费~~ → **CC-D2 已删**（2026-09-25）。生产唯一实现 = `resourceCalc/damagePoolAnomaly.ts` DoT 行。

**P5 · 文件职责混装。** `core/resource.ts` 同时装着资源求解器、热启动缓存（98–160）与招式表查询（1288–1705）。

## 3. 目标形态

```
core/resource.ts                    calcTeamResources ≈ 150 行：只按阶段表顺序调用下面的阶段函数
core/resource/solveContext.ts       SolveContext（只读：configs/config/totalTime/maxIter/oscillatorStop/种子）
                                    + SolveDiagnostics（唯一可变诊断累加器，取代 8 个 let；重折环 = new 一个）
core/resource/innerLoop.ts          S1  runInnerLoop(ctx, from) → { end, clean, iterations }   （纯）
core/resource/foldLoop.ts           S2  runFoldLoop(ctx, diag, from) → states
core/resource/underfillProbe.ts     S3a 末轮欠打回填（高阶：measure/converge 回调注入）
core/resource/assembleSlot.ts       S4  assembleSlot(ctx, slotCtx, cfg, i)
core/resource/finalizePasses.ts     通用「终局整数重推」执行器（按能力，不按角色）
core/resource/warmStart.ts          热启动缓存
core/resource/moveLookup.ts         find* 招式表查询（resource.ts 留 re-export 壳）

mechanics/types.ts  AgentMechanicModule 新增引擎能力（声明式，照 crossAgentSupply 先例）：
  finalizePass?      { run(ctx) ; reset(cfg) }        ← 1531 / 1051
  exSpecialCount?    (cfg) => number                  ← 1471
  curtainTriggers?   (…) => number                    ← 1451（或并入 crossAgentSupply 新 kind）
  anomalyStateSim?   (…)                              ← velina
  ⇒ core agentId 棘轮 6→0、core 角色 import 5→0

composables/resourceCalc/solveTeam.ts   Vue 无关的外层求解：runOuterLoop + stageResolveFeasibility
                                        （输入 = 快照化的 store 读数 + runCalcRound；输出 = CalcOutput）
composables/useResourceCalc.ts          只剩 computed 包装与对外 API
```

**约束（踩过的坑，别重新发明）：**
- 新文件**必须放在 `resourceCalc/` 目录直属**，不能建子目录：`scripts/lib/agent-branch-ratchet.mjs:50-51` 的 `inScope`
  不递归 ⇒ 子目录整类逃出 agentId 棘轮（✔ 复现；`anomalyPanels.ts:17-18` 有同款记录）。要用子目录，先单独一批把 `inScope`
  改成递归（换尺批，不与搬迁混批，规则 17②）。
- `core/**` 不得 import 角色模块、不得写 `agentId === '<id>'`（两条棘轮）；能力一律经 `getAgentMechanic(cfg.agentId)?.<能力>` 查询。
- cfg 对象同一性：回滚只能 `Object.assign`，不能换对象（`resource.ts:799` 注释；工人 A B5-R1）。
- 热启动写回顺序（终局重推之后、装配之前）是 `@fact engine:热启动逐位透明` 的前提，搬迁不得重排。
- `@fact` 锚 `src/core/resource.ts#calcTeamResources` 有多条；符号搬走要同步改锚，否则判据 10 断锚即红。
- `PROBE_TRACE_FOLD` 打表是 `convergenceProbe.test.ts` 的读数来源，随 `runFoldLoop` 一起搬。

## 4. 通用验收（零行为卡全部适用）

```bash
cd /home/kaua/projects/zzz-calculator
# ① 改前：存 dump A（约 45s；PERF_OUT 放仓库外；dump 是 .json 内容，文件名用 .json 便于 require）
PERF_OUT=/home/kaua/calc-arch/dump-A.json npx vitest run --config .zc/perf/vitest.perf.config.ts dump
# ② 改后：
npm run check-guards                     # 期望末行「21 guard checks passed」（条数随加固可能变，不许减少）
npx vitest run src/composables/__tests__/timeGolden.test.ts src/composables/__tests__/timeFillRatchet.test.ts \
  src/core/__tests__/allAgentsGuards.test.ts src/core/__tests__/warmStart.test.ts \
  src/composables/__tests__/seedInvariance.test.ts src/core/__tests__/truncationRefold.test.ts   # 全绿，不许带 *_UPDATE=1
PERF_OUT=/home/kaua/calc-arch/dump-B.json npx vitest run --config .zc/perf/vitest.perf.config.ts dump
node -e 'const a=require("/home/kaua/calc-arch/dump-A.json"),b=require("/home/kaua/calc-arch/dump-B.json");const k=[...new Set([...Object.keys(a),...Object.keys(b)])].filter(x=>x!=="__ms"&&a[x]!==b[x]);console.log(k.length?`DIFF ${k.length}: ${k.slice(0,10)}`:`DUMP-ZERO-DELTA (${Object.keys(a).length-1} 场景)`)'
# ↑ 必须输出 DUMP-ZERO-DELTA；dump 是单行 JSON（值 = 伤害|hash(resourceResult)|hash(stunPool)|降配上限）。
#   `__ms` = dump 自身墙钟耗时（dump.perf.ts 的 performance.now 差值），**不是场景值**，比对时排除
#   （CC-1 工人实测：同代码两次 dump 仅 __ms 不同 42027 vs 49402，624/624 场景逐位相同；lead 裁决 2026-09-24）。
#   ⚠ dump **不覆盖 damagePoolRows 的 note/baseFormula 文案**（只 hash resourceResult/stunPool + 总伤害）。
#   动行文案的卡另跑 rowsnap（= dump + hash(damagePoolRows)，`.zc/perf/rowsnap.perf.ts`，文件名刻意不含 dump 以免被 `dump` 过滤器同时选中）：
#   ⚠ 2026-09-25 CC-T1 起 **rowsnap 基线 = 637 场景**（`rows-A.json`；新增 13 个 `/axis` = 尾段角色队注入最小轴），dump 仍 624；旧 624 版备份 `old/rows-A-624.json`。
#   ⚠ 2026-09-26 CC-13 起 dump-A / rows-A 按新键名（`exRefundEnergy` 等）重生成（旧版备份 `old/dump-A-pre13.json` / `old/rows-A-pre13.json`）；此后纯改名卡用 `PERF_KEY_ALIAS` 开关（`.zc/perf/*.perf.ts#enc`）证零差，映射表随卡更新。
#   PERF_OUT=/home/kaua/calc-arch/rows-B.json npx vitest run --config .zc/perf/vitest.perf.config.ts rowsnap
#   基线 rows-A.json 须在改前 HEAD 的 worktree 里跑，比对命令同上换文件名。
#   ⚠ **基线代次**：`4ca47db`（CC-D1/D3 数值修复）改了 9 个预设 54 个场景 ⇒ 旧 A 作废（移至 /home/kaua/calc-arch/old/）。
#   现行 dump-A.json / rows-A.json 由 lead-arena-0925c 于 `d97a8b0` 重生成（2026-09-25 17:55）；此后只要仍是零行为卡就一直有效，
#   任何**有意改数值**的提交落盘后必须重生成并在此行更新代次。
npm run build                            # vue-tsc + vite，EXIT 0
```
不许跑 `npm run verify`（12min+，lead 合并前统一跑）。报告写 `.zc/reports/<卡号>.md`，第一行 `STATUS: done|blocked`，
附上面每条命令的尾部输出；最后一条回复也带 STATUS。

## 5. 任务卡

| 卡 | 档 | 状态 | 内容 | 主要文件 |
|---|---|---|---|---|
| CC-0 | — | **done（本会话）** | 删 `createRunCalcRound` 8 个死依赖 + 纠正「在 calcOutput 求值中读它们」的假注释 | convergence.ts / useResourceCalc.ts / 3 个测试 |
| CC-1 | fast | **done（dsflash 工人 + lead 复核）** | `find*` 招式表查询迁 `core/resource/moveLookup.ts` | core/resource.ts 1288–1705 |
| CC-2 | fast | **done（dsflash 工人 + lead 复核）** | 热启动缓存迁 `core/resource/warmStart.ts` | core/resource.ts 98–160 |
| CC-3 | fast | **done**（lead 复核：dump 624 零差、guards 21、build、§4+floatNoise/miyabiCinema 37 测过；同机 A/B 耗时 HEAD 52.0/53.2s vs CC-3 50.0/52.6s 无退化） | S1 `runInnerLoop` 提为纯函数 `core/resource/innerLoop.ts` | core/resource.ts 356–430 |
| CC-4 | review | **done**（dsflash 工人 + lead 复核：dump/rowsnap 624 零差；反向验证 ① 删 `diag.iterations` 写入 489 场景红、② 删拒绝还原 1 场景红（`auto-1431-1481-1491/heavyGate`，重折拒绝路径有样本）；resource.ts 1097→907；verify 过） | `SolveDiagnostics` 累加器 + S2 `runFoldLoop` 外提（+ `buildExecutionsWithPhase` 迁 `phaseExecutions.ts`） | 见下方 CC-4 卡 |
| CC-5a | review | **done**（dsflash 工人 + lead 复核：dump/rowsnap 624 零差；反向验证 ① 删被拒 cfg 回滚 16 红、② 删 `diag.timeBudgetIdleSeconds` 177 红；resource.ts 907→801；verify 过） | S3a 欠打回填外提 `core/resource/underfillProbe.ts` | 见下方 CC-5a 卡 |
| CC-5b | review | **done**（dsflash 工人 + lead 复核：dump/rowsnap 624 零差；反向验证 ① `giftTimeThisSlot=0` 29 红、② 注释帷幕提供者块 42 红；resource.ts 801→630；verify 过） | S4 `stageAssembleSlot` 外提 `core/resource/assembleSlot.ts` | 见下方 CC-5b 卡 |
| CC-5c | review | **done**（dsflash 工人 + lead 复核：dump/rowsnap 624 零差；反向验证 ① 删包装 `states = r.states` 0 差（尾段后外层 states 在当前调用图里是死值——重折每轮从 `s2EntrySeedStates` 重跑、循环后不再读；写回按旧语义保留）、② 删 `storeWarmStart` ⇒ warmStart.test 2 红；resource.ts 630→497；verify 过） | S3–S4 尾段管线 `runTailPipeline` 外提 `core/resource/tailPipeline.ts` | 见下方 CC-5c 卡 |
| CC-5d | review | **done**（dsflash 工人 + lead 复核：dump/rowsnap 624 零差；反向验证 ② 恒拒绝 31 红；① 删拒绝分支 `restoreCfgs` 0 差——插桩证实拒绝路径在语料里执行 387 次/43 队、cfg 确被还原，但被还原的键在返回前全被下游覆盖/清除，dump 不可观测（同族 `diag = accepted.diag` 删掉则 1 红），写回按旧语义保留；resource.ts 497→441；verify 过） | 截断重折环外提 `core/resource/truncationRefold.ts`（`rerun` 回调注入） | 见下方 CC-5d 卡 |
| CC-5e | review | **不做**（lead 5d 后实测：`calcTeamResources` 265 行、其中代码 121 行，其余为口径注释——已达 §3 目标「≈150 行只按阶段调用」；再抽 `SolveContext` 收益 < 风险） | `calcTeamResources` 收成编排器 | — |
| CC-6a | review | **done**（dsflash 工人 + lead 复核：dump 624 零差、反向验证 36 条 banyue 场景红、guards 21、build、27 文件 533 测过） | 引擎能力 `exSpecialCount`：1471 般岳分支迁模块；core agentId 6→5、core 角色 import 5→4 | mechanics/types.ts、agents/banyue.ts、core/resource/helpers.ts、2 个棘轮基线 + RATCHET_BURNDOWN |
| CC-6b | review | **done**（dsflash 工人 + lead 复核：dump/rowsnap 624 零差、反向验证 42 条 1051+1451 场景红、guards 21、build、509 测过；另核全部 crossAgentSupply 消费点均按 kind 过滤 ⇒ yidhari 新声明不会被误取） | 1451 帷幕：`curtainTriggers` 能力 + yidhari 声明 `crossAgentSupply.kind='curtain-open'`；agentId 5→3、import 4→2 | 见下方 CC-6b 卡 |
| CC-6c | review | **done**（dsflash 工人 + lead 复核：dump/rowsnap 624 零差；反向验证 ① yidhari→preTail 38 场景红、② 注释 yeshuguang 42 场景红；guards 21、verify 过；core agentId 分支归零） | 1531/1431/1051 终局重推：`finalizePass` 能力 + 通用执行器 `core/resource/finalizePasses.ts`；agentId 3→0 | 见下方 CC-6c 卡 |
| CC-6d | review | **done**（dsflash 工人 + lead 复核：dump/rowsnap 624 零差、反向验证 66 条 1561 场景红、guards 21、build、497 测过；core 角色 import 归零） | velina 风蚀：模块能力 `anomalyCorrosion`，core 经 `agentMechanics` 查询；core 角色 import 2→0 | `anomalyPool.ts`、`anomalyPool/helpers.ts`、新 `anomalyPool/corrosion.ts`、`mechanics/types.ts`、`agents/velina.ts`、棘轮 |
| CC-7 | fast | **done**（dsflash 工人 + lead 复核：PanelValues.atk/hp 必填 ⇒ `?? 0` 死分支；dump 624 零差、guards 21、build、48 测过） | 贯穿力单一事实源：导出 `calcPenetrationPower`，norma.ts / damagePool.ts:1067 改引用（**不碰 :1020**） | core/damage.ts、norma.ts、damagePool.ts |
| CC-8 | fast | **done**（dsflash 工人 + lead 复核：逐项值相等；dump 624 零差 + rowsnap（含行文案）624 零差、guards 21、build） | damagePool 异常常量改引 core：713/500/1250 与 DoT 表改用 `ANOMALY_SINGLE_HIT_MULTIPLIER` / `STANDARD_DOT_CONFIG` | damagePool.ts 1242–1247 / 1402 / 1429 |
| CC-9a | review | **done** `72e0eb5`（damagePool.ts 1727→1141；新 `damagePoolAnomaly.ts` 661 行；rowsnap/dump 624 零差，verify 3490） | damagePool 尾段（:1142–1725 异常 + 1171/1401/1261/爱丽丝/1581 附加行）原样外提 `damagePoolAnomaly.ts` 的 `emitAnomalyRows(env)`，共享 `rows` 注入 | damagePool.ts |
| CC-9b | review | **done** `740290d`（damagePool.ts 1141→438；Direct 350 / Release 297 / CharExtras 241 行；rowsnap/dump 624 零差，verify 3490） | 逐角色主循环（:415–1132）按 D 直伤 / R 异放事件 / X 角色附伤三段原样外提 `damagePoolDirect.ts` / `damagePoolRelease.ts` / `damagePoolCharExtras.ts`；共享 `rows/seenDirectIds/claimedInAxis` 以对象引用经 `CharRowsEnv` 注入；辅助闭包（:116–413）留入口，CC-9c 再议 | damagePool.ts |
| CC-9c | review | **不做**（lead 2026-09-25） | 辅助闭包（:116–413 `pushDirect/pushRelease/axisSplitFor/*Fraction` 等）外提：它们闭包入口局部量，外提须改工厂函数（非原样搬），收益小；damagePool.ts 已 438 行、职责单一（ctx 解构 + 辅助 + 编排三段）。若日后要单测辅助函数再立卡 | damagePool.ts |
| CC-T1 | review | **done**（v2，本机 `.zc/perf`，无仓库提交）：rowsnap 新增 13 个 `/axis` 场景（注入最小轴），基线 624→**637**；lead 复跑：HEAD 零差 637，反向 `isAxis:false` ⇒ DIFF 9 全在 `/axis` | rowsnap 预设补「失衡轴 × 尾段角色」（1171/1401/1261/1581 + 爱丽丝）组合：CC-9a 反向 ① 实测该面零覆盖，只有 `inStunAttribution.test.ts` 兜底。低级模型可做（只加预设 + 重生成 A 基线） | .zc/perf/ |
| CC-10 | review | **done** `a73b6f8`（useResourceCalc.ts 1189→789；新 `solveTeam.ts` 476 行 + 纯度锁测试；dump/rowsnap 624 零差，verify 3493） | `computeCalcOutput`（:248–654，含 `runOuterLoop` / `stageResolveFeasibility`）原样外提 `resourceCalc/solveTeam.ts#solveTeam(input)`，Vue 无关；唯一 store 写（降配闸门 ceiling）改为返回 `ceilingWriteBack` 由 composable 执行 | useResourceCalc.ts |
| CC-11a | review | **done** `129648b`（convergence.ts 1505→1153；roundInputs 354 / roundResult 24 行；vue 仅 type import；dump/rowsnap 624 零差，verify 3493） | C1 轮输入工厂 + C2 `resolveAxisUltimateDecibelCost` → `roundInputs.ts`；C3 `CalcRoundResult` → `roundResult.ts`；convergence.ts 原名 re-export，8 个消费者零改动 | convergence.ts |
| CC-11b | review | **暂缓**（lead 2026-09-25） | `runCalcRound`（convergence.ts :106–1151，顶层 16 个 `let`）引入 `RoundCtx` 按 C4–C10 簇拆。暂缓理由：§3 目标形态**不含** convergence.ts（§3 各项已由 CC-4…CC-10 落地），闭包内各段互读互写局部量、无清晰阶段边界，拆分风险高于收益。**重启条件**：出现要单测某一簇、或某簇需被 solveTeam 以外复用的真实需求；届时先做 CC-T1 v2 保证轴覆盖 | convergence.ts |
| ~~CC-D1~~ | — | ✅ **done 2026-09-25（用户裁决「别人有为什么不算」）** | `damagePool.ts:1020` 琉音命破队友分支的贯穿力补 `sheerForceFlat`（改引 `calcPenetrationPower`） | damagePool.ts:1020 + `@fact engine:贯穿力/单一事实源`（GAME_TERM §10）+ 判据 `ccD3D1Verdict.test.ts::CC-D1` |
| ~~CC-D2~~ | — | ✅ **done 2026-09-25（lead 自做，用户未裁决、按授权取零行为改变方案）** | 删 core `calcStandardDotDamage`（helpers.ts）+ `AnomalyPoolResult.standardDotDamage` + `StandardDotDamageResult/Detail` 类型；`STANDARD_DOT_CONFIG` 保留（damagePoolAnomaly 在用）。**对账**（临时探针，全预设 120 个「预设×元素」DoT 行两边都有输出）：core/damagePool 比值 min 0.409（claret-koleda-rina 电）/ p25 1.000 / 中位 1.000 / p75 1.158 / max 1.774（auto-1381-1361-1301 火）。差异来源：core 只用施加者单人面板、不计持续时间延长、有风角色整段跳过、无蕾米埃尔异常倍率、失衡用 `config.stunned`；damagePool 用虚拟面板按积蓄占比分摊、计延长、按 1−windRate 折算、失衡用覆盖率 ⇒ 接入 core 版只会降精度。**两边都未模拟 DoT 重复触发的刷新截断**（跳数 = 触发×满额）——若要做属改数值，需先查游戏机制，另立项。DoT 占整队伤害中位 0.6%、最高 40.8%。探针 `anomalyFrontierProbe.test.ts` 改读生产 DoT 行（`anomaly-damage-*` 且 type∈灼烧/感电/侵蚀）。dump 624 / rowsnap 637 零差，build + verify 过 | anomalyPool.ts / anomalyPool/helpers.ts / types/resource/pools.ts / anomalyFrontierProbe.test.ts |
| ~~CC-D3~~ | — | ✅ **done 2026-09-25（用户裁决「维琳娜专属资源，不该给别人计算」）** | 风蚀归属改按面板标记 `velinaEnabled`（`velina.ts#findVelinaPanel`/`#resolveVelinaCorrosion`，模块唯一写入方）。探针先行的预测**已证实**：1621 队产出 `{turb:3,micro:2,broad:1,boosted:1}` + 2 条「维琳娜…气旋」行共 15 702 挂在洛克茜名下、1631 队 5 936 挂赛维里安 ⇒ 数值缺陷。修后无维琳娜 ⇒ `velinaCorrosionSource` 为 `undefined`（非全零），气旋行/广域积蓄注入整套消失；**乱流仍在**（通用机制）。dump A/B：6 支洛克茜队 −0.06%~−0.15% | velina.ts / anomalyPool.ts / anomalyPool/helpers.ts + 判据 `anomalyPool.test.ts::CC-D3` + `ccD3D1Verdict.test.ts` |
| CC-D4 | — | **done** `1eedd4c`（lead 自做） | 删 `AgentAnomalyTransformInput.store` 字段、`anomalyPool.ts` 的 `transformStore` 与 `velina.ts` 唯一写入：全仓无读，引擎经能力 `anomalyCorrosion` 按最终乱流次数重算同一结果；dump/rowsnap 零差，verify 绿 | anomalyPool.ts / types.ts / velina.ts |
| CC-12 | 换尺 | **done**（dsflash 工人 + lead 复核：新增命中恰为 convergence.ts:302/311 两行；编排层基线/frozen 1→3（口径纠正），core 5 不变；src 零改动；guards 21、scripts 测试 452 过、build） | 身份扫描器补「本地别名」形态（`convergence.ts:302/311` 的 `fillerAgentId === '1051'/'1041'` 现在量不到），按规则 17② 调 `frozen` 到真实值 | scripts/lib/agent-identity-lines.mjs 等 |
| CC-13 | review | **done**（dsflash 工人 v2 + lead 复核：闸门 grep 两条 0 行；build；guards 21；带 `PERF_KEY_ALIAS=1` dump 624 / rowsnap 637 零差，不带开关 dump 全量 DIFF 624（键名旁证）；反向验证删 `exRefundFreeCap` 写入 ⇒ DIFF 31 全为 yidhari-* 场景；verify 过。首派因卡面漏洞（EnergySource 键进 dump 哈希）停掉，见卡末 v2） | 连续强特通道通用化（R22-D1 批 1-1）：引擎只认 `exContinuous`/`exFinalize`/`exRefundPerPaid`/`exReserved*`/`exRefundFreeCap`，1051 模块声明；core 不再读 `yidhariExPerStun`/`yidhariStunCount`；零 delta | 14 文件，见下方 CC-13 卡 |
| ~~批 1-2~~ | — | **不做**（lead 2026-09-26） | 比利/叶瞬光终局旗标并入 CC-13 通用通道：旗标只被各自模块读写、core 零读取，且语义不同 | `docs/mcp-r22d1-batch12-field-census.md` §2 |
| CC-14a | review | **done** `285885b`（判据 22 803→775） | 6 角色专属能量项迁模块能力 `bonusEnergy`，EnergySource 收成 `bonusEntries`，零差（基线 H1a @ 66ba89a） | 卡面 `docs/mcp-r22d1-batch12-field-census.md` §5.2；普查与分簇见 §5 |
| CC-14b | review | **done** `6d8a995`（判据 22 821→803） | 伊德海莉燃血喧响两处同式迁模块能力 `selfBurnDecibel`，零差（新基线 H0 @ f0df0cb） | 卡面 `docs/mcp-r22d1-batch12-field-census.md` §5.4 |
| CC-14c | review | **done** `ba6db48`（判据 22 775→766） | 装配期外部回血写回迁模块能力 `onFinalAssemble`，删 `yidhariSlot`，零差 | §5.5 |
| CC-14d | review | **done** `e94b896`（判据 22 766→763，target 重设 740） | 热启动反馈字段改模块声明 `feedbackCfgKeys` | §5.5 |
| CC-14e | review | **done** `1e3dc99`（判据 22 763→759） | 卢西娅帷幕写回（assembleSlot luciaCurtain*）并入 onFinalAssemble，零差 | §5.5 / §5.6
| CC-15 | review | **done** `b1ed48e`（判据 22 759→733，target 重设 720） | 赠行通用命名：ultimateGiftTimeReserved / chainGiftTimeReserved / chainGift 等，纯改名零差 |
| CC-16 | review | **done** `fe8fb90`（判据 22 733→712，target 重设 700） | banyueTopUp→interactionTopUp 通用命名，纯改名零差 |
| CC-17 | design | **done** `18bfd88`（判据 22 712→661，target 重设 649；修可琳 basic_attack 泄漏） | axis overlay 消费端能力化（damagePoolDirect 冥网/凝神/柯林失衡加成），约 30 处 |
| CC-18a | design | **done** `23470f2`（判据 22 661→623，target 重设 611） | 柏妮思附加直伤 4 行 + 半月 C6 摧岳附伤迁模块能力 extraDirectRows
| CC-18b | review | **done** `a936127`（判据 22 623→613） | 琉音 3 块（重击附加 / 非轴强特拆分 / 影画6余音）迁 extraDirectRows，零差 | census §5.11 |
| CC-19a | design | **done** `b14fb4a`（判据 22 613→601，target 重设 589） | 新能力 extraAnomalyRows（分组 + 顺序键）；柏妮思 C6 灼烧迸发迁模块，零差 | 设计稿 `docs/mcp-cc19-extra-anomaly-rows.md` / census §5.12 |
| CC-19b | review | **done** `3fbb326`（判据 22 601→545，target 重设 533） | 爱丽丝极性强击 / C6 / 畏缩 + 简 C6 迁 extraAnomalyRows，零差；排序反向验证生效 | census §5.13 |
| CC-19c | review | **done** `b45652c` + `de1cc8d`（判据 22 545→535→499，target 重设 487） | 蕾米埃尔耀变 / 特殊虚耀迁 extraAnomalyRows；辅助函数迁 mechanics、ELEMENT_*_KEYS 迁 core；异常尾段已无内联角色块 | 设计稿 §8 / census §5.14 |
| CC-20 | review | **done** `ea61032`（判据 22 口径纠正 499→462，target 平移 450） | trigger* 触发者通用名 5 个入 ROLE_FIELD_EXEMPT（换尺，规则 17②，单独提交） | census §5.14 |
| CC-21 | review | **done** `3d000d0`（判据 22 462→447，target 重设 435） | 全队异常乘区 remielleAnomalyMultiplier → 模块能力 globalAnomalyMultiplierFactor + 通用改名 globalAnomalyMultiplier，零差 | census §5.15 |
| CC-22 | review | **done** `05bb382`（修订版；判据 22 447→430，target 418） | 原「改名 teamAssaultCount」作废（assault 实为爱丽丝自己触发的强击，并非全队次数）→ 爱丽丝剑仪外部次数源改走 nextRoundFeedback + threads，删掉 AgentTeamConfigInput/panelPhases 专用字段及 convergence 对爱丽丝的直连 import，零差 | census §5.16 |
| CC-23 | review | **done** `8ecd5f2`（判据 22 430→420，target 418） | 般岳交互补齐：banyueSlot 身份找槽 → producesInteractionTopUp 声明式；computeBanyueInteractionTopUp → 模块能力 computeInteractionTopUp；InteractionTopUp 类型迁 mechanics/types；零差 + 单测反向 | census §5.17 |
| CC-24 | review | **done** `1d1d823`（判据 22 420→410，target 398） | 畏缩配置通用化：aliceCoweringConfig → coweringConfig、AliceCoweringConfig → CoweringConfig（输出字段 aliceCoweringDot 不改），零差 | census §5.18 |
| CC-25 | review | **done** `7cef9c8`（判据 22 410→403，target 398） | roundInputs `aliceInfo`（findSlotByIdentity 1401 + 直读 cfg.alice*）→ 模块能力 anomalyPoolSetup（畏缩配置；giftedTriggerSlot 取提供者槽位），零差 + 单测反向 | census §5.19 |
| CC-26 | review | **done** `8b7d9db`（判据 22 403→363，target 351） | core/resource 蕾米埃尔「垂虹」必做动作行 + helpers 时间合计 → 模块能力 extraNecessaryAction；特殊虚耀事件 → remielle buildAnomalyEvents，零差 | census §5.20 |
| CC-26b | review | **done** `0d65f59`（判据 22 363→357，target 351） | rowBuild 蕾米埃尔「光辉回转」后台行 → 模块能力 backstageAutoRows（原位置派发），零差 | census §5.21 |
| CC-28 | review | **done** `69e85c4`（判据 22 357→340，target 328） | useResourceCalc `remielleVoidflareEvents`（编排层角色分支）→ moduleAnomalyEventRecords + 模块能力 anomalyEventRecords；展示层单测固化迁移前输出 | census §5.22 |
| CC-29 | review | **done** `69b53f9`（判据 22 340→332） | useResourceCalc 简 6 命强击暴击附伤事件（findSlotByIdentity 1261，最后一处）→ jane 模块 anomalyEventRecords；useResourceCalc 已无 findSlotByIdentity | census §5.23 |
| CC-30 | review | **done** `371a2c1`（判据 22 332→326，target 314） | `remielleEntryPanels` → `entrySnapshotPanels` 纯改名；判据 17 名单与规则文档同步 | census §5.24 |
| CC-31 | review | **done** `0b8a28a`（判据 22 326→270，target 258） | `CalcRoundThreads` 14 个模块下一轮反馈具名字段 → `moduleFeedback` 字典（键类型 mechanics/types `ModuleFeedback`，缺键 = 0） | census §5.25 |
| CC-32a | review | **done** `0671c4c`（判据 22 270→254，target 242） | crossAgentEnergy 席德正兵回能内联块 → 席德 `crossAgentSupply` `vanguard-energy`（perTargetAmounts + onOwnSlotCrossAgentEnergy 回写） | census §5.26 |
| CC-32b | review | **done** `a276399`（判据 22 254→231，target 219） | `CrossAgentEnergy` 5 个角色具名展示字段 → `bySource` 字典；结果卡改 v-for + 标签表，补席德正兵回能缺失的展示行 | census §5.26、§5.27 |
| CC-33 | review | **done** `e882b9f`（判据 22 231→219，target 207） | 悠真 `harumasaStunOnly` → `SkillExecution.stunOnlyDmgBonus`（通用、带类型）；希希芙蚀骨轴内占比 → 模块能力 `directRowAxisSplit` | census §5.28 |
| CC-34a | review | **done** `7de5847`（判据 22 219→171，target 159） | 蕾米埃尔 14 + 叶瞬光 2 个角色专属面板属性：`core/buff.ts` 删等价 case，`core/panel.ts` 初值由 `data/agentPanelStats.ts` 表铺开；CC-34b/c/d 待做 | census §5.29 |
| CC-34b | review | **done** `db01cb6`（判据 22 171→155，target 143） | 蕾米埃尔 RainbowEnd / RadiantTurn 7 个 cfg 字段与两个招式查找函数从 core/moveLookup + helpers 迁到 `remielle.ts#buildRemielleCharConfig`；`channelMetricsOf` 导出；dump / rows 零差 | census §5.30 |
| CC-34c①+34d | review | **done** `372bbed`（判据 22 155→149，target 143 未变） | 花羽轮舞喧响读点从 helpers cfg 字面量迁 `buildRemielleCharConfig`（`+=`）；删 helpers / anomalyPanels 里蕾米埃尔 3 个函数的 re-export 壳；新增钩子单测（dump 覆盖不到：花羽轮舞次数全仓没有写入方，已记为未决）；CC-34c② 待做 | census §5.31 |
| CC-34c② | review | **done** `99b945a`（判据 22 149→148，target 143 未变） | 新模块能力 `skillDazeMultiplier`（招式级失衡独立乘区）；删 helpers 里蕾米埃尔 1581010 内联分支，remielle 逐字实现；反向变异 dump 37 键 | census §5.32 |
| CC-35a | review | **done** `c684126`（判据 22 148→146） | 新模块能力 `anomalyRefringePct`（异常虚拟面板异化度展示列）；remielle 抽 `remielleRefringePct` 作乘区与展示的唯一来源；core/resourceCalc 的 remielle\* 清零 | census §5.33 |
| CC-35b | review | **done** `084a4e7`（判据 22 146→134，target 重设 122） | `AgentCharConfigInput` 加可选只读 `char`；仪玄 5 / 普罗米娅 1 个交互栏次数由模块 buildCharConfig 读入，删 helpers 字面量 6 行；新测试 charInputFields | census §5.33 |
| CC-35c-A | review | **done** `d40a62d`（判据 22 134→130） | 新模块能力 `teamAnomalyDurationBonus`（全队异常持续时间通用规则臂，取最大值）；柏妮思 / 丽娜 / 简实现，删 anomalyPanels 按 id 写死分支 | census §5.34 |
| CC-35c-B | review | **done** `b7b0d81`（判据 22 130→125） | 新模块能力 `adjustTeammateBuffSource`（队友 buff 来源面板修正）；莱特 / 耀嘉音实现，删 panelPhases 按 id 写死块；接线测试用包裹能力记录调用 | census §5.34 |
| CC-35c-C | review | **done** `c763f5a`（判据 22 125→123） | cfg `luciaC4DecibelPerTrigger` → 通用名 `decibelPerCurtainTrigger`（帷幕喧响） | census §5.35 |
| CC-35c-D | review | **done** `dbc7e92`（判据 22 123→103，target 重设 91） | core/resource/helpers.ts 赠链局部量去角色名（取值早已走 crossAgentSupply 通道） | census §5.35 |
| CC-35d-A | review | **done** `a1241ba`（判据 22 103→92） | 新模块能力 `chainGift`（装配后赠送连携）；`normaHatChain.ts` → `chainGift.ts#applyChainGift`，去 findSlotByIdentity([1571]) | `docs/mcp-cc35d-gift-chain.md`、census §5.36 |
| CC-35d-B1 | review | **done** `0aa191e`（判据 22 92→83，target 71） | 琉音出口改名 ultPromoteCount / ultPromoteHug60 | 设计稿 §D、census §5.37 |
| CC-35d-B2 | review | **done** `e9e80cd`（83→76） | 新模块能力 `skipsGenericDirectRow`（琉音强特行跳过通用直伤），删 CharLocals.liuyinSrc | 设计稿 §D、census §5.37 |
| CC-35d-B3 | review | **done** `840fa70`（76→63，target 51） | 新模块能力 `ultimateGiftSource`；好评转大三处身份查找改能力派发 | 设计稿 §D、census §5.37 |
| CC-36a | review | **done** `8af6ca2`（判据 22 63→40，target 28） | 维琳娜风蚀量去角色名（corrosionSource / cinema2CorrosionRate / 气旋计数） | `docs/mcp-cc36-velina-anomaly.md`、census §5.38 |
| CC-36b | review | **done** `1ea574e`（40→34） | 1 命乱流抗性无视 → 面板字段 `turbulenceResIgnore`；6 命风化加成 → 新模块能力 `windAnomalyBonus`；补单测 | `docs/mcp-cc36-velina-anomaly.md`、census §5.38 |
| CC-37 | review | **done** `f67c0ab`（判据 22 34→31） | 简面板字段 → 通用名 `selfAssaultCritDmgBonus` | census §5.39 |
| CC-39a | review | **done** `a87da93`（31→22，target 10） | 新模块能力 `stunRefundRatio`（雨果决算返还），convergence 去 findSlotByIdentity(1291) | census §5.39 |
| CC-38 | review | **done** `7b865bf`（判据 22 22→7，target 0，爱丽丝清零） | spark 局部量去前缀 + 模块能力 `giftedPolarAssaultCount` + 异常池输出 `coweringDot` | `docs/mcp-cc38-alice.md`、census §5.40 |
| CC-39b | review | **done** `a1eb71e`（判据 22 7→5） | 模块能力 `endsStunWindow` / `axisMoveActionTime` + 单一派发点 helpers（convergence 截断与 roundInputs 轴栈同源；删 1551016 字面量与雨果值导入） | `docs/mcp-cc39b-stun-window-end.md`、census §5.41 |
| CC-40 | review | **done** `0b6b973`（判据 22 5→0，**硬门**） | 40a `liuyinPromote.ts`→`ultimatePromote.ts`；40b moduleFeedback 键 `consumedTeamEnergy` / `teamUltimateExtra`；40c 面板 `veilStunCapMult` / `veilStunVulnBase` | census §5.42 |
| CC-39c | review | **done** `0f9f329` | 佩洛伊斯右分支决算轴集成快照（`peiluoVerdictTruncation.test.ts`，覆盖率 0.0834 对 0.2778） | census §5.43 |
| CC-41 | done | `8b2a1d2` | 蕾米埃尔 1 命花羽轮舞喧响：改走 moduleFeedback `remielleFlowerFeatherDanceCasts`（nextRoundFeedback → applyTeamConfig converge），次数 = min(队友虚曜数, ⌊T/18⌋)；删除无写入方的面板次数字段 | census §5.44 |
| CC-42 | done | `d57c0c3` | 风化浸染默认挑槽的蕾米埃尔排除（跨槽决策）→ 模块能力 `excludeFromWindInfectionPick`；anomalyPanels 不再值导入 `@/mechanics/agents/remielle`；dump/rows 对 dump-41 零差 | census §5.45 |
| CC-43a | done | `d573b4a` | 编排层/core 纯命名项去角色名 7 个（映射见 census §5.47），dump/rows 零差 | census §5.47 |
| CC-43b | done | `6a6c6d7` | 新增判据 23：角色名中缀 / core 子目录棘轮（驼峰切段），基线 13 | census §5.47 |
| CC-43c | done | `4f3d1ea` | 琉音转大次数 `computeLiuyinHugCounts` 值导入 → 模块能力 `promoteHugCounts`（编排层 `promoteHugCountsOf` 按赠大提供者槽位取）；零差，判据 23 4→0 **转硬门** | census §5.50 |
| CC-44 | done | `50f09d7` | `resolveUltimateTargetSlot` 自 mechanics/agents/liuyin.ts 迁 `src/core/resource/targetSlot.ts`（纯函数）；编排层 3 处 + norma 不再值导入 liuyin 模块；crossAgentSupply 缺省落点复用之；零差 | census §5.51 |
| CC-45 | done | `bf971b3` | 判据 24 硬门：`src/core/**` + `src/composables/**` 禁按值依赖 `@/mechanics/agents/*`（整条语句匹配，多行 import/export、裸 import、动态 import 都计；type-only 豁免）；读数 0/0 | census §5.52 |
| CC-46 | done | `d655e9c` | 补测：无 promoteVariant 声明者时 buildStackAxes 跳过转大块（CC-43e 遗留，原仅 rowsnap 兜底）；双向反向变异均红 | census §5.53 |
| CC-47 | done | `79f0f6b` | 判据 7 展示层越层 14→10：views/components 的 `getAgentMechanic`×4 → 编排层门面 `src/composables/agentMechanicView.ts`（teamMechanicSettings / agentCombos / agentResourceSections，纯转发） | census §5.54 |
| CC-48 | done | `d98cfaf` | 判据 7 10→8：StunAxisPage 的 banyue/yixuan 值导入 → 模块能力 `axisEditorBlockMarks` + 声明 `axisMoveMeta`（门面 agentAxisBlockMarks / agentAxisMoveMeta） | census §5.55 |
| CC-49 | done（**第 195 轮已删除**：零生产消费方，见 CC-169） | `b285a4f` | 判据 7 8→6：TeamConfigPage + ImpactChart 逐字相同的 buildTeammateBuffSourceContext 依赖组装 → `src/composables/teammateBuffContext.ts#teammateBuffSourceContextFromStores` | census §5.56 |
| CC-50 | done | `7cf440d` | 判据 7 6→5：StunAxisPage `allocateAxisWindows` → `src/composables/stunAxisView.ts#axisWindowCounts`（纯转发，如实标注）；页面 axisTimes 改 computed 缓存 | census §5.57 |
| CC-51 | done | `baceb72` | 判据 7 5→3：TeamConfigPage 局外面板（calcPanel + 全局 Buff applyTargetedStat）→ `src/composables/outOfCombatPanel.ts#computeOutOfCombatPanel`，与局内 computePanel 对称 | census §5.58 |
| CC-52 | done | `789a27e` | 判据 7 3→2：ImpactChart `runOptimizerForSlot0` 的入参组装 + computeOptimalSubStats/getTemplate + 夹值 → `src/composables/substatOptimizer.ts#computeSubstatAllocationForSlot`，组件只写回 store | census §5.59 |
| CC-53 | done | `eee038f` | 判据 7 2→1：ImpactChart 影响变量表（静态 + 机制设置 + 柏妮思占比）与读写口径 → `src/composables/impactVariables.ts`（buildImpactVariables / readImpactVariable / writeImpactVariable） | census §5.60 |
| CC-54 | done | `cae6624` | 判据 7 收尾：剩下的 1 处 agentSpecs（只读 JSON 注册表）拍板永久保留，RATCHET_BURNDOWN target 0→1，只改守卫配置和注释，探测器口径不变 | census §5.61 |
| CC-55 | done | `8fec4fb` | 柏妮思异放占比声明化：新增模块声明 `AgentMechanicModule.releaseShare`（burnice 声明 namespace burnice）和门面 `agentMechanicView#teamReleaseShares`；impactVariables 与 ResourceUtilizationPage 里两份写死的 1171 已消掉 | census §5.62 |
| CC-56 | done | `3978312` | 展示层写死角色 ID 普查（census §5.63 表）+ 首笔还款：ResourceUtilizationPage 两处写死 1581 改为模块声明 `teammateSplit`（新增）和 `excludeFromWindInfectionPick`（CC-42 已有），经门面 teamTeammateSplit / agentExcludedFromWindInfectionPick 查询 | census §5.63 |
| CC-57 | done | `de68f86` | StunAxisPage 招式级写死 → 模块声明：`axisHiddenMoves`（伊德海莉 1051012）+ `axisMoveSuffix`（仪玄 1371022/026「·+30%失衡」），门面 agentAxisHiddenMoves / agentAxisMoveSuffix | census §5.64 |
| CC-58 | done | `f7d1a1a` | StunAxisPage 转大块拥有者（原写死 1481×2）改走已有模块声明 `ownsPromoteVariantAxisBlocks`，与编排层 buildStackAxes 同源；门面 agentOwnsPromoteVariantAxisBlocks / teamPromoteVariantOwnerSlot | census §5.65 |
| CC-59 | done | `e2e5d37` | StunAxisPage 般岳怒相连段（原写死 1471 + banyue-combo / banyue-combo-didong 共 4 处）改走新模块声明 `axisRageCombos {primary, didong}`（展示层专用），门面 agentAxisRageCombos | census §5.66 |
| CC-61 | done | `c73f7ab` | StunAxisPage 诺姆 1571「诺姆转连携」/ 希格莉德 1591「破阵连段」专属轴块（两段写死 if）改走新模块钩子 `axisExtraBlocks({cinemaLevel, actionTimeOf})`（展示层专用），门面 agentAxisExtraBlocks | census §5.67 |
| CC-62 | done | `737b2c4` | StunAxisPage banyueSlot / yixuanSlot（findIndex 写死 1471 / 1371）改走新模块声明 `axisWindowLane: 'mingwang' \| 'ningshen'`（展示层专用），门面 teamAxisWindowLaneSlot；StunAxisPage 已无 `=== '<agentId>'` 形式的写死（剩 :264/266/268 用 some/find，CC-60） | census §5.68 |
| CC-63 | done | `51b1cb3` | 编排层 roundInputs#expandExecutedToCounts 平A兜底写死（`fillerAgentId === '1051'` / `'1041'`）→ 模块钩子 `expandBasicFill({fillSec, actionTimeOf})`（计算路径；actionTimeOf 返回 undefined = 查不到）；perf 零差 dump/rowsnap DIFF 0；agentId 棘轮 3→1 | census §5.69 |
| CC-64 | done | `ac4e8d3` | stores/config.ts `defaultBasicAttackTimeWeight` 写死（1581 / 1331 按 id 或 teammateBuffId → 0）→ 模块声明 `defaultBasicAttackTimeWeight?: number`；store 首次按值 import `@/mechanics`（getAgentMechanic） | census §5.70 |
| CC-64b | done | `5dd0d0f` | stores/config.ts deriveTeammateBuffEnabled 的蕾米埃尔额外能力档位（getRemielleAdditionalState 写死 1581 + 5 个 buff id 分支）→ 模块钩子 `teammateBuffGate({buffId, team})`，store 询问全部已注册模块 | census §5.71 |
| CC-64c | done | `a2d5b9b` | stores/config.ts 波可娜 C6 base 条互斥（写死 1351）→ 复用 teammateBuffGate（入参加 groupId / groupCinema），pulchra.ts 声明；stores/config.ts 已无角色 id 分支判定（剩 3 处数据表，见 §5.72 更正） | census §5.72 |
| CC-65 | done | `0b3633f` | TeamConfigPage 角色专属计数输入框（1551×2 / 1471 嘲讽取消 / 1541 / 1371×5 写死 v-if 块）→ 模块声明 characterCountInputs + 门面 agentCharacterCountInputs / characterCountInputValue / characterCountInputClearValue；页面一个 v-for，写入统一 setActionCount | census §5.73 |
| CC-65b | done | `edae81c` | stores/config.ts 交互默认值表（1531/1471）与通用基准排除名单（1051）→ 模块声明 interactionDefaults / noGenericInteraction；TeamConfigPage 格挡/双反输入框、弹刀轴自动提示、保底4嗔火开关 → interactionInputs / ownsGuaranteeFury / producesInteractionTopUp 槽位；TeamConfigPage.vue 与 stores/config.ts 均已无四位角色 id 字面量（源码锁） | census §5.74 |
| CC-60 | done | `9379369` | 自动失衡轴「章」档位（1051）/「有琉优先」（1481）→ 模块声明 axisPresetChapterOwner / axisPresetPreferred；data/stunAxisPresets.ts#selectAutoStunAxisPreset 改收注入提示（AutoAxisPresetHints，data 层不 import mechanics），生产入口 roundInputs 传 AUTO_AXIS_PRESET_HINTS；StunAxisPage 脚本无四位 id | census §5.75 |
| CC-66 | done | `5e93c6c` | ResourceResultCard 维琳娜腐蚀展示（:611 moveId 1561007、:748 agentId 1561 + 事件 id 子串）→ 模块声明 resultCardCorrosion + 门面 agentResultCardCorrosion | census §5.76 |
| CC-67 | done | `b942cb2` | panelPhases.ts#evalAdditionalAbilityBuffGates 凯撒 1071「有任意队友」/ 菲欧妮 1641 tier3「异常数≥3」修正 → 模块能力 adjustAdditionalAbilityGates（caesar.ts / phoenix.ts）；ADDITIONAL_GATE_BUFFS 登记表**保留**（裁定见 §5.77） | census §5.77 |
| CC-68 | done | `b3a4e70` | teamCompare.ts#completeInteractionList 般岳 1471 专属交互类型 → 模块声明 compareInteractionTypes + 门面 teamCompareInteractionTypes | census §5.77 |
| CC-69 | done | `6da5838` | roundInputs.ts 伊德海莉单次碾 1 命能耗（按 moveId 写死）→ combo 声明 energyCostAtCinema；damagePoolAnomaly.ts 风蚀气旋异放事件子串 → core/anomalyPool/helpers.ts 单一事实源 CORROSION_CYCLONE_RELEASE_ID_PREFIX / isCorrosionCycloneRelease | census §5.78 |
| CC-70 | done | —（docs） | core/** 角色专属数学盘点 → docs/mcp-core-agent-math-census.md | census §5.79 |
| CC-71 | done | `81acc14` | core/anomalyPool.ts 维琳娜两条风蚀气旋事件 → 模块能力 anomalyCorrosionEvents | census §5.79 |
| CC-72 | done | `da6f203` | core 不再补 cinema2CorrosionRate 默认值（模块兜底）+ 过时 CC-25 注释 | census §5.79 |
| CC-73 | done | `074ee50` | starlightBilly 交互默认值 → 模块常量 BILLY_INTERACTION_DEFAULTS（声明与兜底共用）；1531 spec 旧表名文字 | census §5.80 |
| CC-74 | done | `788c035` | 「11号 + 平A兜底」端到端护栏测试 basicFillE2eCc74（只加测试；关闭 §5.69 perf 盲区） | census §5.81 |
| CC-75 | done | `955ddd5` | giftedPolarAssaultCount 多提供方口径裁定 = 求和；派发收进 resourceCalc/giftedPolarAssault.ts | census §5.82 |
| CC-76 | done | `33dc2be` | teammateBuffGate 多模块表态合并 = 逻辑与（原：第一个表态者说了算，依赖注册顺序） | census §5.83 |
| CC-77 | done | `8095ea8` | 莱特来源面板冲击 ×1.2 集成覆盖测试（×1.0 vs ×1.2 + 比例扫描对公式） | census §5.84 |
| CC-78 | done | `b7168da` | 赠送极性强击注入/归属槽与 anomalyPoolSetup 解耦（firstGiftedPolarAssaultSlot） | census §5.85 |
| CC-79 | done | `03ba536` | StunAxisPage 横幅有琉/无琉 → axisPresetPreferredLabel（声明 axisPresetPreferredShort） | census §5.86 |
| CC-80 | done | `8b8564d` | mechanics/teamVeil.ts 帷幕来源写死 4 个角色 id → 模块能力 teamVeilCount | census §5.87 |
| CC-81 | done | `f338b47` | core/substatOptimizer.ts AGENT_TEMPLATES 8 个角色 → 模块声明 substatTemplate | census §5.88 |
| CC-82 | done | `75fced2` | 角色 id 全仓复查无新增；helpers.ts 加农转子 `'14001'` 写死判定 → src/data/wEnginePeriodicDirect.ts 查表 | census §5.89 |
| CC-83 | done | `037a66f` | 拆 src/mechanics/types.ts 1927→1309 行：卫星类型移到 typesRows.ts / typesHooks.ts，由 types.ts 转出 | census §5.90 |
| CC-84 | 触发式（低） | — | 出现第二件周期直伤音擎时，把 cfg 的 cannonRotor* 字段和 rowBuild 事件泛化为数组 | census §5.89 |
| CC-85 | done | `a96ae36` | 拆 scripts/check-guards.mjs 1633→1244 行：RATCHET_BURNDOWN / DEBT_REGISTRY / CALIBER_TRIGGER_ALLOWLIST 移到 scripts/lib/guard-registries.mjs | census §5.91 |
| CC-86 | done | `4b685c7` | 拆 src/composables/teamTimeline.ts 1515→1117 行：共享工具移到 teamTimelineStore.ts，Chart 4 菲林模拟移到 teamTimelineFilm.ts | census §5.92 |
| CC-87a | done | `023bab6` | drift 机械筛查：锚点符号源码与「据」日期当天一致的 62 条打 `·锚未变@`；zc 只改 `@fact` 行不算锚改动；待复核 80→18 | census §5.93 |
| CC-87b | done | `7481adf` | 剩余 18 条 drift 人工复核：15 条打复核戳、1581 特殊虚耀 2 条改锚到 remielle.ts#extraAnomalyRows、资源账本/截断改写为「不增即接受」；待复核 18→0 | census §5.94 |
| CC-88 | done | `11706a1` | 状态表 7 条 partially_implemented 机制对照代码核实：5 条 → implemented（pending 已过时）、2 条 → implemented_approximation；机制部分实现 7→0 | census §5.95 |
| CC-89 | done | `d6ef3af` | 机制维度 38 条 pending 核实（dsh 只读并行 + lead 抽查统一写入）：8 条更正（1041 潜能 → implemented 等），其余是有意近似 | census §5.96 |
| CC-90 | done | `e1ef565` | 命座维度 109 条 pending 核实（8 批 dsh 只读并行、sched90.sh 自动补位，lead 抽查全部 STALE）：11 条更正（1031 影画1 → implemented；1271 影画2 反向失真；1331 影画6 暴露死通道） | census §5.97 |
| CC-91 | done | `61fce8b` `5476250` | 薇薇安死通道：支援突击接 cfg.parryCount（原文 +2 飞羽→悬落），舞步命中显式 0 注明未建模；判据 25 无类型记录键死读（补 dead-channels 盲区，存量 0） | census §5.98 |
| CC-92 | done | `50e313e` | TeamComparePage.vue 1552→1462：「选第三人」区块纯搬运到 composables/teamCompareSweep.ts（同名注入、逐行 diff 保真）；zc.test 结构熵用例改夹具自证 | census §5.99 |
| CC-93 | done | `2299223` | target 债务销号：核实运行时 team/enemy 等效，保留字段，validate:specs 加「enemy* 字段 ⇒ target enemy/both」校验，DEBT 7→6 | census §5.100 |
| CC-94 | done | `0a7e2a8` | LS 死通道基线 12→1：删 11 个零读零写声明（roxy/claret/norma 配置槽 + catalog 两字段），freePoolPerSpecialty 裁决保留为调参旋钮 | census §5.101 |
| CC-95 | done | `cb169a3` | 判据 14 豁免 8→1：删 6 个死字段（归档 DTO 3、minGain、minWeight、damage isRupture），blockSeconds 形参假阳性修扫描器；棘轮 7→1 | census §5.102 |
| CC-96 | done | `4191bd0` | §38 复算对账：①数字更新 ③drift 销号，新增 ⑦ catalog 效果 basis 引擎零读取、4 条驱动盘 baseAtk 错标统一（零数值变化）；触发器顺延 2026-12-31 | census §5.103 |
| CC-97 | done | `d479d46` | 方向 B「测量清单 v1」：13 个引擎级校准原子（比值法、引擎口径出处、预测值、录入格式），A1 = 局内攻击力%基底 | `docs/mcp-calibration-atoms.md` · census §5.104 |
| CC-98 | done | `1279c24` | 方向 C 第 1 刀：62 个机制模块数据化盘点。能力层几乎同构，改按「spec 生成不了的过程类能力数」分 A2 / B30 / C29，归纳 4 种 spec 原语缺口 G1–G4，挑出 5 个候选 | `docs/mcp-mechanic-dataization-census.md` · census §5.105 |
| R4-A1 | 🛑 **撤销**（用户 `3737419`）：设计稿保留为调研记录，代码已按 R7 删除（`8a0159c`），不再推进 | 第 0 步 `e8aebae` · 第 1 步 `0c0289c` | 用户需求 R4：方向 A 第 1 刀，影子内核 `src/core/timeline/`，只做喧响和失衡两条轨；零差；逐项差异表加归因；≥3 支轴模式队伍；先做性能原型；**切换现引擎属于不可逆点，须用户裁决** | `docs/mcp-timeline-shadow-kernel.md`（§8 为进度账本）· census §5.106 |
| CC-99 | **不做（第 148 轮评估）** | — | 方向 C 第 2 刀（G1 / G3 + 潘引壶迁移）。评估：命座透传 61 处 / 56 键实测没有真 bug；统一只能降计数，G1 还会波及纯 spec 路径，R6 禁止只为降计数改动。重开条件：新角色能靠 G1 / G3 做到纯 spec 时。详见 census 文档 §6 顶部 | census 文档 §6 |
| CC-100 | ✅ done（第 126 轮） | 见 git log「fix(CC-100)」 | R5 D15 + D16：驱动盘 6 号位 `impact` / `anomalyMastery` 主词条与 31200 2 件套改按源数据的百分比口径结算；`inferStatMode` 不再从展示字段 `display` 推断口径。预计非零差，差异必须全部可归因。开工步骤见 R5 账本 §9 | `docs/mcp-r5-spec-impl-reconciliation.md` §7 D15–D16、§9 |
| CC-101 | ✅ done（第 127 轮） | 见 git log「fix(CC-101)」 | R5 D8：同 `exclusiveGroup` 的全队效果只计一次（原始朋克 4 件套多人穿戴重复叠加）。先写夹具复现再去重，预计零差 | 同上 §7 D8、§9 |
| CC-102 | ✅ done（第 128 轮） | 见 git log「fix(CC-102)」 | R5 D19：音擎 effect 级 `requirement` 生效（14150 壳中之灵三条以太限定效果修前对所有装备者生效）。`core/wengineConditions.ts#wEngineEffectRequirementMet`，测试 `wengineEffectRequirement.test.ts` 先红后绿，zd DIFF 0。 |
| CC-103 | ✅ done（第 129 轮） | 见 git log「fix(CC-103)」 | R5 D18：14155 日冕遗蜕 `enemyEtherResReduction` 16 只给佩洛伊斯（1551）。新增 `EffectRequirement.wearerAgentIds`（数据声明、引擎通用判定），catalog 14155 补标；测试 `wengineWearerAgent.test.ts` 先红后绿，zd DIFF 0。 |
| CC-104 | ✅ done（第 130 轮） | 见 git log「fix(CC-104)」 | R5 D20：`coverage.default` 全为 1 的数据前提钉（`coverageDefaultInvariant.test.ts`，失败时指向三处「无记录当 100%」/「fixed 不乘」的代码）；`WEngineFieldPage.vue` 覆盖率按百分比展示。无数值变化。 |
| CC-105 | ✅ done（第 131 轮） | 见 git log「fix(CC-105)」 | R5 D21：skillTag `assistAttack` 归一到招式族 `assist`（31800 混沌爵士 4pc 支援技 +20% 修前漏算）。`core/buff.ts#SKILL_TAG_TARGET`，测试 `skillTargetsCoverage.test.ts`；zd 5 个预设（全部含 31800 装备者 1171 / 1221）伤害上升，timeGolden 5 条 dmg 更新，delta 表见 R5 账本 §9。 |
| CC-106 | ✅ done（第 132 轮） | 见 git log「test(CC-106)」 | R5 D22：`buffModifiersIntegrity.test.ts` 钉住「catalog buffModifiers 全空」与「teammate-buffs 修饰器 operation / 引用 / 目标类型有效」，防静默失效。无数值变化。 |
| CC-107 | ✅ done（第 133 轮） | 见 git log「test(CC-107)」 | R5 D24 / D25：`effectValueInvariant.test.ts` 钉住效果数值字段形态；`remielleSourcePhase.test.ts` 钉住 1581 异化度 / 耀变倍率按**局外**异常精通取值（口径未定，靠 buff 顺序隐式成立，见账本 D25）。无数值变化。 |
| CC-108 | ✅ done（第 134 轮） | 见 git log「fix(CC-108)」 | R5 D26：驱动盘 4 件套 `outOfCombatStat` 门槛（荆棘玫瑰防御 1000/1800、折枝剑歌掌控 115）由漏音擎 / 局外 buff 的 `roughStats` 粗算改为 `calcPanel` 两段式读精确局外面板。claret 两预设 +0.81% / +2.72%，golden 已重生成。 |
| CC-109 | ✅ done（第 135 轮） | 见 git log「fix(CC-109)」 | R5 D28：洛克茜（1621）强特耗能由 10（只算启动）改为 10 + 30/s × 自旋秒（catalog 1621007 两项），修掉「强特次数按 能量/10 推、风能账本按 85/发 记耗能」的双账。含洛克茜的 5 个预设伤害 −54%～−69%，agent:1621 −82%～−85%，golden 已重生成、逐条表见账本 CC-109。 |
| CC-110 | ✅ done（第 136 轮） | 见 git log「fix(CC-110)」 | R5 D31：音擎团队效果在装备者特化不符时不再向队友传播（`core/inCombatBuffs.ts`，与自身通路 `matchSpecialty` 同口径，依据数据 `effect.requirement.specialty`）。zd DIFF 0，新测试 `wengineTeamSpecialty.test.ts` 已做反向验证。 |
| CC-111 | ✅ done（第 137 轮） | 见 git log「feat(CC-111)」 | R5 第 4 刀零差收尾：D3 覆盖率滑块按 stackGroup 联动（`utils/stackGroupCoverage.ts`）；D7 带 durationSeconds 的效果给滑块（音擎 26 + 驱动盘 31600）；D14 蕾米埃尔耀变数据↔模块一致性单测；D2 / D4 数据前提钉。zd DIFF 0。 |
| CC-112 | ✅ done（第 139 轮） | 6db533b | R6 C1：12 个 core 文件改 import `@/mechanics/registry`，去掉 core → mechanics/index → agents → core 的 ESM 环；注册由 `main.ts` 与 vitest `setupFiles` 负责；守卫测试 `coreMechanicsRegistryOnly.test.ts`（含反向验证）；zd `r6c1` DIFF 0。清单见 `docs/mcp-r6-refactor-list.md` |
| CC-113 | ✅ done（第 140 轮） | bc8a018 | R6 C7 第一刀：spec `AttributeConversionSpec.stepRounding`（缺省 floor / none 连续）；1481 琉音暴击转冲击常数只留在 spec，模块经 `applySpecAttributeConversions` 执行；非整数点 verification 含反向验证；zd `c7a` DIFF 0。1571 不做（清单 §2.2）。同提交 C6 / C2 规划条款 |
| CC-114 | ✅ done（第 141 轮） | 56283c6 | R6 C5：删 `DirectDamageInput.damageBasis` 死参数（3 处调用 + 8 处测试传参），catalog 行字段保留并注明「引擎不读」；C3：`appliesToOutOfCombatPanel ≡ scope===outOfCombat` 数据前提测试（夹具自证）。zd `c5` DIFF 0 |
| CC-115 | ✅ done（第 142 轮） | 7223609 | R6 C7 §2.3：1511 南宫羽掌控转冲击迁入 spec（面板 + 展示值都经 runtime）；删 alice 零读取的第二份掌控转精通常数；burnice / phoenix / lighter 不做，promia / jane 待 runtime opt-in 扩展（清单 §2.5）。zd `c7b` `c7c` DIFF 0 |
| CC-116 | ✅ done（第 143 轮） | 24dea16 | R6 C7 §2.5-①：spec runtime 可选 `sources.outOfCombat`，按 `sourcePanelPhase` 取源（opt-in，无调用方传时零差）+ 单测 4 例；1541 普罗米娅掌控转精通迁入 spec（面板真读局外面板、展示值探针、导出常量从 spec 读）。zd `c7d` DIFF 0；登记 0.35% 全队异放增伤未接入 |
| CC-117 | ✅ done（第 144 轮） | 83accb2 | R6 C7 §2.5-②：spec runtime 先封顶再乘覆盖率（全仓覆盖率恒为 1 ⇒ 零差）+ 单测 3 例；1261 简狂热精通转攻迁入 spec（面板 coverage=frenzyFactor、展示值探针、文案从 spec 拼）。zd `c7e` DIFF 0；attributeConversions 归一收尾 |
| CC-118 | ✅ done（第 145 轮） | 02119ce | 卢西娅 6 命 `lucia_c6_hp_to_atk` 改读局外生命（spec 声明 outOfCombat；原文「初始最大生命值」）：`luciaElowen.ts` 传 `sources.outOfCombat`。**改数值**：组队全队总伤害 -0.04% ~ -0.26%（25 个含 1451 的预设，均为 6 命；0 命不变），timeGolden `agent:1451:c6.dmg` 1175132 → 1169281（-0.498%）。zd DIFF 0 是盲区（`/c6` 只作用于 0 号位），用自写探针对比。见清单 §2.8 |
| CC-119 | ✅ done（第 146 轮） | d2b270c | **原登记有误，零差**：普罗米娅 0.35%/点全队异放增伤早已由 spec 1541 teamBuff `promia_ice_team_release_dmg`（formula，读局外掌控）生效，实测队友 anomalyReleaseDmgBonus 34.524 = (248.64−150)×0.35。本卡删除模块常数，展示值改为执行 spec effect，过时的「未接」文案全部更正。zd 伤害逐位相同，差异仅来自 note 文案（改回后 DIFF 0 已证）。见清单 §2.9 |
| CC-120 | ✅ done（第 147 轮） | af31a5e | 全景 §6.4 评估：10 份 spec resources + 3 份 events 经变异法证明不参与计算（zd DIFF 0 + 1091 阳性对照 + 预设外 4 角色定向探针）；120 条数值对照，只有 1581 耀变系数 0.1→0.2 是真错（展示用，零差），加单测钉住；决定不迁移。见 `docs/mcp-spec-resources-audit.md` |
| CC-121 | ✅ done（第 148 轮） | a3d3205 | **改数值**：普罗米娅有罪推定（额外能力 40%）与影画1（20%）原文均为「**全队角色**对[有罪推定]敌人造成[异放]时无视防御」，但 `releaseModifier` 按异放行 agentId 派发，只有她自己的异放吃到。新增模块声明 `releaseModifierScope: 'self' | 'team'`（缺省 self），damagePool 汇总本角色模块和在场 team 模块的修正（相加），编排层不加角色分支；promia 声明 team。含 1541 的预设全队总伤害 +0.54% ~ +4.74%；timeGolden 3 条（auto-1541-1511-1411 +0.535%、auto-1541-1561-1411 +4.097%、auto-1541-1331-1581 +2.700%，时间账零变化）。其余 3 个 releaseModifier 模块（phoenix C6、vivian C2、velina）原文主语都是本人，self 正确 |
| CC-122 | ✅ done（第 149 轮） | 66fcd79 | 零差订正（zd DIFF 0）：① 1471 般岳 `banyue_fury_from_block` 按 catalog 原文与模块改为 `blockCount × 6`（金身弹刀 = 完美格挡；普通弹刀走 parryCount × 4），审计 §3 未决项已结；② 「全队」原文扫描 A / B 两类（审计 §5）：1541 C1 note、1641 phoenix 影画1 过时注释订正；1611 克拉蕾残锋因锋御仅 1 人而等价，加绊线测试 |
| CC-123 | ✅ done（第 150 轮） | 4ae3d49 | 「初始」属性转化改读局外面板（与 CC-118 同口径；原文为准，R5）：① 1511 南宫羽 `nangong_mastery_to_impact`（「每超过1点初始异常掌控」）与 1481 琉音 `liuyin_crit_to_impact`（「初始暴击率超过50%」）spec `sourcePanelPhase` 由 inCombat 订正为 outOfCombat，`nangong.ts` / `liuyin.ts` 的 applyPanel 传 `sources.outOfCombat`；② 展示值同口径：`AgentCharConfigInput` 新增可选 `outOfCombatPanel`（`helpers.ts buildCharConfig` 用同一次 computePanelPhases 取局内 + 局外），南宫羽资源卡「掌控转冲击」读 `nangongInitialMastery`，普罗米娅 `promiaAnomalyMastery` 改读局外（订正 CC-116 遗留的展示 / 计算口径分叉）。**zd cc123 DIFF 0**：harness 预设不开局内 buff，局内 = 局外（探针：1481 暴击 99.4/99.4、1511 掌控 211.68/211.68），只有用户开启局内暴击 / 掌控 buff 时才出差异；阳性对照 `src/mechanics/__tests__/initialConversionCc123.test.ts`（局内 150 / 局外 130 → +20；局内 90% / 局外 60% → +20），反向验证 spec 改回 inCombat 则 2 条变红。回退点：两份 spec 改回 inCombat（模块传 sources 无害）。 |
| CC-124 | ✅ done（第 151 轮） | 862fc15 | 千夏 1491 影画6「根据自身**初始**攻击力的0.03%提升暴伤」原实现读局内 `panel.atk`，改读 `outOfCombatPanel.atk`（缺省回落局内）。预设探针：局内 5564 / 局外 3243.6（旧封顶 105 → 新 97.31）；zd DIFF 0（千夏在预设里都不在 0 号位，`/c6` 盲区）；**timeGolden 仅 `agent:1491:c6.dmg` 2651847 → 2384214（−10.09%）**：裸装单人局内 1756.88 / 局外 1066.8，暴伤 102.71 → 82.00，6 命必暴下倍率比 1.8200/2.0271 = 0.8979，差额来自不吃暴击的部分。单测 `qianxia.test.ts`「CC-124」（反向验证：旧实现失败）。回退点：`applyQianxiaPanel` 改回 `panel.atk` 并还原 baseline 该值。 |
| CC-125 | ✅ done（第 152 轮） | bf6d184 | 爱芮 1501 异放比例「每10点**初始**异常掌控」与影画1 异放暴击「若**初始**异常掌控大于100点」原读局内（damagePool `triggerPanel[rr.basis]` / `settlementPanel.anomalyMastery`）。做法：`execution.ts` 给 `releaseRatio` 加可选 `basisValue`、`releaseCrit` 加可选 `masteryValue`（缺省读局内 ⇒ 薇薇安等不变）；`aire.ts` buildCharConfig 记 `aireInitialMastery = (outOfCombatPanel ?? panel).anomalyMastery`，事件填入两字段；damagePool 两处 `??` 回落。编排层无角色分支。**预设伤害零差**：zd 仅含 1501 的 4 个预设 resourceResult 哈希变（新键进哈希），总伤害 / 失衡池哈希全等；timeGolden 零差（单人局内 = 局外）。阳性对照：变异「初始掌控 +100」→ 异放倍率 294.14 → 488.93，C1/C0 比 1.14 → 1.27（masteryValue 生效），已恢复。新单测 aire.test「CC-125」。回退点：aire.ts 不填两字段即回到局内（类型字段可留）。 |
| CC-126 | ✅ done（第 152 轮） | 941f597 | 柚叶 1411 资源卡「40%初始攻击力」展示改读 `cfg.yuzuhaInitialAtk`（buildCharConfig 从 `outOfCombatPanel` 写；`config.ts` 加类型）。`initialAtk` 只用于展示值 teamAtkBonus，伤害零差（zd 伤害 0）。单测 yuzuha.test「CC-126」。 |
| CC-127 | ✅ done（第 153 轮） | 见 git log「fix(1621): CC-127」 | **真 bug**：洛克茜 1621 核心被动「初始能量自动回复>1.2 时每超过 0.01 攻击+5（上限960）、冲击+0.4（上限76.8）」，`roxy.ts` applyPanel 读 `panel.energyRegen`——该字段是**基础**回能（`src/types/catalog.ts` PanelValues 注释，恒 1.2），转模在任何配装下都不触发，且无单测覆盖。改读 `panel.energyRegenOutOfCombat`（panelPhases.ts 在 applyPanel 前写入：基础 × 局外加成 + 固定），缺省回落。**数值**：5 个洛克茜预设局外回能都是 3.12 → 攻击 +960 / 冲击 +76.8（双封顶）。zd 全队总伤 +5.69%（billy，只有洛克茜本人 ×1.30）~ +14.91%（claret）；洛克茜本人 ×1.30 ≈ 攻击比 4079/3119，队友增益来自冲击→失衡。timeGolden 19 个叶子全在这 5 个预设：失衡次数各 +1、时间分配随失衡窗口重排、dmg +6.9%~+14.3%，已重生成；`timeFillRatchet.baseline.json` 3 条（claret / billy / banyue-roxy）stun 2→3，`TIME_RATCHET_UPDATE=1` 重生成。全仓复查 `.energyRegen` 读取：其余都是有意的基础值用法（resourceIncome 基础×加成、StatPanel 标「基础自动回复」、1561 spec 走 sourceValue=energyRegenOutOfCombat），洛克茜是唯一误读。单测 `initialRegenCritCc127.test.ts`（反向验证：旧实现 3 条全红）。回退点：roxy.ts 改回 `panel.energyRegen` 并还原 baseline。 |
| CC-128 | ✅ done（第 153 轮） | 同 CC-127 提交 | 诺姆 1571 核心被动「初始暴击率超过50%」（暴伤 / 定向失衡）原读局内 `panel.critRate`，改读 `outOfCombatPanel.critRate`（缺省回落局内）。预设内零差（诺姆预设局内 = 局外暴击，探针 99.4/99.4）。单测同文件。 |
| CC-129 | ✅ done（第 154 轮） | `850246fc` | 席德 1461「将**初始攻击力**最高的[强攻]队友视为[正兵]」：原按 `agent.level60.atkBase`（裸基础攻击）选，改读队友**局外攻击** `cfg.outOfCombatPanel.atk`。接线：`CharacterOperationConfig` 新增可选只读 `outOfCombatPanel`（`src/types/resource/config.ts`），编排层 `buildCharConfig`（`src/composables/resourceCalc/helpers.ts`）通用挂载 `panelPhases.outOfCombat`（与 AgentPanelInput.outOfCombatPanel 同一次 computePanelPhases，无角色分支）；缺失时（测试手搓 cfg）回退 atkBase。zd `cc129` DUMP/ROWS DIFF 0（预设里没有选人翻转的队）。单测 `src/mechanics/__tests__/vanguardInitialAtkCc129.test.ts` 3 条（反向验证：旧实现 2 条红，「非强攻排除」新旧都绿）。回退点：xide.ts 两行改回 atkBase；cfg 字段可留（只读、无消费者时无害）。 |
| CC-130 | ✅ done（第 155 轮） | `0ed6ffc5` | 席德 1461「[正兵]获得[明攻]（攻击 +1000 / 暴伤 +30%）；席德与[正兵]获得[围杀]（增伤 +25%，影画2 无视防御 20%）」。teammate-buffs 1461 组静态数据原按**全队**生效（探针实测：非正兵队友吃全部四项，席德本人也吃明攻）。修法：新增通用模块能力 `teammateBuffRecipientFilter`（`src/mechanics/types.ts`，按接收槽返回要剔除的**本人 inCombat buff 效果 id**），编排层 `panelPhases.ts#applyTeammateBuffRecipientFilters` 在额外能力门控之后应用（零角色分支；局外面板探针带重入保护，因只动 inCombat 效果、局外面板不受影响，无循环依赖）；`xide.ts` 抽出 `pickXideVanguardSlot`（build 阶段正兵回能与面板阶段 buff 共用，单候选不探针）。zd `cc130`：18 条差异全在 3 个席德预设（正兵都是唯一强攻队友希希芙，选人不变）：auto-1461-1521-1361 −17.0%（c6 −19.9%），auto-1461-1521-1031 −13.9%（c6 −18.1%），auto-1521-1461-1311 −10.9%（c6 −8.1%）；来源 = 席德本人去掉明攻 + 第三人（扳机 / 妮可 / 耀嘉音）去掉全部四项；失衡零变化，dump 耗时 +0.24%。timeGolden 3 叶 dmg（−10.4%~−17.1%）已解释重生成；timeFillRatchet 不变。teammate-buffs.json 1461 两条说明文字同步（去掉「按全队近似」）。单测 `src/mechanics/__tests__/vanguardBuffRecipientCc130.test.ts` 3 条（反向验证：旧 xide.ts 3 条全红）。回退点：删 xide 模块的 `teammateBuffRecipientFilter` 一行即恢复全队近似（编排层函数无消费者时是恒等）。已知未覆盖：副词条优化器（`src/stores/config.ts` 约 819-861 行、`src/core/substatOptimizer.ts`）仍用未过滤的 enabledTeammateBuffs，只影响优化建议、不影响伤害计算。 |
| CC-131 | ✅ done（第 156 轮） | `4d657d75` | 克拉蕾 1611：删除 teammate-buffs 1611 组的过时 buff `claret.gleaming_edge_teammate`（「核心被动·锋芒毕露」：切换至击破 / 锋御队友时复制 穿透率 +20% / 造成失衡值 +10%）。依据：v12 原文 `data/raw/nanoka_missing/full/1611.json`、catalog 1611 技能文本、相关音擎 14145 / 14161 都没有此效果（无「锋芒毕露」「切换至」「穿透率提升」）；来源是 v12 重录前的测试服草稿 `data/raw/_archive/scratch/claret_teammate_buff.json`（2026-08-18 初始提交即存在，与 spec 注记里「v12 重录只刷新 desc 文本、机制没跟着重排」同一批残留）。且因来源本人会吃自己那组（见清单 §2.16），克拉蕾本人也一直在吃。zd `cc131`：12 条差异全在 2 个克拉蕾预设：claret-roxy-rina −15.6%，claret-koleda-rina −15.3%，失衡池变化（三人都少 10% 失衡值）。timeGolden 9 条（2 预设 dmg、agent:1611 c0-c6 dmg −10.9%~−22.1%，c5/c6 失衡 2→1）+ timeFillRatchet 2 条（stun 3→2、4→3）已解释重生成。1611 组保留为空组。单测 `src/mechanics/__tests__/claretStaleBuffCc131.test.ts`（含「依据仍成立」断言：原文若将来出现这两个词会变红，提示重新评估）。回退点：`git show 4d657d75~1:public/static/teammate-buffs.json` 取回该条，或用存档草稿；同时还原两份基线。 |
| CC-132 | ✅ done（第 157 轮） | `df8523f9` | 柚叶 1411「狸之愿」增伤：teammate-buffs 效果 `effect_68de5894c8`（dmgBonus）数据为 15.04，原文「使拥有者造成的伤害提升15%」⇒ 订正为 15（2026-08-18 初始提交即存在的录入笔误）。zd `cc132`：114 条差异全在 19 个含柚叶的预设，−0.013% ~ −0.019%，失衡零变化；timeGolden 24 叶 dmg（−0.014% ~ −0.031%）已重生成。同提交新增常驻测试 `src/mechanics/__tests__/teammateBuffRawNumbers.test.ts`（队友 buff 数值必须能在角色原文找到，见清单 §2.17）。回退点：该效果 value 改回 15.04 并还原 timeGolden 基线。 |
| CC-133 | ✅ done（第 157 轮，零差） | `366212b7` | 潘引壶 1421「通窍」给「通过快速支援或连携技入场的下一位代理人」，潘引壶本人是触发支援的一方、不会是入场者 ⇒ buff `pan_yinhu.core_open_meridians_sheer_force` 加 `excludeTargetAgentIds: ["1421"]`（1421 无 teammateBuffId 别名）。zd：与 CC-132 后状态逐位零差（dump / rowsnap 均 0）——潘引壶是防护、伤害不走贯穿力。回退点：删该字段。 |
| CC-134 | ✅ done（第 158 轮） | `ece87d0c` | 「每超过 N」取整口径统一为 floor 整步（清单 §2.18）。第一批：spec 里仅有的 4 条 `stepRounding: "none"`（1261 简 精通→攻击、1481 琉音 暴击→冲击、1511 南宫羽 掌控→冲击、1541 普罗米娅 掌控→精通）删去该字段，回到缺省 floor；4 条 verifications 期望值按 floor 重算（121→120、47.2→46、40.5→40、75.75→75）。zd `cc134`：DUMP 210 / ROWS 212 条差异，全部属于含这 4 人的预设（琉音 120、南宫羽 66、普罗米娅 12、南宫羽+普罗米娅 6，另 6 条为具名预设 banyue-liuyin-lucia）；1261 零差（预设里简的精通都是整数）。普罗米娅 −0.03%~−0.08%，南宫羽 −2.06%~+0.01%；琉音预设多数总伤不变、只改失衡池，个别因外层不动点敏感而上升（最大 `auto-1201-1481-1211/c6` +5.34%，归因见 §2.18「已知坑」）。timeGolden 11 叶 / 5 预设已逐条解释并重生成，timeFillRatchet 不变。同提交改写 `seedInvariance.test.ts` 的活性自检：旧 `ledgerExercised > 0` 实为浮点噪声撑绿，改为「种子改变内层迭代轮数」，已做反向验证（详见 §2.18 末段）。回退点：对应 spec 恢复 `"stepRounding": "none"` 与原期望值，并还原 timeGolden。 |
| CC-135 | ✅ done（第 159 轮） | `0028eb01` | 「每超过 N」floor 第二批（清单 §2.18）：青衣 `qingyi.ts` 冲击→攻击、扳机 `trigger.ts` 暴击→追加攻击失衡、柚叶 teammate-buffs 公式（3 个效果）`clamp(floor(max(0, x - 100) + 1e-9) * 0.2, 0, 20)`、爱芮影画1 异放暴击 `damagePool.ts`、克拉蕾初始暴伤→暴击 `claret.ts`、洛克茜回能转模 `roxy.ts`（攻击去掉 `Math.round`，与冲击共用 `regenSteps`）。全部加 `+1e-9` 防浮点少算一步。zd `cc135`：DUMP 102 / ROWS 108 条，全部属于含扳机或柚叶的预设（柚叶 72：−0.068%~+0.001%；柚叶+爱芮 12：−0.010%~0；扳机+柚叶 12：≈0；扳机 6：−1.74%~0）。青衣 / 克拉蕾 / 洛克茜零差，已用探针确认原因：青衣冲击 233.7 → 攻击加成已超 600 上限；克拉蕾局外暴伤正好是整数 50；洛克茜回能超出 1.92，攻击和冲击都已封顶。爱芮只有掌控 208.38 的预设有变化（253.68 时异放暴击率超过 100%，封顶）。扳机 −1.74%（`auto-1201-1361-1211/c0`）是外层不动点敏感：失衡累积 +0.02%，规划失衡 2.98 → 2.34，外层轮数 7 → 5（§2.18 已知坑第二例）。timeGolden 2 叶（柚叶预设 −0.055% / −0.024%，时间账零变化）已重生成。回退点：6 处各自改回连续写法（`git show 0028eb01~1:<路径>`），并还原 timeGolden。 |
| CC-136 | ✅ done（第 160 轮） | `3adb3620` | 外层环内选点与检出相位无关：`pickOuterCycleMember` 改为以池内最优为基准的逐级筛选（全序，取代不传递的带容差两两比较），并在「同级取最后一轮」之前加 ③′「`stunIn` 小者」。根因：2-环两成员 ① 恒等、② 常同级，旧 ③ 由奇偶性决定；琉音 c6 扫描 41 点中 3 个孤立点 +5.34%，新规则 41 点全平。zd 19 条（全 stunPool；yidhari +10.16% = 回到 outer-feedback-regression 的修复值 1.5364）；timeGolden 4 预设、timeFillRatchet 1 条（1431-1341-1031 留白 +1.2s，2s 同级容差内），逐条见 `docs/mcp-outer-fixedpoint-continuity.md` §4。回退点：`git show 0028eb01:src/composables/resourceCalc/outerCycle.ts`，并还原两份时间基线与 yixuan 语料期望。 |
| CC-137 | ✅ done（第 161 轮） | `30daa4b1` | 外层连续性护栏 + 第二种不连续结案：逐轮 trace 证实连续版扳机 w 1.05→1.055 的 −2.9% 是物理失衡次数 floor(N*) 4→3 的整数台阶（同次数最大跳变 0.047%），不是选点伪影，不修。新增 `outerContinuity.test.ts`（琉音 c6 21 点，同次数相邻跳变 ≤1%；反向验证：换回 0028eb01 版 outerCycle.ts 后红）。零数值变化。回退点：删测试文件。 |
| CC-138 | 📏 调研（第 162 轮，无代码） | — | 失衡双源测量（`docs/mcp-stun-dual-source.md`）：外层 `next = N*` 原型（去第二次折算）不落地（cycle 4→4，总伤中位数 0，与 N* 仍差约 2）；规划失衡 78/104 队由必要时间约束决定（17 队 = 0），合轴抵扣假设否定（0/78）。下一步：拆窗口内必要时间（连携 / 终结技）后再定是否改约束。 |
| CC-139 | 📏 调研（第 163 轮，无代码） | — | 失衡双源续（`docs/mcp-stun-dual-source.md` §4）：窗口内连携 / 终结技只解释 80 队缺口的一小部分（2.50→1.35）；真因 = 外层「非失衡时间 ≥ Σnecessary」与池「窗口内照打、只是不攒条」互斥。后果：21/104 队有物理失衡却没有失衡连携（`countStunOf` 读规划值），规划/物理中位数 0.51。下一张 = CC-140 P1：计数通道改读物理次数（原型 + 逐队解释）。 |
| CC-140 | ✅ done（第 164 轮，缺省 off） | `f65c07ae` | `stunPlanProjection` 新增 `physical`（编码 4）：计数通道读上一外层轮池物理次数（`threads.prevPoolStunCount`）。缺省 off，zd DIFF 0。打开后（104 队）：有失衡没连携 21→6，cycle 4→2，超预算 5→13 队（合计 1.2→15.9s），总伤均值 +2.36%。未切默认，理由和修订后的验收见 `docs/mcp-stun-dual-source.md` §5.3。回退：revert。 |
| CC-141 | ✅ done（第 165 轮，缺省 off 零差） | `d395ba79` | physical 超预算归属：主因不是 S3，而是 CC-140 漏改的计数通道——琉音赠大 / 诺姆赠链的账本预留、折叠环、欠打探针、截断上限、赠行规格、种子仍读计划值，装配按物理次数给赠大 ⇒ 多一行终结技（+2.37s，S3 八档无杠杆）。新增 `stunCountForCountChannel` 统一入口。physical 超预算 13 队 / 15.86s → 3 / 0.49s。详见 `docs/mcp-stun-dual-source.md` §6。 |
| CC-143 | ✅ done（第 166 轮） | `98693cac` | physical 1431+1481 两队截断：主体是真实的「资源允许的动作 > 时间」（折叠环停滞收敛、合法截断）；真缺陷是 S3 全档不可行时保基线（满交互 + 最大截断）。新增降配第三层「缓解档」（三臂不劣 + 截断少 >1s + 外层 stable，取截断最小）。physical 截断 177.0→40.6s；默认预设零差，zd 变体 DIFF 6 全部归因（叶瞬光 6 命 / 交互 +25）。详见 `docs/mcp-stun-dual-source.md` §7。 |
| CC-142 | ✅ done（第 167 轮，off 零差） | `44bc4c67` | 残余 6 队全是轴模式：4 支希希芙队用的「希希芙循环」轴（`希单c.json`）本身没写连携块，是轴数据口径，不是缺陷（测试钉住）；2 队是 physical 漏切的计数通道——轴内块次数的分窗仍读计划值。`convergence.ts` 四处计数用途改读 `countStun`。physical「有失衡没连携」6→4。详见 `docs/mcp-stun-dual-source.md` §8。 |
| CC-144 | ✅ done（第 172 轮，切 physical 默认） | `71452ad2` | 缺省投影编码 0→4。试切 30 红全部归类：A 类不变量已空；C 类基线重生成；D 类 18 个文件用文件级 vi.mock 钉回 off（CC-148 迁移）。全库 104 队归因 U 76 / X 19 / Z 9，见 `docs/mcp-cc144-team-deltas.md`；难度阶梯 G4 随缺省施加 physical。详见 `docs/mcp-stun-dual-source.md` §13。 |
| CC-145 | ✅ done（第 169 轮，off 零差） | `6d2984ce` | physical 下叶瞬光队账本预留 5s ≠ 赠行 4s：引擎按截断前的连携数（3）预留，编排层按装配后的连携行（2）算 60 转大 ⇒ promote=4 才是真实值（好评 363 不够第 5 次）。`applyUltimatePromote` 把多留的预留退回目标平 A 行（没有聚合平 A 行时留空闲），输出预留 = 实际用量。新测试 `ultimateGiftRefund.test.ts`。详见 `docs/mcp-stun-dual-source.md` §10。 |
| CC-146 | ✅ done（第 171 轮，off 全库零差） | `f848f72c` | 根因是折叠环规则 ③「clean ⇒ 唯一不动点」不成立：校准种子 pass0 clean 收敛到冷种子到不了的不动点 b=5.79（冷种子入 2-环）。修法 ②′：pass0 注入种子一律弃用、从默认种子起跑。seedInvariance 活性自检反转为 `=== 0`。先试的估时插值 A′ 因外层 cycle 翻倍、次数掉档（−6.7%）否决。详见 `docs/mcp-stun-dual-source.md` §12。 |
| CC-147 | ✅ done 08b4d40d | lead-arena-0925c | 删除热启动缓存（warmStart.ts）、`initialStates` 注入、`FoldLoopContext.injected`、模块能力 `feedbackCfgKeys`，以及 warmStart / seedInvariance 测试。卡片原写的「无读取点」不准确：实际还剩 `injected` 标志，它会让命中缓存时的终局重折和截断重折从默认种子起跑。zd 2 处差异（1431-1491-1311 heavy 79.44M→73.65M），已实证等于「HEAD 缓存永不命中」，所以是删掉了缓存历史依赖缺陷，结果恒等于冷算。stun-dual-source §24.11 |
| CC-148 | ✅ done（第 175 轮，18/18 审完） | `4ca262f1` | 带文件级 off 钉的 18 个测试文件逐条审计：10 个迁到 physical；adjustableEffect 用例级钉；8 个保留文件级钉并写明为机制钉（理由见 stun-dual-source §16.2）；审计中发现 CC-151。不放宽容差。细化为逐用例钉 = CC-152 |
| CC-149 | ✅ 完成（第 183 轮，与 CC-159 同一提交） | — | 降配回调改为「绝对可行即接受」（`feasible = downscaleTrialFeasible(...)`，`accepted = feasible || 相对臂`），恢复 `@fact 降配搜索/绝对可行优先`，消除最大可行档沿合轴率的锯齿。副作用：单人叶瞬光 c4/c5/c6 接受的降配档暴露 CC-160（留白 +5~+11s，伤害 +17.7%~+18.8%）。stun-dual-source §21、§24 |
| CC-150 | ✅ done（第 174 轮） | `e2057bd3` | physical 外层 2-环（整数物理次数无不动点，雨果 0 命轴 5↔4）下资源行（4）与池 / 轴栈 / 伤害侧（5）不同源：`runOuterLoop` 出口把报告池钳到规范成员读入的 K（最大自洽可行整数），`core/stunPool.ts#withStunCount` 重算派生字段。zd 全库 2 条、伤害 0.000%。残差：「池 < 读入」一侧未处理。详见 `docs/mcp-stun-dual-source.md` §15（并更正 §13.1）。；**残差（池 < 读入）已由 CC-153 闭合** |
| CC-151 | ✅ done（第 175 轮） | `4ca262f1` | 锁定失衡次数（stunCountLock≥0）时 physical 投影读池的物理次数、绕过锁定：锁定 + physical 回落 off，其他投影照常（useResourceCalc 约 124 行）。预设不设锁定，zd 与基线零变化。回退点：删 IIFE 里的锁定判断。§16.1 |
| CC-152 | ✅ done c6795167 | lead-arena-0925c | 8 个文件级 off 钉 → 逐用例钉：111 条用例中只有 9 条需要 off，其余 102 条回到缺省 physical 口径；damagePoolDefDown、potentialAxisBatchB 的钉理由已失效，整块删除。钉统一用 `setMechanicSetting('time.stunPlanProjection', 0)`；期望值与容差零改动。stun-dual-source §24.13 |
| CC-153 | ✅ done（第 176 轮） | `d2c89e1e` | CC-150 残差（外层环「池 < 读入」一侧）：pickOuterCycleMember 新增 ⓪″（physical 下不可行成员不参选），⓪ 零窗按读入物理次数判（windowsIn）。zd 5 条逐条解释；timeGolden 1 队、棘轮 2 队重生成。stun-dual-source §17 |
| CC-154 | ✅ done（第 177 轮） | `a0860502` | physical 下模块读计划值当次数：审计三组读点（applyTeamConfig 入参 15 组、axis.windows 7 个读点、编排层 3 处）。方案 C：converge / postRound 派发和 axis.windows 统一改走计数通道 countStun（off 下零差）。12 条红逐处还原归因（夹具钉 off 4 条、期望修订、判据 ③ 改为不变量）；timeGolden 119/415、棘轮 19 队重生成，超预算新增 0。详见 stun-dual-source §18 |
| CC-155 | ✅ done（第 178 轮） | `d030a2ff` | 编排层 3 处计数读计划值改走 countStun：琉音赠大连携窗口（约 342 行）、失衡内异常代表窗（约 986 行）、Boss 异常 stunsTotal（约 1082 行）。986/1082 两处 zd DIFF 0；342 行影响 7 条 zd 变体，都含琉音，规划 0 / 池 3–4 的自相矛盾被消除。timeGolden 3 条、棘轮 3 队重生成。stun-dual-source §19 |
| CC-157 | 🚫 不做（第 179 轮结案：设计内） | — | 原推测「琉音赠送的终结技没进时间预算」是错的：赠行在账本和物化行里都有，超预算来自整数次终结技装不进剩余时间（poolResidual −2.457），轴模式按设计容忍 ≤ `AXIS_FALLBACK_TOLERANCE_SEC` = 2s 的量化残差。timeGolden 中 over > 0 的 10 条全部 ≤ 2s。stun-dual-source §20 |
| CC-158 | ✅ 完成（第 181 轮合入） | — | foldLoop 折叠残差由「只增不减」改为带 1s 门槛的不动点迭代（负溢出先退回本槽残差），退回时扣减已冻结的 refund，防止同一份空闲补偿两次。棘轮 Σ留白 127.8→52.9，golden 957.4→905.3，超预算不变；zd 172/624 条，以上升为主。7 条测试按意图归因（§22.5）。stun-dual-source §22 |
| CC-159 | ✅ 完成（第 183 轮，与 CC-149 同一提交） | — | 叶瞬光终局整数重推在 k↔k+1 轮间单量子 2-循环（无整数不动点），旧行为停在「账本 k+1 轮、装配 k 轮」相位 ⇒ 虚高 12.8s。修法：finalizePasses 检测「周期 2 + 逐槽强特/终结技差 ≤ 1」，由模块声明的 `finalizePass.prefersCycleMember` 选相（叶瞬光取平A大者，`照影=floor(终态剑势/6)` 成立）。棘轮两队 12.8→1.1/2.9。stun-dual-source §23–24 |
| CC-160 | ✅ done 3db6e605 | lead-arena-0925c | 单人 1431 虚高留白（c2–c6 6.7–12.2s）。根因是两个缺陷叠加（stun-dual-source §24.8）。修法（§24.9）：叶瞬光 `finalizePass.begin(cfg, entry)` 按入口态把照影轮数 floor 一次并冻结，新增 `finalizePass.refoldAfter`，终局后重折一次。结果：c0–c6 全部 stable、留白 0；zd 1341-1311 +5.8%。验证：全量测试、verify、两份基线重生成（34 条差异全在 1431 队），4 处测试逐条归因。 |
| CC-161 | ✅ 关闭（CC-160 覆盖，第 188 轮） | lead-arena-0925c | 原病例 zd 1431-1341-1311 在 CC-160 后为 73.19M、留白 0、满档可行；旧版 74.78M 靠超预算相触发降配得到，而且本身带 0.12s 超预算。剩下的 −2.1% 是口径差，不是缺陷。「满档可行时也按伤害试降配」属于新目标函数，与「交互只取最少要求」冲突，需要用户口径，不进引擎待办。stun-dual-source §24.10 |
| CC-162 | ✅ 关闭（不做，第 189 轮） | lead-arena-0925c | 比利各路径留白 ≤1.07（容差量级），没有虚高可修；声明 refoldAfter 会让 basic4_gain rate=1/2 实到 0（退化）⇒ 不声明。锁窗 3 夹具重折被拒只出现在人造场景，要修需加专门机制，不做。stun-dual-source §24.11 |
| CC-163 | ✅ done 58d0143d | lead-arena-0925c | 删除 CC-159 的单量子选相分支（`oneQuantumApart` / `prefersCycleMember`）：分支仍触发（三路径共 199 次），但禁用后 golden、棘轮、zd 全部 104 个预设、单人 1431、全量测试逐位相同，属于死分支。执行器回到「≤12 轮 + 逐位判稳 + refold」。stun-dual-source §24.10 |
| CC-164 | ✅ done（零发现，无代码）90a7eb79 | lead-arena-0925c | CC-27 的同类排查：`PanelValues` 死读零发现（按读取点 125 键 + 按声明 120 字段两种扫法）；179 个滑块中有 19 个只有单测覆盖，但全部走标准 setting 通道、单测注入同键，无 CC-27 类风险，不补测；滑块读取写法归一「不做」。stun-dual-source §24.15 | — |
| CC-165 | ✅ done 90a7eb79 | lead-arena-0925c | 蕾米埃尔 6 命三个 `*TriggerMultiplier` 加成字段初值 1 → 0（原与 `1+x` 叠成 0 命 ×2 / 6 命 ×3）；特殊虚耀 = (3×一命轮次 + 4命补充个数) × (1+加成) ⇒ 1/4/6 命 3/6/12（状态表、6 命原文、模块公式文案三源一致）；惊鸿读 FleetingGrace；两份相同计数公式收为一处。1581 的 0 命预设伤害 −12~16%（归因：反向恢复惊鸿 ×2 后伤害差异全消失）；golden 已重生成。stun-dual-source §24.15 | 状态表 1581 c6 |
| CC-166 | open（暂缓，需规格） | — | 蕾米埃尔 6 命：(a)「垂虹/惊鸿耀变触发2次」与两条翻倍是否叠乘（当前 ×2，LuminizeTrigger 不读）；(b) 普攻 4 段获得 3 个 25% 伤害的特殊虚耀未建模。都会改数值且原文无法消歧，按 R5 暂缓。stun-dual-source §24.15 | 状态表 1581 c6 pending |
| CC-167 | ✅ done（零发现，无代码） | lead-arena-0925c | CC-165 推广：非 0 初值只剩 5 个基础属性，没有 `1 + x` 读法；`1 + … ?? 1` 唯一命中是精炼折算（正确）。不做判据。stun-dual-source §24.16 | — |
| CC-168 | ✅ done 3336f873 | lead-arena-0925c | 副词条优化器（单槽）的队友 buff 输入改为与伤害管线同源：`computePanelPhases` 的 5 步加工（来源修正 / 全局 Buff / 额外能力门控 / 接收槽过滤 / 覆盖率表）抽成 `resolveSlotPanelBuffInputs` 两处共用；`OptimizeSubstatsInput.config.effectCoverageMap` 转发。同提交：局外总回能同时盖到局外面板（洛克茜旁支关闭，读数本就正确）。zd 零差。store 层整队贪心仍用原始上下文（未决，理由见 §24.16）。stun-dual-source §24.16 | — |
| CC-169 | ✅ done af1c9e86 | lead-arena-0925c | 配置页「局外」面板改为直接取引擎 `computePanelPhases(slot).outOfCombat`：原独立组装缺门控 / 接收槽过滤 / 来源修正 / 队友覆盖率，并把全局 Buff 事后叠加到局外（引擎当局内）。口径变化：全局 Buff 只进局内。连带删除零生产消费方的 `composables/teammateBuffContext.ts`。纯展示，伤害零影响。stun-dual-source §24.17 | — |
| CC-170 | ✅ done c727c369 | lead-arena-0925c | calcPanel 调用方口径普查：生产调用点实为 5 个（表见 stun-dual-source §24.18）；发现 CC-171（已修）、CC-172（open）。 | — |
| CC-171 | ✅ done c727c369 | lead-arena-0925c | `computePanelPhases` / `computeEntrySnapshotPanel` 漏传 `potentialLevel` → `cfg.panel.potentialLevel` 恒为 6（柏妮思 / 简资源结果按满潜显示）。补传两行，伤害零变化（潜能伤害走 applyPanel，一直是正确档位）。§24.18 | — |
| CC-172 | ✅ done 8bbefaed | lead-arena-0925c | 来源面板传「角色自身覆盖率表」（`selfEffectCoverageMap`，与进场快照面板共用）：此前来源角色自身条件效果按 100% 算，与其主面板口径分裂。缺省配置零差（覆盖率缺省 100）。§24.19 | — |
| CC-173 | ✅ done（决定：不迁移） e0426398 | lead-arena-0925c | 整队贪心选 (c)：允许与管线不同源（store 禁调编排层；迁出牵连 4 个 store 流程；注入点不更简单）。重开条件：useDefault 缺省改 0，或要求自动分配 = 按钮逐值一致。§24.20 | — |
| CC-174 | ✅ done e0426398 | lead-arena-0925c | calcPanel 生产调用点输入契约测试 `core/__tests__/calcPanelCallContract.test.ts`：清单 = KNOWN，每处显式写 potentialLevel / effectCoverageMap。优化器输入加 potentialLevel 透传。零差。§24.20 | — |
| CC-175 | ✅ done be822bc6 | lead-arena-0925c | core 可选入参普查 → calcAnomalyDamage 契约统一（结算面板减防 / 减抗函数内读，入参只传额外量）：修 ① 减抗双计（4 调用点，自初始提交）、② 标准异常漏通用减防、③ 异放固定减防双计。zd 145 变（140 升 5 降），timeGolden 90 条 dmg 重生成。§24.21 | — |
| CC-176 | done 542884bc | 第 200 轮 | CC-175 普查剩余候选：伤害池直伤入参拼装收口 `calcPoolDirectDamage`（正路与简 / 爱丽丝 6 命附伤共用），修附伤漏侵染区；其余候选已查无问题（stun-dual-source §24.22）。 | verify rc=0；jane.test CC-176 用例；zd 2 预设 +0.01~0.02% |
| CC-177 | done 8fc869d0 | 第 201 轮 | 异常伤害入参拼装收口 `calcPoolAnomalyDamage`（4 个调用点），文件改名 `poolDamage.ts`（stun-dual-source §24.23）。 | 纯重构 zd DIFF 0；verify rc=0 |
| CC-178 | done 9daca673 | 第 201 轮 | 删除合轴节省团队总量 `axisOverlapSeconds` 与两处只被测试走的兜底分支，按块分摊成为唯一表示（§24.24）。 | zd（ZD_DROP）DIFF 0；verify rc=0 |
| CC-179 | done 8aba58f5 | 第 202 轮 | core 可选字段普查（扫描器 k202/scan179.cjs）：`agentMechanics` 改必填（缺省静默跳过模块钩子）；账本 `iterate` 赠送供给补传 `teamSize`（四处同源）；`axisMode` 不做（缺省不改变结果，隐患已登记）（§24.26）。 | zd DIFF 0；退化配置探针；verify rc=0 |
| CC-180 | done 7f320498 | 第 203 轮 | 队友落点统一在编队槽位空间按已上场序列解析（跳过空槽，无队友 = -1）：`resolveTeammateTargetSlot` 替代 `resolveUltimateTargetSlot` 与琉音私有 `resolvePreviousTeammateSlot`；引擎 / 编排层同源于 `configs[].slot`；删除 teamSize 整条链（§24.27）。两人队三种站位由差 12.8% 变为逐位相同。 | zd DIFF 0；退化探针；verify rc=0 |
| CC-181 | done e0fdf806 | 第 204 轮 | CC-179 余项：删 `enemyStunResistance`（单数，零写入）、`guaranteeStunShortfall` 的 target 形参、`decomposeSet` 的 coverage 形参；Top-K 套装排名与最终分配统一 `minGainRatio`（原漏传固定 0.05）；wEngine ctx 三项为扫描器误报，不做（§24.28）。 | zd DIFF 0；蕾米埃尔优化探针零差；verify rc=0 |
| CC-182 | done 85956a53 | 第 205 轮 | 覆盖率差核实为非主因（catalog 默认全 1）；真问题是 `basePanel` 已含当前套装、又叠加候选套装（双计 / 幻影两套），而 `chosenSet` 生产零读取。改为已装备套装时只为它分配，未装备才搜索（§24.29）。按实际伤害 62 角色对照整体持平。 | zd DIFF 0；probe205 实伤对照；verify rc=0 |
| CC-183 | done | 20a47df3 | 副词条优化器打分偏差（高估精通和暴击、低估攻击）。实测 ①（攻击% 乘基础值）与 ①′（calcPanel 探针得出的精确面板增量）都更差，因为偏差在近似式本身，看不到技能级乘区。改为在编排层用真实 `teamTotalDamage` 做挪步爬山精修（`computeSubstatAllocationForSlot` 的 refine 参数，ImpactChart 已接入）：平均 +2.96% → +4.85%，37 → 47 胜，36 升 0 降。详见 stun-dual-source §24.30。 | 探针 k206/c2r.tsv、substatOptimizer.test refine 用例、verify |
| CC-184 | done | ae935755 | 优化器最差个例 1611。根因：打分式看不到防御 / 生命，边际恒 0，贪心提前终止，只分 20/39 步。修复：greedyAllocate 在循环结束后按模板优先序补满剩余预算。开精修后平均 +4.85% → +6.47%，47 → 54 胜，最差 −25% → 0%；不开精修 +2.96% → +3.63%。详见 stun-dual-source §24.31。 | 探针 k207/r1.tsv、n1.tsv；substatOptimizer.test 预算用例；verify |
| CC-185 | done | 0e4e7ecf | 编排层副词条优化器只剩一种模式：useDefault 快速分配作起点，再做真实伤害精修（refine 必填）。实测起点换成贪心，单人队 62 个角色、三人队 21 个槽位伤害全部零差，评估次数相当。core 贪心不删：store useDefault=0 分支和 marginalGains 展示还在用，转 CC-186。详见 stun-dual-source §24.32。 | 探针 k208/final.tsv；p208team 三人队；substatOptimizer.test；verify |
| CC-186 | done | 4d6f13d0 | core 副词条打分模型退役：唯一入口 store `optimizer.useDefault=0` 从引入起无写入点，生产不可达；perSlotMarginalGains 永远为空，两处展示永远显示「未计算」。core/substatOptimizer.ts 915 行减到约 190 行，入口改名 computeDefaultSubStatAllocation；删掉 store 整队贪心分支和坏掉的展示；6 个异常角色的冗余模板声明删除。详见 stun-dual-source §24.33。 | zd DIFF 0；探针变化 0；CC-81 测试重写；verify |
| CC-187 | done | 00e50d4e | 删除 core/resourceTrack.ts（时间轴喧响轨原型，已否决方向 A 的种子，生产零调用）及其测试；decibelCapVerdict 形状面判据删除，闸门改由行为判据承担。同轮两份普查：只读不写 mechanicSetting key = 0；生产零引用导出 25 个（定性表见 stun-dual-source §24.34）。 | verify EXIT=0（3827）；CG；vue-tsc |
| CC-188 | done | 378c1c17 | 删除只被测试调用的生产逻辑副本（丽娜/耀嘉音核心被动公式、spec 资源区静态兜底、旧两级预设下拉），测试改走生产通道；harness 新增 resolveTeammateBuffsOnEmptyPanel。§24.34 其余 C/D/F 条目逐条写了「不做」理由（stun-dual-source §24.35）。 | 变异检验（改 JSON 上限新测试变红）；verify EXIT=0（3827） |
| CC-189 | done | ad9a9321 | 自由对比 x 轴 6 个维度里 3 个是假的（求值器只读 cinema/wengine）：期数轴接线（所选 Boss 的各期危局）；金数/难度两轴删除（无现成口径）；顺带修 env.hp 在装配前读死（选 Boss 约束时血量比除错 Boss）。详见 stun-dual-source §24.36。 | 真引擎判据 + 两项变异检验；verify EXIT=0（3827） |
| CC-190 | done | f516e95f | 接口属性「只写不读」普查（`scripts/audit-write-only-props.cjs`，TS 符号引用 + 名字兜底）：删掉 5 个假契约字段（enemyLevel / ultimateTotalBySlot / targetState / includeOwner / stunsTotal）+ 爱丽丝 6 命常量双源；无数值 bug；T1/T2 清理待办交给低级模型。详见 `docs/mcp-write-only-props.md`、stun-dual-source §24.37。 | zd DIFF 0；verify EXIT=0（3827） |
| CC-191 | done | 9e0d4adf | T1 cfg 死暂存清理 20 字段 + 丽娜/苍角死 applyTeamConfig 整条删除 + 诺姆 C4 过期注释；审计脚本补 JSON 语料（第 213 轮漏扫，T1 原 37 条中 17 条误报），表重新生成。详见 `docs/mcp-write-only-props.md`、stun-dual-source §24.38。 | zd DIFF 0（HEAD 版 1401.json）；verify EXIT=0（3827） |
| CC-192 | done | 10817931 | 机制设置动态普查（179 项：有效 168，无效 11 项已逐条分类）。发现并修复安东额外能力门控缺 spec 声明（生产路径上感电追加恒不触发）和滑块 0% 读成 100%；另查出安东生产计划没有爆发状态招式行（模块 moveId 增伤可能全不命中），列为 CC-193；新增结构守卫 additionalAbilityGate.test.ts；顺带删诺姆 3 个只写字段、改正 1571 过期说明。详见 stun-dual-source §24.39。 | zd DIFF 0（HEAD 版 1571.json + ZD_DROP）；verify EXIT=0（3831） |
| CC-193 | done | 4ddd4f78 | 汇总平A行携带基准段 `benchmarkMoveId` + `execMatchesMove` 通用匹配（振斗耗血暴伤、赛维里安 C1 原先恒不命中；安东按用户 2026-08 裁决保持常态基准段）；`getBasicComboMoves` 数据配置不再受 #N 命名约束，catalog 补 1631 / 1641 基准段（赛维里安 / 菲欧妮普攻伤害原为 0）；守卫：全部角色必须能解析基准段。剩余逐角色欠账见 stun-dual-source §24.40。 | zd DIFF 0（ZD_DROP 两个新键）；time golden 重生成（6 条均已解释）；verify EXIT=0（3837：新增 basicBenchmarkMatchCc193 共 6 例） |
| CC-194 | done | 062af638 | postRound 写入跨轮生效：`threads.postRoundInput` 下一轮 converge 前派发（旧实现写本轮克隆、下一轮重新克隆即丢失 ⇒ 扳机冥狱恒 0、安比 C4 回能从未注入）；判稳签名补强特次数；删除千夏只写不读的钩子（§24.41） | zd 92 条差异全部归因（扳机 84 + 签名 5 个变体，k217b 反证）；verify EXIT=0（3838） |
| CC-195 | done | f5a28e56 | 普攻汇总行 → 段命中通用折算（`basicComboCycleSeconds` + `basicSummarySeconds`）：千夏普攻 #4 进入凝视标记供给（原恒 0；供给改纯函数，删 cfg 回写）、佩洛伊斯日珥账本补余晖回复（仅展示）；苍角按用户循环口径不做；发现千夏 1491008 与爱芮绝对音准两个缺口（§24.42） | zd DIFF 0（预设无千夏队）；harness 实测 +0.14~0.31%；verify EXIT=0（3840） |
| CC-196 | done | e862fbd3 | 爱芮绝对音准次数按原文订正：全场应援非C6=终结×3、C6=floor(t/6)+3（旧实现无门控 floor(t/6)）；甜心律动 #4 +1 应援能量（CC-195 口径）；抽纯函数 `aireAbsolutePitchCount`。爱芮队 C0 −0.6~−10%、C6 +10.6%，时间账零变化。直伤行拆到 CC-197（§24.43） |
| CC-197 | done | 2af8c466 | 爱芮绝对音准直伤行（1501007 / 1501008）走通用 `extraNecessaryAction` 通道（扩展：可读 state、可返回数组、喧响可缺省回落倍率表），时间进账本估计；影画6 +40% 首次命中。爱芮队 +1~+34%（柳队 C0 −5.9%，真实时间代价）。订正 §24.43 溢出误判（逐槽 front 是毛时间，净占用 180）。见 §24.44 |
| CC-198 | done | 3d0217e3 | 千夏 1491008 特别拍照技巧计入凝视标记：新增通用行快照 `prePatchExecutions`（与 `preModuleExecutions` 对称，patchExecutions 看到的行），千夏凝视产行挪到 patchExecutions。标记 +4、千夏队 +0.05~+0.56%，时间账零变化（§24.45） |
| CC-199 | done | 99282fdf | 额外能力门控补全：store 通用门控改按组 id 查拥有者（1411 柚叶 ownerId=slug 曾恒开）；1351 波可娜/1141 莱卡恩补 spec 声明（曾恒开），1351 困迹两条进硬表、影画1 随门控；护栏扩到全员 + catalog additionalAbility.effects 须为空。1511 原文无条件→例外；1441 仅回血→不做（§24.46） |
| CC-200 | done | d5e18595 | 模块必做行时间预留普查（残差插桩：苍角 48s、席德 35s、雅 31s、艾莲 25s；克拉蕾/洛克茜/月城柳不做）。苍角强特子动作改走 `estimateExSpecialTime`（与产行同源的 `soukakuPerExExtraTime`），残差→0，打年糕#3 合轴抵扣回到账本：苍角队 +12.6%/+15.8%（§24.47） |
| CC-201 | done（结论，无代码） | — | 席德落华经 `extraNecessaryAction` 只预留：组队两支伤害逐位不变、单人 c6 触发截断 −6.1% ⇒ 撤回不做。判据修订：只迁**有合轴**的模块前台行（折叠只会丢合轴抵扣）；预筛：雅 1091029 合轴 0.709 ⇒ 下一张，艾莲/席德合轴 0 ⇒ 不做（§24.48） |
| CC-202 | done | 11bf2ac8 | 雅霜月（#3 合轴 0.709 + C6 赠送 #1/#2）经 `extraNecessaryAction` 只预留：残差→0、截断 0，合轴抵扣回归「仅 1s 锁定在前台」口径；雅队 +8.7～+15.7%，单人 c6 不变。spy 同源测试守预留=产行。「模块必做行时间预留」线收尾（§24.49） |
| CC-203 | done | fb64de6f | 额外能力两道门控归一：硬门控表从 catalog 分组派生（`src/specs/additionalGate.ts#additionalGateBuffTable`，来源「额外能力」+ 拥有者有声明 + 跨来源 4 条），引擎与 store 默认门控共读；补 15 条仅软门控的 buff，修跨来源条目「默认勾上、引擎丢弃」。数值零差（§24.50） |
| CC-204 | done | 9aed3fc4 | freeCompare 汇总表胜负着色：`metrics.ts#bestSeriesIndexByLevel` 按 `higherBetter` 标每档最优（并列全标，单系列或全员并列不标），`higherBetter` 从零读取变成有消费方；顺手修表格、折线、纵轴格式化读下拉框当前指标而非 `result.metricId` 的 bug（§24.51） |
| CC-156 | ✅ done e542a005 | lead-arena-0925c | 原病例（归档 72db6dc3）已不复现（池 4）。一般情形「弹刀预算用满仍未达保底」原先静默降级，改为如实提示：`core/parrySplit.ts#guaranteeStunShortfall`（按最终池计数）→ `useResourceCalc.guaranteeStunShortfallResult` → 页面在「保底4失衡」旁提示；同时删除零读取的 `reached`，并把目标值 4 收为 `GUARANTEE_STUN_TARGET`。数值零变化。stun-dual-source §24.12 |
| R5 | **进行中（排最前）**：第 1 刀粗筛 done | 第 1 刀随第 119 轮文档提交 | 用户需求 R5：规格-实现对账。逐个查 `catalog.json` 字段，引擎读不读、怎么读、读得对不对；优先查「零读取」和「读了但语义不同」两类；产出差异清单 | `docs/REQUIREMENTS.md` R5 · `docs/mcp-r5-spec-impl-reconciliation.md` |
| R6 | **进行中**：第 1 步 v1 done（`docs/ARCHITECTURE-OVERVIEW.md`），第 2 步待做 | 第 121 轮文档提交 | 用户需求 R6：先写架构全景文档，再出三类重构机会清单（冗余可简化 / 可归一 / 可结构化），按清单做、不按计数做；判据是工具不是目标 | `docs/REQUIREMENTS.md` R6 · `docs/ARCHITECTURE-OVERVIEW.md` |
| R7 | ✅ done | `8a0159c` | 用户决定删除事件时间轴死代码：`src/core/timeline/`、`scripts/lib/timeline-isolation.*`、`timelineIsolation.test.ts`、判据 26（check-guards 26→25） | `docs/REQUIREMENTS.md` R7 · census §5.109 |
| R8 | ✅ 答复 done；W1、W2 撤回（§2.5），W3、W4 done | 答复 `8a8db00` · W3/W4 随第 121 轮文档提交 | 用户请 lead 自己决定分工与规则：结论与执行项见 `docs/mcp-working-model.md` | `docs/REQUIREMENTS.md` R8 |
| CC-43d | done | `afc6003` | `computeRemielleEntryPanel` → `computeEntrySnapshotPanel`（函数体无角色分支，零差改名；判据 23 13→8） | census §5.48 |
| CC-43e | done | `7ae18b5` | roundInputs `hasLiuyin` 身份判定 → 模块声明 `ownsPromoteVariantAxisBlocks`（琉音）；零差，判据 23 8→6 | census §5.48 |
| CC-43f | done | `cf5f270` | roundInputs 希格莉德破阵展开 → 模块钩子 `expandAxisAction`（sigrid 实现，编排层按槽位 agentId 派发）；零差，判据 23 6→4 | census §5.49 |
| CC-27 | ✅ done 948a1444 | lead-arena-0925c | 状态机本体已由 CC-6d 迁出。本卡删掉最后一条专属穿线 `cinema2CorrosionRate`（roundInputs → AnomalyPoolInput → core → 能力入参）：改由维琳娜 applyPanel 读 settings 盖章、风蚀能力读回（原面板字段零写入，属死读）。事件 id 前缀常量留在 core（依赖方向正确，不做）。zd 零差；新增真管线滑块探针，并做了反向验证。stun-dual-source §24.14 | census §5.19 |
| CC-18c | design | **并入 CC-19a** |

### CC-1 · 招式表查询迁出（fast）

① **先读**：`/home/kaua/projects/zzz-calculator/src/core/resource.ts` 1288–1705（`findExSpecial`…`calcBasicAttackRegenPerSec`、`fusedGroupMetrics`、私有 `channelMetricsOf`）；
`docs/ARCHITECTURE.md` §3 第 83 行（引用了 `core/resource.ts` 的 `fusedGroupMetrics`）。
② **硬约束**：函数体逐字节搬，不改签名不改逻辑；`resource.ts` 留 `export { … } from './resource/moveLookup'` 壳，**全仓调用方零改动**；
`ULTIMATE_COST_DEFAULT` 的 re-export 原样保留；新文件头写职责注释；不许碰 1287 行以上任何代码。
`grep -rn '@fact' src | grep 'resource.ts#find\|resource.ts#fused\|resource.ts#channel'` 命中的锚全部改指新文件。
检查 `moveLookup.ts` 不 import `resource.ts`（防环）。
③ **验收**：§4 全套 + `npx vitest run src/composables/__tests__/moveFusion.test.ts src/composables/__tests__/exSpecialPlan.test.ts`；同步改 ARCHITECTURE §3 第 83 行的路径。
④ **报告**：搬走的符号清单（名字/旧行/新行）、改过的 `@fact` 锚、§4 命令尾部输出。

### CC-2 · 热启动缓存迁出（fast）

① **先读**：`src/core/resource.ts` 98–160（`WARM_START_CACHE_MAX`…`getWarmStartStats`）与 349 行 `@fact engine:热启动逐位透明`。
② **硬约束**：模块级状态 `warmStartCache/warmStartStats` 必须**只有一份**（搬到新文件后 resource.ts 不得再声明同名变量）；
`clearWarmStartCache/getWarmStartStats` 从 resource.ts re-export（测试与 dump 从那里 import）；`calcTeamResources` 内的调用顺序不动。
③ **验收**：§4 全套（warmStart / seedInvariance 是本卡的主判据）。
④ **报告**：同 CC-1。

### CC-3 · S1 内层循环提为纯函数（fast）

① **先读**：`src/core/resource.ts` 247–430；`src/core/resource/floatNoiseCycle.ts`；`docs/mcp-engine-perf.md`「已落地手段」（快照存引用、预键分桶）。
② **硬约束**：签名 `runInnerLoop(from, ctx: { configs; config; maxIter; oscillatorStop })`，函数体逐字搬（闭包变量改读 `ctx.*`）；
`cycleProbeKey` 一起搬；`structuredClone` 与「快照存引用」语义逐位保留；`calcTeamResources` 内留 `const runInner = (from) => runInnerLoop(from, innerCtx)` 一行，
两个调用点（`runFoldLoop`、`convergeCounts`）不改。`@fact engine:判稳含平A时间` 随代码搬，改锚。
③ **验收**：§4 全套 + `npx vitest run src/core/__tests__/floatNoiseCycle.test.ts`；再跑一次 profile 确认没变慢：
`PERF_PROFILE=1 npx vitest run --config .zc/perf/vitest.perf.config.ts engine`（报 `runInnerLoop` 自耗时，与改前比）。
④ **报告**：同 CC-1 + 改前/改后 profile 两行。

### CC-7 · 贯穿力单一事实源（fast）

① **先读**：`src/core/damage.ts` 180–240；`src/mechanics/agents/norma.ts` 95–110；`src/composables/resourceCalc/damagePool.ts` 1010–1075。
② **硬约束**：`core/damage.ts` 把 `calcPenetrationPower` 加 `export`（函数体不动）；norma.ts 删私有副本改 import
（注意 norma 版本对 `atk`/`hp` 有 `?? 0`——`PanelValues` 这两个字段若非可选则等价，**先确认类型**，不等价就停下报告）；
damagePool.ts:1067 改为 `basisValueOverride: calcPenetrationPower(panel)`（同样先确认 `panel.hp ?? 0` 等价性）。
~~**:1020 不许动**（缺 `sheerForceFlat` 是 CC-D1 待裁决项）~~ ⇒ **CC-D1 已于 2026-09-25 裁决并修**（:1020 改引 `calcPenetrationPower`），本约束解除。norma.ts 是录入层，只许 import `@/core`（判据 19 只禁 `@/composables`）。
③ **验收**：§4 全套 + `npx vitest run src/mechanics/__tests__/norma*.test.ts`。
④ **报告**：等价性论证（类型定义出处）、改动行、§4 尾部输出。

### CC-8 · 异常常量改引 core（fast）

① **先读**：`damagePool.ts` 1234–1331、1395–1435；`src/core/anomalyPool/helpers.ts` 1305–1335。
② **硬约束**：只替换**数值来源**，行文案（`note`/`baseFormula` 里的「713%」字样）可改为模板插值，但渲染出的字符串必须逐字相同；
DoT 表 `{ 百分比, 间隔, tick 数 }` 逐项与 `STANDARD_DOT_CONFIG` 对照，任何一项不相等 ⇒ 停下报告（那是口径差，不是重复）。
③ **验收**：§4 全套（dump 的 `teamTotalDamage` 列是主判据）。
④ **报告**：逐项对照表（damagePool 值 / core 值 / 是否相等）、§4 尾部输出。

### CC-12 · 身份扫描器补别名形态（换尺批）

① **先读**：`scripts/lib/agent-identity-lines.mjs` 头注释；`scripts/report-agent-identity.mjs --md` 输出里的「观察项·别名盲区」；AGENTS 规则 6 与规则 17②⑥。
② **硬约束**：**只改尺子不改被测代码**；新形态 = 「局部 const 由 `.agentId`/`.id`/`teammateBuffId` 初始化，随后与四位数字字面量比较」；
`frozen` 调到真实值，沿革里写「口径纠正不是退步」+ 新旧读数；补 `src/scripts/__tests__/` 下的正/反例单测。
③ **验收**：`npm run check-guards`、`npx vitest run src/scripts/__tests__/`（相关文件）、`node scripts/report-agent-identity.mjs --md` 前后对比。
④ **报告**：新旧读数、新增命中的逐行清单。

### design 卡（CC-4/5/6/9/10/11）——lead 写完设计再放行

**CC-6 设计稿**：dsflash 设计工人产出，lead 审过，全文 `.zc/reports/CC-6-design.md`（gitignored 工作态，56KB，逐行出处）。要点：
- 能力一律挂 `AgentMechanicModule`，引擎经 `getAgentMechanic(cfg.agentId)?.<能力>` 查询，返回 `undefined` = 不认领、回落通用路径（照 `crossAgentSupply` 先例）。
- 闸门复核：4 块里只有 1451 需要读别的槽位中间态（yidhari 的 `ultimateCount`）⇒ 必须先收集成标量（`crossAgentSupply` 新 kind），能力函数只吃标量；
  走 `applyTeamConfig` 拿不到 iterate 的 `prevStates`，会改数值，不可行。
- **每步必须同批下调棘轮**：`scripts/lib/agent-branch-ratchet.mjs` 的 `CORE_AGENT_BRANCH_BASELINE`、`scripts/lib/layer-import-ratchet.mjs` 的
  `CORE_ROLE_IMPORT_BASELINE`、`scripts/lib/guard-registries.mjs` 的 `RATCHET_BURNDOWN.frozen`（CC-85 前在 check-guards.mjs）三处一起改（只改基线不改 frozen ⇒ verify 红；计数低于基线 check-guards 也红）。
- 每步带**反向验证**：临时删掉新能力声明 ⇒ dump 必须精确变红（证明引擎真的在走能力，而不是恰好算出同一个数）。

### CC-6a · 1471 强特次数迁引擎能力（review）

① **先读**：`.zc/reports/CC-6-design.md` §0、§3.1、§4 步骤 1；`src/core/resource/helpers.ts` 140–210；`src/core/resource/crossAgentSupply.ts` 1–60；
`src/mechanics/types.ts` 中 `crossAgentSupply?` 声明附近；`src/mechanics/agents/banyue.ts` 中 `banyueMechanic` 定义。
② **硬约束**：能力签名按设计稿 `exSpecialCount?(input: { cfg; totalEnergy }): number | undefined`；引擎查询位置 = 原 1471 分支所在处
（**在** `exSpecialCostType === 'resource'` 与 `exSpecialEnergyConsume <= 0` 两个早返回**之后**，顺序不变）；1051 分支原样不动。
动手前确认没有任何 `AgentMechanicModule` 已在**模块顶层**声明 `exSpecialCount` 键（`grep -rn "exSpecialCount:" src/mechanics/agents/` 会命中 koleda/luciaElowen/liuyin 的 state 字段与函数参数、banyue 的 `estimateExSpecialTime` 解构——这些都不是能力声明，忽略；
另查 `src/mechanics/types.ts` 的 `AgentMechanicModule` 无同名成员）。三处棘轮同批下调（6→5、5→4）并在 `RATCHET_BURNDOWN` 沿革写一行。
③ **验收**：§4 全套 + `npx vitest run src/mechanics/__tests__/banyue*.test.ts src/composables/__tests__/yidhariInteractionGrid.test.ts`；
反向验证：临时注释掉 banyue 的 `exSpecialCount` 跑 dump，含 1471 的场景必须非零差异，记下差异条数后**恢复**，再跑一次 dump 确认回到零差异。
④ **报告**：改动行、三处棘轮新旧值、反向验证差异条数、§4 尾部输出。

### CC-6b · 1451 帷幕触发迁引擎能力（review）

① **先读**：`.zc/reports/CC-6-design.md` §3.2（c）（d）（e）与 §6 第 1、2 条；**设计稿行号已过期**（CC-3/6a、`4ca47db` 之后），一律以当前代码为准：
`src/core/resource/helpers.ts` 285–335（`luciaSlot` / `curtainTriggers` / yidhari 外部回血 `external` / `luciaC4DecibelPerTrigger`）；
`src/core/resource.ts` 705–735（收敛后帷幕折算，含「卢西娅必须按 agentId 找槽」注释）与 785–860（装配段写回 `luciaCurtain*` / `yidhariExternalHealPct`、喧响源）；
`src/core/resource/crossAgentSupply.ts` 40–63；`src/mechanics/types.ts` 755–800；`src/mechanics/agents/luciaElowen.ts` 88–103（`computeLuciaCurtainTriggers`）与其模块定义；`src/mechanics/agents/yidhari.ts` 模块定义。

② **lead 裁决（2026-09-25 lead-arena-0925c）**：
- §6-1：类别名定为 `'curtain-open'`（语义 = 队友开帷幕次数），同步把 `types.ts` `CrossAgentSupplySpec.kind` 注释里预告的 `'curtain'` 改成 `'curtain-open'`。
- §6-2：外部回血源**复用**帷幕提供者槽 `providerSlot`，不新增 `heal-per-ult` 类别；在 `curtain.ts` 头注释写死前提：「当前唯一帷幕提供者 = 唯一外部回血源 = 卢西娅；出现第二个提供者时必须把回血源拆成独立能力」。

**硬约束**：
- 形状照设计稿 §3.2（c）：`curtainTriggers?(input: { cfg; state; teammateOpenCount; totalTime }): number`；yidhari 声明 `crossAgentSupply: { kind: 'curtain-open', supply: ({ state }) => Math.max(0, Math.floor(state.ultimateCount)) }`；
  `crossAgentSupply.ts` 加 `crossAgentSupplyCountOf`；新文件 `src/core/resource/curtain.ts`（`curtainInfoOf`，不写 id、不 import 角色模块）；helpers.ts 与 resource.ts 两个调用点、装配段按设计稿改写，删两处 `computeLuciaCurtainTriggers` import 与两处 `'1451'` 字面量。
- **证伪闸门（动手前与收工前各跑一次）**：`grep -rn "curtainTriggers" src/mechanics/agents/` 只命中 luciaElowen；`grep -rn "curtain-open" src/mechanics/agents/` 只命中 yidhari。
  `crossAgentSupply` 每个模块**只能声明一条**（类型是单个 spec，不是数组）——lead 已核 yidhari 当前**没有**声明；若你开工时发现已有，停下报 blocked。
- `yidhariSlot`（字段判据 `yidhariDecibelPerHpPct`）**保留**，继续用于外部回血写回与 yidhariBurn；只有「队友开帷幕数」改由 `curtain-open` 收集。
  ⚠ 这是本卡最大的等价性风险：旧式按**字段**找 yidhari、新式按**模块**找；resource.ts 705–720 的注释证明「buildCharConfig 写的字段在某些 cfg 副本上会缺」。若 dump 在带 1051 的场景红，**首先怀疑这里**，报 blocked，不要硬修。
- 装配段 `luciaCurtainTeammates` 的多提供者比例分摊是**新语义、当前不可达**，注释里写明（防后人以为逐位等价）。
- 更新 resource.ts「卢西娅必须按 agentId 找槽」注释：说明现在按模块能力（`getAgentMechanic(cfg.agentId)?.curtainTriggers`）找槽，与 `luciaCinemaLevel` 是否在场无关。
- `WARM_KEY_OMIT_CFG` 不动。三处棘轮同批下调：core agentId 5→3、core 角色 import 4→2、`RATCHET_BURNDOWN.frozen` 同步，并写沿革。

③ **验收**：§4 全套（dump 用 `d97a8b0` 代次的 A）+ rowsnap（`luciaCurtain*` 进 damagePool 展示时可见）+
`npx vitest run src/mechanics/__tests__/luciaElowen.test.ts src/mechanics/__tests__/yidhari.test.ts src/composables/__tests__/yidhariInteractionGrid.test.ts`。
**反向验证**：临时让 yidhari 的 `curtain-open` supply 返回 0 跑 dump ⇒ 带 1051+1451 的场景必须非零差异，记条数后**恢复**，再跑一次 dump 确认回到零差异。

④ **报告**：改动行、两次闸门 grep 输出、三处棘轮新旧值、反向验证差异条数（列出场景键前 10 个）、§4 + rowsnap 尾部输出。

### CC-13 · 连续强特通道通用化（R22-D1 债 1a 的前置「批 1-1」）（review，低级模型可做）

**背景**：DEBT「全局实数化收敛重构」（1a，标记 `core/resource/helpers.ts#resolveExSpecialCount`）的保留理由是
「1051 的 refund 自指反馈**只能**按角色开洞、无法用声明式通用通道表达——该前提未验证（批 1-1 未开工）」。
lead 2026-09-26 实读：引擎侧的数学（refund 解析不动点 `O*=(E0−保留成本)/(消耗−返还)`、迭代期实数终结技
时间信道、强特 0.5 阻尼、内层上限 ≥100、终局 floor 一次）**全部是通用的**，唯一绑定 1051 的是**字段名**，
外加 `resourceIncome.ts` 非轴分支读 `yidhariExPerStun × yidhariStunCount` 当「无返还上限」。本卡把它改成
**引擎只认通用字段、模块声明**，零行为改变。

**字段映射**（旧名全仓消失，含测试；新名在 `types/resource/config.ts` 开一段「连续强特通道（引擎通用，模块声明）」逐字段写文档）：

| 旧（1051 专名） | 新（引擎通用） | 写入方 | 语义 |
|---|---|---|---|
| `yidhariContinuousEx` | `exContinuous` | 模块 buildCharConfig | 迭代期强特次数实数参与收敛（阻尼 + 实数 ult 时间信道 + 内层上限 ≥100） |
| `yidhariFinalizeEx` | `exFinalize` | 模块 finalizePass begin/reset | 终局整数重推期：floor 一次、不阻尼 |
| `yidhariRefundPerOutStunEx` | `exRefundPerPaid` | 模块 buildCharConfig | 超出保留/上限部分的每发强特返还闪能 |
| `yidhariInStunExCount` | `exReservedCount` | 模块 applyTeamConfig(converge) | 次数已知、不返还的强特（**条件写形态逐位保留**：只在 `inStunEx>0` 时写） |
| `yidhariInStunEnergyCost` | `exReservedEnergyCost` | 同上 | 上述强特的闪能成本 |
| （新增） | `exRefundFreeCap` | 模块 applyTeamConfig(converge)，紧跟 `record.yidhariStunCount = stunCount` **无条件**写 | 非保留模式下不返还的强特次数上限 |
| `EnergySource.yidhariRefund`（`types/resource/energy.ts`） | `exRefundEnergy` | 引擎 | 返还闪能总量 |

**步骤**：
1. `types/resource/config.ts`：删 5 个旧字段声明，新增 6 个通用字段（带 JSDoc，注明「当前唯一声明方 = 1051 `mechanics/agents/yidhari.ts`」）。`yidhariExPerStun` / `yidhariStunCount` **保留**（模块内部仍用，`computeYidhariHpSource` 读）。`energy.ts` 改名。
2. `mechanics/agents/yidhari.ts`：写入/读取全部换新名；`applyYidhariTeamConfig` 在 `record.yidhariStunCount = stunCount` 下一行加
   `record.exRefundFreeCap = fin(cfg.yidhariExPerStun ?? 2) * fin(stunCount)`，其中 `fin` 逐字复刻 `resourceIncome.ts:36` 的
   `n = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : 0`（逐位等价的关键：原式 = `n(yidhariExPerStun ?? 2) * n(yidhariStunCount ?? 0)`，而 `yidhariStunCount` 唯一写入方就是这一行上面那行）。
3. `core/resource/resourceIncome.ts` refund 块：换新名；非轴分支改 `const cap = n(cfg.exRefundFreeCap)`；局部变量 `yidhariRefundPer`/`yidhariRefund` 改 `refundPer`/`exRefundEnergy`；注释改成通用口径（保留 2026-09-04 双稳态来历一句 + 「当前唯一声明方 1051」）。修完 `grep -n yidhari src/core/resource/resourceIncome.ts` 里 **refund 块内**为 0（块外其它伊德海莉机制不在本卡范围，别动）。
4. `core/resource/helpers.ts`：`resolveExSpecialCount` 两个分支、`:390 yidhariRealUlt`、`:399 exForTime`、`:616 storedEx` 换新名，变量 `yidhariRealUlt`→`realUltForTime`；注释通用化。**debt 标记行（`// debt: 全局实数化收敛重构…`）保留**，其下「⚠ 本标记（1a）保留」那段改写为：批 1-1 已由 CC-13 落地（通道已是声明式通用字段 ⇒「只能按角色开洞」前提证伪）；债本体（全局「实数化松弛、终局才 floor」推广到其它正反馈模块 + 逐模块重校准）仍未做 ⇒ 标记保留。`@fact yidhari:refund不动点` 行**只允许**把其中的字段名换新名，其余逐字不动。
5. `core/resource.ts:155`（`yidhariContinuousPresent`→`continuousExPresent`）、`core/resource/finalizePasses.ts`、`composables/resourceCalc/convergence.ts` 注释、`starlightBilly.ts` / `yeshuguang.ts` / `seedInvariance.test.ts` 注释里的旧名 → 新名。
6. 测试：`mechanics/__tests__/axisContext.test.ts`（13 处）、`core/__tests__/energyRowParity.test.ts:130` 等全部换新名；断言语义不改。
7. `scripts/check-guards.mjs` DEBT_REGISTRY 中该条上方注释补一句「2026-09-26 CC-13：批 1-1 通用连续通道已落地，债本体仍在」；**键与 due 不改**（标记关键词没变）。

**禁止**：改 `docs/AGENT_ID_BURNDOWN_LOG.md`、`docs/ENGINE_PIPELINE_GUIDE.md`、`scripts/lib/agent-branch-ratchet.mjs` 与 `check-guards.mjs` 的 `plan:`/沿革字符串里的旧名——那些是**历史记录**，描述的是当时状态。不许改任何数值、分支结构、条件写形态、阻尼系数、迭代上限。不改比利/叶瞬光的各自旗标（`billyFinalizeChain` 等并入通用通道 = 后续「批 1-2」候选，不在本卡）。

**闸门**：
- `grep -rnE 'yidhari(ContinuousEx|FinalizeEx|RefundPerOutStunEx|InStunExCount|InStunEnergyCost)|yidhariRefund\b' src` ⇒ **0 行**；
- `grep -nE 'yidhariExPerStun|yidhariStunCount' src/core -r` ⇒ **0 行**；
- `get_diagnostics` 无新增；`npm run build` 过；§4 dump（624）与 rowsnap（637）对 `dump-A.json` / `rows-A.json` **零差**；`node scripts/check-guards.mjs` 全绿。

**lead 复核加做**：反向验证——临时删掉步骤 2 新增的 `exRefundFreeCap` 写入行 ⇒ dump/rowsnap 必须在 1051 非轴场景出现差异（证明新字段真在通路上），恢复后零差。

**报告**：`.zc/reports/CC-13.md`，第一行 `STATUS: done|blocked`；逐文件改动摘要、两条闸门 grep 的原始输出、build / dump / rowsnap / check-guards 尾部输出（原文，不许估算）。

**v2 修订（lead 2026-09-26，首派工人发现的卡面漏洞）**：§4 的 dump/rowsnap 对 `rr`（资源结果）整体做 sha256，
每个角色的 `energySource` 都带 `yidhariRefund` 键 ⇒ **纯改名也会让 624/637 场景全部「有差」**（数值没变，是键名进了哈希）。
首派工人正确识别后在「闸门要求改名」与「要求零差」之间打转、未改 src，lead 已停掉。修法（不放松判据）：
`.zc/perf/{dump,rowsnap}.perf.ts` 的 `enc()` 新增开关 **`PERF_KEY_ALIAS=1`**——哈希前把上表 6 个新键名映射回旧名、剔除新增
`exRefundFreeCap`，键位置不变，其它对象原样（lead 已在 HEAD 上验证开关透明：带开关对 A 零差）。**本卡零差判据 = 带
`PERF_KEY_ALIAS=1` 跑出的 dump/rowsnap 对 A 零差**；另附不带开关的一次结果（预期全量 DIFF，仅作「键确实改了」的旁证）。
合入后 lead 不带开关重生成 dump-A / rows-A。字段映射、步骤、闸门其余不变。

### CC-6d · 维琳娜风蚀迁引擎能力（review）

**lead 设计（2026-09-25 lead-arena-0925c，替代设计稿 §3.4）**。现状（@4fa05c8 实测）：`4ca47db` 已把风蚀认人收敛为
`velina.ts#resolveVelinaCorrosion(panels, turbulenceCount, windTriggerCount, fallbackRate?)`——按 `panel.velinaEnabled` 认人，队里没有维琳娜返回 `undefined`。
core 只剩两处对它的**值导入**：`anomalyPool.ts:10`（调用点 `:332`，终局按最终乱流次数重结算）与 `anomalyPool/helpers.ts:55`（调用点 `calcTurbulenceDamage` 内 `:1210`）。
anomalyPool 已有现成的能力通道 `input.agentMechanics`（同 `transformAnomalyPool` 的用法，`anomalyPool.ts:99`）；
**生产调用方传的是全部已注册模块** `getRegisteredAgentMechanics()`（`convergence.ts:128`），不只本队 ⇒ 维琳娜模块恒在列表，由它自己按面板标记认人 ⇒ 逐位等价。

① **先读**：`src/mechanics/agents/velina.ts` 100–160；`src/core/anomalyPool.ts` 90–110、300–345；`src/core/anomalyPool/helpers.ts` 1185–1215 与 `AnomalyPoolInput`（约 270–315）；
`src/mechanics/types.ts` 的 `AgentMechanicModule`（`transformAnomalyPool?` 与 CC-6b 新加的 `curtainTriggers?` 附近）；`src/core/__tests__/anomalyPool.test.ts` 50–180；`src/composables/__tests__/ccD3D1Verdict.test.ts` 头注释。

② **形状（照做）**：
- `types.ts` 加 `anomalyCorrosion?(input: { panels: readonly PanelValues[]; turbulenceCount: number; windTriggerCount: number; fallbackRate?: number }): VelinaCorrosionSource | undefined`，
  JSDoc 写明：纯函数；返回 `undefined` = 本模块不认领 / 队里没有该资源持有者；同一队至多一个模块返回非 undefined。
- `velina.ts` 的模块声明 `anomalyCorrosion: ({ panels, turbulenceCount, windTriggerCount, fallbackRate }) => resolveVelinaCorrosion(panels, turbulenceCount, windTriggerCount, fallbackRate)`。
  ⚠ `fallbackRate` 必须**原样透传**（包括 `undefined`）：helpers 调用点传的是 `config.velinaCinema2CorrosionRate`，可能为 undefined，靠 `resolveVelinaCorrosion` 的默认参数 `2/3` 兜底；不许在引擎侧补默认值。
- 新文件 `src/core/anomalyPool/corrosion.ts`：`resolveAnomalyCorrosion(agentMechanics: readonly AgentMechanicModule[] | undefined, panels, turbulenceCount, windTriggerCount, fallbackRate?)`
  = 按列表顺序取第一个非 undefined 结果，都没有返回 `undefined`。只许 `import type` 角色相关类型，不写 agentId、不 import 角色模块。
- `anomalyPool.ts:332` 改为 `resolveAnomalyCorrosion(input.agentMechanics, …)`；`calcTurbulenceDamage` **末尾**加可选参数 `agentMechanics?`（唯一调用方 `anomalyPool.ts:319`，同步传 `input.agentMechanics`），`:1210` 改走 `resolveAnomalyCorrosion`。
- 删两处 `resolveVelinaCorrosion` 值导入。棘轮：core 角色 import 2→0（`layer-import-ratchet.mjs` 基线 + `RATCHET_BURNDOWN.frozen` 同步，写沿革）；core agentId 基线 3 **不变**。
- 已知语义差（lead 已核，可接受）：调用方**不传** `agentMechanics` 且面板带 `velinaEnabled` 时，旧式仍会结算风蚀、新式不结算。仓库内唯一不传的调用方是
  `src/core/anomalyPool/__tests__/onStunBuildup.test.ts`，其面板无 `velinaEnabled` ⇒ 两边都是 undefined。在 `corrosion.ts` 头注释写明这一点。
- **证伪闸门（动手前与收工前各跑一次）**：`grep -rn "anomalyCorrosion" src/mechanics/agents/` 只命中 velina。若 `anomalyPool.test.ts` / `ccD3D1Verdict.test.ts` 任一红 ⇒ 报 blocked，**不许改测试**。

③ **验收**：§4 全套（dump 用 `d97a8b0` 代次的 A）+ rowsnap +
`npx vitest run src/core/__tests__/anomalyPool.test.ts src/composables/__tests__/ccD3D1Verdict.test.ts src/mechanics/__tests__/velina.test.ts src/core/anomalyPool/__tests__/`。
**反向验证**：临时注释掉 velina 的 `anomalyCorrosion` 声明跑 dump ⇒ 带 1561 的场景必须非零差异，记条数后**恢复**，再跑一次 dump 确认回到零差异。

④ **报告**：改动行、两次闸门 grep 输出、棘轮新旧值、反向验证差异条数（列出场景键前 10 个）、§4 + rowsnap 尾部输出。

### CC-6c · 比利 / 叶瞬光 / 伊德海莉终局整数重推迁引擎能力（review）

**lead 重核（2026-09-25 lead-arena-0925c，@83861c3）**：设计稿 §3.3 的能力形状、执行器 `runFinalizePasses`、两个 stage 不合并、复位在装配后——**成立**，照做；
但它的行号全部过期、且 **reset 语义写错一处**（见②第 3 条）。当前代码位置：
- preTail 执行器 = `src/core/resource.ts` 闭包 `runBillyFinalize`（约 467–523）：1531 按 `agentId === '1531' && billyAxisActive !== 1` 筛（约 474）、1431 按 `yeshuguangContinuousForms === 1` 筛；
  两类**一起** begin、共用一个 ≤12 轮 10 字段逐位判稳循环，稳定才 `converged = true`。调用点：正常轨迹约 527、截断重折环约 1028（`runFoldLoop` 之后）。
- tail 执行器 = 约 668–705 伊德海莉块（`findIndex(c => c.yidhariContinuousEx === true)`），位于 `runTailPipeline` 内，在热启动回写 `storeWarmStart` 与 CC-6b 帷幕折算**之前**；重折环经 `runTailPipeline()` 自动重跑，无需另改。
- 复位 = 约 1074–1082（装配之后）。
- 三个模块各只注册自己（`starlightBilly.ts:867` / `yeshuguang.ts:761` / `yidhari.ts:440` 的 `agentIds` 均为单元素，lead 已核）。

① **先读**：`.zc/reports/CC-6-design.md` §3.3（b）（c）（e）；上面列出的 resource.ts 三段；`src/mechanics/types.ts` 的 `AgentMechanicModule`；三个角色模块的 mechanic 定义。

② **硬约束**：
1. 能力形状照设计稿：`finalizePass?: { stage: 'preTail' | 'tail'; applies(cfg): boolean; begin(cfg): void; reset(cfg): void }`；新文件 `src/core/resource/finalizePasses.ts`
   导出 `runFinalizePasses(configs, states, stage, iterate, config) → { states, converged }` 与 `resetFinalizePasses(configs)`；`iterate` **参数注入**（不 import helpers.ts）。
2. `applies` 逐位对齐原筛选：1531 = `Number(billyAxisActive ?? 0) !== 1`（`agentId` 那层由「只有 1531 模块被问到」保证）；1431 = `Number(yeshuguangContinuousForms ?? 0) === 1`；1051 = `cfg.yidhariContinuousEx === true`。
3. ⚠ **reset 必须保留原来的不对称**（设计稿写成「对所有声明者无条件 reset」是错的）：原代码对 **1531 / 1051 无条件**写 `false`（不看 applies，哪怕 begin 从没跑过），
   对 **1431 只在 `yeshuguangContinuousForms === 1` 时**写 `false`（否则字段保持 undefined）。⇒ `resetFinalizePasses` 对每个声明了 `finalizePass` 的 cfg 都调 `reset`，
   由**模块自己**决定：billy / yidhari 的 reset 无条件写 false；yeshuguang 的 reset 内部先判 `yeshuguangContinuousForms === 1` 再写。写错会让 undefined→false 漂进 cfg，可能进 hash / 热启动键。
4. 执行器：`targets` 为空直接返回 `{ states, converged: false }`（不调 iterate）；判稳 = 原 10 字段逐位 `!==`，≤12 轮；调用点 `if (fp.converged) converged = true`（不许写成 `converged = fp.converged`）。
5. 删 resource.ts 的 3 处 `'1531'` / `'1051'` 字面量；棘轮 core agentId 3→0（`agent-branch-ratchet.mjs` 基线 + `RATCHET_BURNDOWN.frozen` 同步，写沿革）；core 角色 import 不变（0）。
6. 证伪闸门（动手前与收工前）：`grep -rn "finalizePass" src/mechanics/agents/` 收工时恰命中 starlightBilly / yeshuguang / yidhari 三个；动手前为 0。

③ **验收**：§4 全套 + rowsnap + `npx vitest run src/mechanics/__tests__/billySmoke.test.ts src/core/__tests__/truncationRefold.test.ts src/composables/__tests__/seedInvariance.test.ts src/core/__tests__/warmStart.test.ts src/composables/__tests__/convergenceProbe.test.ts`
（再加 `ls src/mechanics/__tests__ | grep -i -E 'yeshuguang|yidhari|billy'` 列出的全部）。
**反向验证**（两次，各自恢复并以零差异证明）：① 临时把 yidhari 的 `stage` 改成 `'preTail'` ⇒ 带 1051 的场景非零差异（证明 stage 不可合并）；② 临时注释掉 yeshuguang 的 `finalizePass` ⇒ 带 1431 的场景非零差异。

④ **报告**：改动行、闸门 grep、棘轮新旧值、两次反向验证差异条数与前 10 个场景键、§4 + rowsnap 尾部输出。


### CC-11a · convergence 轮输入簇 / 终结喧响纯函数 / 轮结果类型外提（review）

**lead 设计（2026-09-25 lead-arena-0925c，@3d8350d 实测）**。CC-11 拆刀：**11a 纯搬 C1/C2/C3**（本卡）→ 11b `runCalcRound` 引入 `RoundCtx` 按 C4–C10 簇拆（待 lead 设计，工人 C 簇表见 `/home/kaua/calc-arch/C-outer.md` §4.5，行号需按 11a 后重测）。
现状：`src/composables/resourceCalc/convergence.ts` 1505 行，三块与 `runCalcRound` 本体（`createRunCalcRound` :437–1505）**零值级耦合**：
| 簇 | 行 | 内容 | 目标 |
|---|---|---|---|
| C1 | :1–13 文件头 + :35–330 | `createConvergenceRoundInputs(deps)` 工厂（含 `computed`，每实例一份） | `roundInputs.ts` |
| C2 | :331–351（含 :332–343 文档注释） | `resolveAxisUltimateDecibelCost` 纯函数；**唯一生产调用点 = C1 内 :244** | `roundInputs.ts`（随唯一消费者） |
| C3 | :403–436（含 :403 注释） | `export interface CalcRoundResult` | `roundResult.ts` |
lead 已核事实：
- :437–1505 **不引用** `createConvergenceRoundInputs` / `resolveAxisUltimateDecibelCost`（grep 仅 :244/:344）；`runCalcRound` 只用类型 `ComputedRef`（deps 签名）⇒ 11a 后 convergence.ts 对 `vue` 只剩 `import type`。
- 外部消费面：`useResourceCalc.ts:17`、测试 `nextRoundFeedbackR19/R20`、`ysgLoopTraceProbe`（值 import 两工厂）、`peiluo.test.ts:62`（动态 `import('@/composables/resourceCalc/convergence')` 取 C2）、`outerCyclePick.test.ts` / `solveTeam.ts` / `outerCycle.ts`（`import type CalcRoundResult`）⇒ convergence.ts **原名 re-export**，这 8 个文件**一行不改**。
- check-guards 绑定 convergence.ts 的只有 debt 键 `convergence.ts:轮换动作覆盖实数化`（标记在 :1156，属本体，不动）与锚 `convergence.ts#createRunCalcRound`（不动）。C1–C3 区域**无** `@fact` / `debt:`。
- C1 含 `'1051'`/`'1041'` 身份字面量（:301/:311）与 sigrid/hugo 模块 import：agentId 棘轮按整个 `resourceCalc/` 目录计 ⇒ 随搬读数不变；`role-import` 护栏若按文件列举则报告读数（不许改基线，变化即 blocked）。
- `tsconfig.app.json` 开 `noUnusedLocals` ⇒ `npm run build` 会抓死 import。

① **先读**：convergence.ts 1–440（分段）；`C-outer.md` §4.5；`git show 740290d --stat`（同目录搬迁先例）。

② **做法**：
1. 新建 `src/composables/resourceCalc/roundInputs.ts`：文件头 = 原 :1–13 注释（首行改为「收敛轮输入 helpers（CC-11a 2026-09-25 自 `convergence.ts` 原样迁入；此前 #10 自 useResourceCalc 迁入 convergence）」，其余原样）→ C1/C2 需要的 import（从原 :14–33 与 :352–401 中**只取用到的**，注释随行）→ C1 :35–330 原样 → C2 :331–351 原样。
2. 新建 `src/composables/resourceCalc/roundResult.ts`：C3 需要的 `import type` → :403–436 原样。
3. convergence.ts：删除上述三块；新文件头（≤10 行）写「单轮计算工厂 `createRunCalcRound`；轮输入 → `./roundInputs`、轮结果类型 → `./roundResult`（CC-11a）；本体 RoundCtx 拆分见 CC-11b」；加
   ```ts
   export { createConvergenceRoundInputs, resolveAxisUltimateDecibelCost } from './roundInputs'
   import type { CalcRoundResult } from './roundResult'
   export type { CalcRoundResult } from './roundResult'
   ```
   删除只被三块使用的 import（build 会报；逐个核）；`import { computed, type ComputedRef } from 'vue'` 收窄为 `import type { ComputedRef } from 'vue'`。:352–365 的「5 个 compute*NextRoundFeedback 已迁出」注释块与 `DECIBEL_ROUND_THRESHOLD` 留在 convergence.ts（本体用）。
4. 禁止：改任何表达式 / 注释内容（除第 1、3 步写明的文件头）/ 成员顺序；改 8 个消费者文件；改棘轮基线；新建子目录。

**证伪闸门**：前提 =「C1–C3 与本体零值级耦合」。可观察失败 = build 报本体引用了被搬走的符号 / dump 或 rowsnap 非零差 / check-guards 任何读数变化（停下 blocked）。
收工：`grep -c "export function createRunCalcRound" convergence.ts` = 1；`grep -cE "from 'vue'" convergence.ts` 的那一行必须是 `import type`；三文件行数之和 ≈ 1505 + 新增头/import 行（报告写明）。

③ **验收**：§4 全套 + dump + rowsnap + `npm run check-guards` + `npm run build` +
`npx vitest run nextRoundFeedback ysgLoopTraceProbe peiluo outerCyclePick solveTeamPurity convergence roundThreads src/scripts/__tests__/`（报告列实际文件数）。
**反向验证**（各自恢复并以 dump 零差证明）：① `roundInputs.ts` 里 C2 临时恒 `return 3000` ⇒ `peiluo.test.ts` 红（证明 re-export 接的是新实现）；② `roundInputs.ts` 的 `expandExecutedToCounts` 首行临时 `return executed` ⇒ dump 非零差（证明 C1 是活的且被 useResourceCalc 经 re-export 调用）。

④ **报告**：三文件行数、convergence.ts 删除的 import 清单、check-guards 全部读数前后、两次反向验证结果、§4 + dump/rowsnap 尾部。

**结项（lead 复核 2026-09-25）**：lead 逐行比对删除 348 行（差异仅按卡改写的文件头首行、一行 import 拆分）；三文件 get_diagnostics 0；check-guards 全读数不变（agentId 3/3、@fact 146/146、debt 6/6）。反向 ① C2 恒 3000 ⇒ peiluo 红（expected 3000 to be 2000）；② `expandExecutedToCounts` 短路 ⇒ dump DIFF 41。独立复跑 dump/rowsnap 624 零差、verify 3493 passed / 29 skipped。工人过程中自查出报告里编造的耗时数字并重跑取真值——提示词继续保留「附每条验收命令的尾部输出」。

### CC-T1 · rowsnap 补「失衡轴 × 尾段角色」变体（fast，低级模型可做）

**lead 设计（2026-09-25 lead-arena-0925c）**。背景：CC-9a 反向 ①（`emitAnomalyRows` 传 `isAxis:false`）在 rowsnap 上**零差**——现有 624 场景 = 预设 × {default,c0,c6,w,heavy,heavyGate}，**全部 `useStunAxis=false`**，尾段角色的轴内分支从未被快照覆盖（只有 `inStunAttribution.test.ts` 兜底）。
⚠ `.zc/perf/` 被 `.gitignore:42` 忽略 ⇒ 本卡改的是**本机测试基建**，无仓库提交；产物是新基线文件 + 报告。

① **先读**：`.zc/perf/rowsnap.perf.ts` 全文（~55 行）；§4 的 rowsnap / 比对命令；`src/stores/config.ts:519`（`useStunAxis`）；`src/composables/resourceCalc/damagePool.ts` 中 `const isAxis =` 一行（轴判据 = `(useStunAxis || autoActive) && stunAxisResult`）。

② **做法**：
1. 只改 `.zc/perf/rowsnap.perf.ts`（**不改** `dump.perf.ts`——dump 基线不动）：在每个预设的变体序列**末尾**（`heavyGate` 复位之后）追加
   ```ts
   if (/\b(1171|1261|1401|1581)\b/.test(p.id.replace(/-/g, ' '))) {
     const ax = config.useStunAxis
     config.useStunAxis = true; snap(`${p.id}/axis`)
     config.useStunAxis = ax
   }
   ```
   （1171 柏妮思 / 1261 简 / 1401 爱丽丝 / 1581 蕾米埃尔 = `damagePoolAnomaly.ts` 尾段的角色块。）
2. 生成新基线：`PERF_OUT=/home/kaua/calc-arch/rows-A2.json npx vitest run --config .zc/perf/vitest.perf.config.ts rowsnap`。
3. **旧键不变证明**：用 §4 比对脚本思路写一次性 node 比对，只比 `rows-A.json` 的键：rows-A2 在这 624 个键上必须与 rows-A **逐值相等**（证明追加变体不扰动其它场景）；新增键数 = N（报告写明，应 > 0）。
4. **判据生效证明（本卡主判据）**：临时把 `src/composables/resourceCalc/damagePool.ts` 里 `emitAnomalyRows({... isAxis: Boolean(isAxis) ...})` 改为 `isAxis: false`，跑 rowsnap 到 `rows-T.json`，与 rows-A2 比对 ⇒ **必须非零差，且差异键全部以 `/axis` 结尾**（报条数与前 10 键）。**恢复**后再跑一次，与 rows-A2 零差。
   若仍零差：说明 `useStunAxis=true` 下 `stunAxisResult` 为空或这些预设无轴块——**不要**改业务代码，写 STATUS: blocked，附：一个 `/axis` 场景的 `calc.stunAxisResult.value` 是否为 null（可在 perf 里临时 console.log）。
5. 通过后：`mv rows-A2.json rows-A.json`（旧文件先备份为 `old/rows-A-624.json`），并在 §4 rowsnap 说明处由 lead 更新场景数（工人只在报告里写新场景数，**不改 docs**）。

③ **验收**：第 3、4 步两项比对输出；`git status` 显示仓库**无**已跟踪文件改动（damagePool.ts 已恢复）。
④ **报告** `.zc/reports/CC-T1.md`：新增键数与列表前 20、旧键逐值相等输出、反向输出、恢复后零差输出。

**v2 修订（lead 2026-09-25，据首派报告 `.zc/reports/CC-T1.md` §5）**：首派 13 个 `/axis` 场景与 `/default` 逐字节相同 ⇒ blocked。原因（工人探针实测）：13/13 `stunAxisResult = null`——这些队无 `stunAxisPresetId`、`selectAutoStunAxisPreset` 无命中，`applyTeamToStore` 不写 `stunAxes`，而 `useResourceCalc.ts#stunAxisResult` 过滤掉 `actions` 为空的轴后为空即返回 null。
v2 做法（替换第 1 步的变体体）：
```ts
if (/\b(1171|1261|1401|1581)\b/.test(p.id.replace(/-/g, ' '))) {
  const ax = config.useStunAxis, axes = config.stunAxes
  config.stunAxes = [{ name: 'T1', actions: [{ slot: 0, moveId: 'basic', count: 3 }] }]
  config.useStunAxis = true; snap(`${p.id}/axis`)
  config.useStunAxis = ax; config.stunAxes = axes
}
```
（`moveId: 'basic'` 单位 = 秒，是 `StunAxisAction` 正式支持的形态，见 `types/resource/pools.ts:326`。）先在 perf 里临时 `console.log(calc.stunAxisResult.value !== null)` 确认 13/13 为 true 再跑第 2–5 步；若 `config.stunAxes` 需经 store action 写入（直接赋值不生效），改用该 action 并在报告写明。其余步骤、判据不变。

### CC-10 · `solveTeam` 抽离 Vue：`computeCalcOutput` 外提 `resourceCalc/solveTeam.ts`（review）

**lead 设计（2026-09-25 lead-arena-0925c，@9f8cf0a 实测）**。现状：`useResourceCalc.ts`（1189 行）的 `computeCalcOutput()` 在 **:248–654**，内嵌外层不动点 `runOuterLoop`（:276）与 S3 可行化 `stageResolveFeasibility`（:479），被 `calcOutput` computed（:214，含 LRU memo）调用。
lead 已扫 :249–653 对 composable 的全部依赖（脚本 `/home/kaua/calc-arch/scan10*.sh`）：
- **读**：`configStore.enemy.{stunCountLock,battleTime,invincibleTime}`（:251/:253，只在开头 3 个 const 里）、`computeWindowDuration()`（:252）、`resourceConfig.value?.interactionScaleMonotone / interactionScaleCeiling`（:575/:576/:599）、`runCalcRound(...)`（:364，composable 在 :838 用 `createRunCalcRound` 建）；模块级常量 `MAX_OUTER_ITER` / `OUTER_STUN_TOLERANCE`。
- **写**：**唯一副作用** :624–626 `if (monotoneGate && interactionScale !== undefined) configStore.interactionScaleCeiling = Math.min(configStore.interactionScaleCeiling, interactionScale)`——它是 `stageResolveFeasibility` 的最后一条语句，之后到 :654 再无 `resourceConfig`/`configStore` 读；core 不读 `interactionScaleCeiling`（全仓只有 :141 组装与 :576 读）⇒ **推迟到 solveTeam 返回后由 composable 执行，读写时序不变**。
- 其余 import 全是纯函数（`netFrontlineOccupation`、`outerCycle.*`、`feasibilitySearch.*`、`roundThreads.*`、`TIME_BUDGET_TOLERANCE_SECONDS`、`CalcRoundResult`）；**无** `vue` / `toRaw` / `catalogStore` / memo 引用。
- `@fact engine:降配档单调闸门`（:568）锚 `useResourceCalc.ts#stageResolveFeasibility`，**不在** `CALIBER_TRIGGER_ALLOWLIST` ⇒ 随代码搬走、锚改 `src/composables/resourceCalc/solveTeam.ts#stageResolveFeasibility`（check-guards 会验 file/symbol 存在；先例 = check-guards.mjs:179 `engine:轴内块数落地` 锚随实现迁移）。

① **先读**：`useResourceCalc.ts` 1–100、106–147、200–660、715–726、830–850；`resourceCalc/convergence.ts` 中 `createRunCalcRound` 的签名与返回类型；`difficultyDescent.test.ts` 100–140（闸门判据）。

② **做法**：
1. 新建 `src/composables/resourceCalc/solveTeam.ts`（**不许** import `vue` / `pinia` / `@/stores/*` / `useResourceCalc`）：
   ```ts
   export type RunCalcRound = ReturnType<typeof createRunCalcRound>   // import type
   export interface SolveTeamInput {
     runCalcRound: RunCalcRound
     lockedStunCount: number          // 原 :251
     stunWindowDur: number            // 原 :252
     stunEffTime: number              // 原 :253
     resourceConfig: ResourceCalcConfig | null   // = resourceConfig.value；函数体内原 `resourceConfig.value?.x` 改为 `resourceConfig?.x`（仅此机械替换，=== true / 真值口径各自照旧）
   }
   export interface SolveTeamResult {
     out: <原 computeCalcOutput 返回类型>
     /** 闸门写回：非 null ⇒ 调用方执行 configStore.interactionScaleCeiling = Math.min(当前值, 该值) */
     ceilingWriteBack: number | null
   }
   export function solveTeam(input: SolveTeamInput): SolveTeamResult
   ```
   函数体 = 原 :254–653 **原样**（从 `AXIS_FALLBACK_TOLERANCE_SEC` 到 `return out` 之前的全部，含 `runOuterLoop` / `stageResolveFeasibility` / 注释 / `@fact` 行）。唯二改动：
   - `resourceConfig.value?.` → `resourceConfig?.`（3 处）；
   - :624–626 的 store 写改为 `if (monotoneGate && interactionScale !== undefined) ceilingWriteBack = interactionScale`（外层 `let ceilingWriteBack: number | null = null`），末尾 `return { out, ceilingWriteBack }`。
   `MAX_OUTER_ITER` / `OUTER_STUN_TOLERANCE`：若 useResourceCalc.ts 其余位置不再使用 ⇒ 整体搬进 solveTeam.ts（连注释）；若仍用或被测试 import ⇒ 在 solveTeam.ts 定义并 export，useResourceCalc.ts 改 `import` + 原名 re-export（**不许**反向 import useResourceCalc）。
2. useResourceCalc.ts 的 `computeCalcOutput()` 变薄（函数名与返回类型保持，memo 的 `ReturnType<typeof computeCalcOutput>` 不动）：
   ```ts
   function computeCalcOutput() {
     <原 :249–253 三个 const 原样>
     const { out, ceilingWriteBack } = solveTeam({ runCalcRound, lockedStunCount, stunWindowDur, stunEffTime, resourceConfig: resourceConfig.value })
     if (ceilingWriteBack !== null) {
       configStore.interactionScaleCeiling = Math.min(configStore.interactionScaleCeiling, ceilingWriteBack)
     }
     return out
   }
   ```
   删搬走后成死绑定的 import（逐个 grep 确认）。文件头 :69 附近关于「computed 内写回」的注释改一句指向新位置（语义不变）。
3. 新增 `src/composables/__tests__/solveTeamPurity.test.ts`：读 `solveTeam.ts` 源码断言不含 `from 'vue'` / `from 'pinia'` / `@/stores/` / `useResourceCalc`（抽离的意义 = 可脱 Vue 调用，用测试锁住）。
4. 禁止：改任何数值 / 条件 / 迭代顺序；改 memo 逻辑；改 `createRunCalcRound`；改棘轮基线。

**证伪闸门**：前提 =「:249–653 除上述依赖外不触碰 composable 状态、写回之后无读」。可观察失败 = TS 报出未列出的外层标识符（停下写 blocked 列出，**不许**自行扩 input）、dump/rowsnap 非零差、`difficultyDescent.test.ts` 红。

③ **验收**：§4 全套 + dump + rowsnap + `npm run check-guards`（`@fact anchors` 行计数不降）+ `npm run build` +
`npx vitest run difficultyDescent convergence outerCycle feasibility timeLedger solveTeamPurity useResourceCalc calcOutputMemo src/scripts/__tests__/`（报告列实际文件数）。
**反向验证**（各自恢复并以 dump 零差 + 该测试转绿证明）：① composable 临时不执行 `ceilingWriteBack` ⇒ `difficultyDescent.test.ts` 应红（报红的用例名）；② solveTeam 内临时跳过 `stageResolveFeasibility`（直接用 `r`）⇒ dump 非零差（报条数与前 10 键）。

④ **报告**：useResourceCalc.ts 行数前后、solveTeam.ts 行数、`@fact` 最终位置与锚、两常量去向、死绑定清单、反向验证结果、§4 + dump/rowsnap 尾部输出。

**结项（lead 复核 2026-09-25）**：lead 逐行比对删除行（差异仅 3 处 `.value` 机械替换、store 写→`ceilingWriteBack`、import、`@fact` 改锚、写回处一行注释改写）；三文件 get_diagnostics 0；`@fact` 3→0+3 全随实现迁移，check-guards 146/146；solveTeam 直接依赖（roundThreads/outerCycle/feasibilitySearch/core resource）均无 vue/pinia/stores。反向 ① 不执行写回 ⇒ difficultyDescent 1 红（0.25→0.375）；② 跳 S3 ⇒ dump DIFF 245。独立复跑 dump/rowsnap 624 零差、verify 3493 passed / 29 skipped。旁注：`zcWorkspace.test.ts` 高并发偶红一次（租约 TTL 计时竞态，单跑 8/8），与本卡无关，未立卡。

### CC-9b · damagePool 逐角色主循环三段外提（review）

**lead 设计（2026-09-25 lead-arena-0925c，@4a387e1 实测）**。承接 CC-9a（`72e0eb5`，尾段已外提）。现状：`damagePool.ts` 1141 行；`for (const charResult of adjustedResourceResult.characters)` 主循环在 **:415–1132**，循环头 :416–421 定义 4 个本槽局部量（`slot` / `agent` / `skills` / `liuyinSrc`），循环体按职责分三段、段间**无**跨段 `continue/break/return`（lead 已 grep）：

| 段 | 行 | 内容 | 目标 |
|---|---|---|---|
| D | :423–671 | 逐招直伤 `for (const exec …)`（含 `emitExecDirect` 闭包、`seenDirectIds` 去重）+ `if (isAxis)` 轴内直读技能表兜底 | `damagePoolDirect.ts#emitCharDirectRows` |
| R | :672–927 | `for (const event of charResult.anomalyEventExecutions …)` 异放/异常事件行 | `damagePoolRelease.ts#emitCharReleaseRows` |
| X | :928–1131 | 1171 柏妮思机制行 / 琉音额外能力 / 半月 C6 碎击附伤 / 琉音非轴块 | `damagePoolCharExtras.ts#emitCharExtraRows` |

lead 已核事实：
- 共享可变态只有 `rows`（push）、`seenDirectIds`（Map，:389 定义、:473–474 写）、`claimedInAxis`（Record，仅经 `axisSplitFor` 闭包写）——全是**原地变更的对象引用**，传引用即共享，无需 RowSink。
- 循环段内 `isAxis` 全部是真值用法（`if`/`!`/`&&` 条件/三元/`!!isAxis` 递进模块，:625 注释所说「原样递进」递的就是 `!!isAxis`）⇒ 同 9a 传 `Boolean(isAxis)`。**工人须复核**：若发现 `isAxis && …` 的**结果被赋值或作为非条件值使用**，改传原值并在报告写明。
- `@fact` 两条在 :144–145，不在范围内；check-guards 按行内容（非行号）锚定它们。agentId 棘轮按整个 `resourceCalc/` 目录计 ⇒ 字面量随代码搬，读数不变。`checkGuards.test.ts:371` 只断言 damagePool.ts 存在。
- 本卡**不动**辅助闭包（:116–413 的 `agentName` / `axisSplitFor` / `axisStunFor` / `pushDirect` / `pushRelease` / `releaseMultiplierFor` / 各 `*Fraction` / `releaseStunSegments` / `xixifuToxinInAxisFraction`）——它们留在入口、以函数引用进 env（CC-9c 再议）。

① **先读**：`damagePool.ts` 全文（分段 `sed`）；`damagePoolAnomaly.ts` 1–75（9a 的 env 形状，照抄风格）；`git show 72e0eb5 --stat`。

② **做法**：
1. 新建 `src/composables/resourceCalc/damagePoolDirect.ts`（**直属**），导出：
   ```ts
   export interface CharLocals { charResult: <原类型>; slot: number; agent: <原推断类型>; skills: <原推断类型>; liuyinSrc: <原推断类型> }
   export interface CharRowsEnv { ctx: DamagePoolContext; rows: DamagePoolRow[]; isAxis: boolean; /* + 三段实际用到的入口局部量与闭包，照原类型 */ }
   export function emitCharDirectRows(env: CharRowsEnv, cl: CharLocals): void   // 函数体 = :423–671 原样
   ```
   `damagePoolRelease.ts#emitCharReleaseRows(env, cl)`（:672–927）与 `damagePoolCharExtras.ts#emitCharExtraRows(env, cl)`（:928–1131）同形，`import type { CharRowsEnv, CharLocals } from './damagePoolDirect'`。
   三个函数**共用一个** `CharRowsEnv`（字段取三段并集，未用字段不解构即可）。各函数体开头：按 `damagePool.ts:97–105` **同名同别名**解构 `env.ctx` 中该段用到的字段 → 解构 env 其余字段 → 解构 `cl`；其余表达式、注释、顺序一字不改（只去公共缩进）。
2. damagePool.ts：循环改为
   ```ts
   const charEnv: CharRowsEnv = { ctx, rows, isAxis: Boolean(isAxis), /* … */ }
   for (const charResult of adjustedResourceResult.characters) {
     <:416–421 原样保留，含注释>
     const cl = { charResult, slot, agent, skills, liuyinSrc }
     emitCharDirectRows(charEnv, cl)
     emitCharReleaseRows(charEnv, cl)
     emitCharExtraRows(charEnv, cl)
   }
   ```
   `charEnv` 在循环**外**构造一次（各字段都是循环内不变的引用）。删除搬走后成死绑定的 import / ctx 解构字段（逐个 grep 确认）。9a 的 `emitAnomalyRows(...)` 调用不动。
3. env 字段准入：只允许 `const` 绑定、`function` 声明、或原地变更的对象（`rows`/`seenDirectIds`/`claimedInAxis`）。若某段**给入口的 `let` 重新赋值**，停下写 blocked（附行号）。
4. 禁止：改任何数值 / 条件 / 文案 / 块顺序；改辅助闭包；改棘轮基线；建子目录；把 `rows.push` 换成返回值拼接。

**证伪闸门**：前提 =「三段只经共享对象引用通信、段间无控制流耦合」。可观察失败 = rowsnap / dump 非零差异，或 TS 报出入口 `let` 被段内赋值（停下）。
收工 `grep -c "pushDirect(" / "pushRelease(" / "stunOverrideForMove"` 四个文件合计 = 改前 damagePool.ts 的读数（报告写前后）；`npm run check-guards` 编排层 agentId 读数不变。

③ **验收**：§4 全套 + **rowsnap（主判据）** + `npm run check-guards` + `npm run validate:specs` + `npm run build` +
`npx vitest run damagePool burnice liuyin banyue peiluo hugo yeshuguang inStunAttribution damageSourceBreakdown src/scripts/__tests__/`（报告列实际文件数）。
**反向验证**（三次，各自恢复并以 rowsnap+dump 零差异证明）：分别在 `emitCharDirectRows` / `emitCharReleaseRows` / `emitCharExtraRows` 函数体首行临时 `return` ⇒ 各自 rowsnap 非零差异（报条数与前 10 键）。
若某次**零差**：不要硬造，按 9a 先例用该段角色的单测（如 `burnice.test.ts`）做同改动活性证明，并在报告里标「rowsnap 覆盖缺口」。

④ **报告**：三新文件行数与 damagePool.ts 行数前后、`CharRowsEnv` 最终字段表（注明哪段用）、死绑定清单、`isAxis` 复核结论、闸门 grep 前后读数、三次反向验证结果、§4 + rowsnap 尾部输出。

**结项（lead 复核 2026-09-25）**：`740290d`。lead 逐行比对：删除行全部出现在三新文件中（差异仅 import / ctx 解构）；四文件 get_diagnostics 0；`isAxis` 全真值用法（工人复核同）；env 15 字段均为函数或原地变更对象。反向 ③ 三段首行 return ⇒ rowsnap DIFF 624 / 135 / 137（三段均被快照覆盖）。独立复跑 rowsnap/dump 624 零差、verify 3490 passed / 29 skipped。CC-9 系列收官（9c 不做）。

### CC-9a · damagePool 异常/附加伤害尾段外提 `damagePoolAnomaly.ts`（review）

**lead 设计（2026-09-25 lead-arena-0925c，@17fc318 实测）**。CC-9 拆刀：**9a 尾段**（本卡）→ 9b 逐角色主循环（:423–1141，约 700 行，待 lead 设计）→ 9c 轴占比闭包（:316–422）视 9b 形状再定。
现状：`src/composables/resourceCalc/damagePool.ts`（1727 行）只有一个函数 `buildDamagePoolRows`（:103–1727）。其尾段 **:1142–1725** 是一串互相独立、只往共享 `rows` 数组 `push` 的块：
风属性异常事件 / 乱流 / 紊乱明细 / 按元素异常累积（:1142–1357），然后 1171 C6 灼烧爆发、1401 极性强击、1261 C6、1401 C6、爱丽丝畏缩 DOT、1581 蕾米埃尔（:1358–1725）。:1726 `return rows.filter(...)`。
lead 已 grep：尾段用到的外层**局部量**只有 `rows`、`agentName`、`enemyDamageRes`、`isAxis`（只作真值判断）、`windSlot`、`inWindowFraction`、`nonWindInAxisFraction`、`ultimateInAxisFraction`，其余来自 ctx 解构（`allocMap` = `ctx.axisAllocation`、`stunCoverage` 等）。
**无 `@fact` 声明**在范围内（两条在 :152–153，不动）。agentId 棘轮按 `resourceCalc/` **直属文件合计**计数 ⇒ 字面量随代码搬到直属新文件，总数不变、基线不改。`DamagePoolRow` 定义在 `./helpers`（无环）。

① **先读**：`damagePool.ts` 1–125、300–425、1130–1727；`scripts/lib/agent-branch-ratchet.mjs` 40–70（直属文件口径）。

② **做法**：
1. 新建 `src/composables/resourceCalc/damagePoolAnomaly.ts`（**直属**，不建子目录）：
   ```ts
   export interface AnomalyRowsEnv {
     ctx: DamagePoolContext          // import type from './damagePool'（纯类型，运行时无环）
     rows: DamagePoolRow[]           // 共享输出数组：按原顺序 push，禁止换成返回值拼接
     agentName: (agentId: string, slot: number) => string
     enemyDamageRes: Record<string, number>   // 类型照原局部量推断结果写，不收窄不放宽
     isAxis: boolean                 // 调用处传 Boolean(isAxis)（尾段只作真值判断，lead 已核）
     windSlot: number
     inWindowFraction: (element: string) => number
     nonWindInAxisFraction: () => number
     ultimateInAxisFraction: (slot?: number) => number
   }
   export function emitAnomalyRows(env: AnomalyRowsEnv): void
   ```
   函数体 = :1142–1725 **原样搬**：开头按 `damagePool.ts:105–112` 的**同名同别名**解构 `env.ctx` 中尾段实际用到的字段，再解构 env 里的局部量，其余表达式一字不改；注释随搬；所需 import 从 damagePool.ts 照抄（只拿用到的）。
2. damagePool.ts：原 :1142–1725 换成 `emitAnomalyRows({ ctx, rows, agentName, enemyDamageRes, isAxis: Boolean(isAxis), windSlot, inWindowFraction, nonWindInAxisFraction, ultimateInAxisFraction })`；
   删搬走后成死绑定的 import / 局部量（逐个 grep 确认；**`windSlot` 等若主循环仍用则保留**）。
3. 若 TS 报尾段还用到未列出的外层局部量：**可以**加进 `AnomalyRowsEnv`（照原类型），在报告里列出；但若它是**可变**的（`let`、或尾段对它赋值/push 以外的写），停下写 blocked。
4. 禁止：改任何数值 / 条件 / 文案 / 块顺序；改 agentId 棘轮基线；建子目录。

**证伪闸门**：前提 =「尾段只读外层量、只经 `rows.push` 输出」。可观察失败 = rowsnap / dump 非零差异，或发现尾段写了外层可变量（停下）。
收工 `grep -cE "findSlotByIdentity\(" src/composables/resourceCalc/damagePool.ts src/composables/resourceCalc/damagePoolAnomaly.ts` 两文件之和 = 改前 damagePool.ts 的计数（报告写前后数）；`npm run check-guards` 的编排层 agentId 读数不变。

③ **验收**：§4 全套 + **rowsnap（本卡主判据：行文案/顺序）** + `npm run check-guards` + `npm run validate:specs` + `npm run build` +
`npx vitest run burnice remielle alice jane specialMechanics inStunAttribution damageSourceBreakdown damagePool src/scripts/__tests__/`（名字过滤，报告列出实际跑到的文件数）。
**反向验证**（两次，各自恢复并以零差异证明）：① 调用处临时传 `isAxis: false` ⇒ rowsnap 非零差异（证明 env 接线生效）；② `damagePoolAnomaly.ts` 里临时在 1581 蕾米埃尔块前 `return` ⇒ rowsnap 非零差异（证明搬过去的末块是活的）。

④ **报告**：改动行、damagePool.ts 行数前后、新增进 env 的字段（如有）、死绑定清单、闸门 grep 前后读数、两次反向验证差异条数与前 10 个键、§4 + rowsnap 尾部输出。

**结项（lead 复核 2026-09-25）**：env 比草案多 `axisStunFor` / `pushRelease` 两个只读函数声明（lead 核：均为 `function` 声明，无可变外层量）。反向 ② 蕾米埃尔块前 return ⇒ rowsnap DIFF 36。
反向 ① `isAxis:false` 在 rowsnap 上**零差**——624 预设不含「轴 × 尾段敏感角色」组合，尾段 `isAxis` 分支在快照面恒走非轴臂；工人改用 `inStunAttribution.test.ts` 同改动 3 红作活性证明。
**覆盖缺口备忘**：rowsnap 预设集对尾段轴内分支无覆盖，9b 若动轴占比闭包需先补预设或改用单测为判据。

### CC-5d · 截断重折环外提 `truncationRefold.ts`（review）

**lead 设计（2026-09-25 lead-arena-0925c，@01f33ef 实测）**。原「重折环外提 + 编排器」只做**重折环**；「`calcTeamResources` 收成编排器（`SolveContext`）」改为 CC-5e，5d 合入后按剩余行数再评估是否值得做。
现状：`resource.ts` **:317–394** = 头注释（:317–327）+ `ROW_REFOLD_MAX_PASSES` / `truncationRefoldPasses` / `truncationRefoldRejected` / `lastLimits` / `restoreCfgs` / `resetDiagnostics`（:328–342）+ 重折循环（:343–393）+ `delete cfg.rowTimeLimit`（:394）。
循环读写外层 `states` / `diag` / `tail`，写 cfg（`restoreCfgs` 清键 + assign 保对象同一性、`rowTimeLimit`、`timeBudgetExcess`）与 `config.timeBudgetRefund` / `config.overflowSeconds`；
每轮「从 S2 入口重跑」= `resetDiagnostics()` → `runFoldLoop(s2EntrySeedStates 拷贝)` → `runPreTailFinalize` → `runTailPipeline()`，三个包装都在调用时读外层 `diag`。
范围内**无 `@fact` 声明**（最近的 `@fact engine:资源账本/截断` 在 :408，不动），lead 已 grep 核过。输出读数：`truncationRefoldPasses` / `truncationRefoldRejected` 被返回值（:463–465）消费。

① **先读**：`src/core/resource.ts` 280–470；`src/core/resource/tailPipeline.ts` 的 `TailResult`；`src/core/resource/solveDiagnostics.ts`；`src/core/__tests__/truncationRefold.test.ts` 头注释。

② **做法**：
1. 新建 `src/core/resource/truncationRefold.ts`：
   ```ts
   export interface TruncationRefoldContext {
     configs: CharacterOperationConfig[]; config: ResourceCalcConfig
     s2EntryCfgs: CharacterOperationConfig[]      // resource.ts 的 s2EntryCfgs（入口态浅拷贝）
     s2EntrySeedStates: IterationState[]
     toleranceSeconds: number                     // = TIME_BUDGET_TOLERANCE_SECONDS（常量带 @fact，留 resource.ts 注入）
     /** 从 S2 入口重跑到装配：调用方把外层 diag 换成传入的 d，再跑 fold → preTail 终推 → 尾段；返回重跑后的 states 与 tail */
     rerun: (d: SolveDiagnostics, seed: IterationState[]) => { states: IterationState[]; tail: TailResult }
   }
   export interface TruncationRefoldResult {
     states: IterationState[]; diag: SolveDiagnostics; tail: TailResult
     passes: number; rejected: boolean
   }
   export function runTruncationRefold(ctx: TruncationRefoldContext, init: { states: IterationState[]; diag: SolveDiagnostics; tail: TailResult }): TruncationRefoldResult
   ```
   函数体 = :317–394 **原样搬**（头注释进 JSDoc；`ROW_REFOLD_MAX_PASSES`、`restoreCfgs` 成为本文件模块级 const / 函数），机械替换：
   - 开头 `let { states, diag, tail } = init`、`let truncationRefoldPasses = 0` 等照旧；
   - 「`resetDiagnostics()` + 两行 `states = runFoldLoop/runPreTailFinalize` + `const trial = runTailPipeline()`」→
     `diag = createSolveDiagnostics(); const r = ctx.rerun(diag, ctx.s2EntrySeedStates.map(s => ({ ...s }))); states = r.states; const trial = r.tail`
     （**顺序保持**：restoreCfgs → 写 rowTimeLimit → timeBudgetExcess=0 → config.timeBudgetRefund=0 → 新 diag → 重跑）；
   - `accepted` 快照与拒绝还原逐字保留（`diag = accepted.diag` 等）；
   - `delete cfg.rowTimeLimit` 循环留在函数末尾（return 前）；返回 `{ states, diag, tail, passes: truncationRefoldPasses, rejected: truncationRefoldRejected }`。
   **不得 import `../resource`**。
2. resource.ts：原 :317–394 换成
   ```ts
   const refold = runTruncationRefold({
     configs, config, s2EntryCfgs, s2EntrySeedStates, toleranceSeconds: TIME_BUDGET_TOLERANCE_SECONDS,
     rerun: (d, seed) => {
       diag = d                                   // 三个包装在调用时读外层 diag
       states = runFoldLoop(seed)
       states = runPreTailFinalize(states)
       const t = runTailPipeline()                // 包装内部会把 states 写回
       return { states, tail: t }
     },
   }, { states, diag, tail })
   states = refold.states; diag = refold.diag; tail = refold.tail
   const truncationRefoldPasses = refold.passes
   const truncationRefoldRejected = refold.rejected
   ```
   `tail` 若因此不再被重新赋值可改 `const`，否则保持 `let`。:463–465 的返回值字段不变。删死绑定（`createSolveDiagnostics` 若 resource.ts 其他处仍用则保留——逐个 grep）。
3. 禁止：改数值 / 条件 / 顺序 / 容差（`1e-6`、`1e-3`、`ROW_REFOLD_MAX_PASSES = 3`）；把 `truncationBeforeRefold`（:315）搬走；动 `@fact`；建子目录。

**证伪闸门**：前提 =「重折环只经 `states`/`diag`/`tail`、上列 ctx 与 cfg/config 副作用通信，且 `rerun` 回调能逐位复现原三步」。可观察失败 = dump 非零差异，或 TS 报出未列出的自由变量（停下写 blocked 并列出）。
收工 `grep -nE 'restoreCfgs|ROW_REFOLD_MAX_PASSES|lastLimits|resetDiagnostics' src/core/resource.ts` 只允许命中注释。

③ **验收**：§4 全套 + rowsnap + `npm run check-guards` + `npm run validate:specs` + `npm run build` +
`npx vitest run truncationRefold timeFillRatchet warmStart seedInvariance determinism underfillRefund src/scripts/__tests__/`（报告列出实际跑到的文件数）。
**反向验证**（两次，各自恢复并以零差异证明）：① `truncationRefold.ts` 里临时删拒绝分支的 `restoreCfgs(accepted.cfgs)` ⇒ dump 非零差异（CC-4 已知 `auto-1431-1481-1491/heavyGate` 走拒绝路径）；
② 临时把接受判据的 `+ 1e-6` 改成 `- 1e9`（恒拒绝）⇒ dump 非零差异（进了重折环且被接受的场景变化）。

④ **报告**：改动行、resource.ts 行数前后、死绑定清单、闸门 grep、docs 待改清单、两次反向验证差异条数与前 10 个键、§4 + rowsnap 尾部输出。

### CC-5c · S3–S4 尾段管线外提 `tailPipeline.ts`（review）

**lead 设计（2026-09-25 lead-arena-0925c，@CC-5b 合入后实测）**。CC-5 原「5c」再拆：**5c 尾段管线**（本卡）→ **5d 重折环外提 + `calcTeamResources` 收成编排器**（待 lead 设计）。
现状：5a/5b 之后 `runTailPipeline` 闭包（`resource.ts:335–445`）只剩约 50 行代码：欠打回填 → 伊德海莉 tail 终推 → 热启动落缓存 → 帷幕 / 赠链 / 赠大 → `assembleSlot` 逐槽累加。
它**重绑定外层 `states`**（欠打回填与 tail 终推两处），且重折环依赖这一点：`accepted.states` 快照在 tail 之后取、拒绝时 `states = accepted.states` 还原（:491 / :518）。
模块级 `chainGiftRowSpec`（:56）/ `ultimateGiftRowSpec`（:68）只被它用。块内 / 两函数上**无 `@fact` 声明**（只有对 `@fact engine:赠送时间/轴模式四处同源` 的文字引用），lead 已 grep 核过。

① **先读**：`src/core/resource.ts` 40–90、200–215、265–275、325–530；`src/core/resource/underfillProbe.ts`、`assembleSlot.ts`（ctx 注入先例）；`src/core/resource/warmStart.ts` 的 `storeWarmStart`。

② **做法**：
1. 新建 `src/core/resource/tailPipeline.ts`：
   ```ts
   export interface TailPipelineContext {
     configs: CharacterOperationConfig[]; config: ResourceCalcConfig; totalTime: number
     probeCtx: UnderfillProbeContext
     warmExactKey: string; warmSeedStates: IterationState[]
   }
   export interface TailResult {
     characters: CharacterResourceResult[]; timeTruncatedSeconds: number
     truncationCuts: TruncationCut[]
     truncationBySlot: { slot: number; requested: number; kept: number; cutSeconds: number }[]
     inputStunCount: number; chainGiftTime: number; liuyinGiftTimeTotal: number
   }
   export function runTailPipeline(ctx: TailPipelineContext, diag: SolveDiagnostics, from: IterationState[]): { states: IterationState[]; tail: TailResult }
   ```
   函数体 = 闭包 :336–444 **原样搬**：开头 `let states = from` 并解构 `const { configs, config, totalTime, probeCtx, warmExactKey, warmSeedStates } = ctx`，末尾 `return { states, tail: { …原返回对象… } }`。
   `chainGiftRowSpec` / `ultimateGiftRowSpec` 连同其注释一起搬进本文件（不 export）。注释全部随搬。**不得 import `../resource`**。
2. resource.ts：建 `const tailCtx: TailPipelineContext = { configs, config, totalTime, probeCtx, warmExactKey, warmSeedStates }`；闭包换成**保语义包装**：
   ```ts
   const runTailPipeline = () => { const r = runTailPipelinePure(tailCtx, diag, states); states = r.states; return r.tail }
   ```
   （每次调用读 `diag` 与 `states`，并把新 `states` 写回外层——重折环的 `accepted.states` 快照 / 拒绝还原依赖它。）两个调用点（`let tail = runTailPipeline()`、重折环 `const trial = runTailPipeline()`）逐字不改。
   删搬走后成死绑定的 import（逐个 grep 确认）。函数头阶段表与其他 src 注释里的位置同步；docs/ 只在报告列清单。
3. 禁止：改数值 / 条件 / 顺序（尤其「tail 终推 → 热启动落缓存 → 帷幕/赠链」次序是 `@fact engine:热启动逐位透明` 的前提）；动重折环；建子目录。

**证伪闸门**：前提 =「尾段只经 `states`（入/出）、`diag`、上列 ctx 与 cfg/config 副作用通信」。可观察失败 = dump 非零差异，或 TS 报出未列出的自由变量（停下写 blocked 并列出）。
收工 `grep -nE 'chainGiftRowSpec|ultimateGiftRowSpec' src/core/resource.ts` 只允许命中注释。

③ **验收**：§4 全套 + rowsnap + `npm run check-guards` + `npm run validate:specs` + `npm run build` +
`npx vitest run truncationRefold warmStart seedInvariance determinism underfillRefund timeFillRatchet norma liuyin src/scripts/__tests__/`（名字过滤，报告列出实际跑到的文件数）。
**反向验证**（两次，各自恢复并以零差异证明）：① 临时把包装里的 `states = r.states` 删掉 ⇒ 报告差异条数（预期非零：重折被拒 / 欠打回填接受的场景读到旧 states；若为 0 如实写明）；
② 临时删 `tailPipeline.ts` 里 `storeWarmStart(...)` 调用 ⇒ 跑 `npx vitest run warmStart` 预期红（dump 不一定变，热启动逐位透明）；若不红，如实报告并写明 warmStart.test 实际覆盖了什么（不算失败，lead 裁决）。

④ **报告**：改动行、resource.ts 行数前后、死绑定清单、闸门 grep、docs 待改清单、两次反向验证结果、§4 + rowsnap 尾部输出。

### CC-5b · S4 `stageAssembleSlot` 外提 `assembleSlot.ts`（review）

**lead 设计（2026-09-25 lead-arena-0925c，@45d7e8a 实测）**。
现状：`runTailPipeline`（`resource.ts:335`）里的 `stageAssembleSlot`（**:430–604**）是逐槽装配闭包，已返回 `{ result, cutSeconds, cuts, bySlotEntry }`，由 :605–611 的 `configs.map` 累加。
自由变量（lead 已 grep 核过：块内**无** `diag`、无 resource.ts 常量、无 `chainGiftRowSpec`/`warm*`）：`configs`、`config`、`totalTime`、`states`、`curtain`（:374）、`curtainTriggers`（= `curtain.triggers`）、
`yidhariSlot`（:376）、`giftTimeOfSlot`（:410）、`chainGiftRow` / `ultimateGiftRow`（:415–420）；函数：helpers 的 `calcEnergySource` / `calcCrossAgentEnergy` / `calcRawDecibelParts` / `calcDecibelSource` /
`calcTimeAllocation` / `buildAnomalyEventExecutions` / `truncateExecutionsToFrontline`，以及 `buildGiftRow`（`./giftRows`）、`buildExecutionsWithPhase`（`./phaseExecutions`）、
`giftDecibelForCfg` / `findCrossAgentSupplySlots`（`./crossAgentSupply`）、`getAgentMechanic`、`isFrontlineExecution`。

① **先读**：`src/core/resource.ts` 80–95、335–620；`src/core/resource/underfillProbe.ts` 与 `foldLoop.ts`（ctx 注入先例）；`src/core/resource/curtain.ts` 20–40（`CurtainInfo`）。

② **做法**：
1. 新建 `src/core/resource/assembleSlot.ts`：
   ```ts
   export interface AssembleSlotContext {
     configs: CharacterOperationConfig[]; config: ResourceCalcConfig; totalTime: number
     states: IterationState[]            // 装配期终态（runTailPipeline 在此之前已完成全部 states 重绑定）
     curtain: CurtainInfo; yidhariSlot: number
     giftTimeOfSlot: (idx: number) => number
     chainGiftRow: { targetIdx: number; count: number }
     ultimateGiftRow: { targetIdx: number; count: number }
   }
   export function assembleSlot(ctx: AssembleSlotContext, cfg: CharacterOperationConfig, i: number) // 返回类型让 TS 推断（与原闭包一致）
   ```
   函数体 = 闭包 :431–603 **原样搬**：函数开头加 `const { configs, config, totalTime, states, curtain, yidhariSlot, giftTimeOfSlot, chainGiftRow, ultimateGiftRow } = ctx` 与
   `const curtainTriggers = curtain.triggers`，其余表达式**一字不改**（用解构而不是逐处 `ctx.x`，把 diff 压到最小）。注释全部随搬。
2. resource.ts：在 :420 之后（`ultimateGiftRow` 定义后、累加器前）建 `const slotCtx: AssembleSlotContext = { configs, config, totalTime, states, curtain, yidhariSlot, giftTimeOfSlot, chainGiftRow, ultimateGiftRow }`；
   `configs.map` 里 `stageAssembleSlot(cfg, i)` → `assembleSlot(slotCtx, cfg, i)`；删闭包。累加顺序、`characters` 的类型标注不变。
   搬走后变成死绑定的 helpers 解构项（`resource.ts:88` 那行）与 import 要删（否则 build 报 TS6133）；**只删确实无引用的**，逐个 grep 确认。
3. 函数头阶段表（:167）的 `stageAssembleSlot` 改成 `core/resource/assembleSlot.ts#assembleSlot`，其余提到 `stageAssembleSlot` 的 src 注释同步；docs/ 里的只在报告列清单。
4. 禁止：改任何数值 / 条件 / 顺序（尤其 cfg 写回——`yidhariExternalHealPct`、`luciaCurtain*` 写在逐槽循环里，槽序即写序）；把累加器搬进新文件；建子目录。

**证伪闸门**：前提 =「装配闭包只经上列自由变量与外界通信，且装配期间 `states` 不再重绑定」。可观察失败 = dump 非零差异，或 TS 报出未列出的自由变量（停下写 blocked 并列出）。
收工 `grep -n 'stageAssembleSlot' src/` 只允许命中注释 / 文档性文字。

③ **验收**：§4 全套 + rowsnap + `npm run check-guards` + `npm run validate:specs` + `npm run build` +
`npx vitest run truncationRefold timeFillRatchet allAgentsGuards luciaElowen yidhari norma liuyin src/scripts/__tests__/`（名字过滤，匹配不到的忽略，报告里列出实际跑到的文件数）。
**反向验证**（两次，各自恢复并以零差异证明）：① 临时把 `giftTimeThisSlot` 改成 `0` ⇒ 带赠行（诺姆 / 琉音）的场景非零差异；② 临时注释掉 `if (i === curtain.providerSlot) { … }` 整块 ⇒ 带卢西娅的场景非零差异。

④ **报告**：改动行、resource.ts 行数前后、删掉的死绑定清单、闸门 grep、docs 待改清单、两次反向验证差异条数与前 10 个键、§4 + rowsnap 尾部输出。

### CC-5a · S3a 欠打回填外提 `underfillProbe.ts`（review）

**lead 设计（2026-09-25 lead-arena-0925c，@1db534c 实测）**。CC-5 拆三刀：**5a 欠打回填**（本卡）→ 5b S4 `stageAssembleSlot` 外提 → 5c 重折环外提 + `calcTeamResources` 收成编排器（5b/5c 待 lead 设计）。
现状：`runTailPipeline`（`resource.ts:320`）开头的欠打回填是一个自包含块 `{ … }`（**:334–447**，块前 :321–333 是它的头注释）：
读 `configs` / `config` / `totalTime` / `states`，内部闭包 `frontlineRowsOf`（:342）与 `convergeCounts`（:395，调 `runInnerLoop`），
写 `states`（接受时）、`config.timeBudgetRefund` / `config.overflowSeconds` / cfg（被拒时回滚）、`diag.timeBudgetRefundedSeconds`（接受时）、`diag.timeBudgetIdleSeconds`（进了试探才写）。
它用到的 `UNDERFILL_PROBE_THRESHOLD_SECONDS` / `TIME_BUDGET_TOLERANCE_SECONDS` 定义在 `resource.ts` 且带 `@fact`（锚指常量本身）⇒ **常量不搬**，经 ctx 注入（新文件 import `../resource` 会成环）。

① **先读**：`src/core/resource.ts` 95–120、260–300、313–450；`src/core/resource/foldLoop.ts` 全文（CC-4 同款先例：ctx + diag 注入、包装行）；`src/core/resource/solveDiagnostics.ts`。

② **做法**：
1. 新建 `src/core/resource/underfillProbe.ts`：
   ```ts
   export interface UnderfillProbeContext {
     configs: CharacterOperationConfig[]; config: ResourceCalcConfig; totalTime: number
     innerCtx: InnerLoopContext
     thresholdSeconds: number   // = UNDERFILL_PROBE_THRESHOLD_SECONDS（resource.ts 注入）
     toleranceSeconds: number   // = TIME_BUDGET_TOLERANCE_SECONDS（resource.ts 注入）
   }
   export function runUnderfillProbe(ctx: UnderfillProbeContext, diag: SolveDiagnostics, from: IterationState[]): IterationState[]
   ```
   函数体 = 块 :334–447 **原样搬**：开头 `let states = from`，末尾 `return states`；外层变量 → `ctx.x`；两个常量 → `ctx.thresholdSeconds` / `ctx.toleranceSeconds`；
   `runInnerLoop(from)` → `runInnerLoop(from, ctx.innerCtx)`。`frontlineRowsOf` / `convergeCounts` 保持为函数内嵌套闭包（不 export、不改口径）。
   头注释 :321–333 随搬到函数 JSDoc；resource.ts 原处留一行指路注释。直接 import `./innerLoop`、`./helpers`（`materializeRows`）、`./crossAgentSupply`、`@/mechanics`（`getAgentMechanic`）、`@/types/resource`；**不得 import `../resource`**。
2. resource.ts：在 `foldCtx` 旁建 `const probeCtx: UnderfillProbeContext = { configs, config, totalTime, innerCtx, thresholdSeconds: UNDERFILL_PROBE_THRESHOLD_SECONDS, toleranceSeconds: TIME_BUDGET_TOLERANCE_SECONDS }`；
   `runTailPipeline` 里原块换成 `states = runUnderfillProbe(probeCtx, diag, states)`（**调用时读 `diag`**，重折环会换对象）。
3. 禁止：改任何数值 / 条件 / 顺序 / 回滚范围（cfg、`timeBudgetRefund`、`overflowSeconds` 三者都要回滚，见块内注释的实测事故）；动 `@fact` 声明位置；改 runTailPipeline 其他段；建子目录。

**证伪闸门**：前提 =「块 :334–447 只经 `states` 与上列副作用和外界通信」。可观察失败 = dump 非零差异，或搬出后 TS 报出块内引用了未列出的外层变量（那就停下写 blocked，列出变量名）。
收工 `grep -n 'frontlineRowsOf\|convergeCounts' src/core/resource.ts` 只允许命中注释。

③ **验收**：§4 全套 + rowsnap + `npm run check-guards` + `npm run validate:specs` + `npm run build` +
`npx vitest run underfillRefund seedInvariance determinism timeFillRatchet truncationRefold warmStart src/scripts/__tests__/`。
**反向验证**（两次，各自恢复并以零差异证明）：① 临时删被拒分支的 `configs.forEach((c, i) => Object.assign(c, savedCfg[i]))` ⇒ dump 非零差异（块内注释说 1431 队会变）；
② 临时删 `diag.timeBudgetIdleSeconds = Math.max(0, underfill)` ⇒ dump 非零差异（证明诊断经注入的 diag 上报）。

④ **报告**：改动行、resource.ts 行数前后、闸门 grep、两次反向验证差异条数与前 10 个键、§4 + rowsnap 尾部输出。

### CC-4 · SolveDiagnostics 累加器 + S2 `runFoldLoop` 外提（review）

**lead 设计（2026-09-25 lead-arena-0925c，@1da56fc 实测；取代 §3 草图里的 `solveContext.ts` 命名——`SolveContext` 留给 CC-5）**。
现状：`calcTeamResources`（`resource.ts:181`）有 **10 个诊断 `let`**（:263–274）：`converged`、`iter`、`timeBudgetPasses`、`timeBudgetConverged`、
`timeBudgetResidualSeconds`、`timeBudgetIdleSeconds`、`timeBudgetRefundedSeconds`、`refundFrozen`、`bestExcess`、`stagnantPasses`。
写入点：`runFoldLoop` 闭包（:294–467）、`runPreTailFinalize`（:476）、`runTailPipeline` 内欠打回填（:607 / :617）与伊德海莉 tail（:644）、
`resetDiagnostics`（:924–935）、重折环 `accepted` 快照（:948–952）与拒绝还原（:978–987）。读出点：`PROBE_TRACE_FOLD` 打表（:1028–1035）与返回值（:1045–1060）。
dump 对整个 `resourceResult` 取 hash（含 `iterations` / `converged` / `convergence.*`）⇒ 诊断量写错 dump 必红。

① **先读**：`src/core/resource.ts` 75–100、181–300、294–470、470–500、595–650、905–1060；`src/core/resource/innerLoop.ts` 1–60（纯函数 + ctx 先例）；
`src/core/resource/finalizePasses.ts`（参数注入先例）；`src/types/resource/team.ts` 中 `@fact engine:收敛读数归属`。

② **做法**（同一提交，按序）：
1. 新建 `src/core/resource/solveDiagnostics.ts`：
   ```ts
   export interface SolveDiagnostics {
     converged: boolean; iterations: number
     timeBudgetPasses: number; timeBudgetConverged: boolean
     timeBudgetResidualSeconds: number; timeBudgetIdleSeconds: number; timeBudgetRefundedSeconds: number
     refundFrozen: boolean; bestExcess: number | undefined; stagnantPasses: number | undefined
   }
   export function createSolveDiagnostics(): SolveDiagnostics // 初值与 :263–274 逐字相同
   ```
   resource.ts：10 个 `let` → `let diag = createSolveDiagnostics()`；所有读写改 `diag.<字段>`（`iter` → `diag.iterations`）。
   `resetDiagnostics()` → `diag = createSolveDiagnostics()`；`accepted` 快照里 10 个字段 → 一个 `diag`（存引用即可：随后 reset 换新对象，旧对象此后无人写）；
   拒绝分支 10 行还原 → `diag = accepted.diag`。**闭包里一律经变量 `diag` 访问，禁止 `const d = diag` 之类缓存**（重折换对象后会写到旧对象）。
2. 新建 `src/core/resource/phaseExecutions.ts`：`buildExecutionsWithPhase`（:85–98）原样搬去并 export（依赖只有 `helpers.buildExecutions` + `getAgentMechanic`）；
   resource.ts 改 import，:797 调用点不变。
3. 新建 `src/core/resource/foldLoop.ts`：
   ```ts
   export interface FoldLoopContext {
     configs: CharacterOperationConfig[]; config: ResourceCalcConfig
     totalTime: number; maxTimeIter: number
     injected: boolean                       // 原 `injectedStates` 的真值判断
     defaultSeedStates: IterationState[]; innerCtx: InnerLoopContext
   }
   export function runFoldLoop(ctx: FoldLoopContext, diag: SolveDiagnostics, from: IterationState[]): IterationState[]
   ```
   函数体 = 闭包 :295–466 **原样搬**，只做机械替换：外层变量 → `ctx.x`；诊断 → `diag.x`；`runInnerLoop(x)` → `runInnerLoop(x, ctx.innerCtx)`
   （直接 import `./innerLoop`、`./helpers`、`./crossAgentSupply`、`./phaseExecutions`，同 innerLoop 直接 import helpers 的先例；**不得 import `../resource`**，会成环）。
   `PROBE_TRACE_FOLD` 打表块随搬、字段名不变（`convergenceProbe.test` 读 `globalThis.__foldPasses`）。
   resource.ts 留一行 `const runFoldLoop = (from: IterationState[]) => runFoldLoopPure(foldCtx, diag, from)`（**每次调用时读 `diag`**），两个调用点（:485、:965）逐字不改。
   - 原闭包 for 体没缩进（:298 起），搬时可规范缩进，但不许改任何表达式、顺序或常量。
   - 注释全部随代码搬，含 `@fact engine:收敛环停点规范化`：其 `锚` 从 `src/core/resource.ts#calcTeamResources` 改为 `src/core/resource/foldLoop.ts#runFoldLoop`。
   - 搬完 `grep -rn "runFoldLoop" docs/ src/ scripts/`：只改 `src/core/**` 内注释；`docs/` 里的引用只在报告里列清单，不改（lead 处理）。
4. 禁止：改任何数值 / 条件 / 顺序；把每 pass 局部量（`teamRefund` / `maxExcess` / `maxIdle`）放进 diag；动 `runTailPipeline` 逻辑（只做诊断变量改名）；建子目录。

**证伪闸门**：前提 =「10 个诊断量只在上列点读写，且『重折换新对象 / 拒绝换回旧对象』≡ 旧式逐字段快照还原」。可观察失败 = dump 非零差异。
动手前记 `grep -cE '\b(iter|converged|refundFrozen|bestExcess|stagnantPasses|timeBudget(Passes|Converged|ResidualSeconds|IdleSeconds|RefundedSeconds))\b' src/core/resource.ts`；
收工时 `grep -nE '^\s*let (converged|iter|refundFrozen|bestExcess|stagnantPasses|timeBudget)' src/core/resource.ts` 必须为空。

③ **验收**：§4 全套 + rowsnap + `npm run check-guards` + `npm run validate:specs` + `npm run build` +
`npx vitest run src/composables/__tests__/convergenceProbe.test.ts src/core/__tests__/truncationRefold.test.ts src/core/__tests__/warmStart.test.ts src/composables/__tests__/seedInvariance.test.ts src/core/__tests__/dynamicComboAlign.test.ts src/composables/__tests__/convergenceNightB.test.ts src/scripts/__tests__/`。
**反向验证**（两次，各自恢复并以零差异证明）：① foldLoop.ts 里临时删 `diag.iterations = inner.iterations` ⇒ dump 必须非零差异（证明返回读数来自新 diag）；
② 临时删拒绝分支的 `diag = accepted.diag` ⇒ 报告差异条数（624 场景若无「重折被拒」样本可能为 0：如实写「拒绝路径无 dump 样本」，不算失败）。

④ **报告**：改动行、闸门 grep 前后读数、resource.ts 行数前后、docs 里需 lead 改的 `runFoldLoop` 引用清单、两次反向验证差异条数与前 10 个键、§4 + rowsnap 尾部输出。

每张 design 卡放行前，lead 在本节补三样：**接口签名**、**证伪闸门**（前提假设 + 假设为假时的可观察失败）、**切批顺序**。
已知前提与风险（工人 A/B/C 报告，lead 抽查）：
- CC-4：`refundFrozen` 是跨 pass、跨重折轮的状态机（每次折叠管线运行独立冻结），必须成为 `SolveDiagnostics` 显式字段；
  诊断量「归属被接受那次调用」（`types/resource/team.ts:24` `@fact engine:收敛读数归属`）——写回时机不能变。
- CC-5：欠打回填被拒试探要**连 cfg 一起回滚**（叶瞬光自动选轴写 `record.yeshuguangAutoAxis`，实测不回滚 ⇒ 1431 队留白 2.6→11.3s）；
  `frontlineRowsOf` 必须与 `netFrontlineOccupation` 同口径（不同口径实测差 164s）。
- CC-6 证伪闸门草案：前提 =「4 个角色专属块只读 cfg 与本轮 states、可表达为模块能力函数」；
  可观察失败 = 迁移后 dump 非零差异，或能力函数需要读别的槽位的**中间态**（那就说明它属于 `applyTeamConfig` 而不是引擎能力，停下重设计）。
- CC-9：`emitExecDirect` 闭包捕获 `exec/unitMultiplier/isPerSecondRow/baseNote`，不要外提（提出来要 10+ 参数）。
- CC-10：`calcOutput` 有 LRU16 记忆化（`calcOutputMemo.test.ts`），键 = 对象身份；Vue 无关化后记忆层留在 composable 侧。

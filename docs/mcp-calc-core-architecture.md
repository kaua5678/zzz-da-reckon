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
- 标准 DoT：core `calcStandardDotDamage` 产出 `standardDotDamage`，**生产代码零消费**（只有探针测试读），damagePool 另算一套（算法不同，不是逐位重复）。

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
| CC-T1 | review | **待立项** | rowsnap 预设补「失衡轴 × 尾段角色」（1171/1401/1261/1581 + 爱丽丝）组合：CC-9a 反向 ① 实测该面零覆盖，只有 `inStunAttribution.test.ts` 兜底。低级模型可做（只加预设 + 重生成 A 基线） | .zc/perf/ |
| CC-10 | review | **done** `a73b6f8`（useResourceCalc.ts 1189→789；新 `solveTeam.ts` 476 行 + 纯度锁测试；dump/rowsnap 624 零差，verify 3493） | `computeCalcOutput`（:248–654，含 `runOuterLoop` / `stageResolveFeasibility`）原样外提 `resourceCalc/solveTeam.ts#solveTeam(input)`，Vue 无关；唯一 store 写（降配闸门 ceiling）改为返回 `ceilingWriteBack` 由 composable 执行 | useResourceCalc.ts |
| CC-11a | review | **ready**（lead 设计 2026-09-25 @3d8350d，卡见下） | C1 轮输入工厂 + C2 `resolveAxisUltimateDecibelCost` → `roundInputs.ts`；C3 `CalcRoundResult` → `roundResult.ts`；convergence.ts 原名 re-export，8 个消费者零改动 | convergence.ts |
| CC-11b | review | design（待 11a） | `runCalcRound` 引入 `RoundCtx`，按工人 C 的 C4–C10 簇拆（33 个局部 `let` 的归属是设计核心；簇表行号 11a 后重测） | convergence.ts |
| ~~CC-D1~~ | — | ✅ **done 2026-09-25（用户裁决「别人有为什么不算」）** | `damagePool.ts:1020` 琉音命破队友分支的贯穿力补 `sheerForceFlat`（改引 `calcPenetrationPower`） | damagePool.ts:1020 + `@fact engine:贯穿力/单一事实源`（GAME_TERM §10）+ 判据 `ccD3D1Verdict.test.ts::CC-D1` |
| CC-D2 | — | **decide** | core `standardDotDamage` 生产零消费：删掉，还是让 damagePool 消费它（两套算法不同，需先对账） | 需用户口径 |
| ~~CC-D3~~ | — | ✅ **done 2026-09-25（用户裁决「维琳娜专属资源，不该给别人计算」）** | 风蚀归属改按面板标记 `velinaEnabled`（`velina.ts#findVelinaPanel`/`#resolveVelinaCorrosion`，模块唯一写入方）。探针先行的预测**已证实**：1621 队产出 `{turb:3,micro:2,broad:1,boosted:1}` + 2 条「维琳娜…气旋」行共 15 702 挂在洛克茜名下、1631 队 5 936 挂赛维里安 ⇒ 数值缺陷。修后无维琳娜 ⇒ `velinaCorrosionSource` 为 `undefined`（非全零），气旋行/广域积蓄注入整套消失；**乱流仍在**（通用机制）。dump A/B：6 支洛克茜队 −0.06%~−0.15% | velina.ts / anomalyPool.ts / anomalyPool/helpers.ts + 判据 `anomalyPool.test.ts::CC-D3` + `ccD3D1Verdict.test.ts` |
| CC-D4 | — | 待立项 | `transformStore.velinaCorrosionSource` 死写（`anomalyPool.ts:98/111` 建、`velina.ts:277` 写、全仓无读）——接上或删，单独一批 | 与 CC-6d 分批 |
| CC-12 | 换尺 | **done**（dsflash 工人 + lead 复核：新增命中恰为 convergence.ts:302/311 两行；编排层基线/frozen 1→3（口径纠正），core 5 不变；src 零改动；guards 21、scripts 测试 452 过、build） | 身份扫描器补「本地别名」形态（`convergence.ts:302/311` 的 `fillerAgentId === '1051'/'1041'` 现在量不到），按规则 17② 调 `frozen` 到真实值 | scripts/lib/agent-identity-lines.mjs 等 |

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
  `CORE_ROLE_IMPORT_BASELINE`、`scripts/check-guards.mjs` 的 `RATCHET_BURNDOWN.frozen` 三处一起改（只改基线不改 frozen ⇒ verify 红；计数低于基线 check-guards 也红）。
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

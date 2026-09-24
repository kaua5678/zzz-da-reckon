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
  `damagePool.ts:1020` 的内联版**缺 `sheerForceFlat`**（可能是缺陷，见卡 CC-D1）。
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
npm run build                            # vue-tsc + vite，EXIT 0
```
不许跑 `npm run verify`（12min+，lead 合并前统一跑）。报告写 `.zc/reports/<卡号>.md`，第一行 `STATUS: done|blocked`，
附上面每条命令的尾部输出；最后一条回复也带 STATUS。

## 5. 任务卡

| 卡 | 档 | 状态 | 内容 | 主要文件 |
|---|---|---|---|---|
| CC-0 | — | **done（本会话）** | 删 `createRunCalcRound` 8 个死依赖 + 纠正「在 calcOutput 求值中读它们」的假注释 | convergence.ts / useResourceCalc.ts / 3 个测试 |
| CC-1 | fast | **done（dsflash 工人 + lead 复核）** | `find*` 招式表查询迁 `core/resource/moveLookup.ts` | core/resource.ts 1288–1705 |
| CC-2 | fast | ready | 热启动缓存迁 `core/resource/warmStart.ts` | core/resource.ts 98–160 |
| CC-3 | fast | ready | S1 `runInnerLoop` 提为纯函数 `core/resource/innerLoop.ts` | core/resource.ts 356–430 |
| CC-4 | review | design | `SolveDiagnostics` 累加器 + S2 `runFoldLoop` 外提 | core/resource.ts 329–600 |
| CC-5 | review | design（依赖 CC-4） | S3a 欠打回填 / S4 `assembleSlot` / 重折环外提；`calcTeamResources` 收成编排器 | core/resource.ts 677–1210 |
| CC-6 | review | design | 引擎能力接口：1471 `exSpecialCount` → 1451 帷幕 → 1531/1051 `finalizePass` → velina；每迁一个下调对应 `frozen` | mechanics/types.ts、core/resource*.ts、anomalyPool*.ts、4 个角色模块 |
| CC-7 | fast | ready | 贯穿力单一事实源：导出 `calcPenetrationPower`，norma.ts / damagePool.ts:1067 改引用（**不碰 :1020**） | core/damage.ts、norma.ts、damagePool.ts |
| CC-8 | fast | ready | damagePool 异常常量改引 core：713/500/1250 与 DoT 表改用 `ANOMALY_SINGLE_HIT_MULTIPLIER` / `STANDARD_DOT_CONFIG` | damagePool.ts 1242–1247 / 1402 / 1429 |
| CC-9 | review | design（依赖 CC-7/8） | damagePool 按簇拆到 `resourceCalc/` 直属文件（`damagePoolDirect.ts`/`damagePoolRelease.ts`/`damagePoolAnomaly.ts`/`damagePoolAxis.ts`），共享可变态 `rows/claimedInAxis/seenDirectIds` 由入口持有的 `RowSink` 注入 | damagePool.ts |
| CC-10 | review | design | `solveTeam`：把 `computeCalcOutput`（runOuterLoop + stageResolveFeasibility）从 composable 抽成 Vue 无关函数 | useResourceCalc.ts 248–653 |
| CC-11 | review | design | `runCalcRound` 引入 `RoundCtx`，按工人 C 的 C4–C10 簇拆；C1/C2/C3（轮输入簇、`resolveAxisUltimateDecibelCost`、`CalcRoundResult`）可先纯搬 | convergence.ts |
| CC-D1 | — | **decide** | `damagePool.ts:1020` 琉音命破队友分支的贯穿力缺 `sheerForceFlat`：漏写还是有意？ | 需用户口径 |
| CC-D2 | — | **decide** | core `standardDotDamage` 生产零消费：删掉，还是让 damagePool 消费它（两套算法不同，需先对账） | 需用户口径 |
| CC-12 | 换尺 | ready（单独一批） | 身份扫描器补「本地别名」形态（`convergence.ts:302/311` 的 `fillerAgentId === '1051'/'1041'` 现在量不到），按规则 17② 调 `frozen` 到真实值 | scripts/lib/agent-identity-lines.mjs 等 |

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
**:1020 不许动**（缺 `sheerForceFlat` 是 CC-D1 待裁决项）。norma.ts 是录入层，只许 import `@/core`（判据 19 只禁 `@/composables`）。
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

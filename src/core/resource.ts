import type {
  ResourceCalcConfig,
  TeamResourceResult,
  IterationState,
} from '@/types/resource'
import { projectStunPlanForCounts } from '@/core/stunPlanProjection'

import {
  crossAgentSupplyAt,
  crossAgentSuppliesOf,
  findCrossAgentSupplySlots,
  ultimateGiftOf,
  type CrossAgentSupplyInfo,
} from './resource/crossAgentSupply'
// 终局整数重推执行器（规则 6 引擎落点，2026-09-25 CC-6c）：1531/1431（preTail）与 1051（tail）
// 的角色专属「谁参与/置哪个旗标」已迁各模块的 `finalizePass` 能力，本文件只调通用执行器。
import { runFinalizePasses, resetFinalizePasses } from './resource/finalizePasses'
// 求解诊断累加器（CC-4，2026-09-25）：10 个函数级诊断 `let` 收成唯一可变对象；重折环换新对象
// 即归零、拒绝时换回快照对象——口径 `engine:收敛读数归属`（诊断量归属被接受的那次调用）。
import { createSolveDiagnostics } from './resource/solveDiagnostics'
// S2 时间预算折叠环（CC-4）：纯函数外提，`diag` 每次调用时由包装读取（禁止缓存，重折换对象）。
import { runFoldLoop as runFoldLoopPure, type FoldLoopContext } from './resource/foldLoop'
// 物化 + 相位写入包装已随装配段迁 `./resource/assembleSlot.ts`（CC-5b），本文件不再直接用。
// S3a 末轮欠打回填（CC-5a 外提）：门槛常量与其 `@fact` 留在本文件，经 ctx 注入；纯函数 `diag` 注入。
// 实现（`runUnderfillProbe`）随尾段管线迁 `./resource/tailPipeline.ts`（CC-5c），本文件只剩 ctx 类型。
import { type UnderfillProbeContext } from './resource/underfillProbe'
// `materializeRows` 已随欠打回填试探迁 `./resource/underfillProbe.ts`（CC-5a），本文件不再直接用。
// 装配段的 helpers 消费者（calcEnergySource / calcRawDecibelParts / calcDecibelSource /
// calcTimeAllocation / buildAnomalyEventExecutions / calcCrossAgentEnergy / truncateExecutionsToFrontline）
// 已随 S4 迁 `./resource/assembleSlot.ts`（CC-5b）；本文件只剩 `iterate`（终局重推执行器注入）。
import { iterate } from './resource/helpers'
// S4 装配（CC-5b）与 S3–S4 尾段管线（CC-5c）均已外提纯函数：
// `assembleSlot(ctx, cfg, i)` 由 `./resource/tailPipeline.ts` 内部构造 `slotCtx` 调用（本文件不再 import 它）；
// `runTailPipelinePure(ctx, diag, states)` 由本文件构造 `tailCtx` 后经保语义包装 `runTailPipeline` 调用。
import { runTailPipeline as runTailPipelinePure, type TailPipelineContext } from './resource/tailPipeline'

export { crossAgentSupplyAt, crossAgentSuppliesOf, findCrossAgentSupplySlots, ultimateGiftOf }
export type { CrossAgentSupplyInfo }

// 热启动缓存已迁 src/core/resource/warmStart.ts（CC-2）；此处 re-export 壳保持既有
// `@/core/resource` 引用（测试 / dump / 编排层）零改动。
// `storeWarmStart` 随尾段管线迁 `./resource/tailPipeline.ts`（CC-5c），本文件不再直接调用。
import {
  warmStartExactKey,
  lookupWarmStart,
} from './resource/warmStart'
export { clearWarmStartCache, getWarmStartStats } from './resource/warmStart'

// ============ 单角色能量计算 ============

/** 计算单角色能量回复（单次迭代，基于当前时间分配） */
// S1 内层不动点已迁 src/core/resource/innerLoop.ts（CC-3）；本文件只保留只读 ctx 类型与装配。
// CC-5a 后 `runInnerLoop` 的最后消费者（欠打回填 `convergeCounts`）已迁 `./resource/underfillProbe.ts`，
// 本文件不再直接调用实现，只经 `foldCtx` / `probeCtx` 注入 `innerCtx`。
import { type InnerLoopContext } from './resource/innerLoop'

/**
 * 时间预算容差（秒）：量化（floor 次数）导致的残差属合轴可覆盖，不追求精确 0（坑12/19 既有口径）。
 * 单一事实源——欠打回填的可行性门控与队伍对比的超时判定共用（teamCompare.actionTimeTotal）。
 */
export const TIME_BUDGET_TOLERANCE_SECONDS = 1

// `cycleProbeKey`（内层环检测预键）已随 `runInnerLoop` 迁 src/core/resource/innerLoop.ts（CC-3）。
// 下列 `@fact` 的**实现已迁** `src/core/resource/innerLoop.ts`，声明按既有惯例留在 re-export 壳处
// （同 CC-1 `moveLookup.ts` 的处理）；**锚已随实现改指新文件**，豁免清单键（`src/core/resource.ts engine:判稳含平A时间`）不变。
// @fact engine:判稳含平A时间 口径: 内环次数收敛判稳 = 强特/终结次数 + basicAttackTime 严格相等（bat 是预算与次数的确定性函数；折叠边界 bat 跳变而次数暂不动时旧判稳提前 clean，停点带「驱动快照 ≠ 终局态行重放」伪不动点——实测雅 C2 快照 585.8 vs 重放 307.5、命座伤害 C4<C2 非单调） | 据 实测@2026-09-09 能量行级Σ专项·复核@2026-09-25 | 验 src/mechanics/__tests__/miyabiCinema.test.ts | 锚 src/core/resource/innerLoop.ts#runInnerLoop | 信 确认

/**
 * 欠打回填的启动门槛（秒）：平A权重队的剩余自由时间必须按权重全部分配（用户口径 2026-09-08），
 * 故门槛 = 量化容差：欠打 >1s 必试探回填（refund→平A池→按 timeWeight 水填分配）；≤1s 属量化
 * 地板（坑12「不追求精确 0」，合轴可覆盖），不试探。09-05「≤5s 会把近均衡队推进 stunCount=0
 * 吸引盆」的风险已在 09-08 引擎（1051/1531 实数化、轴栈资源门控、sigrid 估时钩子、琉音三件套）
 * 复核：1s 门槛下 ratchet 绝对不变量（stun>0/outerExit≠maxIter）/runArchiveDeploy（116k 样本）/
 * allAgentsSweep（C6>C0 等不变量）/yidhariInteractionGrid 全绿，旧盆不复现（实测数字见
 * underfillRefund.test.ts 与 docs 坑19① 否决记录）。
 * @fact engine:欠打回填 口径: 折叠循环退出后按「预算−物化净占用」重测欠打量，折半试探注入 refund；接受三条件=内层判稳+trialRows≤预算−容差+行数变多，任一不满足连 cfg 一起回滚；门槛=1s 量化容差（平A权重队自由时间按权重全分配，留白只剩 ≤2s 量化/试探粒度地板；欠打 ≤1s 不试探；09-05「≤5s 推近均衡队入 stunCount=0 盆」在 09-08 引擎复核不复现；**无排除队**——1591 一族 2026-09-10 解除（该族试探现进入即被 fits 门拒，开关零差异），1051/1531 已随热启动规范种子修复放回）；宁可留白不制造超预算 | 据 用户@2026-09-08「平A权重与留白不应并存，剩余自由时间按权重全部分配」+09-05「全部动手」·复核@2026-09-08·复核@2026-09-10（能量行级 Σ 后全链零差异）·复核@2026-09-25 | 验 src/composables/__tests__/underfillRefund.test.ts | 锚 src/core/resource.ts#UNDERFILL_PROBE_THRESHOLD_SECONDS | 信 确认
 */
export const UNDERFILL_PROBE_THRESHOLD_SECONDS = TIME_BUDGET_TOLERANCE_SECONDS

/**
 * 折叠环轮数上限（算力护栏；`ResourceCalcConfig.maxTimeIterations` 可覆写）。
 *
 * 历史值 **8**。2026-09-10 尾巴专项实测：判据 `maxExcess ≤ 1e-3` 对**慢收缩队**要 10~25 轮才达得到，
 * 8 轮的上限因此成了「`timeBudgetConverged=false`」的**唯一来源**（3 队尾巴逐队实测残差轨迹：
 * `billy-roxy-lucia` `3.637→…→0.417`（ρ≈0.70/轮，需 ≈25 轮）、`auto-1591-1161-1211`
 * `0.173→…→0.003` 与 `auto-1591-1481-1311` `0.150→…→0.002`（ρ≈0.5/轮，各差 1~2 轮）；
 * 停滞判据在这些队上**永不触发**——每轮改善 0.17s ≫ 阈值 1e-2，不是停在量化地板）。
 * 取 32 = 实测需求（≈25）留一倍余量；代价只落在本来就要跑满的队（127 预设里 8 轮顶格 6 队，
 * 其余 121 队 ≤5 轮），且停滞判据仍在，真发散队照旧 3 轮停。
 *
 * @fact engine:折叠环上限 口径: 折叠环轮数上限缺省 32（`TIME_FOLD_MAX_PASSES`，`maxTimeIterations` 可覆写）；判据 `maxExcess ≤ 1e-3` **不放宽**——8 轮上限曾是 tbConv=false 的唯一来源（3 队尾巴全部在几何收敛，21 轮内可达标）。实测 3→0 队、留白 189.3s/超预算 2.2s 不变、棘轮零变差、golden 15 条 delta/5 队（billy 逐槽 nec ±0.35s 守恒再分配 + 1591 系 ≤3ms） | 据 用户裁决@2026-09-10「重排就重排，以长期利益为主」·复核@2026-09-25 | 验 src/composables/__tests__/convergenceProbe.test.ts + src/composables/__tests__/timeGolden.test.ts | 锚 src/core/resource.ts#TIME_FOLD_MAX_PASSES | 信 确认
 */
export const TIME_FOLD_MAX_PASSES = 32

/**
 * 内层不动点（`runInnerLoop` / 欠打回填 `convergeCounts`）轮数上限缺省值 = **收敛尝试的总预算**。
 * `ResourceCalcConfig.maxIterations` 可覆写；编排层 `useResourceCalc` 从这里取（规则 11，别再在别处写字面量）。
 *
 * 历史值 **20**（1051 伊德海莉连续松弛队单独抬到 100，见 calcTeamResources 头部）。2026-09-19 R37-J5 ④ 把叶瞬光
 * 「平A→局外剑势→明心境轮数→必要时间→平A」这条**连续**反馈边搬进内层（估计与物化行单源）后，该环是 ρ≈0.17 的
 * 几何收缩：第 14 轮起 9 位小数不动，但浮点复合映射没有精确不动点，第 21 轮起才进入 1 ulp 的精确 2-循环
 * （由 `floatNoiseCycle.ts` 判成已收敛）。20 轮上限在它进入精确环之前就到顶 ⇒ 停点 = 上限处瞬态、`converged=false`，
 * 且欠打回填试探同样因「未稳」被拒。实测 104 预设：master 撞顶 **0** 队；分支 3 支 1431 队全部 iter=20 撞顶
 * （`auto-1431-1491-1311` / `-1341-1311` / `-1481-1311`，正是「最后一公里」留白/超预算残余那几队）。
 * 上限只需容得下「收缩到 ulp 级 + 进入精确环」：ρ=0.17 ≈21 轮、ρ=0.5 ≈55 轮、0.5 阻尼的 1051 实测 41 轮 ⇒ 取 **100**
 * 与 1051 既有口径统一；正常收敛队照旧 ≤15 轮退出，代价只落在本来就要跑满的队。
 *
 * **两层语义**（`INNER_LOOP_OSCILLATOR_STOP` 配套）：第 20 轮之后的预算**只用于收敛尝试**——尝试成功（严格判稳 / 浮点
 * 噪声环）就返回收敛态；尝试失败（真整数环 / 预算耗尽）**回到历史停点 = 第 20 轮状态**，与旧口径逐位一致。
 * 为什么不直接取环的规范成员：整数量子振荡器（实测单人 1431 命座 6：ex 6↔10 / ult 1↔2 精确 2-循环，环增益 >1）
 * 的环成员账本是「本轮次数 + 上轮平A」估出来的混相位量，行与账本差 21s，折叠环随之在 84/49/29/78s 之间摆、靠停滞
 * 规则退出 ⇒ 留白 0 → 29.0s。非收敛轨迹没有「更对」的停点，只有「历史已钉」的停点；真解是 DEBT「全局实数化收敛重构」。
 * @fact engine:内层上限 口径: 内层不动点轮数预算缺省 100（`INNER_LOOP_MAX_ITERATIONS`，`maxIterations` 可覆写；1051 队原本就 100），第 20 轮（`INNER_LOOP_OSCILLATOR_STOP`，1051 队 = 预算本身）之后只用于收敛尝试：判稳严格相等**不放宽**，浮点噪声环视为收敛；真整数环 / 耗尽 ⇒ 回到第 20 轮状态（非收敛轨迹与旧口径逐位一致）——20 轮曾是分支上 1431 三队 `converged=false` 的唯一来源（连续收缩到 ulp 级要 ≈21 轮） | 据 实测@2026-09-19 R37-J5 内层收敛专项（单人 1431 c6 取环规范成员留白 29s 的反例；先例：折叠环上限 8→32 用户裁决@2026-09-10「以长期利益为主」）·复核@2026-09-25 | 验 src/core/__tests__/floatNoiseCycle.test.ts + src/core/__tests__/warmStart.test.ts | 锚 src/core/resource.ts#INNER_LOOP_MAX_ITERATIONS | 信 确认
 * ⟳复核: 「全局实数化收敛重构」（DEBT_REGISTRY）落地或 20 轮停点语义再动时，复核「104 预设 converged=false 只剩真整数环队（当前 2 队）」+「单人 1431 c6 留白仍为 0」+「warmStart 冷/热逐位一致且 converged」（floatNoiseCycle.test + warmStart.test + timeGolden） | 到期 2026-12-31
 */
export const INNER_LOOP_MAX_ITERATIONS = 100

/**
 * 非收敛轨迹（整数量子振荡器）的停点轮次 = 历史内层上限 20：`INNER_LOOP_MAX_ITERATIONS` 里第 20 轮之后的预算只用于
 * 收敛尝试，失败即返回第 20 轮状态（详见上方两层语义）。1051 连续松弛队的历史上限本就是 100 ⇒ 她的停点轮次 = 预算本身。
 */
const INNER_LOOP_OSCILLATOR_STOP = 20


/**
 * ===== 计算核心的**阶段顺序**（2026-09-11 显式化；改动前先读这张表，改动只落在对应阶段）=====
 *
 * | 阶段 | 名字 | 位置 | 输入 → 输出 | 判据/不变量 |
 * |---|---|---|---|---|
 * | S0 | 输入装配 | `useResourceCalc#runCalcRound`（`buildCharConfig` + `applyTeamMechanics`） | store/catalog → `cfg[]` | 规则 6：队伍级机制走 `applyTeamConfig` |
 * | S1 | 资源账本预解（内层不动点） | `runInnerLoop` → `iterate`（`helpers.ts#iterate`，四步见其函数头） | `cfg[]` + 种子 → `IterationState[]` | 判稳 = 强特/终结次数 + `basicAttackTime` **严格相等**；跑满/入环 → 规范停点（冷热解耦） |
 * | S2 | 时间预算折叠（外层不动点） | `runFoldLoop` | states → states（`cfg.timeBudgetExcess`/`timeBudgetRefund` 折入） | `Σ前台行 ≡ 账本`；`+=` 折正超出、负差 refund 回填；上限 `TIME_FOLD_MAX_PASSES` |
 * | S3 | 可行化决策 | `useResourceCalc#stageResolveFeasibility`（轴退化 + 降配，2026-09-11 抽出） | 整轮结果 → `{r, axisFallback, interactionScale}` | 三臂不更差（截断/超预算/留白各 1s）+ 枚举取最大可行；锁窗一律不动 |
 * | S4 | 装配 + 可行化截断 | `core/resource/assembleSlot.ts#assembleSlot`（#8 分刀自逐槽 `configs.map` 抽出，CC-5b 外提；截断在 `truncateExecutionsToFrontline`） | states + cfg → `characters[]`（行/资源/时间） | 平A行不参与截断；后台行不占前台；整数装包；`overflowSeconds`/`truncationCuts` 逐行上报 |
 * | S5 | 物化输出 | 本函数尾部的 `return` | 上面各阶段 → `TeamResourceResult` | 资源/计数取**未截断账本**、伤害/失衡取**截断后行**（二者不自洽是已知债务，见 DEBT_REGISTRY「截断不回灌资源循环」） |
 *
 * 顺序不可交换：S1 定次数/资源 → S2 让账本与物化行自洽 → S3 决定"撑不下时怎么退" → S4 削行 →
 *  S5 输出。**S1 的行级资源收入按 `feasibleRows` 取（`cfg.rowTimeLimit` 由外环注入）**，
 *  这条是 A 项（截断回灌）的预留接口，缺省不截断 ⇒ 既有口径不动。
 *  S3a 欠打回填 → S4 装配的执行链（含伊德海莉 tail 终推 / 热启动落缓存 / 赠链·帷幕折算）已外提
 *  `core/resource/tailPipeline.ts#runTailPipeline`（CC-5c；本函数只留保语义包装，把新 `states`
 *  写回外层供重折环快照/还原）。
 */
export function calcTeamResources(config: ResourceCalcConfig): TeamResourceResult {
  const totalTime = config.totalTime
  // 伊德海莉连续松弛（0.5 阻尼）收敛比整数动力学慢：她的队内层迭代上限至少 100
  // （阻尼残差减半每轮，且判稳用严格相等——浮点不动点约需 40+ 轮）。2026-09-19 起缺省上限也是 100
  // （`INNER_LOOP_MAX_ITERATIONS`，理由见其注释）；这条 max 只在调用方显式传更小的 `maxIterations` 时仍为她兜底。
  // agentId 判断冗余已删：yidhariContinuousEx 唯一写入方 = src/mechanics/agents/yidhari.ts:148
  // （模块只对自己的 cfg 运行 ⇒ 该字段为 true 即蕴含 agentId === '1051'），引擎层不读 agentId。
  const yidhariContinuousPresent = config.characters.some(c => c.yidhariContinuousEx === true)
  const maxIter = Math.max(config.maxIterations || INNER_LOOP_MAX_ITERATIONS, yidhariContinuousPresent ? 100 : 0)
  /** 非收敛轨迹的停点轮次（历史上限；显式传更小的 maxIterations 时以它为准，1051 队 = 预算本身） */
  const oscillatorStop = yidhariContinuousPresent ? maxIter : Math.min(maxIter, INNER_LOOP_OSCILLATOR_STOP)
  const configs = config.characters
  // 欠打试探排除队（2026-09-08 立 → **2026-09-10 解除，现无任何排除队**）：
  //  · **1591 希格莉德**（当时唯一排除）：试探的物化行测量口径（`buildExecutions` + 赠送行近似）
  //    **看不到装配期追加的行**（最终 s0 行比试探测得的多 ~1.9s——装配期还追加小数次数连携行），
  //    于是曾接受「按它自己的测量合规、按最终装配却超自家账本」的注入 → 破跨路径恒等式
  //    `timeLedgerInvariants`「行≤账本」（实测 auto-1591-1481 队超 0.07~1.13s）。已试并否决的
  //    替代方案：试探接受前加「逐槽原始行 ≤ 账本」判据 → 用的是同一份测量，照样看不见缺的那行。
  //    **解除依据（2026-09-10 实测，能量收入行级 Σ 切换 07481b8/a337c02 之后重测）**：该族试探
  //    现在**进入但全部被拒**——探针实测 auto-1591-1481-1311 `underfill=1.563` → attempt0
  //    `trialRows=181.35 > 预算−容差 179`（fits=false）→ 回滚「宁可留白不制造超预算」；开关该
  //    排除在**全链逐位零差异**（`timeGolden` 127 预设 + 60 角色×命座 0/6 全 0 delta、
  //    `timeLedgerInvariants`/`timeFillRatchet`/`underfillRefund` 同绿、`npm run verify` EXIT=0）。
  //    **该缺口已收口（2026-09-15 复核）**：轴模式赠大时间**已进** `frontlineRowsOf`
  //    （见下方 `config.axisLiuyinPromote` 分支）；轴模式 promote 次数与通用公式的**分歧也已关闭**
  //    （阈值结转修正，判据 `liuyin.test.ts`「通用公式 vs 轴预设声明」）。
  //    ⚠ 旧注释引用的 `liuyinGiftChainInfo` 已删（2026-09-13 迁为模块 `crossAgentSupply`），
  //    别再按它去找代码。仍由 `timeLedgerInvariants` 持续兜住越账。
  //  · 1051 伊德海莉 / 1531 星徽·比利：**2026-09-08 已放回**——它们当初被排除是因为热启动缓存注入
  //    收敛末态导致冷/热落点分叉（0.009s / 0.0015s），而「缓存只存规范种子」修好后同配置计算逐位
  //    稳定，两族试探全绿（seedInvariance / warmStart / yidhariInteractionGrid / timeLedgerInvariants）。

  // 热启动：无显式种子时查缓存，命中则从上次收敛态出发（逐位透明，见块注释）
  const warmExactKey = config.initialStates ? '' : warmStartExactKey(config)
  const warmSeed = lookupWarmStart(config, warmExactKey)

  // 初始 state：平A时间按权重分配，强特/大招次数初始为0（initialStates 注入：测试/热启动用）
  const totalWeight = configs.reduce((a, c) => a + c.timeWeight, 0)
  const injectedStates = config.initialStates && config.initialStates.length === configs.length
    ? config.initialStates
    : warmSeed?.states
  // 默认零种子快照：规范重跑用（种子注入的轨迹若未正常收敛 = 停点含瞬态相位成分，弃掉重跑冷轨迹）
  // **计数通道**：`stunPlanProjection` 打开时把失衡计划值投影成整数再乘进连携数（默认 off = 现状，
  // 见 `core/stunPlanProjection.ts`）；时间账（窗口/覆盖率/`stunSeconds`）继续用实数 `config.stunCount`。
  const countStunPlan = projectStunPlanForCounts(config.stunCount ?? 0, config.stunPlanProjection ?? 'off')
  const defaultSeedStates: IterationState[] = configs.map(cfg => ({
    basicAttackTime: totalWeight > 0
      ? totalTime * (cfg.timeWeight / totalWeight)
      : 0,
    exSpecialCount: 0,
    ultimateCount: 0,
    chainCountTotal: (cfg.chainCountTotalOverride ?? cfg.chainCountPerStun * countStunPlan) + (cfg.chainCountTotalExtra ?? 0),
    totalEnergy: 0,
    totalDecibel: cfg.initialDecibelGift + (cfg.extraSelfDecibelReward ?? 0),
    necessaryTime: 0,
    frontlineTime: totalTime * (cfg.timeWeight / totalWeight) / Math.max(1, totalWeight) * totalWeight,
    backstageTime: 0,
    comboAlignTime: 0,
    comboAlignCredit: 0,
  }))
  let states: IterationState[] = injectedStates
    ? injectedStates.map(s => ({ ...s }))
    : defaultSeedStates.map(s => ({ ...s }))

  // 时间预算收敛（外层）+ 资源收敛（内层）：
  // 模块 buildExecutions 会物化出占用前台、但未计入 estimateExSpecialTime 的动作行
  // （雅霜月架势/叶瞬光飞光/柏妮思双喷/星徽比利EX链等）。本循环把每个角色执行行的
  // **前台时间**（timeBucket ≠ 'backstage'，见 isFrontlineExecution）对其**自家账本**
  // （necessaryTime + basicAttackTime）收敛：超出量折入 timeBudgetExcess → 压缩全队平A池
  // → 平A回能减少 → 次数重收敛。收敛后 Σ前台执行行 ≡ 账本 ≡ 共享时间轴的占用（构造性恒等式）。
  // （战斗时间 − 无敌时间）由 iterate 的共享平A池钳制消费：availableBasicTime = max(0, 预算 − Σ必要 + refund)。
  // 反向（账本高估：estimate 计了物化不存在的行，如连段块双算/历史 excess 残留）会把 basic 挤到 0
  // → 物化行打不满战斗时间：团队正差经 timeBudgetRefund 回填平A池（仍按 timeWeight 分配，时间守恒）。
  // 折叠环轮数上限 = 算力护栏（默认值见 TIME_FOLD_MAX_PASSES）。
  // 2026-09-10 尾巴专项实测：**8 轮上限曾是唯一的「非收敛」来源**——判据是 `maxExcess ≤ 1e-3`，
  // 而慢收缩队的残差按几何比 ρ≈0.5~0.70/轮衰减（billy-roxy-lucia 3.637→0.417 七轮、
  // auto-1591 系 0.173→0.003 七轮），到判据要 10~25 轮，8 轮先把它们砍在残差 0.4s / 3 毫秒上。
  // 上限只对「本来就要跑满」的队收费（实测 127 预设：8 轮顶格 6 队，其余 121 队 ≤5 轮）。
  const maxTimeIter = config.maxTimeIterations || TIME_FOLD_MAX_PASSES
  // 重置上一轮调用残留的时间预算（cfg 可能被外层不动点复用）
  for (const cfg of configs) cfg.timeBudgetExcess = 0
  config.timeBudgetRefund = 0
  // 求解诊断累加器（CC-4，2026-09-25）：原 10 个函数级 `let`（converged/iter/timeBudget*×5/
  // refundFrozen/bestExcess/stagnantPasses）收成唯一可变对象，S2 折叠环经 `diag` 参数注入读写。
  // 重折环 `resetDiagnostics` = 换新对象；被接受态存引用、拒绝时整体换回（口径 `engine:收敛读数归属`）。
  let diag = createSolveDiagnostics()
  /**
   * 热启动种子 = **规范种子**（本轮 `states` 的初值：默认零种子或注入种子本身），**不是收敛末态**。
   * 为什么不能存末态（2026-09-08 修，用户实测「同一队算两次结果不一样」）：折叠 pass0 的 refund
   * 冻结（`teamRefund`）与内层落点都随初值变——非实数化队的落点本就随初值漂移（seedInvariance
   * 的「游戏等价」档），存末态等于把本轮落点带进下一轮：同配置第二次计算换结果（实测 1431 系
   * 4 队冷/热 slack 9.20 vs 4.86、7.57 vs 1.03、3.06 vs 6.26、0.68 vs 0.45，且门槛 10s 同样复现
   * ——与欠打回填门槛无关）。缓存机制（精确键 / LRU / 命中计数）保留，但注入种子必须与冷算同源。
   * 真正的加速要等实数化专项（落点唯一）之后才可能。
   * @fact engine:热启动逐位透明 口径: 热启动缓存只存**规范种子**（本轮 states 初值），不存收敛末态/试探前末态——折叠 pass0 的 refund 冻结与内层落点随初值变，存末态会让同配置第二次计算换结果（实测 1431 系 4 队冷热 slack 9.20 vs 4.86 等）；改前「存试探前末态」只解决了「从已回填态出发」那一种分叉 | 据 用户实测@2026-09-08「同一队算两次结果不一样」·复核@2026-09-08·复核@2026-09-25 | 验 src/core/__tests__/warmStart.test.ts | 锚 src/core/resource.ts#warmSeedStates | 信 确认
   */
  const warmSeedStates: IterationState[] = states
  /**
   * 内层次数收敛 + 停点规范化（环检测 + 字典序规范停点）已迁 `src/core/resource/innerLoop.ts`
   * （CC-3，纯函数）：折叠循环与欠打回填试探共用同一台机器。此处只注入只读 ctx
   * （configs/config/maxIter/oscillatorStop），经 `foldCtx` / `probeCtx` 传给两个调用方。
   * 原 `runInnerLoop` 包装行的最后一个消费者（欠打回填 `convergeCounts`）已随 CC-5a 迁出，
   * 包装随之删除——`underfillProbe.ts` 直接 `runInnerLoop(from, ctx.innerCtx)`。
   */
  const innerCtx: InnerLoopContext = { configs, config, maxIter, oscillatorStop }
  // `runFoldLoop`（S2 时间预算折叠环）已迁 `src/core/resource/foldLoop.ts`（CC-4，2026-09-25，纯函数）。
  // 下列 `@fact` 的**实现已迁**该文件，声明按既有惯例留在 re-export 壳处（同 CC-3 `innerLoop.ts` 的处理）；
  // **锚已随实现改指新文件**，豁免清单键（`src/core/resource.ts engine:收敛环停点规范化`）不变。
  // @fact engine:收敛环停点规范化 口径: 注入种子（热启动/显式 initialStates）的收敛轨迹若属非正常收敛（跑满上限或全状态签名精确重复=入极限环），该停点含瞬态相位成分 → 弃用并从默认零种子**规范重跑**；重跑仍入环则取环内 JSON 字典序最小成员为规范停点（相位无关，冷/热进同一环成员集合相同）。正常收敛照旧接受（不动点唯一性 = 2026-09-04 连续松弛教义）。结果 = f(默认种子, 迭代映射)，与注入种子彻底解耦 | 据 喧响行级化专项实测@2026-09-08·复核@2026-09-25 | 验 src/composables/__tests__/yidhariInteractionGrid.test.ts + src/core/__tests__/decibelRowParity.test.ts | 锚 src/core/resource/foldLoop.ts#runFoldLoop | 信 确认
  /**
   * S2 时间预算折叠环（CC-4 外提至 `./resource/foldLoop.ts`，纯函数）的只读上下文与包装。
   * ⚠ 包装**每次调用时读 `diag`**（禁止 `const d = diag` 缓存——重折环会换新对象，缓存会写到旧对象）。
   * 两个调用点（正常轨迹 / 截断重折环）逐字不改。
   */
  const foldCtx: FoldLoopContext = {
    configs, config, totalTime, maxTimeIter,
    injected: !!injectedStates, defaultSeedStates, innerCtx,
  }
  const runFoldLoop = (from: IterationState[]): IterationState[] => runFoldLoopPure(foldCtx, diag, from)
  /**
   * S3a 欠打回填试探（CC-5a 外提至 `./resource/underfillProbe.ts`，纯函数）的只读上下文。
   * 门槛常量（`UNDERFILL_PROBE_THRESHOLD_SECONDS` / `TIME_BUDGET_TOLERANCE_SECONDS`）的声明与
   * `@fact` 留在本文件（锚指常量本身），经 ctx 注入；`diag` 由包装**每次调用时读**（重折环换对象）。
   */
  const probeCtx: UnderfillProbeContext = {
    configs, config, totalTime, innerCtx,
    thresholdSeconds: UNDERFILL_PROBE_THRESHOLD_SECONDS,
    toleranceSeconds: TIME_BUDGET_TOLERANCE_SECONDS,
  }

  // ===== 终局整数重推（链数/轮数实数化收尾；规则 6 引擎落点，2026-09-25 CC-6c）=====
  // 迭代期 1531 动力压制链数、1431 明心境轮数以**实数**参与收敛（正反馈连续通道；消滞后后估时与
  // 物化共用同一求解器），终局 floor 一次 + 整数态重推 ≤12 轮到全状态逐位稳定，让时间预算/能量/
  // 喧响账本与整数次数自洽。角色专属部分（谁参与 / 置哪个旗标 / 何时复位）已迁各模块的
  // `finalizePass` 能力（starlightBilly / yeshuguang 声明 `stage='preTail'`），本处只调通用执行器
  // `runFinalizePasses`——引擎不写 agentId、不 import 角色模块。
  //
  // 旗标在最终装配后才复位：欠打回填试探与最终装配都必须按**整数物化行**测可行性/出账，
  // 否则「floor 后 +1 链（≈10s）」的时长会被当成余量放行（1s 容差兜不住一整链）。
  // ⚠ preTail 与 tail 两个 stage **不可合并**（欠打回填前 vs 后，合并会改数值）。
  const runPreTailFinalize = (from: IterationState[]): IterationState[] => {
    const fp = runFinalizePasses(configs, from, 'preTail', iterate, config)
    if (fp.converged) diag.converged = true
    return fp.states
  }

  // 正常轨迹：折叠 + 比利重推
  // S2 入口快照（债 2 批 2-1 重折环用）：cfg 浅拷贝 + 规范种子副本。重折 = 「假如一开始就带 rowTimeLimit」从这里重跑，
  // 而不是在被第一遍尾段改写过的 cfg（yidhariExternalHealPct 累加、终局旗标、refund 试探）上叠着跑。
  const s2EntryCfgs = configs.map(c => ({ ...c }))
  const s2EntrySeedStates = states.map(s => ({ ...s }))
  states = runFoldLoop(states)
  states = runPreTailFinalize(states)

  // ===== S3–S4 尾段管线（R37-J2 步骤 ① 函数化 2026-09-19；CC-5c 外提 `./resource/tailPipeline.ts`）=====
  // 末轮欠打回填 → 伊德海莉终推 → 热启动落缓存 → 赠链/终结礼/帷幕次数 → S4 装配（`assembleSlot`）。
  // 债 2 批 2-1「截断外环回灌」要在初装截断 > 容差时按每槽 kept 设 cfg.rowTimeLimit，从 S2 折叠起
  // **重跑到装配**；实现已外提为纯函数 `runTailPipelinePure(ctx, diag, states)`（CC-5c，2026-09-25）。
  // 下面只是**保语义包装**：每次调用读 `diag` 与 `states`，并把新 `states` 写回外层——重折环的
  // `accepted.states` 快照 / 拒绝还原依赖它（两个调用点逐字不改）。判据 = timeGolden / timeFillRatchet
  // delta 0（规则 10）；先例 = #8 分刀 `assembleSlot`。
  const tailCtx: TailPipelineContext = {
    configs, config, totalTime, probeCtx, warmExactKey, warmSeedStates,
  }
  const runTailPipeline = () => {
    const r = runTailPipelinePure(tailCtx, diag, states)
    states = r.states
    return r.tail
  }
  let tail = runTailPipeline()
  /** 重折环之前的初装截断（同一次运行内的读数；诊断量 `truncationBeforeRefoldSeconds`，只在进了重折环时上报） */
  const truncationBeforeRefold = tail.timeTruncatedSeconds

  // ===== 债 2 批 2-1：截断外环回灌（rowTimeLimit 重折环，2026-09-19 R37-J2 ②）=====
  // 病灶：S1 迭代按**未截断行**计回能/喧响 ⇒ 强特/终结次数被 180s 装不下的行推高 ⇒ 招式行塞爆前台被 S4 截断 ⇒
  // 账本 > 展示层（般+诺+卢实测槽0 回能账本 200 vs 截断后行 Σ 140）。修法（用户 2026-09-11 给定语义「装不下就重收敛」）：
  // 初装截断 > 容差时，把每槽装配 kept（招式行真兑现的秒数）作为 cfg.rowTimeLimit 注入，回到 S2 入口重跑
  // 折叠 → 比利终推 → 尾段（欠打回填 → 伊德海莉终推 → 装配）；账本收入经 feasibleRows 只数装得下的行。
  // 接受判据 = Σcut **不增**（≤ 上次 + 1e-6；相等也接受——那正是「账本按真装得下的行计」的不动点态）；变大则整体回滚到
  // 上一次接受态并停。停机 = 本轮 kept 与上一轮写入的 rowTimeLimit 逐槽一致（|Δ| ≤ 1e-3，账本 == 展示层，无需再跑）或 3 轮用尽。
  // 默认路径（cut ≤ 1s 的队，刀 1 后 103/105 预设）：零分支零写入 ⇒ 逐位 0 delta；结构性溢出（必要行本身 > 预算，1431 簇）
  // 若一轮后 cut 不降 ⇒ 回滚初装态、如实上报（overflowSeconds / truncationCuts），交给外层降配 / 逐模块退化。
  // ⚠ 三条纪律：① cfg 对象保持同一性（闭包/外层不动点持有引用）⇒ 还原用「清键 + assign」；② rowTimeLimit 返回前恒删除
  //   （cfg 被外层不动点/热启动复用，WARM_KEY_OMIT_CFG 也已排除）；③ 函数级诊断量随每次重跑归零，报告的是被接受那一跑的读数。
  const ROW_REFOLD_MAX_PASSES = 3
  let truncationRefoldPasses = 0
  let truncationRefoldRejected = false
  let lastLimits: Map<number, number> | null = null
  const restoreCfgs = (snap: Record<string, unknown>[]) => {
    configs.forEach((c, i) => {
      const rec = c as unknown as Record<string, unknown>
      for (const k of Object.keys(rec)) delete rec[k]
      Object.assign(rec, snap[i])
    })
  }
  const resetDiagnostics = () => {
    // 换新对象 = 旧式 10 字段逐项归零（`createSolveDiagnostics` 初值与旧 `:263–274` 逐字相同）。
    diag = createSolveDiagnostics()
  }
  for (let refoldPass = 0; refoldPass < ROW_REFOLD_MAX_PASSES; refoldPass++) {
    if (tail.timeTruncatedSeconds <= TIME_BUDGET_TOLERANCE_SECONDS) break
    const keptBySlot = new Map<number, number>()
    for (const e of tail.truncationBySlot) {
      if (e.cutSeconds > TIME_BUDGET_TOLERANCE_SECONDS) keptBySlot.set(e.slot, Math.max(0, e.kept))
    }
    if (keptBySlot.size === 0) break
    // 不动点：本轮装配 kept 与上一轮写入的 rowTimeLimit 逐槽一致 ⇒ 账本已按真装得下的行计，停
    if (lastLimits && lastLimits.size === keptBySlot.size
      && [...keptBySlot].every(([slot, k]) => Math.abs((lastLimits!.get(slot) ?? Infinity) - k) <= 1e-3)) break
    // 上一次接受态的快照（拒绝时整体还原）
    // `diag` 存**引用**即可：随后 `resetDiagnostics()` 换新对象，旧对象此后无人写 ⇒ 引用等价于旧式
    // 10 字段逐项值快照（口径 `engine:收敛读数归属`：诊断量归属被接受的那次调用）。
    const accepted = {
      cfgs: configs.map(c => ({ ...c })) as Record<string, unknown>[],
      states,
      diag,
      timeBudgetRefund: config.timeBudgetRefund,
      overflowSeconds: config.overflowSeconds,
      tail,
    }
    // 回到 S2 入口：cfg 还原为入口态 + 本轮 rowTimeLimit（其余槽不写），种子同规范种子，诊断量归零
    restoreCfgs(s2EntryCfgs)
    for (const cfg of configs) {
      const k = keptBySlot.get(cfg.slot)
      if (k !== undefined) cfg.rowTimeLimit = k
    }
    for (const cfg of configs) cfg.timeBudgetExcess = 0
    config.timeBudgetRefund = 0
    resetDiagnostics()
    states = runFoldLoop(s2EntrySeedStates.map(s => ({ ...s })))
    states = runPreTailFinalize(states)
    const trial = runTailPipeline()
    if (trial.timeTruncatedSeconds <= accepted.tail.timeTruncatedSeconds + 1e-6) {
      tail = trial
      lastLimits = keptBySlot
      truncationRefoldPasses += 1
      continue
    }
    truncationRefoldRejected = true
    // 拒绝：整体还原到上一次接受态（cfg 同一性保持），停止重折
    restoreCfgs(accepted.cfgs)
    states = accepted.states
    // 换回接受态那次调用的诊断对象（旧式 10 字段逐项还原；重折期间写的是已弃用的新对象）
    diag = accepted.diag
    config.timeBudgetRefund = accepted.timeBudgetRefund
    config.overflowSeconds = accepted.overflowSeconds
    tail = accepted.tail
    break
  }
  // rowTimeLimit 是本函数内部的迭代量：返回前恒删除（cfg 被外层不动点 / 热启动复用）
  for (const cfg of configs) delete cfg.rowTimeLimit
  const { characters, timeTruncatedSeconds, truncationCuts, truncationBySlot, inputStunCount } = tail

  // 溢出 = **被时间线截断掉的秒数**（装配阶段实测）：为了塞进战斗时间砍掉了多少动作。
  // 截断后 Σ物化净占用恒 ≤ 预算，所以"账本超预算"（iterate 那份中间值）与"物化超预算"
  // 都不再是溢出——只有真被砍掉的时间才是。消费方：TeamComparePage 操作难度横轴（1秒=1难度点）。
  // debt: 截断不回灌资源循环（A 项，2026-09-11 用户立项）——被砍招式的行级回能/喧响仍按**未截断**的
  //       `state` 计进账本（`calcEnergySource` 走 `materializeRows(state)`），于是资源池总量/次数
  //       （如强特 40 次）比 180s 计划实际兑现的高（实测般+诺+卢全关档：槽0 回能账本 200 vs 截断后行 Σ 140）。
  //       修法（用户给定语义）：先按预算重分配平A池、交互只取「达成目标的最少要求」，装不下就重收敛，
  //       直到截断为 0（A 项 = 截断后行重收敛）。due: A 项落地（含全库 delta 归因）时销号。
  //       进度（2026-09-19 R37-J2，批 2-1）：上方 rowTimeLimit 重折环已落地「装不下就重收敛」的外环形态（只接受 Σcut 严格变小，
  //       ≤3 轮）；刀 1 后全库仅 1431 簇两队有初装截断，其余 103 队默认路径逐位 0 delta。**未销号**：结构性溢出队重折后
  //       仍可能残留截断（如实上报），「直到截断为 0」要等实数化专项 + 用户终验。
  // @fact engine:资源账本/截断 口径: 资源池能量/喧响收入按 feasibleRows 计（cfg.rowTimeLimit 缺省 = 未截断行；初装截断 > 容差时重折环按每槽装配 kept 注入、从 S2 入口重跑到装配，只接受 Σcut 严格变小、≤3 轮、拒绝即整体回滚、返回前删键），装配期截断只削招式行（伤害/失衡随之降）；残留截断如实上报（overflowSeconds/truncationCuts） | 据 用户@2026-09-11·实测般+诺+卢 · 债2批2-1@2026-09-19 R37·复核@2026-09-25 | 验 src/composables/__tests__/teamTimeSummary.test.ts + src/core/__tests__/truncationRefold.test.ts | 锚 src/core/resource.ts#calcTeamResources | 信 确认
  // ⟳复核: 重折环上限 / 接受判据 / kept 口径再动时，复核「默认路径（cut ≤ 1s 队）逐位 0 delta」+「1431 簇两队 Σcut 只减不增、cfg 无 rowTimeLimit 残留」（truncationRefold.test.ts + timeGolden） | 到期 2026-12-31
  config.overflowSeconds = timeTruncatedSeconds

  // 比利/伊德海莉/叶瞬光终局旗标复位：cfg 对象被外层不动点/热启动复用，下轮调用必须回到实数迭代期
  // （伊德海莉复位必须在装配之后：装配行按 finalizeEx=true floor 蓄力 cycles，见 buildYidhariExecutions）。
  // 2026-09-25 CC-6c：角色专属复位（谁复位哪个旗标、叶瞬光的 `yeshuguangContinuousForms === 1` 门控）
  // 已迁各模块的 `finalizePass.reset`，本处只调通用执行器 `resetFinalizePasses`——引擎不写 agentId。
  resetFinalizePasses(configs)

  // 终局预留量（供 applyLiuyinPromote 判定跳过 post-hoc carve；与 iterate Step4 同一求解）
  // ——与上方 giftTimeOfSlot 同源（同一 helper、同一轴模式条件），不重算。
  const liuyinGiftTimeTotal = tail.liuyinGiftTimeTotal

  // 收敛读数归属设施（2026-09-10 尾巴专项，`PROBE_TRACE_FOLD=1` 打开；不开则零副作用）：
  // **一次预设求值会跑 N 次 `calcTeamResources`**（外层不动点轮 + 非轴对照 + 降配二分 6×2 + 下游重算，
  // 实测 billy-roxy-lucia 18 次），每次自带一份折叠环与诊断量，而 `ConvergenceReport` 只暴露
  // **被接受那次**的读数。逐 pass 打表若不按调用分组，就会把别的管线（例如第 2 轮就收敛的可行试探）
  // 的读数当成被接受管线的——尾巴专项里正是这样误判过一轮（见 docs 坑33「尾巴专项收口」）。
  // 消费方：`src/composables/__tests__/convergenceProbe.test.ts` 的 `PROBE_CONV_TEAM` 分支。
  if (typeof process !== 'undefined' && process.env?.PROBE_TRACE_FOLD === '1') {
    const g = globalThis as unknown as { __foldTrace?: unknown[] }
    ;(g.__foldTrace ??= []).push({
      passes: diag.timeBudgetPasses,
      conv: diag.timeBudgetConverged,
      residual: diag.timeBudgetResidualSeconds,
      idle: diag.timeBudgetIdleSeconds,
      refund: diag.timeBudgetRefundedSeconds,
      truncated: timeTruncatedSeconds,
      team: configs.map(c => c.agentId).join('/'),
    })
  }

  return {
    totalTime,
    plannedStunCount: inputStunCount,
    characters,
    iterations: diag.iterations,
    converged: diag.converged,
    axisOverlapSeconds: config.axisOverlapSeconds,
    axisOverlapByAction: config.axisOverlapByAction,
    overflowSeconds: config.overflowSeconds,
    truncationCuts: truncationCuts.length > 0 ? truncationCuts : undefined,
    // 琉音好评转大赠链时间已由引擎预留（非轴）→ applyLiuyinPromote 不再 post-hoc carve 守恒
    liuyinGiftTimeReserved: liuyinGiftTimeTotal > 0 ? liuyinGiftTimeTotal : undefined,
    // 诺姆膛温换连携赠链时间（对称暴露，供「账本预留 == 装配赠行」机器判据核对）
    normaGiftTimeReserved: tail.chainGiftTime > 0 ? tail.chainGiftTime : undefined,
    convergence: {
      timeBudgetConverged: diag.timeBudgetConverged,
      timeBudgetPasses: diag.timeBudgetPasses,
      timeBudgetResidualSeconds: diag.timeBudgetResidualSeconds,
      timeBudgetIdleSeconds: diag.timeBudgetIdleSeconds,
      timeBudgetRefundedSeconds: diag.timeBudgetRefundedSeconds,
      timeTruncatedSeconds,
      truncationBySlot: truncationBySlot.length > 0 ? truncationBySlot : undefined,
      truncationRefoldPasses: truncationRefoldPasses > 0 ? truncationRefoldPasses : undefined,
      truncationRefoldRejected: truncationRefoldRejected || undefined,
      truncationBeforeRefoldSeconds: truncationRefoldPasses > 0 ? truncationBeforeRefold : undefined,
    },
  }
}

// ============ 辅助函数（招式表查询已迁 src/core/resource/moveLookup.ts）============

// 下沉（2026-09-13 展示层越层棘轮）：定义在 src/data/resourceDefaults.ts，此处 re-export 保持
// 引擎侧调用点与既有 `@/core/resource` 引用零改动；展示层改 import `@/data/…`。
export { ULTIMATE_COST_DEFAULT } from '@/data/resourceDefaults'

// 下列两条 `@fact` 的**实现已迁** `src/core/resource/moveLookup.ts`，声明按既有惯例留在
// re-export 壳处（同 `data/exSpecialPlans.ts` 声明 → 锚 `findExSpecial`）；**锚已随实现改指新文件**。
// @fact engine:fusedGroupMetrics/一次动作整段量 口径: 登记融合组的「一次动作」在倍率·失衡·积蓄·喧响上 Σ 全部段、在前台时间上只 Σ countsTime≠false 的段（能力场/自动攻击段不站场）；未登记段仍取本段值 | 据 用户@2026-09-11「倍率表必须融合，因为连携本身就是打3段」+「时间通道只回头段那也不行，必须改」+「只有炮击算时间，能力场是自动攻击，不算时间」·复核@2026-09-25 | 验 src/composables/__tests__/moveFusion.test.ts | 锚 src/core/resource/moveLookup.ts#fusedGroupMetrics | 信 确认
// @fact engine:findChainAttack/多段连携 口径: 登记融合组的连携「一次动作」时长 = Σ 站场段 actionTime（星见雅春临 0.515+0.515+0.687=1.717s；妮可 0.25+0.25=0.5s，能量场段不计时），喧响 = Σ 全部段（雅 230.15、妮可 217.25，全体基线 168~278）；未登记连携仍取头段 | 据 nanoka full/1091.json + full/1031.json param.desc + 用户@2026-09-11·复核@2026-09-25 | 验 src/composables/__tests__/moveFusion.test.ts | 锚 src/core/resource/moveLookup.ts#findChainAttack | 信 确认

// 招式表查询（`find*` 族 + 融合组「一次动作」整段量）——CC-1（2026-09-24）迁
// `src/core/resource/moveLookup.ts`；此处 re-export 壳保持全仓调用方（`@/core/resource`）
// 零改动。实现、职责注释与 @fact 锚随实现落在新文件。
export {
  findExSpecial,
  findUltimate,
  fusedGroupMetrics,
  fusedGroupActionTime,
  findChainAttack,
  findDodgeCounter,
  findDefensiveAssist,
  findAssistFollowUp,
  findCounterAssist,
  findRemielleRainbowEnd,
  findRemielleRadiantTurn,
  calcBasicAttackRegenPerSec,
} from './resource/moveLookup'

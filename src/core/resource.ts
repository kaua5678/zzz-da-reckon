import type {
  ResourceCalcConfig, CharacterOperationConfig,
  TeamResourceResult, CharacterResourceResult,
  IterationState, SkillExecution, TruncationCut,
} from '@/types/resource'
import { isFrontlineExecution } from '@/types/resource'
import { getAgentMechanic } from '@/mechanics'
import { projectStunPlanForCounts } from '@/core/stunPlanProjection'

import {
  crossAgentSupplyAt,
  crossAgentSuppliesOf,
  findCrossAgentSupplySlots,
  ultimateGiftOf,
  giftDecibelForCfg,
  type CrossAgentSupplyInfo,
} from './resource/crossAgentSupply'
import { curtainInfoOf } from './resource/curtain'
// 终局整数重推执行器（规则 6 引擎落点，2026-09-25 CC-6c）：1531/1431（preTail）与 1051（tail）
// 的角色专属「谁参与/置哪个旗标」已迁各模块的 `finalizePass` 能力，本文件只调通用执行器。
import { runFinalizePasses, resetFinalizePasses } from './resource/finalizePasses'
// 求解诊断累加器（CC-4，2026-09-25）：10 个函数级诊断 `let` 收成唯一可变对象；重折环换新对象
// 即归零、拒绝时换回快照对象——口径 `engine:收敛读数归属`（诊断量归属被接受的那次调用）。
import { createSolveDiagnostics } from './resource/solveDiagnostics'
// S2 时间预算折叠环（CC-4）：纯函数外提，`diag` 每次调用时由包装读取（禁止缓存，重折换对象）。
import { runFoldLoop as runFoldLoopPure, type FoldLoopContext } from './resource/foldLoop'
// 物化 + 相位写入包装（CC-4 外提）：产行钩子对 cfg 只读，相位由引擎按同一 state 补写。
import { buildExecutionsWithPhase } from './resource/phaseExecutions'

export { crossAgentSupplyAt, crossAgentSuppliesOf, findCrossAgentSupplySlots, ultimateGiftOf }
export type { CrossAgentSupplyInfo }

// 热启动缓存已迁 src/core/resource/warmStart.ts（CC-2）；此处 re-export 壳保持既有
// `@/core/resource` 引用（测试 / dump / 编排层）零改动。
import {
  warmStartExactKey,
  lookupWarmStart,
  storeWarmStart,
} from './resource/warmStart'
export { clearWarmStartCache, getWarmStartStats } from './resource/warmStart'

// ============ 单角色能量计算 ============

/**
 * 赠行**物化口径**（阶段1 ②，2026-09-10）：行由引擎产出（存在/次数单一事实源），倍率由编排层补。
 *
 * 下面两个薄包装只是把「账本口径」（`crossAgentSupplyAt`，带秒数）转成「行口径」（带次数），
 * 并统一按 `config.teamSize`（编排层队长）解析目标槽——与账本口径 `configs.length` 解耦。
 */
function chainGiftRowSpec(
  configs: CharacterOperationConfig[], states: IterationState[], totalTime: number, teamSize: number | undefined,
): { targetIdx: number; count: number } {
  const [info] = crossAgentSuppliesOf(configs, states, 'gift-chain:chain', {
    totalTime, stunCount: 0, teamSize, axisMode: false,
  })
  return !info || info.count <= 0 || !configs[info.targetIdx]
    ? { targetIdx: -1, count: 0 }
    : { targetIdx: info.targetIdx, count: info.count }
}

/** 行口径的琉音赠大（含次数）：轴模式用轴预设计数，非轴用模块供给；目标槽按 `teamSize` 解析 */
function ultimateGiftRowSpec(
  configs: CharacterOperationConfig[], states: IterationState[], totalTime: number, stunCount: number,
  axisPromote: { targetSlot: number; count: number } | undefined, axisMode: boolean, teamSize: number | undefined,
): { targetIdx: number; count: number } {
  // 轴模式：次数由轴预设 `promoteVariant` 块决定（模块供给被 axisSuppressed 跳过），预设计数优先
  if (axisMode && axisPromote && axisPromote.count > 0) {
    return configs[axisPromote.targetSlot] ? { targetIdx: axisPromote.targetSlot, count: axisPromote.count } : { targetIdx: -1, count: 0 }
  }
  const [info] = crossAgentSuppliesOf(configs, states, 'gift-chain:ultimate', {
    totalTime, stunCount, teamSize, axisMode,
  })
  return !info || info.count <= 0 || !configs[info.targetIdx]
    ? { targetIdx: -1, count: 0 }
    : { targetIdx: info.targetIdx, count: info.count }
}

/** 计算单角色能量回复（单次迭代，基于当前时间分配） */
import * as ResourceCalcHelpers from './resource/helpers'
import { buildGiftRow } from './resource/giftRows'
// S1 内层不动点已迁 src/core/resource/innerLoop.ts（CC-3）；此处按名 alias 引入，函数体内以同名
// 包装 `runInnerLoop` 注入只读 ctx ⇒ 两个调用点（折叠环 / 欠打回填试探）逐字不改。
import { runInnerLoop as runInnerLoopPure, type InnerLoopContext } from './resource/innerLoop'
const { calcEnergySource, calcRawDecibelParts, calcDecibelSource, calcTimeAllocation, materializeRows, buildAnomalyEventExecutions, iterate, calcCrossAgentEnergy, truncateExecutionsToFrontline } = ResourceCalcHelpers

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
 * | S4 | 装配 + 可行化截断 | `stageAssembleSlot`（#8 分刀自逐槽 `configs.map` 抽出；截断在 `truncateExecutionsToFrontline`） | states + cfg → `characters[]`（行/资源/时间） | 平A行不参与截断；后台行不占前台；整数装包；`overflowSeconds`/`truncationCuts` 逐行上报 |
 * | S5 | 物化输出 | 本函数尾部的 `return` | 上面各阶段 → `TeamResourceResult` | 资源/计数取**未截断账本**、伤害/失衡取**截断后行**（二者不自洽是已知债务，见 DEBT_REGISTRY「截断不回灌资源循环」） |
 *
 * 顺序不可交换：S1 定次数/资源 → S2 让账本与物化行自洽 → S3 决定"撑不下时怎么退" → S4 削行 →
 *  S5 输出。**S1 的行级资源收入按 `feasibleRows` 取（`cfg.rowTimeLimit` 由外环注入）**，
 *  这条是 A 项（截断回灌）的预留接口，缺省不截断 ⇒ 既有口径不动。
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
   * （CC-3，纯函数）：折叠循环与「② 规范重跑」共用同一台机器。此处只注入只读 ctx
   * （configs/config/maxIter/oscillatorStop），两个调用点（`runFoldLoop` / `convergeCounts`）逐字不改。
   */
  const innerCtx: InnerLoopContext = { configs, config, maxIter, oscillatorStop }
  const runInnerLoop = (from: IterationState[]) => runInnerLoopPure(from, innerCtx)
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

  // ===== S3–S4 尾段管线函数化（R37-J2 步骤 ①，2026-09-19，零行为搬迁）=====
  // 末轮欠打回填 → 伊德海莉终推 → 热启动落缓存 → 赠链/终结礼/帷幕次数 → S4 装配（stageAssembleSlot）。
  // 为什么函数化：债 2 批 2-1「截断外环回灌」要在初装截断 > 容差时按每槽 kept 设 cfg.rowTimeLimit，从 S2 折叠起
  // **重跑到装配**；本段原是 calcTeamResources 体内的线性代码，不可二次进入——协作者半成品（分支
  // collab/wip-snapshot-20260919）正是卡在这里。本步只搬不改：块内代码逐字节原样、缩进 +2；读写的外层量
  // （states / converged / timeBudgetRefundedSeconds / timeBudgetIdleSeconds / config.* / cfg.*）仍经闭包，
  // 装配产物改为返回值。判据 = timeGolden / timeFillRatchet / allAgentsSweep delta 0（规则 10）；先例 = #8 分刀 stageAssembleSlot。
  const runTailPipeline = () => {
    // ===== 末轮欠打回填（可行性门控，2026-09-05）=====
    // 上面折叠循环的 refund **冻结在 pass0**，而 pass0 恒测到**正** excess（此时平A池按权重满额发放
    // → 模块专属行爆量 → 行时间超账本）→ refund 被冻成 0；此后 excess 转负（账本 > 物化行 = 时间
    // 没打满）就再也拿不到回填。实测 96/125 预设 refund=0、41 队留白 >1s（最大 93.7s = 朱鸢/妮可/苍角
    // 的 1241 槽：账本必要 138.3s vs 物化必要行 44.6s），而 timeBudgetConverged 仍报 true——
    // 「收敛健康」掩盖了「动作只打了 86s」。
    // 修法：折叠循环退出后重测一次欠打量，**折半试探**注入 refund 并重收敛；只有「物化净占用更接近
    // 预算、且不越过预算」才接受，否则回滚该次注入。必须是可行性门控而不是逐轮跟随——
    // refund→平A→回能→次数→物化行 是放大环（naive 逐轮跟随实测：留白 1544s→267s 的同时
    // 超预算队从 8 推到 20，破坏 netFrontlineOccupation ≤ 预算 这条被轴退化/降配/队伍对比消费的
    // 硬不变量）。门控保证本步**绝不比现状差**：要么把留白收小，要么原样不动。
    // 债1批1-3已销号（2026-09-18）：折半试探门控经 seedInvariance.test.ts（104 预设 × 4 种子）
    // 机器判据验证，全库次数落点零偏差，天花板与净占用不变量保持稳定，离散修正影响已被约束在容差内。
    {
      const budgetSeconds = totalTime - (config.invincibleTime ?? 0)
      const chainGiftProvider = findCrossAgentSupplySlots(configs, 'gift-chain:chain')[0] ?? -1
      /**
       * Σ物化前台**净**占用：扣轴内合轴分摊 + 每槽超出该分摊的招式合轴抵扣（max 不叠加）——
       * 与超时判定单一事实源 `netFrontlineOccupation` **完全同口径**，否则试探门控放行、
       * 装配后仍超预算（实测差出 164s）。
       */
      const frontlineRowsOf = (st: IterationState[]): number => {
        const overlap = config.axisOverlapByAction ?? {}
        const overlapBySlot: number[] = configs.map(() => 0)
        for (const [key, sec] of Object.entries(overlap)) {
          const slot = Number(key.slice(0, key.indexOf(':')))
          const idx = configs.findIndex(c => c.slot === slot)
          if (idx >= 0 && Number.isFinite(sec)) overlapBySlot[idx] += sec
        }
        let total = 0
        const chainGiftInfo = crossAgentSupplyAt(configs, st, chainGiftProvider, {
          totalTime, stunCount: config.stunCount ?? 0, teamSize: config.teamSize,
        })
        // 琉音赠大：一律走 `ultimateGiftOf`（单一事实源，`@fact engine:赠送时间/轴模式四处同源` ③）——
        // 轴模式用轴预设计数（`config.axisLiuyinPromote`），非轴用模块供给；不再在此内联轴分支（W19）
        const giftLiu = ultimateGiftOf(configs, st, {
          totalTime, stunCount: config.stunCount ?? 0, teamSize: config.teamSize,
          ...(config.axisMode ? { axisMode: true } : {}),
          ...(config.axisLiuyinPromote ? { axisPromote: config.axisLiuyinPromote } : {}),
        })
        const giftLiuTime = giftLiu.time
        const giftLiuTarget = giftLiu.targetIdx
        for (let i = 0; i < configs.length; i++) {
          const cfg = configs[i]
          const state = st[i]
          const teammateFrontline = configs.reduce(
            (sum, _, j) => (j === i ? sum : sum + st[j].frontlineTime), 0)
          // 试探测量切 `materializeRows`（阶段1 第二刀收口，2026-09-09）：相位写入已拆到
          // `materializePhaseState`（引擎侧显式补写），产行钩子对 cfg 只读——试探测量由此与装配同源
          // （同一 `buildExecutions`）且不再污染相位。**实测否决记录（同日早间）**：当时 3 处相位写入
          // 仍在钩子里，切换后 golden 多 9 条 delta（全在 1431，c0 留白 57.9→65.4s）——顺序必须是
          // 「先拆相位写入、再切测量」，否则测出的是相位污染而不是测量口径差异。
          const probeRows = materializeRows(cfg, state, state.chainCountTotal, teammateFrontline)
          // 相位写入照旧补写（与折叠/装配同口径）：产行钩子已只读，写入由引擎显式声明。
          // 不补写 = 下一轮 estimate 读到上一次物化的陈旧值（实测 golden 10 条 delta：1431 c0 留白
          // 57.9→65.4s、1181:c6 ex −1.29）。
          getAgentMechanic(cfg.agentId)?.materializePhaseState?.({ cfg, state, executions: probeRows, teamFrontlineSeconds: teammateFrontline })
          const rowNet = probeRows.reduce(
            (sum, e) => sum + Math.max(0, (e.totalTime ?? 0)
              - (overlap[`${cfg.slot}:${e.moveId}`] ?? 0))
              * (isFrontlineExecution(e) ? 1 : 0),
            0) + (i === chainGiftInfo.targetIdx ? chainGiftInfo.time : 0)
              + (i === giftLiuTarget ? giftLiuTime : 0)
          const extraCredit = Math.max(0, (state.comboAlignCredit ?? 0) - overlapBySlot[i])
          total += Math.max(0, rowNet - extraCredit)
        }
        return total
      }
      /**
       * 内层次数收敛 = 折叠环同一台机器 `runInnerLoop`（判稳严格相等 + 精确环检测 + 浮点噪声环视为已收敛，规范停点）。
       * 2026-09-19 前这里是一段**裸循环**（只有严格判稳、无环检测）：连续收缩队（1431 剑势环 / 1531 回血环）的试探
       * 进入 ulp 级微环后永远「未稳」⇒ 回填一律被拒——单人 1431 命座 6 实测留白 29.0s、`auto-1431-1341-1311`
       * 留白 1.5s 都是这一处拒出来的。真整数环仍 stable=false（与 ⑤a「规范停点当稳」不同——那次 1591 系变差被否决）。
       */
      const convergeCounts = (from: IterationState[]) => {
        const r = runInnerLoop(from)
        return { states: r.end, stable: r.clean }
      }
      let rowsFilled = frontlineRowsOf(states)
      let underfill = budgetSeconds - rowsFilled
      // 门槛 = 1s（量化容差，2026-09-08 用户口径「平A权重与留白不应并存，剩余自由时间按权重
      // 全部分配」）：欠打 >1s 一律试探回填；≤1s 属量化地板（坑12「不追求精确 0」，合轴可覆盖），
      // 不试探。历史：09-05 门槛 10s（当时扫描 1s=335/41/2(+2队崩) 5s=353/31/2 10s=391/23/2 20s=421/20/2，
      // 「+2 队崩」= 近均衡队被推进 stunCount=0 吸引盆：失衡 116k→9.5k，runArchiveDeploy 雅/南宫/柚叶队崩）；
      // 09-08 引擎（1051/1531 实数化、轴栈资源门控、sigrid 估时钩子、琉音三件套）上 1s 门槛复核：
      // ratchet 绝对不变量/runArchiveDeploy/allAgentsSweep/yidhariInteractionGrid 全绿，旧盆不复现
      // （实测数字见 underfillRefund.test.ts 与 docs 坑19① 否决记录）。
      // **无排除队（2026-09-10 起）**：1591 一族原排除已于本日解除（见 `calcTeamResources` 顶部
      // 注释的实测依据）；1051/1531 于 2026-09-08 随热启动规范种子修复放回。
      if (underfill > UNDERFILL_PROBE_THRESHOLD_SECONDS) {
        let probe = underfill
        for (let attempt = 0; attempt < 4 && probe > 0.5; attempt++) {
          const savedRefund: number = config.timeBudgetRefund ?? 0
          // 试探轮跑 iterate 会触发模块钩子的**写回**（叶瞬光自动选轴在 estimateExSpecialTime 里
          // 按 timeBudgetExcess 退化并改 record.yeshuguangAutoAxis；般岳补齐同款通道）——被拒的
          // 试探必须连 cfg 一起回滚，否则结构选择被副作用永久改写（实测 1431 队留白 2.6→11.3s、
          // 伤害 −13%，就是退化后的轴留在了 cfg 上）。
          const savedCfg = configs.map(c => ({ ...c }))
          // overflowSeconds 是 iterate 的副作用输出（编排层拿它判「非轴降配」缩交互次数）：
          // 试探轮会写下自己的溢出值，被拒后若不回滚，编排层会按一个不存在的溢出把交互缩光
          // → 失衡归零（实测 runArchiveDeploy 雅/南宫/柚叶队 stunCount 螺旋到 0）。
          const savedOverflow = config.overflowSeconds ?? 0
          config.timeBudgetRefund = savedRefund + probe
          const trial = convergeCounts(states)
          const trialRows = frontlineRowsOf(trial.states)
          // 留 1× 容差余量：本步之后还有伊德海莉终局整数重推（实测 +1.3s）与外层不动点再平衡，
          // 试探测得的行数不是最终装配的行数。margin 扫描（棘轮回归队数）：0=1 队 1=1 队 2=3 队。
          const fitsBudget = trialRows <= budgetSeconds - TIME_BUDGET_TOLERANCE_SECONDS
          if (trial.stable && fitsBudget && trialRows > rowsFilled) {
            states = trial.states
            rowsFilled = trialRows
            diag.timeBudgetRefundedSeconds = config.timeBudgetRefund ?? 0
            underfill = budgetSeconds - trialRows
            if (underfill <= TIME_BUDGET_TOLERANCE_SECONDS) break
          } else {
            config.timeBudgetRefund = savedRefund // 回滚：宁可留白，不制造超预算
            config.overflowSeconds = savedOverflow
            configs.forEach((c, i) => Object.assign(c, savedCfg[i]))
            probe /= 2
          }
        }
        diag.timeBudgetIdleSeconds = Math.max(0, underfill)
        // 热启动缓存**不存**试探前末态（2026-09-08 修）：折叠 pass0 的 refund 冻结与内层落点随初值变，
        // 存末态会让同配置第二次计算换结果（1431 系 4 队冷/热 9.20 vs 4.86 等）。缓存存的是本轮的
        // **规范种子**（见 warmSeedStates 声明处 @fact）——牺牲加速，换「同配置连续计算不许变」。
      }
    }

    // 失衡次数由外部失衡池不动点收敛后传入（连携次数 = chainCountPerStun × stunCount，见 iterate）
    const inputStunCount = config.stunCount ?? 0

    // 伊德海莉终局整数重推（targeted 连续松弛收尾，2026-09-04；规则 6 引擎落点，2026-09-25 CC-6c）：
    // 迭代期她的强特次数以实数参与收敛（refund 反馈解析求解 → 唯一不动点，消除 19/20 双稳态），
    // 终局 floor 一次 + 整数态重推 ≤12 轮到全状态逐位稳定，让时间预算/能量/喧响账本与整数次数自洽。
    // 角色专属部分（`stage='tail'` / 置哪个旗标）已迁 yidhari 模块的 `finalizePass` 能力，本处只调
    // 通用执行器（引擎不写 agentId、不 import 角色模块）。stage='tail' = 欠打回填之后、装配之前，
    // **不可与 preTail 合并**（合并会改数值）。
    // 终局重推要求全状态逐位稳定：她的次数已是整数，队友（如莱卡恩实数次数）在整数池下
    // 是整数输入的确定性函数——逐位相等才是 determinism.test（伤害逐位一致）的判据；
    // 只比次数会用 ε 外的平A时间残差破坏逐位一致。
    // 旗标复位移到装配之后（2026-09-09，与 billyFinalizeChain 同款）：装配行必须仍按终局语义
    // floor（yidhari 蓄力 cycles 迭代期实数松弛后，装配期靠本旗标取整数行），复位只服务于
    // 「cfg 被外层不动点/热启动复用，下轮调用回到实数迭代期」。
    // 实数迭代期的 2-循环（次数↔喧响↔终结技阈值）被终局整数重推吸收：重推稳定的整数态
    // 就是终局不动点，收敛标志按重推结果报（重推 ≤3 轮未稳 = 不谎报收敛）。
    {
      const fp = runFinalizePasses(configs, states, 'tail', iterate, config)
      states = fp.states
      if (fp.converged) diag.converged = true
    }

    // 热启动回写：本轮末态（无论是否完全收敛，同配置下次都从它出发）
    if (!config.initialStates) storeWarmStart(warmExactKey, warmSeedStates)

    // 收敛后按最终状态折算跨角色联动：卢西娅4命帷幕触发次数（含伊德海莉大招开帷幕）、回血按卢西娅大招次数
    // 2026-09-25 CC-6b：整块迁进引擎能力/跨槽供给（规则 6）——提供者按模块能力
    // `getAgentMechanic(cfg.agentId)?.curtainTriggers` 找槽（与 `luciaCinemaLevel` 是否在场无关，
    // 该字段写在编排层另一份 cfg 上的旧顾虑随之消失），队友开帷幕量按 `curtain-open` 收集成标量
    // （`yidhariSlot` 仍按 `yidhariDecibelPerHpPct` 字段找，继续用于外部回血写回与 yidhariBurn）。
    const curtain = curtainInfoOf(configs, states, totalTime)
    const curtainTriggers = curtain.triggers
    const yidhariSlot = configs.findIndex(c => c.yidhariDecibelPerHpPct !== undefined)

    // 构建最终结果
    /**
     * 赠送行时间（诺姆膛温赠链 / 琉音好评转大赠大）：由 `applyNormaHatChain` / `applyLiuyinPromote`
     * 在装配**之后**追加到目标槽执行计划，不在 `buildExecutions` 产物里；其时间已由 iterate 计入
     * 目标槽必要时间（GROSS 全额，见 helpers.ts Step4 两处预留）。**截断上限与前台展示必须同口径计入**，
     * 否则：① 其它行按「含赠送时间的账本」截断、再叠加赠送行 → 物化行超账本（守恒破）；
     * ② 资源卡「总计」= 战斗时间 + 赠送秒数（用户实测 2026-09-08：诺姆入队后主C 180s + 诺姆连携秒数）。
     * 轴模式同样计入（次数走 `ultimateGiftOf` 的轴分支，见下方；旧注释「轴模式不预留」已作废）。
     */
    const chainGiftFinal = crossAgentSupplyAt(configs, states, findCrossAgentSupplySlots(configs, 'gift-chain:chain')[0] ?? -1, {
      totalTime, stunCount: config.stunCount ?? 0, teamSize: config.teamSize,
    })
    /**
     * 琉音赠大（装配侧：**截断上限 + 前台展示 + 赠行时间预留**）——四处同源之一（单一事实源 =
     * `ultimateGiftOf`，见 `@fact engine:赠送时间/轴模式四处同源`）。
     *
     * ⚠ **2026-09-20 轴模式改为计入**（用户口径「同一个量转大次数，在轴模式下显示制定了部分好评值的
     * 用途，剩余好评应该默认 90……所以转大次数应该很明确」）：
     *
     * 旧口径「轴模式不预留」（2026-09-10 为避数值重排暂时维持）的代价 = **双重计费**：模块的
     * `axisSuppressed` 让非轴分支恒返回 count 0，而本处（截断上限）扣掉了轴赠大、`iterate` 账本与
     * S2 折叠环测量却都没涨 ⇒ 截断额度凭空少 8.732s（雨果 0 命轴），决算行被整数装包砍掉一整次
     * （5→4，实测 `hugoVerdictLanding`/`stunVulnSummary` 案例 B/D 红）。
     *
     * 现改为一律走 `ultimateGiftOf`（轴模式用 `axisLiuyinPromote.count`——编排层已按「轴声明 60 +
     * 剩余好评默认 90」算好，与 `promoteFixpoint` 同源）⇒ 预留 == 赠行 == 截断扣除，守恒恢复，
     * `applyLiuyinPromote` 也不再需要 post-hoc carve（`liuyinGiftTimeReserved` 有值即走预留路径）。
     */
    const ultimateGiftFinal = ultimateGiftOf(configs, states, {
      totalTime, stunCount: config.stunCount ?? 0, teamSize: config.teamSize,
      axisMode: config.axisMode, axisPromote: config.axisLiuyinPromote,
    })
    const giftTimeOfSlot = (idx: number): number =>
      (idx === chainGiftFinal.targetIdx ? chainGiftFinal.time : 0)
      + (idx === ultimateGiftFinal.targetIdx ? ultimateGiftFinal.time : 0)
    // 赠行**物化口径**（阶段1 ②，2026-09-10）：行由引擎产出（存在/次数单一事实源），倍率由编排层补。
    // 目标槽按 `config.teamSize`（编排层队长）解析——与账本口径 `configs.length` 解耦，见 giftRowTargetSlot。
    const chainGiftRow = chainGiftRowSpec(configs, states, totalTime, config.teamSize)
    const ultimateGiftRow = ultimateGiftRowSpec(
      configs, states, totalTime, config.stunCount ?? 0,
      config.axisLiuyinPromote, !!config.axisMode, config.teamSize,
    )
    /** 时间线截断总量（装配阶段砍掉的秒数）：= 资源允许但时间装不下的部分，上报为 overflowSeconds */
    let timeTruncatedSeconds = 0
    /** 逐行截断明细（团队级汇总，Σ cutSeconds == timeTruncatedSeconds）：资源池清单 + 难度轴交互缩放 */
    const truncationCuts: TruncationCut[] = []
    /** 各槽截断秒数账（requested/kept/cutSeconds）：存活率 = kept/requested，难度轴按它缩交互次数 */
    const truncationBySlot: { slot: number; requested: number; kept: number; cutSeconds: number }[] = []
    // ===== S4 装配段本体（#8 分刀，2026-09-12 零行为抽出）=====
    // 自 `configs.map` 回调一比一搬入：累加（timeTruncatedSeconds / truncationCuts / truncationBySlot）
    // 与 cfg 写回的**每槽执行顺序**、`cuts 非空才 push` 的条件守卫全在循环 wrapper 原样保持；
    // 判据 = timeGolden / timeFillRatchet delta 0（规则 10）。骨架先例：runFoldLoop / runBillyFinalize。
    const stageAssembleSlot = (cfg: (typeof configs)[number], i: number) => {
      const state = states[i]
      const chainCountTotal = state.chainCountTotal

      // 伊德海莉外部回血按卢西娅最终终结技次数折算后写回 cfg（供喧响/展示共用精确值）
      // 2026-09-25 CC-6b：回血源复用帷幕提供者槽（lead 裁决 §6-2；前提写死在 `./curtain.ts` 头注释）。
      if (i === yidhariSlot && curtain.providerSlot >= 0) {
        cfg.yidhariExternalHealPct = (cfg.yidhariExternalHealPct ?? 0)
          + (cfg.yidhariExternalHealPerUltPct ?? 0) * (states[curtain.providerSlot]?.ultimateCount ?? 0)
      }
      // 卢西娅4命帷幕触发总次数写回 cfg（供模块资源卡展示）
      if (i === curtain.providerSlot) {
        cfg.luciaCurtainTriggerCount = curtainTriggers
        // 展示拆分（2026-09-19，零求值改动）：自开部分 + 队友来源归因（边际法：队友份额 = 总 − 自开，
        // 15s CD 封顶与覆盖滑块折算效应按比例落到两边）。2026-09-25 CC-6b：队友源改为按
        // `curtain-open` 跨槽供给的全部提供者收集，并按各自 rawCount 比例分摊队友份额。
        // ⚠ **多提供者比例分摊是新语义、当前不可达**（唯一提供者 = 伊德海莉）：单提供者时
        // mateTotal > 0 ⇒ 比例 = 1 ⇒ triggers 与原式 `max(0, 总 − 自开)` 逐位相同；出现第二个
        // 提供者时行为与迁移前不同（旧实现只取 yidhariSlot 一个来源），故此处**不是**逐位等价承诺。
        cfg.luciaCurtainSelfCount = getAgentMechanic(cfg.agentId)!.curtainTriggers!({
          cfg,
          state: states[i],
          teammateOpenCount: 0,
          totalTime,
        })
        const mateSlots = findCrossAgentSupplySlots(configs, 'curtain-open')
        const raw = mateSlots.map(s => ({
          slot: s,
          agentId: configs[s]?.agentId ?? '',
          rawCount: Math.max(0, Math.floor(states[s]?.ultimateCount ?? 0)),
        })).filter(m => m.rawCount > 0)
        const mateTotal = raw.reduce((n, m) => n + m.rawCount, 0)
        const mateTriggers = Math.max(0, curtainTriggers - cfg.luciaCurtainSelfCount)
        cfg.luciaCurtainTeammates = raw.map(m => ({
          agentId: m.agentId,
          rawCount: m.rawCount,
          triggers: mateTotal > 0 ? mateTriggers * (m.rawCount / mateTotal) : 0,
        }))
      }

      // Σ 队友前台秒（行级能量/喧响与装配 buildExecutions 同语义：不含自己）
      const teammateFrontlineSeconds = configs.reduce(
        (sum, _, j) => (j === i ? sum : sum + states[j].frontlineTime),
        0,
      )

      // 能量源 = iterate 驱动次数的快照（2026-09-03：展示与驱动同源，Δ 恒 0——
      // 曾各算各的：iterate 用上轮态、装配重算当前态，雅/莱卡恩 Δ=+55.5）。
      // 快照缺失（历史状态/热启动）才回退重算 + 跨角色回补。
      const energySrc = state.energySource
        ? { ...state.energySource }
        : calcEnergySource(cfg, state, configs, config.shieldCount, config.energyShieldCount, chainCountTotal, config.totalTime, teammateFrontlineSeconds)
      if (!state.energySource) {
        const crossAgent = calcCrossAgentEnergy(i, configs, states)
        energySrc.crossAgent = crossAgent
        energySrc.supportUltimateRegen = crossAgent.supportUltimateRegen
        energySrc.total += crossAgent.total
      }


      // 喧响伴随
      let teammateShare = 0
      for (let j = 0; j < configs.length; j++) {
        if (j === i) continue
        const otherCfg = configs[j]
        const otherChainCountTotal = states[j].chainCountTotal
        // 行级喧响 Σ：j 视角的队友前台秒（Σ k≠j，与装配层 buildExecutions 传参同语义）
        const otherTeamFrontline = configs.reduce((sum, _, k) => (k === j ? sum : sum + states[k].frontlineTime), 0)
        const otherShareable = calcRawDecibelParts(otherCfg, states[j], otherChainCountTotal, states[j].exSpecialCount, states[j].ultimateCount, totalTime, otherTeamFrontline).shareableTotal
        teammateShare += otherShareable * otherCfg.decibelShareRatio
      }

      // 诺姆影画4·膛温换连携喧响：`giftDecibelForCfg` 已含 `decibelPerUnit × count`
      // （400 = 诺姆+上一位队友两侧合计，门控在模块内判），引擎**不再**自己乘系数。
      const normaC4Decibel = giftDecibelForCfg(configs, states, cfg, totalTime)

      const decibelSrc = calcDecibelSource(cfg, state, teammateShare, chainCountTotal, totalTime,
        (cfg.luciaC4DecibelPerTrigger ?? 0) * curtainTriggers
        // 诺姆影画4·膛温换连携：诺姆+上一位队友各 +200 不可分享喧响（计入终结技次数）
        + normaC4Decibel,
        config.specialActionDecibelBonusPerSlot?.[i] ?? 0,
        config.anomalyDecibelBonusPerSlot?.[i] ?? 0,
        teammateFrontlineSeconds)
      // 物化钩子派发前的引擎行快照：供 buildResourceResult 复现钩子当时看到的行基准
      // （阶段1 第二刀——卢西娅 cap 等派生量不再经 cfg 回写传递）
      const preModuleExecutions: SkillExecution[] = []
      const builtExecutions = buildExecutionsWithPhase(cfg, state, chainCountTotal, teammateFrontlineSeconds, preModuleExecutions)
      // 本槽赠送行时间（诺姆赠链 / 琉音赠大）：账本已含（necessary 预留），但行不在 builtExecutions 里
      // ——截断上限先扣掉它，装配后再追加的赠送行才与账本守恒（见上方 giftTimeOfSlot 注释）。
      const giftTimeThisSlot = giftTimeOfSlot(i)
      // ===== 时间线截断（通用资源循环规则，2026-09-05 用户口径）=====
      // 本槽物化行超出账本（必要 + 平A）的部分按时间线尾部截断：平A行是填充项永远保留，
      // 招式行从后往前整行丢、边界行等比缩（伤害/失衡/积蓄/回能线性缩）。iterate 已把必要时间
      // 封顶到「预算 − 队友占用」，所以这里的上限就是账本本身。语义 = 实战 180s 到点结算，
      // 资源攒多了也兑现不出来——旧实现没有这层，只能靠虚高账本挤平A池，结果两头都不准。
      const truncated = truncateExecutionsToFrontline(
        builtExecutions, Math.max(0, state.necessaryTime + state.basicAttackTime - giftTimeThisSlot))
      // 赠行由**引擎**物化（阶段1 ②）：仍追加在截断之后（永不被截），截断上限仍先扣赠行时间
      const giftRowsHere: SkillExecution[] = []
      if (i === ultimateGiftRow.targetIdx && ultimateGiftRow.count > 0) {
        giftRowsHere.push(buildGiftRow({
          moveId: cfg.ultimateMoveId,
          moveName: '好评转大·队友终结技',
          count: ultimateGiftRow.count,
          actionTime: cfg.ultimateActionTime ?? 0,
          skillDamageTarget: 'ultimate',
          skillTableNote: '好评转大：赠送队友终结技（白送，不耗喧响/能量）',
        }))
      }
      if (i === chainGiftRow.targetIdx && chainGiftRow.count > 0) {
        giftRowsHere.push(buildGiftRow({
          moveId: cfg.chainMoveId,
          moveName: '诺姆膛温替换·队友连携技',
          count: chainGiftRow.count,
          actionTime: cfg.chainActionTime ?? 0,
          comboAlignRatio: cfg.chainComboAlignRatio ?? 0,
          skillTableNote: '诺姆预热膛温≥80%帽子把戏：上一位队友的快速支援替换为其本人连携技（招式与倍率取该队友技能表）',
          normaGiftChain: true,
        }))
      }
      const executions = giftRowsHere.length > 0 ? [...truncated.executions, ...giftRowsHere] : truncated.executions
      // 显示口径统一：前台时间 = **前台**执行行 ΣtotalTime（后台行不占共享轴，如莱卡恩围猎蓄力；
      // 含合轴，机制改写行/倍率表行都在内），后台 = 总时间 - 前台。
      // 装配后追加的赠送行（诺姆赠链/琉音赠大）不在 Σ行里——展示层由 `normalizeDisplayTime`
      // 在编排层按最终行统一重算（单一口径，新增赠送机制不必各自回扣）。
      // 赠行已在 `executions` 里（上方物化），故这里不再加 giftTimeThisSlot（否则双计）
      const execFrontlineTime = executions.reduce((sum, e) => sum + (isFrontlineExecution(e) ? (e.totalTime ?? 0) : 0), 0)
      const timeAlloc = {
        ...calcTimeAllocation(cfg, state, totalTime),
        frontlineTime: execFrontlineTime,
        backstageTime: Math.max(0, totalTime - execFrontlineTime),
      }
      const anomalyEventExecutions = buildAnomalyEventExecutions(cfg, state, totalTime)
      const mechanicResult = getAgentMechanic(cfg.agentId)?.buildResourceResult?.({
        cfg,
        state,
        teamFrontlineSeconds: teammateFrontlineSeconds,
        preModuleExecutions,
      }) ?? {}

      const result = {
        slot: cfg.slot,
        agentId: cfg.agentId,
        agentName: cfg.agentId, // 名称由上层填充
        isFlashUser: cfg.isFlashUser,
        timeAllocation: timeAlloc,
        energySource: energySrc,
        // 真正驱动 exSpecialCount 的收敛后总能量（iterate 末轮 totalEnergy）
        derivedEnergy: state.totalEnergy,
        exSpecialCount: state.exSpecialCount,
        exSpecialMoveId: cfg.exSpecialMoveId,
        exSpecialEnergyConsume: cfg.exSpecialEnergyConsume,
        decibelSource: decibelSrc,
        ultimateCost: cfg.ultimateCost,
        ultimateCount: state.ultimateCount,
        chainCountPerStun: cfg.chainCountPerStun,
        chainCountTotal,
        executions,
        anomalyEventExecutions,
        totalStunBuildUp: 0, // 后续由 damage.ts 补充
        ...mechanicResult,
      }
      return {
        result,
        cutSeconds: truncated.cutSeconds,
        // 守卫原样：cut 非空才记 cuts/账（与抽取前 push 条件一致）
        cuts: truncated.cuts.length > 0 ? truncated.cuts.map(c => ({ slot: cfg.slot, ...c })) : [],
        bySlotEntry: truncated.cuts.length > 0 ? {
          slot: cfg.slot,
          requested: truncated.usedSeconds,
          kept: Math.max(0, truncated.usedSeconds - truncated.cutSeconds),
          cutSeconds: truncated.cutSeconds,
        } : null,
      }
    }
    const characters: CharacterResourceResult[] = configs.map((cfg, i) => {
      const s = stageAssembleSlot(cfg, i)
      timeTruncatedSeconds += s.cutSeconds
      for (const c of s.cuts) truncationCuts.push(c)
      if (s.bySlotEntry) truncationBySlot.push(s.bySlotEntry)
      return s.result
    })
    return {
      characters, timeTruncatedSeconds, truncationCuts, truncationBySlot, inputStunCount,
      chainGiftTime: chainGiftFinal.time, liuyinGiftTimeTotal: ultimateGiftFinal.time,
    }
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

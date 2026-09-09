import type {
  ResourceCalcConfig, CharacterOperationConfig,
  TeamResourceResult, CharacterResourceResult,
  IterationState, ExSpecialCostType, SkillExecution,
} from '@/types/resource'
import { isFrontlineExecution } from '@/types/resource'
import { getAgentMechanic } from '@/mechanics'
import { computeLuciaCurtainTriggers } from '@/mechanics/agents/luciaElowen'
import { computeNormaHatToChainCount } from '@/mechanics/agents/norma'
import { resolveUltimateTargetSlot } from '@/mechanics/agents/liuyin'
import { computeLiuyinHugCounts, computeLiuyinSource } from '@/mechanics/agents/liuyin'
import { moveFusionByMoveId } from '@/data/moveFusions'

/**
 * 诺姆膛温换连携（C4）赠链时间信道（与 iterate Step4 同口径）：hatCount 次赠链由
 * applyNormaHatChain 在装配后追加到「上一位队友」的执行计划，其时间已由 iterate 计入
 * 该槽必要时间——折叠环/欠打试探的行测量必须同样计入，否则预留被读成 idle → refund 双击。
 */
function normaGiftChainInfo(
  configs: CharacterOperationConfig[],
  states: IterationState[],
  normaSlot: number,
  totalTime: number,
): { targetIdx: number; time: number } {
  const nCfg = configs[normaSlot]
  if (!nCfg) return { targetIdx: -1, time: 0 }
  const hatCount = computeNormaHatToChainCount(nCfg, {
    exSpecialCount: states[normaSlot].exSpecialCount,
    ultimateCount: states[normaSlot].ultimateCount,
    frontlineTime: states[normaSlot].frontlineTime,
    battleTime: nCfg.normaBattleTime ?? totalTime,
  }, Number((nCfg as unknown as Record<string, unknown>)['setting:norma.holdSeconds'] ?? 2))
  if (hatCount <= 0) return { targetIdx: -1, time: 0 }
  const setting = Number((nCfg as unknown as Record<string, unknown>)['setting:liuyin.ultimateTargetSlot'] ?? -1)
  const targetIdx = resolveUltimateTargetSlot(normaSlot, configs.length, setting)
  return { targetIdx, time: hatCount * (configs[targetIdx]?.chainActionTime ?? 0) }
}

/**
 * 琉音好评转大赠链时间（非轴，与 iterate Step4 同口径）：promote 个赠大 = 目标槽 promote ×
 * ultimateActionTime——装配后 applyLiuyinPromote 追加的行时间必须在此预留（守恒破 +7.2s 前例），
 * 折叠环/欠打试探的行测量同口径计入，否则预留被读成 idle → refund 双击。
 */
function liuyinGiftChainInfo(
  configs: CharacterOperationConfig[],
  states: IterationState[],
  liuyinSlot: number,
  totalTime: number,
  stunCount: number,
): { targetIdx: number; time: number } {
  const lCfg = configs[liuyinSlot]
  if (!lCfg) return { targetIdx: -1, time: 0 }
  const lState = states[liuyinSlot]
  const src = computeLiuyinSource({
    exSpecialCount: lState.exSpecialCount,
    ultimateCount: lState.ultimateCount,
    combatTime: lCfg.battleTime ?? totalTime,
    cinemaLevel: lCfg.liuyinCinemaLevel ?? 0,
    extraAbilityActive: lCfg.liuyinExtraAbilityActive ?? false,
    previousTeammateSlot: lCfg.liuyinPreviousTeammateSlot ?? 0,
  })
  const setting = Number((lCfg as unknown as Record<string, unknown>)['setting:liuyin.ultimateTargetSlot'] ?? -1)
  const targetIdx = resolveUltimateTargetSlot(liuyinSlot, configs.length, setting)
  const tCfg = configs[targetIdx]
  const targetChainTotal = Math.min(
    (tCfg?.chainCountPerStun ?? 0) * stunCount,
    tCfg?.chainCountTotalOverride ?? (tCfg?.chainCountPerStun ?? 0) * stunCount,
  )
  const hug = computeLiuyinHugCounts(
    src.goodReviewTotal,
    stunCount,
    Math.floor(Number((lCfg as unknown as Record<string, unknown>)['setting:liuyin.hug60Count'] ?? -1)),
    targetChainTotal,
  )
  const promote = hug.hug60 + hug.hug90
  if (promote <= 0) return { targetIdx: -1, time: 0 }
  return { targetIdx, time: promote * (configs[targetIdx]?.ultimateActionTime ?? 0) }
}

/**
 * 琉音赠大时间**跨层统一入口**（2026-09-10）：轴模式与「轴栈窗口口径」对齐——
 * 轴内 60/90 转大次数由轴预设 promoteVariant 块决定（编排层按窗口数加权后经
 * `config.axisLiuyinPromote` 注入），通用公式 `liuyinGiftChainInfo`（好评/连携窗口推导）
 * 在轴模式会算出另一个数（旧代码干脆跳过测量 → 试探看不见赠行）。非轴模式仍走通用公式。
 *
 * **调用范围（实测校准，别顺手扩大）**：目前只有 `frontlineRowsOf`（试探测量）用它；
 * `iterate` 预留与装配侧 `giftTimeOfSlot` **仍维持「轴模式不计入」**——2026-09-10 分别开关实测：
 * 预留侧 4 队留白变差（+0.27~2.70s），装配侧落点大改（stun 4→6、dmg ±5.8%/+32.5%），
 * 两者都属数值重排须裁决（见 docs/ENGINE_PIPELINE_GUIDE.md §4 坑19①）。
 */
function liuyinGiftTime(
  configs: CharacterOperationConfig[],
  states: IterationState[],
  totalTime: number,
  stunCount: number,
  axisPromote: { targetSlot: number; count: number } | undefined,
  axisMode: boolean,
): { targetIdx: number; time: number } {
  const liuyinSlot = configs.findIndex(c => c.agentId === '1481')
  if (liuyinSlot < 0) return { targetIdx: -1, time: 0 }
  if (!axisMode) return liuyinGiftChainInfo(configs, states, liuyinSlot, totalTime, stunCount)
  if (!axisPromote || axisPromote.count <= 0) return { targetIdx: -1, time: 0 }
  const tCfg = configs[axisPromote.targetSlot]
  if (!tCfg) return { targetIdx: -1, time: 0 }
  return { targetIdx: axisPromote.targetSlot, time: axisPromote.count * (tCfg.ultimateActionTime ?? 0) }
}

// ============ 单角色能量计算 ============

/** 计算单角色能量回复（单次迭代，基于当前时间分配） */
import * as ResourceCalcHelpers from './resource/helpers'
const { calcEnergySource, calcRawDecibelParts, calcDecibelSource, calcTimeAllocation, buildExecutions, materializeRows, buildAnomalyEventExecutions, iterate, calcCrossAgentEnergy, truncateExecutionsToFrontline } = ResourceCalcHelpers

/**
 * 物化 + **相位写入**（阶段1 第二刀，2026-09-09）：产行钩子对 cfg 只读，相位状态由引擎在此按
 * **同一个 state** 补写。与旧口径「写在 buildExecutions 里」逐位等价（同一调用点、同一 state、
 * 同一值），但产行函数变纯——`materializeRows` 不再需要为这些字段兜底快照/恢复。
 * 注意：`materializeRows` 内部**不**调本包装（那条路径会快照/恢复，写入本就该被丢弃）。
 */
function buildExecutionsWithPhase(
  cfg: CharacterOperationConfig,
  state: IterationState,
  chainCountTotal: number,
  teamFrontlineSeconds: number,
  moduleInputRows?: SkillExecution[],
): SkillExecution[] {
  const rows = buildExecutions(cfg, state, chainCountTotal, teamFrontlineSeconds, moduleInputRows)
  getAgentMechanic(cfg.agentId)?.materializePhaseState?.({ cfg, state, executions: rows, teamFrontlineSeconds })
  return rows
}

// ============ 热启动缓存 ============
/**
 * 热启动（2026-08 复活）：把上次收敛的 IterationState[] 缓存、同配置再次计算时作为初值注入。
 * **只做精确键命中**：从上一轮的收敛末态出发时，iterate 落在不动点上，结果与冷算逐位一致
 * （下方测试锁定）。**队签名近似命中（改滑块/命座后复用邻域初值）暂不做的度量依据**：
 * 内层循环只对强特/终结次数判稳，次数稳定后 basicAttackTime/喧响的小数位仍随初值漂移
 * （实测同队签名扰动下喧响总数差 ~0.1%）——近似命中会让结果依赖计算历史，
 * 违反 seedInvariance「收敛态与初值无关」的安全性前提；前置是先把内层收敛判据
 * 加强到小数位稳定（会整体微移全库数值基线，须单独立项验证后再启用近似命中）。
 */
interface WarmStartEntry {
  exactKey: string
  states: IterationState[]
}
const WARM_START_CACHE_MAX = 16
/** 收敛后写回 cfg 的反馈字段 + 每次进入先清零的草稿字段：不是输入，进精确键只会造成假未命中。
 *  新增「收敛后写回 cfg」的字段时必须同步加进这里。 */
const WARM_KEY_OMIT_CFG = new Set([
  'timeBudgetExcess',
  'luciaCurtainTriggerCount',
  'yidhariExternalHealPct',
  'normaHatToChainCount',
])
const warmStartCache: WarmStartEntry[] = []
const warmStartStats = { stored: 0, seeded: 0 }

function sanitizeWarmKeyCfg(cfg: CharacterOperationConfig): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(cfg as unknown as Record<string, unknown>)) {
    if (!WARM_KEY_OMIT_CFG.has(k)) out[k] = v
  }
  return out
}

function warmStartExactKey(config: ResourceCalcConfig): string {
  const globals: Record<string, unknown> = { ...config }
  delete globals.initialStates
  delete globals.characters
  return JSON.stringify([globals, config.characters.map(sanitizeWarmKeyCfg)])
}

/** 命中则返回缓存的收敛态（只读，调用方自行浅拷贝）；显式 initialStates 时返回 null */
function lookupWarmStart(config: ResourceCalcConfig): WarmStartEntry | null {
  if (config.initialStates) return null
  const entry = warmStartCache.find(e => e.exactKey === warmStartExactKey(config)) ?? null
  if (entry) warmStartStats.seeded++
  return entry
}

function storeWarmStart(exactKey: string, states: IterationState[]): void {
  const idx = warmStartCache.findIndex(e => e.exactKey === exactKey)
  if (idx >= 0) warmStartCache.splice(idx, 1)
  warmStartCache.push({ exactKey, states: states.map(s => ({ ...s })) })
  if (warmStartCache.length > WARM_START_CACHE_MAX) warmStartCache.shift()
  warmStartStats.stored++
}

/** 清空热启动缓存与统计（测试隔离用） */
export function clearWarmStartCache(): void {
  warmStartCache.length = 0
  warmStartStats.stored = 0
  warmStartStats.seeded = 0
}

/** 热启动统计（测试/诊断用）：stored=写入次数，seeded=命中注入次数 */
export function getWarmStartStats(): { stored: number; seeded: number } {
  return { ...warmStartStats }
}

/**
 * 时间预算容差（秒）：量化（floor 次数）导致的残差属合轴可覆盖，不追求精确 0（坑12/19 既有口径）。
 * 单一事实源——欠打回填的可行性门控与队伍对比的超时判定共用（teamCompare.actionTimeTotal）。
 */
export const TIME_BUDGET_TOLERANCE_SECONDS = 1

/**
 * 欠打回填的启动门槛（秒）：平A权重队的剩余自由时间必须按权重全部分配（用户口径 2026-09-08），
 * 故门槛 = 量化容差：欠打 >1s 必试探回填（refund→平A池→按 timeWeight 水填分配）；≤1s 属量化
 * 地板（坑12「不追求精确 0」，合轴可覆盖），不试探。09-05「≤5s 会把近均衡队推进 stunCount=0
 * 吸引盆」的风险已在 09-08 引擎（1051/1531 实数化、轴栈资源门控、sigrid 估时钩子、琉音三件套）
 * 复核：1s 门槛下 ratchet 绝对不变量（stun>0/outerExit≠maxIter）/runArchiveDeploy（116k 样本）/
 * allAgentsSweep（C6>C0 等不变量）/yidhariInteractionGrid 全绿，旧盆不复现（实测数字见
 * underfillRefund.test.ts 与 docs 坑19① 否决记录）。
 * @fact engine:欠打回填 口径: 折叠循环退出后按「预算−物化净占用」重测欠打量，折半试探注入 refund；接受三条件=内层判稳+trialRows≤预算−容差+行数变多，任一不满足连 cfg 一起回滚；门槛=1s 量化容差（平A权重队自由时间按权重全分配，留白只剩 ≤2s 量化/试探粒度地板；欠打 ≤1s 不试探；09-05「≤5s 推近均衡队入 stunCount=0 盆」在 09-08 引擎复核不复现；**无排除队**——1591 一族 2026-09-10 解除（该族试探现进入即被 fits 门拒，开关零差异），1051/1531 已随热启动规范种子修复放回）；宁可留白不制造超预算 | 据 用户@2026-09-08「平A权重与留白不应并存，剩余自由时间按权重全部分配」+09-05「全部动手」·复核@2026-09-08·复核@2026-09-10（能量行级 Σ 后全链零差异） | 验 src/composables/__tests__/underfillRefund.test.ts | 锚 src/core/resource.ts#UNDERFILL_PROBE_THRESHOLD_SECONDS | 信 确认
 */
export const UNDERFILL_PROBE_THRESHOLD_SECONDS = TIME_BUDGET_TOLERANCE_SECONDS


export function calcTeamResources(config: ResourceCalcConfig): TeamResourceResult {
  const totalTime = config.totalTime
  // 伊德海莉连续松弛（0.5 阻尼）收敛比整数动力学慢：她的队内层迭代上限提到 100
  // （阻尼残差减半每轮，且判稳用严格相等——浮点不动点约需 40+ 轮；只影响含她的队，其余队维持 20 历史口径）。
  const yidhariContinuousPresent = config.characters.some(c => c.agentId === '1051' && c.yidhariContinuousEx === true)
  const maxIter = Math.max(config.maxIterations || 20, yidhariContinuousPresent ? 100 : 0)
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
  //    **测量口径缺口本身仍在**（轴模式赠大时间不进 `frontlineRowsOf`，且轴模式 promote 次数由轴
  //    预设决定、`liuyinGiftChainInfo` 回落通用公式会算错），只是不再被排除掩盖——现由
  //    `timeLedgerInvariants` 兜住：一旦某队真的因此越账，护栏立刻红。真收口 = 把轴 promote 计数
  //    线程化进 core（半修 C/D 路线，见 docs/ENGINE_PIPELINE_GUIDE.md §4 坑19①）。
  //  · 1051 伊德海莉 / 1531 星徽·比利：**2026-09-08 已放回**——它们当初被排除是因为热启动缓存注入
  //    收敛末态导致冷/热落点分叉（0.009s / 0.0015s），而「缓存只存规范种子」修好后同配置计算逐位
  //    稳定，两族试探全绿（seedInvariance / warmStart / yidhariInteractionGrid / timeLedgerInvariants）。

  // 热启动：无显式种子时查缓存，命中则从上次收敛态出发（逐位透明，见块注释）
  const warmExactKey = config.initialStates ? '' : warmStartExactKey(config)
  const warmSeed = lookupWarmStart(config)

  // 初始 state：平A时间按权重分配，强特/大招次数初始为0（initialStates 注入：测试/热启动用）
  const totalWeight = configs.reduce((a, c) => a + c.timeWeight, 0)
  const injectedStates = config.initialStates && config.initialStates.length === configs.length
    ? config.initialStates
    : warmSeed?.states
  // 默认零种子快照：规范重跑用（种子注入的轨迹若未正常收敛 = 停点含瞬态相位成分，弃掉重跑冷轨迹）
  const defaultSeedStates: IterationState[] = configs.map(cfg => ({
    basicAttackTime: totalWeight > 0
      ? totalTime * (cfg.timeWeight / totalWeight)
      : 0,
    exSpecialCount: 0,
    ultimateCount: 0,
    chainCountTotal: (cfg.chainCountTotalOverride ?? cfg.chainCountPerStun * (config.stunCount ?? 0)) + (cfg.chainCountTotalExtra ?? 0),
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
  const maxTimeIter = config.maxTimeIterations || 8
  // 重置上一轮调用残留的时间预算（cfg 可能被外层不动点复用）
  for (const cfg of configs) cfg.timeBudgetExcess = 0
  config.timeBudgetRefund = 0
  let converged = false
  let iter = 0
  // 收敛诊断：三层不动点里第 ② 层（时间预算）原先耗尽上限就静默接受末轮结果，见 ConvergenceReport
  let timeBudgetPasses = 0
  let timeBudgetConverged = false
  let timeBudgetResidualSeconds = 0
  let timeBudgetIdleSeconds = 0
  let timeBudgetRefundedSeconds = 0
  let refundFrozen = false
  /**
   * 热启动种子 = **规范种子**（本轮 `states` 的初值：默认零种子或注入种子本身），**不是收敛末态**。
   * 为什么不能存末态（2026-09-08 修，用户实测「同一队算两次结果不一样」）：折叠 pass0 的 refund
   * 冻结（`teamRefund`）与内层落点都随初值变——非实数化队的落点本就随初值漂移（seedInvariance
   * 的「游戏等价」档），存末态等于把本轮落点带进下一轮：同配置第二次计算换结果（实测 1431 系
   * 4 队冷/热 slack 9.20 vs 4.86、7.57 vs 1.03、3.06 vs 6.26、0.68 vs 0.45，且门槛 10s 同样复现
   * ——与欠打回填门槛无关）。缓存机制（精确键 / LRU / 命中计数）保留，但注入种子必须与冷算同源。
   * 真正的加速要等实数化专项（落点唯一）之后才可能。
   * @fact engine:热启动逐位透明 口径: 热启动缓存只存**规范种子**（本轮 states 初值），不存收敛末态/试探前末态——折叠 pass0 的 refund 冻结与内层落点随初值变，存末态会让同配置第二次计算换结果（实测 1431 系 4 队冷热 slack 9.20 vs 4.86 等）；改前「存试探前末态」只解决了「从已回填态出发」那一种分叉 | 据 用户实测@2026-09-08「同一队算两次结果不一样」·复核@2026-09-08 | 验 src/core/__tests__/warmStart.test.ts | 锚 src/core/resource.ts#warmSeedStates | 信 确认
   */
  const warmSeedStates: IterationState[] = states
  /**
   * 内层次数收敛 + 停点规范化（环检测 + 字典序规范停点）。
   * 提升到函数级（2026-09-08 重构）：折叠循环与「② 规范重跑」共用。
   */
  const runInnerLoop = (from: IterationState[]): { end: IterationState[]; clean: boolean } => {
    const cycleSigs = new Map<string, number>()
    const cycleSnapshots: IterationState[][] = []
    let cur = from
    for (iter = 0; iter < maxIter; iter++) {
      const newStates = iterate(configs, cur, config)
      // 检查收敛：强特次数、大招次数与**平A时间**是否稳定。伊德海莉连续松弛（阻尼实数次数）同样按
      // 严格相等判稳——阻尼映射收敛到浮点不动点后逐位复现（热启动透明的前提）；ε 判据会留下
      // ~1e-12 残差，热启动会话与冷启动会话不再逐位一致（determinism.test 的失败机制）。
      // bat 必须进判稳（2026-09-09，能量行级 Σ 暴露）：折叠边界的路径里预算收紧会让 bat 跳变而
      // 次数暂时不动（实测雅 C2：input bat≈127 → output bat=50.1、ex 恒 22 → 旧判稳提前 clean，
      // 停点的 energySource 快照仍是压缩前 bat 算的 585.8，终局行重放只有 307.5——驱动≠终局态的
      // 伪不动点，把 C2 撑在高吸引子、C4 落自洽低吸引子 → 命座伤害非单调）。bat 是预算与次数的
      // 确定性函数（次数+预算不变 ⇒ bat 逐位不变），进判稳只多跑折叠边界后的诚实重收敛，不引入浮点残差。
      // @fact engine:判稳含平A时间 口径: 内环次数收敛判稳 = 强特/终结次数 + basicAttackTime 严格相等（bat 是预算与次数的确定性函数；折叠边界 bat 跳变而次数暂不动时旧判稳提前 clean，停点带「驱动快照 ≠ 终局态行重放」伪不动点——实测雅 C2 快照 585.8 vs 重放 307.5、命座伤害 C4<C2 非单调） | 据 实测@2026-09-09 能量行级Σ专项 | 验 src/mechanics/__tests__/miyabiCinema.test.ts | 锚 src/core/resource.ts#runInnerLoop | 信 确认
      let changed = false
      for (let i = 0; i < cur.length; i++) {
        if (newStates[i].exSpecialCount !== cur[i].exSpecialCount ||
            newStates[i].ultimateCount !== cur[i].ultimateCount ||
            newStates[i].basicAttackTime !== cur[i].basicAttackTime) {
          changed = true
          break
        }
      }

      cur = newStates
      if (!changed) return { end: cur, clean: true }
      // 环检测：签名 = 全状态 JSON（含 energySource 快照——iterate 消费的一切）；快照/恢复用
      // structuredClone 而非 JSON roundtrip——JSON 会把 NaN 物化成 null 写回状态（毒路径）
      const sig = JSON.stringify(cur)
      const firstSeen = cycleSigs.get(sig)
      if (firstSeen !== undefined) {
        const members = cycleSnapshots.slice(firstSeen)
        let canonical = members[0]
        let canonicalSig = JSON.stringify(canonical)
        for (const m of members) {
          const ms = JSON.stringify(m)
          if (ms < canonicalSig) { canonical = m; canonicalSig = ms }
        }
        return { end: structuredClone(canonical), clean: false }
      }
      cycleSigs.set(sig, cycleSnapshots.length)
      cycleSnapshots.push(structuredClone(cur))
    }
    return { end: cur, clean: false } // 跑满上限：停点=上限处瞬态（起点确定则停点确定）
  }
  /** 时间预算折叠循环（内层次数收敛 + 停点规范化 + 折叠 excess/refund 冻结）；写函数级诊断量 */
  const runFoldLoop = (from: IterationState[]): IterationState[] => {
    let st = from
    // 每次折叠管线运行（含规范重放）独立冻结 refund
    refundFrozen = false
    for (let timePass = 0; timePass < maxTimeIter; timePass++) {
    timeBudgetPasses = timePass + 1
    // @fact engine:收敛环停点规范化 口径: 注入种子（热启动/显式 initialStates）的收敛轨迹若属非正常收敛（跑满上限或全状态签名精确重复=入极限环），该停点含瞬态相位成分 → 弃用并从默认零种子**规范重跑**；重跑仍入环则取环内 JSON 字典序最小成员为规范停点（相位无关，冷/热进同一环成员集合相同）。正常收敛照旧接受（不动点唯一性 = 2026-09-04 连续松弛教义）。结果 = f(默认种子, 迭代映射)，与注入种子彻底解耦 | 据 喧响行级化专项实测@2026-09-08 | 验 src/composables/__tests__/yidhariInteractionGrid.test.ts + src/core/__tests__/decibelRowParity.test.ts | 锚 src/core/resource.ts#calcTeamResources | 信 确认
    // 否决记录（环停点侧，都有实测数字）：环均值阻尼（对环成员取均值）实测被吸回同一环、
    // 桥接不了「冷种子收敛不动点 vs 热种子入环」的共存吸引子 → 否决；0.5 阻尼单独用也吸收不了
    // 整数阶梯跳变（丽娜 ex 行随能量阈值 6↔7 跳变，账本阶跃 ~180 喧响经队伍分享闭环）→ 否决。
    // 精确周期环检测 + 规范重跑（2026-09-08）：内层判稳只看强特/终结次数严格相等，但喧响
    // 账本行级化后「喧响→能量→次数→必要时间→平A池→阶梯行数→喧响」反馈环带整数阶梯项
    // （实测振荡器：丽娜 ex 行+子行随能量阈值 6↔7 整数量子跳变，账本阶跃 ~180 喧响经队伍
    // 分享闭环），0.5 阻尼吸收不了 → 全状态精确 2-循环、甚至「冷种子收敛到不动点、热种子入环」
    // 的多吸引子共存（yidhariInteractionGrid parry=4/dodge=2 格实测；环均值阻尼亦实测被吸回
    // 同一环——均值桥接不了共存吸引子，否决）。停点必须与种子无关，规则三层：
    // ① 逐轮记录全状态签名，签名精确重复 = 进入极限环 → 取环内 JSON 字典序最小成员为规范停点
    //    （相位无关：冷/热从不同瞬态段进入同一个环，成员集合相同，规范选择必然相同）；
    // ② 注入种子（显式 initialStates / 热启动缓存）的轨迹若非正常收敛（跑满上限或入环）= 停点
    //    含瞬态相位成分 → 弃用并**规范重跑**：从默认零种子重启，逐位复刻冷启动轨迹；重跑仍入环
    //    则按①取字典序规范——重跑结果是（默认种子, 迭代映射）的纯函数，与注入种子彻底解耦；
    // ③ 正常收敛（次数严格相等判稳）的轨迹直接接受——不动点唯一性由既有连续松弛教义保证
    //    （2026-09-04），冷/热正常收敛落点逐位一致是 determinism.test 的既有约定。
    // 下游（折叠残差累计/欠打回填/终局整数重推/装配）全部是停点的确定性函数；pass>0 的起点
    // 冷热已同，其上限停点亦同，冷热逐位一致由归纳保持。
    let inner = runInnerLoop(st)
    if (!inner.clean && timePass === 0 && injectedStates) {
      // ② 规范重跑：种子轨迹的停点含瞬态相位，弃用，从默认零种子复刻冷启动
      inner = runInnerLoop(defaultSeedStates.map(s => ({ ...s })))
    }
    st = inner.end
    if (inner.clean) converged = true

    // 测量每个角色执行计划的**前台**时间（后台行不占共享轴），对自家账本收敛：
    // 超出账本 = 该角色有未付费的前台行 → 折入必要时间压缩平A池（团队级，非单人预算）。
    // 只折正超出（真溢出）：负值 = estimate 高估必要时间 / 有空闲前台，不折回单角色
    // （否则 necessary 变负），改为团队 refund 回填平A池（见下）。
    let maxExcess = 0
    let maxIdle = 0
    let teamRefund = 0
    // 诺姆膛温换连携赠链行在装配后被 applyNormaHatChain 追加、不在 buildExecutions 产物里——
    // 行测量必须计入其时间（iterate 必要时间已按同一口径预留），否则折叠环会把预留读成
    // idle → pass0 refund 双击（与最高马力星光行同病）。
    const giftNormaSlot = configs.findIndex(c => c.agentId === '1571')
    const gift = giftNormaSlot >= 0 ? normaGiftChainInfo(configs, st, giftNormaSlot, totalTime) : { targetIdx: -1, time: 0 }
    // 琉音好评转大赠链行同理（非轴）：装配后 applyLiuyinPromote 追加，行测量计入其时间
    // 琉音赠大：**只作测量口径统一**（2026-09-10 实测：轴模式也在此预留会让 4 队留白变差
    // +0.27~2.70s——预留挤平A池而赠行不等量补回，见 docs 坑19①；故 iterate 侧维持旧口径「轴模式不预留」，
    // 只有 `frontlineRowsOf` 试探测量与 `giftTimeOfSlot` 装配侧按轴预设计数统一）
    const giftLiuyin = !config.axisUltimateTrackBySlot && configs.some(c => c.agentId === '1481')
      ? liuyinGiftChainInfo(configs, st, configs.findIndex(c => c.agentId === '1481'), totalTime, config.stunCount ?? 0)
      : { targetIdx: -1, time: 0 }
    for (let i = 0; i < configs.length; i++) {
      const cfg = configs[i]
      const state = st[i]
      const teammateFrontlineSeconds = configs.reduce(
        (sum, _, j) => (j === i ? sum : sum + st[j].frontlineTime),
        0,
      )
      const executions = buildExecutionsWithPhase(cfg, state, state.chainCountTotal, teammateFrontlineSeconds)
      // 净占用口径：物化行全额 − 轴内合轴分摊（跨角色并行块只计一次前台；iterate 平A池吃进同一值）。
      // 分摊按 `${slot}:${moveId}`（栈引擎比例分摊），行 count = 块次数、totalTime 全额。
      const overlapByAction = config.axisOverlapByAction
      const rowTime = executions.reduce(
        (sum, e) => sum + Math.max(0, (e.totalTime ?? 0) - (overlapByAction?.[`${cfg.slot}:${e.moveId}`] ?? 0))
          * (isFrontlineExecution(e) ? 1 : 0),
        0,
      ) + (i === gift.targetIdx ? gift.time : 0)
        + (i === giftLiuyin.targetIdx ? giftLiuyin.time : 0)
      // 账本份额 = 必要时间 + 分到的平A池（iterate 保证 Σ账本 ≤ budget + refund）
      const excess = rowTime - (state.necessaryTime + state.basicAttackTime)
      // 真实时间压力（模块退化判据的权威信号，见 CharacterOperationConfig.timePressureSeconds）：
      // 本槽物化行 − 队友账本净占用后剩下的可用前台。用**当轮实测行**而不是累加的折叠残差，
      // 否则 pass0 的虚高会把「其实装得下」的队误判成超支（叶瞬光自动轴退化即为此被关掉过）。
      const teammatesLedgerNet = configs.reduce(
        (sum, _, j) => (j === i ? sum
          : sum + Math.max(0, st[j].necessaryTime - (st[j].comboAlignCredit ?? 0) + st[j].basicAttackTime)),
        0)
      const availableFrontline = Math.max(0, (totalTime - (config.invincibleTime ?? 0)) - teammatesLedgerNet)
      cfg.timeAvailableFrontlineSeconds = availableFrontline
      cfg.timePressureSeconds = rowTime - availableFrontline
      if (excess > 1e-6) {
        // 量化（floor 次数）导致残差 ~1s 属合轴可覆盖，不追求精确 0。
        // `+=` 累加（2026-09-03 实测三语义对比）：`=` 对正反馈队（猫又/伊德海莉——模块行随
        // 平A池增长）欠补偿 → 溢出 186s；峰值 `max()` 同样溢出；累加虽使单调队（希格莉德
        // 敛枪式/凛冽枪尖）必要时间带历史残差，但这是全队模块行（雅/叶瞬光/柏妮思）的既有
        // 口径（必要 = 估计 + 折叠残差），且收敛健康（timeBudgetConverged、无溢出）。
        cfg.timeBudgetExcess = (cfg.timeBudgetExcess ?? 0) + excess
        if (excess > maxExcess) maxExcess = excess
      } else if (-excess > 1e-6) {
        // 负溢出（该角色账本 > 物化行，idle_i = estimate 高估量，与 basicAttackTime 无关）：
        // 单角色不折回（necessaryTime 变负、平A池膨胀），团队层面累计成 refund 回填平A池
        // ——回填后 Σ前台行 = Σ物化必要行 + 平A池 ≈ 预算，时间打满。
        teamRefund += -excess
        if (-excess > maxIdle) maxIdle = -excess
      }
    }
    timeBudgetResidualSeconds = maxExcess
    timeBudgetIdleSeconds = maxIdle
    // refund = Σ(该角色正 idle)：idle_i = 账本_i − 物化必要行_i。
    // **冻结语义**：首轮测得的 idle 总和写入 timeBudgetRefund（第 2 轮起 iterate 吃进、次数重收敛），
    // 之后**不再改写**——refund 与次数收敛存在耦合（平A回能→次数→必要时间→idle），逐轮跟随会
    // 抖动到 8 轮耗尽（伊德海莉烧血/艾莲等强依赖角色的 idle 随次数跳变）；一次性修正 + 收敛判据
    // 保持 excess-only（与旧行为同构），换 canceling 掉的精度是 ±1s 量化残差量级。
    // 天然上限：idle_i ≤ E_i → refund ≤ ΣE → availableBasicTime ≤ 预算，不会填超战斗时间。
    if (!refundFrozen) {
      config.timeBudgetRefund = Math.max(0, teamRefund)
      timeBudgetRefundedSeconds = config.timeBudgetRefund
      refundFrozen = true
      continue // 注入轮不判收敛：下一轮 iterate 吃进 refund 后再按 excess 判据停（否则 states 没吃到回填）
    }
    // 收敛判据：excess 是**秒**——精确估时（琉音/sigrid 钩子）把残差压到 ~5e-4s 浮点噪声量级，
    // 1e-6 判据 8 轮耗尽 → timeBudgetConverged=false 而 allAgentsSweep 硬断言恒 true（2026-09-06
    // 实测否决）。1e-3（1 毫秒）容差远小于任何量化残差（坑12 口径 ±1~2s），不改变折叠动力学，
    // 只让「已收敛到浮点噪声」的队如实报收敛。
    if (maxExcess <= 1e-3) {
      timeBudgetConverged = true
      break
    }
    }
    return st
  }

  // ===== 星徽·比利终局整数重推（链数实数化收尾，2026-09-06，1051 yidhariFinalizeEx 同骨架）=====
  // 迭代期她的动力压制链数与最高马力星光以实数参与收敛（HP 池 ∝ 普攻回血 ∝ 平A时间 = 正反馈
  // 连续通道；消滞后后估时与物化共用同一求解器），终局 floor 一次 + 整数态重推 ≤12 轮到全状态
  // 逐位稳定，让时间预算/能量/喧响账本与整数链数自洽（只作用于 1531 非轴模式，轴模式恒整数）。
  // 旗标在最终装配后才复位：欠打回填试探与最终装配都必须按**整数物化行**测可行性/出账，
  // 否则「floor 后 +1 链（≈10s）」的时长会被当成余量放行（1s 容差兜不住一整链）。
  const runBillyFinalize = (from: IterationState[]): IterationState[] => {
    let st = from
    const billyFinalizeConfigs = configs.filter(c => c.agentId === '1531' && Number((c as unknown as Record<string, unknown>).billyAxisActive ?? 0) !== 1)
    if (billyFinalizeConfigs.length > 0) {
      for (const bCfg of billyFinalizeConfigs) bCfg.billyFinalizeChain = true
      let finalizeStable = false
      for (let finalizePass = 0; finalizePass < 12; finalizePass++) {
        const prev = st
        st = iterate(configs, st, config)
        let stable = true
        for (let i = 0; i < st.length; i++) {
          const a = st[i], b = prev[i]
          if (a.exSpecialCount !== b.exSpecialCount || a.ultimateCount !== b.ultimateCount ||
              a.basicAttackTime !== b.basicAttackTime || a.necessaryTime !== b.necessaryTime ||
              a.frontlineTime !== b.frontlineTime || a.backstageTime !== b.backstageTime ||
              a.comboAlignTime !== b.comboAlignTime || a.comboAlignCredit !== b.comboAlignCredit ||
              a.totalEnergy !== b.totalEnergy || a.totalDecibel !== b.totalDecibel) {
            stable = false
            break
          }
        }
        if (stable) {
          finalizeStable = true
          break
        }
      }
      if (finalizeStable) converged = true
    }
    return st
  }

  // 正常轨迹：折叠 + 比利重推
  states = runFoldLoop(states)
  states = runBillyFinalize(states)

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
  // debt: 全局实数化收敛重构——本步仍是「一次内层收敛」粒度的离散修正，天花板 = ±1 次强特/终结
  //       次数对应的秒数；升级路径见 check-guards DEBT_REGISTRY 同名词条。
  {
    const budgetSeconds = totalTime - (config.invincibleTime ?? 0)
    const giftNormaSlot = configs.findIndex(c => c.agentId === '1571')
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
      const gift = giftNormaSlot >= 0 ? normaGiftChainInfo(configs, st, giftNormaSlot, totalTime) : { targetIdx: -1, time: 0 }
      // 琉音赠大：轴模式用轴预设计数（`config.axisLiuyinPromote`），非轴用通用公式（跨层统一入口）
      const giftLiu = liuyinGiftTime(
        configs, st, totalTime, config.stunCount ?? 0,
        config.axisLiuyinPromote, !!config.axisUltimateTrackBySlot,
      )
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
          0) + (i === gift.targetIdx ? gift.time : 0)
            + (i === giftLiu.targetIdx ? giftLiu.time : 0)
        const extraCredit = Math.max(0, (state.comboAlignCredit ?? 0) - overlapBySlot[i])
        total += Math.max(0, rowNet - extraCredit)
      }
      return total
    }
    /** 内层次数收敛（与折叠循环同一判据：强特/终结次数 + 平A时间严格相等，见 runInnerLoop 注释）；stable=false = 耗尽上限 */
    const convergeCounts = (from: IterationState[]) => {      let st = from
      for (let k = 0; k < maxIter; k++) {
        const next = iterate(configs, st, config)
        let changed = false
        for (let i = 0; i < st.length; i++) {
          if (next[i].exSpecialCount !== st[i].exSpecialCount
            || next[i].ultimateCount !== st[i].ultimateCount
            || next[i].basicAttackTime !== st[i].basicAttackTime) { changed = true; break }
        }
        st = next
        if (!changed) return { states: st, stable: true }
      }
      return { states: st, stable: false }
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
          timeBudgetRefundedSeconds = config.timeBudgetRefund ?? 0
          underfill = budgetSeconds - trialRows
          if (underfill <= TIME_BUDGET_TOLERANCE_SECONDS) break
        } else {
          config.timeBudgetRefund = savedRefund // 回滚：宁可留白，不制造超预算
          config.overflowSeconds = savedOverflow
          configs.forEach((c, i) => Object.assign(c, savedCfg[i]))
          probe /= 2
        }
      }
      timeBudgetIdleSeconds = Math.max(0, underfill)
      // 热启动缓存**不存**试探前末态（2026-09-08 修）：折叠 pass0 的 refund 冻结与内层落点随初值变，
      // 存末态会让同配置第二次计算换结果（1431 系 4 队冷/热 9.20 vs 4.86 等）。缓存存的是本轮的
      // **规范种子**（见 warmSeedStates 声明处 @fact）——牺牲加速，换「同配置连续计算不许变」。
    }
  }

  // 失衡次数由外部失衡池不动点收敛后传入（连携次数 = chainCountPerStun × stunCount，见 iterate）
  const inputStunCount = config.stunCount ?? 0

  // 伊德海莉终局整数重推（targeted 连续松弛收尾，2026-09-04）：迭代期她的强特次数以实数参与收敛
  // （refund 反馈解析求解 → 唯一不动点，消除 19/20 双稳态），终局 floor 一次 + 整数态重推 ≤12 轮
  // 到全状态逐位稳定，让时间预算/能量/喧响账本与整数次数自洽（只作用于 1051，不动其他模块的收敛语义）。
  const yidhariFinalizeIdx = configs.findIndex(c => c.agentId === '1051' && c.yidhariContinuousEx)
  if (yidhariFinalizeIdx >= 0) {
    const yCfg = configs[yidhariFinalizeIdx]
    yCfg.yidhariFinalizeEx = true
    let finalizeStable = false
    for (let finalizePass = 0; finalizePass < 12; finalizePass++) {
      const prev = states
      states = iterate(configs, states, config)
      // 终局重推要求全状态逐位稳定：她的次数已是整数，队友（如莱卡恩实数次数）在整数池下
      // 是整数输入的确定性函数——逐位相等才是 determinism.test（伤害逐位一致）的判据；
      // 只比次数会用 ε 外的平A时间残差破坏逐位一致。
      let stable = true
      for (let i = 0; i < states.length; i++) {
        const a = states[i], b = prev[i]
        if (a.exSpecialCount !== b.exSpecialCount || a.ultimateCount !== b.ultimateCount ||
            a.basicAttackTime !== b.basicAttackTime || a.necessaryTime !== b.necessaryTime ||
            a.frontlineTime !== b.frontlineTime || a.backstageTime !== b.backstageTime ||
            a.comboAlignTime !== b.comboAlignTime || a.comboAlignCredit !== b.comboAlignCredit ||
            a.totalEnergy !== b.totalEnergy || a.totalDecibel !== b.totalDecibel) {
          stable = false
          break
        }
      }
      if (stable) {
        finalizeStable = true
        break
      }
    }
    // 旗标复位移到装配之后（2026-09-09，与 billyFinalizeChain 同款）：装配行必须仍按终局语义
    // floor（yidhari 蓄力 cycles 迭代期实数松弛后，装配期靠本旗标取整数行），复位只服务于
    // 「cfg 被外层不动点/热启动复用，下轮调用回到实数迭代期」。
    // 实数迭代期的 2-循环（次数↔喧响↔终结技阈值）被终局整数重推吸收：重推稳定的整数态
    // 就是终局不动点，收敛标志按重推结果报（重推 ≤3 轮未稳 = 不谎报收敛）。
    if (finalizeStable) converged = true
  }

  // 热启动回写：本轮末态（无论是否完全收敛，同配置下次都从它出发）
  if (!config.initialStates) storeWarmStart(warmExactKey, warmSeedStates)

  // 收敛后按最终状态折算跨角色联动：卢西娅4命帷幕触发次数（含伊德海莉大招开帷幕）、回血按卢西娅大招次数
  const luciaSlot = configs.findIndex(c => c.agentId === '1451')
  const yidhariSlot = configs.findIndex(c => c.agentId === '1051')
  const curtainCoverage = configs.find(c => c.luciaC4CurtainCoverage !== undefined)?.luciaC4CurtainCoverage ?? 1
  const curtainTriggers = luciaSlot >= 0
    ? computeLuciaCurtainTriggers(
        states[luciaSlot]?.exSpecialCount ?? 0,
        states[luciaSlot]?.ultimateCount ?? 0,
        yidhariSlot >= 0 ? (states[yidhariSlot]?.ultimateCount ?? 0) : 0,
        curtainCoverage,
        totalTime,
      )
    : 0

  // 构建最终结果
  /**
   * 赠送行时间（诺姆膛温赠链 / 琉音好评转大赠大）：由 `applyNormaHatChain` / `applyLiuyinPromote`
   * 在装配**之后**追加到目标槽执行计划，不在 `buildExecutions` 产物里；其时间已由 iterate 计入
   * 目标槽必要时间（GROSS 全额，见 helpers.ts Step4 两处预留）。**截断上限与前台展示必须同口径计入**，
   * 否则：① 其它行按「含赠送时间的账本」截断、再叠加赠送行 → 物化行超账本（守恒破）；
   * ② 资源卡「总计」= 战斗时间 + 赠送秒数（用户实测 2026-09-08：诺姆入队后主C 180s + 诺姆连携秒数）。
   * 轴模式不预留（轴内赠块由轴引擎计账，见 helpers.ts `liuyinGiftAxisActive`），故同样不在此计入。
   */
  const giftNormaIdxFinal = configs.findIndex(c => c.agentId === '1571')
  const normaGiftFinal = giftNormaIdxFinal >= 0
    ? normaGiftChainInfo(configs, states, giftNormaIdxFinal, totalTime)
    : { targetIdx: -1, time: 0 }
  // 琉音赠大（装配侧：截断上限 + 前台展示）：轴模式维持旧口径「不预留/不计入」（2026-09-10 实测：
  // 改用轴预设计数会让落点大改——stun 4→6、dmg ±5.8%/+32.5%，属数值重排，须裁决；见 docs 坑19①）
  const liuyinGiftFinal = !config.axisUltimateTrackBySlot && configs.some(c => c.agentId === '1481')
    ? liuyinGiftChainInfo(configs, states, configs.findIndex(c => c.agentId === '1481'), totalTime, config.stunCount ?? 0)
    : { targetIdx: -1, time: 0 }
  const giftTimeOfSlot = (idx: number): number =>
    (idx === normaGiftFinal.targetIdx ? normaGiftFinal.time : 0)
    + (idx === liuyinGiftFinal.targetIdx ? liuyinGiftFinal.time : 0)
  /** 时间线截断总量（装配阶段砍掉的秒数）：= 资源允许但时间装不下的部分，上报为 overflowSeconds */
  let timeTruncatedSeconds = 0
  const characters: CharacterResourceResult[] = configs.map((cfg, i) => {
    const state = states[i]
    const chainCountTotal = state.chainCountTotal

    // 伊德海莉外部回血按卢西娅最终终结技次数折算后写回 cfg（供喧响/展示共用精确值）
    if (i === yidhariSlot && luciaSlot >= 0) {
      cfg.yidhariExternalHealPct = (cfg.yidhariExternalHealPct ?? 0)
        + (cfg.yidhariExternalHealPerUltPct ?? 0) * (states[luciaSlot]?.ultimateCount ?? 0)
    }
    // 卢西娅4命帷幕触发总次数写回 cfg（供模块资源卡展示）
    if (i === luciaSlot) {
      cfg.luciaCurtainTriggerCount = curtainTriggers
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

    // 诺姆影画4·膛温换连携喧响：次数 = floor(膛温/80)，直接调模块纯函数（不依赖 buildResourceResult 写入，
    // 避免把 buildResourceResult 提前改变 billy 等角色的 cfg 时序）
    const normaC4Decibel = (cfg.normaCinemaLevel ?? 0) >= 4 && cfg.agentId === '1571'
      ? computeNormaHatToChainCount(cfg, {
          exSpecialCount: state.exSpecialCount,
          ultimateCount: state.ultimateCount,
          frontlineTime: state.frontlineTime,
          battleTime: totalTime,
        }, Number((cfg as unknown as Record<string, unknown>)['setting:norma.holdSeconds'] ?? 2)) * 200 * 2
      : 0

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
    const executions = truncated.executions
    timeTruncatedSeconds += truncated.cutSeconds
    // 显示口径统一：前台时间 = **前台**执行行 ΣtotalTime（后台行不占共享轴，如莱卡恩围猎蓄力；
    // 含合轴，机制改写行/倍率表行都在内），后台 = 总时间 - 前台。
    // 装配后追加的赠送行（诺姆赠链/琉音赠大）不在 Σ行里——展示层由 `normalizeDisplayTime`
    // 在编排层按最终行统一重算（单一口径，新增赠送机制不必各自回扣）。
    const execFrontlineTime = executions.reduce((sum, e) => sum + (isFrontlineExecution(e) ? (e.totalTime ?? 0) : 0), 0)
      + giftTimeThisSlot
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

    return {
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
  })

  // 溢出 = **被时间线截断掉的秒数**（装配阶段实测）：为了塞进战斗时间砍掉了多少动作。
  // 截断后 Σ物化净占用恒 ≤ 预算，所以"账本超预算"（iterate 那份中间值）与"物化超预算"
  // 都不再是溢出——只有真被砍掉的时间才是。消费方：TeamComparePage 操作难度横轴（1秒=1难度点）。
  config.overflowSeconds = timeTruncatedSeconds

  // 比利/伊德海莉终局旗标复位：cfg 对象被外层不动点/热启动复用，下轮调用必须回到实数迭代期
  // （伊德海莉复位必须在装配之后：装配行按 finalizeEx=true floor 蓄力 cycles，见 buildYidhariExecutions）
  for (const cfg of configs) if (cfg.agentId === '1531') cfg.billyFinalizeChain = false
  for (const cfg of configs) if (cfg.agentId === '1051') cfg.yidhariFinalizeEx = false

  // 终局预留量（供 applyLiuyinPromote 判定跳过 post-hoc carve；与 iterate Step4 同一求解）
  // ——与上方 giftTimeOfSlot 同源（同一 helper、同一轴模式条件），不重算。
  const liuyinGiftTimeTotal = liuyinGiftFinal.time

  return {
    totalTime,
    plannedStunCount: inputStunCount,
    characters,
    iterations: iter,
    converged,
    axisOverlapSeconds: config.axisOverlapSeconds,
    axisOverlapByAction: config.axisOverlapByAction,
    overflowSeconds: config.overflowSeconds,
    // 琉音好评转大赠链时间已由引擎预留（非轴）→ applyLiuyinPromote 不再 post-hoc carve 守恒
    liuyinGiftTimeReserved: liuyinGiftTimeTotal > 0 ? liuyinGiftTimeTotal : undefined,
    convergence: {
      timeBudgetConverged,
      timeBudgetPasses,
      timeBudgetResidualSeconds,
      timeBudgetIdleSeconds,
      timeBudgetRefundedSeconds,
      timeTruncatedSeconds,
    },
  }
}

// ============ 辅助函数 ============

/** 终结技喧响消耗（全游戏统一3000，仅1个角色为2000暂不纳入计算器） */
export const ULTIMATE_COST_DEFAULT = 3000

/** 从倍率表数据提取强特信息
 *  在 special category 中找 "EX Special Attack" 的 move
 *  energyCost 从 move.energyCost 字段提取（如 {"Energy Cost": "60"}）
 *  多数角色只取第一个耗能的强特即可；复杂消耗（如柏妮思多种耗能）后续单独修改
 *  2026-09 成本类型化：energyCost 键按语义分类（energy/resource/free）——
 *  替代资源键（如克拉蕾 "Sharpness Cost"（锐能））不再被解析成能量消耗
 */
export function findExSpecial(agentSkills: {
  categories: { id: string; moves: { id: string; name: { en?: string }; energyCost?: Record<string, string>; rows: { id: string; values: number[] }[]; actionTime?: number | null; comboAlignRatio?: number }[] }[]
}): { moveId: string; energyConsume: number; costType: ExSpecialCostType; costAmount: number; resourceId?: string; actionTime: number; decibelRecovery: number; energyCostRaw?: Record<string, string>; comboAlignRatio: number } | null {
  const special = agentSkills.categories.find(c => c.id === 'special')
  if (!special) return null

  // 找第一个有 energyCost 且非空的 EX Special
  const exMove = special.moves.find(m => {
    const name = m.name?.en?.toLowerCase() || ''
    return name.includes('ex special') && m.energyCost && Object.keys(m.energyCost).length > 0
  })
  // 如果没找到有 energyCost 的，退而找任意 EX Special
  const fallbackMove = exMove || special.moves.find(m =>
    (m.name?.en?.toLowerCase() || '').includes('ex special')
  )
  if (!fallbackMove) return null

  // 成本类型化：键名含 energy → 能量（含闪能）；否则 → 替代资源；无键 → 免费
  const energyCostRaw = fallbackMove.energyCost
  const keys = energyCostRaw ? Object.keys(energyCostRaw) : []
  const energyKey = keys.find(k => /energy/i.test(k))
  let costType: ExSpecialCostType = 'energy'
  let costAmount = 0
  let resourceId: string | undefined
  if (!energyCostRaw || keys.length === 0) {
    costType = 'free'
  } else if (energyKey) {
    // 优先取 "Energy Cost" 等激活键，其次取第一个可解析为数字的能量键
    const priorityKeys = ['Energy Cost', 'Activation Energy Cost', 'Energy Cost to Use']
    let parsed = 0
    for (const pk of priorityKeys) {
      if (energyCostRaw[pk]) {
        const num = parseFloat(energyCostRaw[pk])
        if (!isNaN(num)) { parsed = num; break }
      }
    }
    if (parsed === 0) {
      for (const k of [energyKey, ...keys]) {
        const num = parseFloat(energyCostRaw[k])
        if (!isNaN(num) && num > 0) { parsed = num; break }
      }
    }
    costAmount = parsed
    if (energyKey.toLowerCase().includes('flash')) resourceId = 'flash'
  } else {
    costType = 'resource'
    // 替代资源：取第一个可解析为数字的量（克拉蕾 Sharpness Cost 60 → 锐能 60）
    for (const k of keys) {
      const num = parseFloat(energyCostRaw[k])
      if (!isNaN(num) && num > 0) { costAmount = num; break }
    }
    resourceId = keys[0]?.toLowerCase().includes('sharpness') ? 'sharpness' : keys[0]
  }

  // 多段强特（登记融合组，如雅·飞雪斩击 = #1+#2）：时间与喧响按一次动作取整段；
  // **耗能不动**——nanoka 把耗能写在前缀项上，一次动作只计一次（坑 31）。
  const { actionTime: exActionTime, decibelRecovery: exDecibel } = channelMetricsOf(agentSkills, fallbackMove)

  return {
    moveId: fallbackMove.id,
    // 能量型照旧计费；替代资源/免费型不再冒充能量 60
    energyConsume: costType === 'energy' ? costAmount : 0,
    costType,
    costAmount,
    resourceId,
    actionTime: exActionTime,
    decibelRecovery: exDecibel,
    energyCostRaw,
    comboAlignRatio: fallbackMove.comboAlignRatio ?? 0,
  }
}

/** 从倍率表数据提取终结技信息
 *  在 chain category 中找 "Ultimate" 的 move（区别于 "Chain Attack"）
 *  注意：终结技消耗3000喧响释放，数据行本身无 decibel_recovery，故 decibelRecovery 恒为0
 */
export function findUltimate(agentSkills: {
  categories: { id: string; moves: { id: string; name: { en?: string }; rows: { id: string; values: number[] }[]; actionTime?: number | null; comboAlignRatio?: number }[] }[]
}): { moveId: string; actionTime: number; decibelRecovery: number; comboAlignRatio: number } | null {
  const chain = agentSkills.categories.find(c => c.id === 'chain')
  if (!chain) return null

  const ultMove = chain.moves.find(m => {
    const name = m.name?.en?.toLowerCase() || ''
    return name.includes('ultimate') && !name.includes('chain attack')
  })
  if (!ultMove) return null

  // 多段终结技（登记组，如妮可 特制以太榴弹 = 炮击 + 能量场）：倍率/喧响取整段，
  // 时间只取站场段（能量场是自动攻击）。
  const { actionTime: ultActionTime, decibelRecovery: ultDecibel } = channelMetricsOf(agentSkills, ultMove)

  return {
    moveId: ultMove.id,
    actionTime: ultActionTime,
    decibelRecovery: ultDecibel,
    comboAlignRatio: ultMove.comboAlignRatio ?? 0,
  }
}

/**
 * 融合组「一次动作」的整段量（前台时长 + 喧响）。moveId 登记了融合组
 * （`data/moveFusions.ts` 单一事实源）时：
 *   - actionTime = Σ (countsTime !== false 的段) actionTime × term.count——
 *     能力场/自动攻击段（妮可 1031303/1031305）打伤害但角色不站场，时间按 0 计；
 *   - decibelRecovery = Σ **全部**段 decibel_recovery × term.count（能量场照样回喧响）。
 * 未登记或组内缺段 → null（回头段原值，保守防半融合）。
 *
 * 为什么必须走登记组而不是「同 category 里的 #N 段全加」：catalog 的多段行既可能是
 * 一次动作的分段（星见雅春临 #1~#3），也可能是两个独立动作（叶瞬光 1431 连携两段
 * 3.3s/2.5s、喧响 218.9 已在全体基线内）——启发式求和会把后者顶成 5.8s 的假时长。
 *
 * @fact engine:fusedGroupMetrics/一次动作整段量 口径: 登记融合组的「一次动作」在倍率·失衡·积蓄·喧响上 Σ 全部段、在前台时间上只 Σ countsTime≠false 的段（能力场/自动攻击段不站场）；未登记段仍取本段值 | 据 用户@2026-09-11「倍率表必须融合，因为连携本身就是打3段」+「时间通道只回头段那也不行，必须改」+「只有炮击算时间，能力场是自动攻击，不算时间」 | 验 src/composables/__tests__/moveFusion.test.ts | 锚 src/core/resource.ts#fusedGroupMetrics | 信 确认
 */
export function fusedGroupMetrics(
  agentSkills: {
    categories: {
      moves: { id: string; actionTime?: number | null; rows?: { id: string; values: number[] }[] }[]
    }[]
  },
  moveId: string,
): { actionTime: number; decibelRecovery: number } | null {
  const group = moveFusionByMoveId.get(moveId)
  if (!group) return null
  const segments = new Map<string, { actionTime?: number | null; rows?: { id: string; values: number[] }[] }>()
  for (const cat of agentSkills.categories) {
    for (const m of cat.moves ?? []) segments.set(String(m.id), m)
  }
  let actionTime = 0
  let decibelRecovery = 0
  for (const term of group.terms) {
    const seg = segments.get(term.moveId)
    if (!seg) return null
    if (term.countsTime !== false) actionTime += (seg.actionTime ?? 0) * term.count
    const row = seg.rows?.find(r => r.id === 'decibel_recovery')
    decibelRecovery += (row?.values[0] || 0) * term.count
  }
  return { actionTime, decibelRecovery }
}

/** 只要时长的那一侧（能力场段按 0 计）——留给只需要 actionTime 的调用方。 */
export function fusedGroupActionTime(
  agentSkills: { categories: { moves: { id: string; actionTime?: number | null; rows?: { id: string; values: number[] }[] }[] }[] },
  moveId: string,
): number | null {
  return fusedGroupMetrics(agentSkills, moveId)?.actionTime ?? null
}

/**
 * 各族 `find*` 的统一出口：一条通道（强特/终结/连携/闪反/招架/支援突击…）取到的
 * 「一次动作」前台时长与喧响。登记了融合组 → 整段量；否则 → 本段量。
 * **时间不是「招式段」的单元，是「一次动作」的单元**——只回头段会把一次动作
 * 的其余段整段漏掉（坑 31：雅连携显示 0.515s，实际一次打三段 1.717s）。
 */
function channelMetricsOf(
  agentSkills: {
    categories: {
      moves: { id: string; actionTime?: number | null; rows?: { id: string; values: number[] }[] }[]
    }[]
  },
  move: { id: string; actionTime?: number | null; rows?: { id: string; values: number[] }[] },
): { actionTime: number; decibelRecovery: number } {
  const fused = fusedGroupMetrics(agentSkills, move.id)
  if (fused) return fused
  return {
    actionTime: move.actionTime ?? 0,
    decibelRecovery: move.rows?.find(r => r.id === 'decibel_recovery')?.values[0] || 0,
  }
}

/** 从倍率表数据提取连携技信息
 *  在 chain category 中找 "Chain Attack" 的 move（区别于 "Ultimate"）
 *  多段连携（登记融合组）取**一次动作**的整段量：倍率/喧响 Σ 全部段、时间 Σ 站场段。
 *  结果页同屏显示「1258.3% / 单次 0.515s」两套口径即为该错配（坑 31）。
 */
// @fact engine:findChainAttack/多段连携 口径: 登记融合组的连携「一次动作」时长 = Σ 站场段 actionTime（星见雅春临 0.515+0.515+0.687=1.717s；妮可 0.25+0.25=0.5s，能量场段不计时），喧响 = Σ 全部段（雅 230.15、妮可 217.25，全体基线 168~278）；未登记连携仍取头段 | 据 nanoka full/1091.json + full/1031.json param.desc + 用户@2026-09-11 | 验 src/composables/__tests__/moveFusion.test.ts | 锚 src/core/resource.ts#findChainAttack | 信 确认
export function findChainAttack(agentSkills: {
  categories: { id: string; moves: { id: string; name: { en?: string }; rows: { id: string; values: number[] }[]; actionTime?: number | null; comboAlignRatio?: number }[] }[]
}): { moveId: string; actionTime: number; decibelRecovery: number; comboAlignRatio: number } | null {
  const chain = agentSkills.categories.find(c => c.id === 'chain')
  if (!chain) return null

  const chainMove = chain.moves.find(m => {
    const name = m.name?.en?.toLowerCase() || ''
    return name.includes('chain attack') && !name.includes('ultimate')
  })
  if (!chainMove) return null

  const { actionTime, decibelRecovery } = channelMetricsOf(agentSkills, chainMove)

  return {
    moveId: chainMove.id,
    actionTime,
    decibelRecovery,
    comboAlignRatio: chainMove.comboAlignRatio ?? 0,
  }
}

/** 从倍率表提取轻弹刀（Defensive Assist #1）信息
 *  在 assist category 中找 name 含 "Defensive Assist" 且含 "#1" 的 move
 */
/** 从倍率表提取闪避反击（Dodge Counter）信息 */
export function findDodgeCounter(agentSkills: {
  categories: { id: string; moves: { id: string; name: { en?: string; zhCN?: string }; rows: { id: string; values: number[] }[]; actionTime?: number | null; comboAlignRatio?: number; timeType?: string }[] }[]
}): { moveId: string; actionTime: number; decibelRecovery: number; comboAlignRatio: number } | null {
  const dodge = agentSkills.categories.find(c => c.id === 'dodge' || c.id === 'dodgecounter')
  if (!dodge) return null

  const move = dodge.moves.find(m => {
    const en = m.name?.en?.toLowerCase() || ''
    const zh = m.name?.zhCN || ''
    return m.timeType === 'dodgeCounter' || en.includes('dodge counter') || zh.includes('闪避反击')
  })
  if (!move) return null

  // 一次动作可能被 catalog 拆成多段（登记融合组）：前台时间与喧响都走融合口径（坑 31）。
  const { actionTime, decibelRecovery } = channelMetricsOf(agentSkills, move)

  return {
    moveId: move.id,
    actionTime,
    decibelRecovery,
    comboAlignRatio: move.comboAlignRatio ?? 0,
  }
}

export function findDefensiveAssist(agentSkills: {
  categories: { id: string; moves: { id: string; name: { en?: string; zhCN?: string }; rows: { id: string; values: number[] }[]; actionTime?: number | null; comboAlignRatio?: number }[] }[]
}): { moveId: string; actionTime: number; decibelRecovery: number; comboAlignRatio: number } | null {
  const assist = agentSkills.categories.find(c => c.id === 'assist')
  if (!assist) return null

  const move = assist.moves.find(m => {
    const name = m.name?.en?.toLowerCase() || ''
    return name.includes('defensive assist') && name.includes('#1')
  })
  if (!move) return null

  // 一次动作可能被 catalog 拆成多段（登记融合组）：时间与喧响走融合口径（坑 31）。
  const { actionTime, decibelRecovery } = channelMetricsOf(agentSkills, move)

  return {
    moveId: move.id,
    actionTime,
    decibelRecovery,
    comboAlignRatio: move.comboAlignRatio ?? 0,
  }
}

/** 从倍率表提取支援突击（Assist Follow-Up）信息
 *  在 assist category 中找 name 含 "Assist Follow-Up" 的 move（取第一个）
 */
export function findAssistFollowUp(agentSkills: {
  categories: { id: string; moves: { id: string; name: { en?: string; zhCN?: string }; rows: { id: string; values: number[] }[]; actionTime?: number | null; comboAlignRatio?: number }[] }[]
}): { moveId: string; actionTime: number; decibelRecovery: number; comboAlignRatio: number } | null {
  const assist = agentSkills.categories.find(c => c.id === 'assist')
  if (!assist) return null

  const move = assist.moves.find(m => {
    const name = m.name?.en?.toLowerCase() || ''
    return name.includes('assist follow-up') || name.includes('assist follow up')
  })
  if (!move) return null

  // 一次动作可能被 catalog 拆成多段（登记融合组）：时间与喧响走融合口径（坑 31）。
  const { actionTime, decibelRecovery } = channelMetricsOf(agentSkills, move)

  return {
    moveId: move.id,
    actionTime,
    decibelRecovery,
    comboAlignRatio: move.comboAlignRatio ?? 0,
  }
}


/** 从倍率表提取蕾米「普通攻击：垂虹」信息（特殊虚耀跟随该动作触发） */
export function findRemielleRainbowEnd(agentSkills: {
  categories: { id: string; moves: { id: string; name: { en?: string; zhCN?: string }; rows: { id: string; values: number[] }[]; actionTime?: number | null; comboAlignRatio?: number }[] }[]
}): { moveId: string; actionTime: number; decibelRecovery: number; comboAlignRatio: number } | null {
  const basic = agentSkills.categories.find(c => c.id === 'basic')
  if (!basic) return null

  const move = basic.moves.find(m => {
    const en = (m.name?.en ?? '').toLowerCase()
    const zh = m.name?.zhCN ?? ''
    return m.id === '1581007' || en.includes("rainbow's end") || zh.includes('垂虹')
  })
  if (!move) return null

  // 一次动作可能被 catalog 拆成多段（登记融合组）：时间与喧响走融合口径（坑 31）。
  const { actionTime, decibelRecovery } = channelMetricsOf(agentSkills, move)

  return {
    moveId: move.id,
    actionTime,
    decibelRecovery,
    comboAlignRatio: move.comboAlignRatio ?? 0,
  }
}

/** 从倍率表提取蕾米后台 Radiant Turn 信息 */
export function findRemielleRadiantTurn(agentSkills: {
  categories: { id: string; moves: { id: string; name: { en?: string; zhCN?: string }; rows: { id: string; values: number[] }[]; actionTime?: number | null; comboAlignRatio?: number }[] }[]
}): { moveId: string; actionTime: number; decibelRecovery: number; comboAlignRatio: number } | null {
  const special = agentSkills.categories.find(c => c.id === 'special')
  if (!special) return null

  const move = special.moves.find(m => {
    const en = (m.name?.en ?? '').toLowerCase()
    const zh = m.name?.zhCN ?? ''
    return m.id === '1581010' || en.includes('radiant turn') || zh.includes('radiant turn') || zh.includes('曙光回旋')
  })
  if (!move) return null

  // 一次动作可能被 catalog 拆成多段（登记融合组）：时间与喧响走融合口径（坑 31）。
  const { actionTime, decibelRecovery } = channelMetricsOf(agentSkills, move)

  return {
    moveId: move.id,
    actionTime,
    decibelRecovery,
    comboAlignRatio: move.comboAlignRatio ?? 0,
  }
}

/** 计算平A秒均回能
 *  遍历 basic category，取 #1-#N 普通平A段（排除强化平A），求秒均回能平均值
 */
export function calcBasicAttackRegenPerSec(agentSkills: {
  categories: { id: string; moves: { id: string; name: { en?: string }; actionTime?: number | null; rows: { id: string; values: number[] }[] }[] }[]
}): { energyPerSec: number; decibelPerSec: number } {
  const basic = agentSkills.categories.find(c => c.id === 'basic')
  if (!basic) return { energyPerSec: 0, decibelPerSec: 0 }

  const energyRates: number[] = []
  const decibelRates: number[] = []

  for (const move of basic.moves) {
    const name = move.name?.en || ''
    // 匹配 #1 到 #N 的普通平A段
    const match = name.match(/#\d+/)
    if (!match) continue
    // 排除冲刺攻击、闪避反击等
    if (name.toLowerCase().includes('dash') || name.toLowerCase().includes('dodge')) continue

    const actionTime = move.actionTime
    if (!actionTime || actionTime <= 0) continue

    let energy = 0
    let decibel = 0
    for (const row of move.rows) {
      if (row.id === 'energy_recovery') energy = row.values[0] || 0
      // 命破角色用闪能：平A回复读 flash_energy_recovery（能量回复读 energy_recovery，二者互斥）
      if (row.id === 'flash_energy_recovery') energy = row.values[0] || 0
      if (row.id === 'decibel_recovery') decibel = row.values[0] || 0
    }

    // 排除强化平A：倍率异常高（强化平A伤害通常是普通平A的2-3倍以上）
    let damage = 0
    for (const row of move.rows) {
      if (row.id === 'damage') damage = row.values[0] || 0
    }
    // 简单判定：伤害倍率 > 200% 可能是强化平A（后续可调）
    if (damage > 200) continue

    energyRates.push(energy / actionTime)
    decibelRates.push(decibel / actionTime)
  }

  const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0
  return {
    energyPerSec: avg(energyRates),
    decibelPerSec: avg(decibelRates),
  }
}

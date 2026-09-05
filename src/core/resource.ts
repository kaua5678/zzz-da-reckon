import type {
  ResourceCalcConfig, CharacterOperationConfig,
  TeamResourceResult, CharacterResourceResult,
  IterationState, ExSpecialCostType,
} from '@/types/resource'
import { isFrontlineExecution } from '@/types/resource'
import { getAgentMechanic } from '@/mechanics'
import { computeLuciaCurtainTriggers } from '@/mechanics/agents/luciaElowen'
import { computeNormaHatToChainCount } from '@/mechanics/agents/norma'
import { resolveUltimateTargetSlot } from '@/mechanics/agents/liuyin'
import { computeLiuyinHugCounts, computeLiuyinSource } from '@/mechanics/agents/liuyin'

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

// ============ 单角色能量计算 ============

/** 计算单角色能量回复（单次迭代，基于当前时间分配） */
import * as ResourceCalcHelpers from './resource/helpers'
const { calcEnergySource, calcRawDecibelParts, calcDecibelSource, calcTimeAllocation, buildExecutions, buildAnomalyEventExecutions, iterate, calcCrossAgentEnergy, truncateExecutionsToFrontline } = ResourceCalcHelpers

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
 * 欠打回填的启动门槛（秒）：低于此量不试探，避免为量化残差扰动外层不动点。
 * @fact engine:欠打回填 口径: 折叠循环退出后按「预算−物化净占用」重测欠打量，折半试探注入 refund；接受三条件=内层判稳+trialRows≤预算−容差+行数变多，任一不满足连 cfg 一起回滚；门槛 10s（≤5s 会把近均衡队推进 stunCount=0 吸引盆）；宁可留白不制造超预算 | 据 用户@2026-09-05「全部动手」+实测 | 验 src/composables/__tests__/underfillRefund.test.ts | 锚 src/core/resource.ts#UNDERFILL_PROBE_THRESHOLD_SECONDS | 信 确认
 */
export const UNDERFILL_PROBE_THRESHOLD_SECONDS = 10

export function calcTeamResources(config: ResourceCalcConfig): TeamResourceResult {
  const totalTime = config.totalTime
  // 伊德海莉连续松弛（0.5 阻尼）收敛比整数动力学慢：她的队内层迭代上限提到 100
  // （阻尼残差减半每轮，且判稳用严格相等——浮点不动点约需 40+ 轮；只影响含她的队，其余队维持 20 历史口径）。
  const yidhariContinuousPresent = config.characters.some(c => c.agentId === '1051' && c.yidhariContinuousEx === true)
  const maxIter = Math.max(config.maxIterations || 20, yidhariContinuousPresent ? 100 : 0)
  const configs = config.characters

  // 热启动：无显式种子时查缓存，命中则从上次收敛态出发（逐位透明，见块注释）
  const warmExactKey = config.initialStates ? '' : warmStartExactKey(config)
  const warmSeed = lookupWarmStart(config)

  // 初始 state：平A时间按权重分配，强特/大招次数初始为0（initialStates 注入：测试/热启动用）
  const totalWeight = configs.reduce((a, c) => a + c.timeWeight, 0)
  const injectedStates = config.initialStates && config.initialStates.length === configs.length
    ? config.initialStates
    : warmSeed?.states
  let states: IterationState[] = injectedStates
    ? injectedStates.map(s => ({ ...s }))
    : configs.map(cfg => ({
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
   * 热启动种子：默认末态；欠打回填触发时改存**试探前**末态（保持冷/热逐位一致，见回填块注释）。
   * @fact engine:热启动逐位透明 口径: 回填触发时热启动缓存存试探前末态——存回填后末态会让下次调用从「已回填」出发、不再测到 pass0 的正 excess，折出不同账本 → 冷热落点分叉（实测 1241/1191 队由一致变不一致） | 据 实测@2026-09-05 | 验 src/composables/__tests__/underfillRefund.test.ts | 锚 src/core/resource.ts#warmSeedStates | 信 确认
   */
  let warmSeedStates: IterationState[] = states
  for (let timePass = 0; timePass < maxTimeIter; timePass++) {
    timeBudgetPasses = timePass + 1
    for (iter = 0; iter < maxIter; iter++) {
      const newStates = iterate(configs, states, config)

      // 检查收敛：强特次数和大招次数是否稳定。伊德海莉连续松弛（阻尼实数次数）同样按
      // 严格相等判稳——阻尼映射收敛到浮点不动点后逐位复现（热启动透明的前提）；ε 判据会留下
      // ~1e-12 残差，热启动会话与冷启动会话不再逐位一致（determinism.test 的失败机制）。
      let changed = false
      for (let i = 0; i < states.length; i++) {
        if (newStates[i].exSpecialCount !== states[i].exSpecialCount ||
            newStates[i].ultimateCount !== states[i].ultimateCount) {
          changed = true
          break
        }
      }

      states = newStates
      if (!changed) {
        converged = true
        break
      }
    }

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
    const gift = giftNormaSlot >= 0 ? normaGiftChainInfo(configs, states, giftNormaSlot, totalTime) : { targetIdx: -1, time: 0 }
    // 琉音好评转大赠链行同理（非轴）：装配后 applyLiuyinPromote 追加，行测量计入其时间
    const giftLiuyinSlot = !config.axisUltimateTrackBySlot && configs.some(c => c.agentId === '1481') ? configs.findIndex(c => c.agentId === '1481') : -1
    const giftLiuyin = giftLiuyinSlot >= 0
      ? liuyinGiftChainInfo(configs, states, giftLiuyinSlot, totalTime, config.stunCount ?? 0)
      : { targetIdx: -1, time: 0 }
    for (let i = 0; i < configs.length; i++) {
      const cfg = configs[i]
      const state = states[i]
      const teammateFrontlineSeconds = configs.reduce(
        (sum, _, j) => (j === i ? sum : sum + states[j].frontlineTime),
        0,
      )
      const executions = buildExecutions(cfg, state, state.chainCountTotal, teammateFrontlineSeconds)
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
          : sum + Math.max(0, states[j].necessaryTime - (states[j].comboAlignCredit ?? 0) + states[j].basicAttackTime)),
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

  // ===== 星徽·比利终局整数重推（链数实数化收尾，2026-09-06，1051 yidhariFinalizeEx 同骨架）=====
  // 迭代期她的动力压制链数与最高马力星光以实数参与收敛（HP 池 ∝ 普攻回血 ∝ 平A时间 = 正反馈
  // 连续通道；消滞后后估时与物化共用同一求解器），终局 floor 一次 + 整数态重推 ≤12 轮到全状态
  // 逐位稳定，让时间预算/能量/喧响账本与整数链数自洽（只作用于 1531 非轴模式，轴模式恒整数）。
  // 旗标在最终装配后才复位：欠打回填试探与最终装配都必须按**整数物化行**测可行性/出账，
  // 否则「floor 后 +1 链（≈10s）」的时长会被当成余量放行（1s 容差兜不住一整链）。
  const billyFinalizeConfigs = configs.filter(c => c.agentId === '1531' && Number((c as unknown as Record<string, unknown>).billyAxisActive ?? 0) !== 1)
  if (billyFinalizeConfigs.length > 0) {
    for (const bCfg of billyFinalizeConfigs) bCfg.billyFinalizeChain = true
    let finalizeStable = false
    for (let finalizePass = 0; finalizePass < 12; finalizePass++) {
      const prev = states
      states = iterate(configs, states, config)
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
    if (finalizeStable) converged = true
  }

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
      const giftLiu = !config.axisUltimateTrackBySlot && configs.some(c => c.agentId === '1481')
        ? liuyinGiftChainInfo(configs, st, configs.findIndex(c => c.agentId === '1481'), totalTime, config.stunCount ?? 0)
        : { targetIdx: -1, time: 0 }
      for (let i = 0; i < configs.length; i++) {
        const cfg = configs[i]
        const state = st[i]
        const teammateFrontline = configs.reduce(
          (sum, _, j) => (j === i ? sum : sum + st[j].frontlineTime), 0)
        const rowNet = buildExecutions(cfg, state, state.chainCountTotal, teammateFrontline).reduce(
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
    /** 内层次数收敛（与折叠循环同一判据：强特/终结次数严格相等）；stable=false = 耗尽上限 */
    const convergeCounts = (from: IterationState[]) => {
      let st = from
      for (let k = 0; k < maxIter; k++) {
        const next = iterate(configs, st, config)
        let changed = false
        for (let i = 0; i < st.length; i++) {
          if (next[i].exSpecialCount !== st[i].exSpecialCount
            || next[i].ultimateCount !== st[i].ultimateCount) { changed = true; break }
        }
        st = next
        if (!changed) return { states: st, stable: true }
      }
      return { states: st, stable: false }
    }
    const statesPreProbe = states
    let rowsFilled = frontlineRowsOf(states)
    let underfill = budgetSeconds - rowsFilled
    // 门槛 10s：±1~2s 的量化残差属既有口径（坑12「不追求精确 0」），为它扰动外层均衡不划算——
    // 实测门槛降到 5s 以下时，对 2.2s 欠打的队做回填会把外层不动点推进 stunCount=0 的吸引盆
    // （失衡 116k→9.5k，runArchiveDeploy 雅/南宫/柚叶队崩、anomalyUtilization 丽娜积蓄偏 0.3%）。
    // 门槛扫描（留白合计/改善/变差）：1s=335/41/2(+2队崩) 5s=353/31/2(+2队崩) 10s=391/23/2 20s=421/20/2。
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
      // 热启动逐位透明：缓存**试探前**的末态。回填后的末态作种子会让折叠循环 pass0 从
      // 「已回填」出发（不再测到那个巨大的正 excess）→ 折出不同的账本 → 冷/热落点分叉
      // （实测 1241/1191 队由冷热一致变不一致）。存试探前末态则每次调用都重走同一条路径。
      warmSeedStates = statesPreProbe
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
    yCfg.yidhariFinalizeEx = false
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

    // 能量源 = iterate 驱动次数的快照（2026-09-03：展示与驱动同源，Δ 恒 0——
    // 曾各算各的：iterate 用上轮态、装配重算当前态，雅/莱卡恩 Δ=+55.5）。
    // 快照缺失（历史状态/热启动）才回退重算 + 跨角色回补。
    const energySrc = state.energySource
      ? { ...state.energySource }
      : calcEnergySource(cfg, state, configs, config.shieldCount, config.energyShieldCount, chainCountTotal, config.totalTime)
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
      const otherShareable = calcRawDecibelParts(otherCfg, states[j], otherChainCountTotal, states[j].exSpecialCount, states[j].ultimateCount, totalTime).shareableTotal
      teammateShare += otherShareable * otherCfg.decibelShareRatio
    }

    const teammateFrontlineSeconds = configs.reduce(
      (sum, _, j) => (j === i ? sum : sum + states[j].frontlineTime),
      0,
    )
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
      config.anomalyDecibelBonusPerSlot?.[i] ?? 0)
    const builtExecutions = buildExecutions(cfg, state, chainCountTotal, teammateFrontlineSeconds)
    // ===== 时间线截断（通用资源循环规则，2026-09-05 用户口径）=====
    // 本槽物化行超出账本（必要 + 平A）的部分按时间线尾部截断：平A行是填充项永远保留，
    // 招式行从后往前整行丢、边界行等比缩（伤害/失衡/积蓄/回能线性缩）。iterate 已把必要时间
    // 封顶到「预算 − 队友占用」，所以这里的上限就是账本本身。语义 = 实战 180s 到点结算，
    // 资源攒多了也兑现不出来——旧实现没有这层，只能靠虚高账本挤平A池，结果两头都不准。
    const truncated = truncateExecutionsToFrontline(
      builtExecutions, state.necessaryTime + state.basicAttackTime)
    const executions = truncated.executions
    timeTruncatedSeconds += truncated.cutSeconds
    // 显示口径统一：前台时间 = **前台**执行行 ΣtotalTime（后台行不占共享轴，如莱卡恩围猎蓄力；
    // 含合轴，机制改写行/倍率表行都在内），后台 = 总时间 - 前台。
    // 折叠循环把前台行对其账本收敛 + 本步截断 ⇒ Σ前台行 ≤ 账本 ≤ 战斗时间。
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

  // 比利终局旗标复位：cfg 对象被外层不动点/热启动复用，下轮调用必须回到实数迭代期
  for (const cfg of configs) if (cfg.agentId === '1531') cfg.billyFinalizeChain = false

  // 终局预留量（供 applyLiuyinPromote 判定跳过 post-hoc carve；与 iterate Step4 同一求解）
  const liuyinGiftTimeTotal = !config.axisUltimateTrackBySlot && configs.some(c => c.agentId === '1481')
    ? liuyinGiftChainInfo(configs, states, configs.findIndex(c => c.agentId === '1481'), totalTime, inputStunCount).time
    : 0

  return {
    totalTime,
    stunCount: inputStunCount,
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

  // 从 rows 提取 decibel_recovery
  let decibelRecovery = 0
  for (const row of fallbackMove.rows) {
    if (row.id === 'decibel_recovery') {
      decibelRecovery = row.values[0] || 0
    }
  }

  return {
    moveId: fallbackMove.id,
    // 能量型照旧计费；替代资源/免费型不再冒充能量 60
    energyConsume: costType === 'energy' ? costAmount : 0,
    costType,
    costAmount,
    resourceId,
    actionTime: fallbackMove.actionTime ?? 0,
    decibelRecovery,
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

  let decibelRecovery = 0
  for (const row of ultMove.rows) {
    if (row.id === 'decibel_recovery') {
      decibelRecovery = row.values[0] || 0
    }
  }

  return {
    moveId: ultMove.id,
    actionTime: ultMove.actionTime ?? 0,
    decibelRecovery,
    comboAlignRatio: ultMove.comboAlignRatio ?? 0,
  }
}

/** 从倍率表数据提取连携技信息
 *  在 chain category 中找 "Chain Attack" 的 move（区别于 "Ultimate"）
 */
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

  let decibelRecovery = 0
  for (const row of chainMove.rows) {
    if (row.id === 'decibel_recovery') {
      decibelRecovery = row.values[0] || 0
    }
  }

  return {
    moveId: chainMove.id,
    actionTime: chainMove.actionTime ?? 0,
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

  let decibelRecovery = 0
  for (const row of move.rows) {
    if (row.id === 'decibel_recovery') {
      decibelRecovery = row.values[0] || 0
    }
  }

  return {
    moveId: move.id,
    actionTime: move.actionTime ?? 0,
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

  let decibelRecovery = 0
  for (const row of move.rows) {
    if (row.id === 'decibel_recovery') {
      decibelRecovery = row.values[0] || 0
    }
  }

  return {
    moveId: move.id,
    actionTime: move.actionTime ?? 0,
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

  let decibelRecovery = 0
  for (const row of move.rows) {
    if (row.id === 'decibel_recovery') {
      decibelRecovery = row.values[0] || 0
    }
  }

  return {
    moveId: move.id,
    actionTime: move.actionTime ?? 0,
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

  let decibelRecovery = 0
  for (const row of move.rows) {
    if (row.id === 'decibel_recovery') {
      decibelRecovery = row.values[0] || 0
    }
  }

  return {
    moveId: move.id,
    actionTime: move.actionTime ?? 0,
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

  let decibelRecovery = 0
  for (const row of move.rows) {
    if (row.id === 'decibel_recovery') {
      decibelRecovery = row.values[0] || 0
    }
  }

  return {
    moveId: move.id,
    actionTime: move.actionTime ?? 0,
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

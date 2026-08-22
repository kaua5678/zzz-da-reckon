import type {
  ResourceCalcConfig, CharacterOperationConfig,
  TeamResourceResult, CharacterResourceResult,
  EnergySource, DecibelSource, TimeAllocation,
  SkillExecution, IterationState, AnomalyEventExecution,
} from '@/types/resource'
import { isFrontlineExecution } from '@/types/resource'
import type { PanelValues } from '@/types/catalog'
import { fmt } from '@/utils/format'
import { getAgentMechanic } from '@/mechanics'
import { computeLuciaCurtainTriggers } from '@/mechanics/agents/luciaElowen'
import { computeNormaHatToChainCount } from '@/mechanics/agents/norma'

// ============ 单角色能量计算 ============

/** 计算单角色能量回复（单次迭代，基于当前时间分配） */
import * as ResourceCalcHelpers from './resource/helpers'
const { calcEnergySource, calcRawDecibelParts, calcDecibelSource, calcTimeAllocation, buildExecutions, buildAnomalyEventExecutions, iterate, calcCrossAgentEnergy } = ResourceCalcHelpers
export function calcTeamResources(config: ResourceCalcConfig): TeamResourceResult {
  const totalTime = config.totalTime
  const maxIter = config.maxIterations || 20
  const configs = config.characters

  // 初始 state：平A时间按权重分配，强特/大招次数初始为0（可注入初值——连续松弛下与初值无关）
  const totalWeight = configs.reduce((a, c) => a + c.timeWeight, 0)
  const coldStates = (): IterationState[] => configs.map(cfg => ({
    basicAttackTime: totalWeight > 0
      ? totalTime * (cfg.timeWeight / totalWeight)
      : 0,
    exSpecialCount: 0,
    ultimateCount: 0,
    chainCountTotal: cfg.chainCountTotalOverride ?? cfg.chainCountPerStun * (config.stunCount ?? 0),
    totalEnergy: 0,
    totalDecibel: cfg.initialDecibelGift + (cfg.extraSelfDecibelReward ?? 0),
    necessaryTime: 0,
    frontlineTime: totalTime * (cfg.timeWeight / totalWeight) / Math.max(1, totalWeight) * totalWeight,
    backstageTime: 0,
    comboAlignTime: 0,
  }))
  let states: IterationState[] = config.initialStates && config.initialStates.length === configs.length
    ? config.initialStates.map(s => ({ ...s }))
    : coldStates()

  // 时间预算收敛（外层）+ 资源收敛（内层）：
  // 模块 buildExecutions 会物化出占用前台、但未计入 estimateExSpecialTime 的动作行
  // （雅霜月架势/叶瞬光飞光/柏妮思双喷/星徽比利EX链等）。本循环把每个角色执行行的
  // **前台时间**（timeBucket ≠ 'backstage'，见 isFrontlineExecution）对其**自家账本**
  // （necessaryTime + basicAttackTime）收敛：超出量折入 timeBudgetExcess → 压缩全队平A池
  // → 平A回能减少 → 次数重收敛。三人账本合计恒 ≤ 战斗时间（iterate 的共享池钳制保证），
  // 收敛后 Σ前台执行行 ≡ 账本 ≡ 共享时间轴的占用（构造性恒等式，游戏内 180s 必须打完）。
  // （战斗时间 − 无敌时间）仍由 iterate 的共享平A池钳制消费：availableBasicTime = max(0, 预算 − Σ必要)。
  const maxTimeIter = config.maxTimeIterations || 8
  // 重置上一轮调用残留的时间预算（cfg 可能被外层不动点复用）
  for (const cfg of configs) cfg.timeBudgetExcess = 0
  let converged = false
  let iter = 0
  // 收敛诊断：三层不动点里第 ② 层（时间预算）原先耗尽上限就静默接受末轮结果，见 ConvergenceReport
  let timeBudgetPasses = 0
  let timeBudgetConverged = false
  let timeBudgetResidualSeconds = 0
  let timeBudgetIdleSeconds = 0
  for (let timePass = 0; timePass < maxTimeIter; timePass++) {
    timeBudgetPasses = timePass + 1
    for (iter = 0; iter < maxIter; iter++) {
      const newStates = iterate(configs, states, config)

      // 检查收敛：强特/终结次数（实数）与平A时间稳定（ε=1e-9：收敛残差压到浮点尘埃，
      // 与到达路径无关；终局 floor(+1e-6) 的松弛带吸收边界误差）
      let changed = false
      for (let i = 0; i < states.length; i++) {
        if (Math.abs(newStates[i].exSpecialCount - states[i].exSpecialCount) > 1e-9 ||
            Math.abs(newStates[i].ultimateCount - states[i].ultimateCount) > 1e-9 ||
            Math.abs(newStates[i].basicAttackTime - states[i].basicAttackTime) > 1e-9) {
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
    // 只折正超出（真溢出）：负值 = estimate 高估必要时间 / 有空闲前台，属正常，不动（否则 necessary 变负、basic 膨胀）。
    let maxExcess = 0
    let maxIdle = 0
    for (let i = 0; i < configs.length; i++) {
      const cfg = configs[i]
      const state = states[i]
      const teammateFrontlineSeconds = configs.reduce(
        (sum, _, j) => (j === i ? sum : sum + states[j].frontlineTime),
        0,
      )
      const executions = buildExecutions(cfg, state, state.chainCountTotal, teammateFrontlineSeconds)
      const rowTime = executions.reduce((sum, e) => sum + (isFrontlineExecution(e) ? (e.totalTime ?? 0) : 0), 0)
      // 账本份额 = 必要时间 + 分到的平A池（iterate 保证 Σ账本 ≤ budget）
      const excess = rowTime - (state.necessaryTime + state.basicAttackTime)
      if (excess > 1e-6) {
        // 量化（floor 次数）导致残差 ~1s 属合轴可覆盖，不追求精确 0
        cfg.timeBudgetExcess = (cfg.timeBudgetExcess ?? 0) + excess
        if (excess > maxExcess) maxExcess = excess
      } else if (-excess > maxIdle) {
        // 负溢出按设计不折回（折回会让 necessaryTime 变负、平A池膨胀），但要上报：
        // 持续偏大 = 某模块 estimateExSpecialTime 系统性高估，单侧钳制会掩盖这类建模错误
        maxIdle = -excess
      }
    }
    timeBudgetResidualSeconds = maxExcess
    timeBudgetIdleSeconds = maxIdle
    if (maxExcess <= 1e-6) {
      timeBudgetConverged = true
      break
    }
  }

  // 连续松弛终局整数化（贪心装包）：迭代期次数为实数；终局先取 floor 基线（与旧整数动力学同
  // 量级，天然不溢出），再把各次数的**小数部分**按降序在剩余预算内逐一加回——消除 floor 的
  // 「时间税」系统性向下偏差（曾致失衡窗口 4→2、后场喷发 8→7 等边界塌缩），同时 Σ前台 ≤
  // 战斗−无敌由构造保证。收敛态仍是输入的纯函数（消滞回：不同初值不再落到相邻不动点）。
  // 结构性整数（般岳怒相循环、琉音三段等）小数恒 0，自动不参与加回。
  const invBudget = totalTime - (config.invincibleTime ?? 0)
  let n = {
    ex: states.map(s => Math.floor(s.exSpecialCount + 1e-6)),
    ult: states.map(s => Math.floor(s.ultimateCount + 1e-6)),
  }
  {
    // 组装 floor 基线并求剩余预算（必要时间为次数的线性函数，贪心可直接按单价扣减）
    const basePrev = states.map((s, i) => ({ ...s, exSpecialCount: n.ex[i], ultimateCount: n.ult[i] }))
    const baseState = iterate(configs, basePrev, config, n)
    let spare = invBudget - baseState.reduce((sum, s) => sum + s.necessaryTime, 0)
    type Cand = { slot: number; kind: 'ex' | 'ult'; frac: number; cost: number }
    const cands: Cand[] = []
    for (let i = 0; i < configs.length; i++) {
      const cfg = configs[i]
      // 结构性整数槽位（exSpecialCountFloor=true：琉音三段/诺姆弹幕/比利EX链等）不参与加回——
      // 其模块必要时间对次数是非线性的（整段结构），线性单价假设会突破时间预算
      const linearEx = !cfg.exSpecialCountFloor
      const fx = states[i].exSpecialCount - n.ex[i]
      const fu = states[i].ultimateCount - n.ult[i]
      if (linearEx && fx > 1e-9 && cfg.exSpecialActionTime > 0) cands.push({ slot: i, kind: 'ex', frac: fx, cost: cfg.exSpecialActionTime })
      if (fu > 1e-9 && cfg.ultimateActionTime > 0) cands.push({ slot: i, kind: 'ult', frac: fu, cost: cfg.ultimateActionTime })
    }
    cands.sort((a, b) => b.frac - a.frac)
    for (const cand of cands) {
      if (cand.cost <= spare) {
        n[cand.kind][cand.slot] += 1
        spare -= cand.cost
      }
    }
    const finalPrev = states.map((s, i) => ({ ...s, exSpecialCount: n.ex[i], ultimateCount: n.ult[i] }))
    states = iterate(configs, finalPrev, config, n)
    // 整数态重推抬升：整数装配的基础池 ≥ 均衡假设（小数时间税被归还）→ 重推实数次数可能更高；
    // 用重推结果再走一轮贪心，直到 n 稳定（≤3 轮）。无此环时邻槽次数被税压低（卢西娅C4 负提升案例）。
    for (let lift = 0; lift < 3; lift++) {
      const rederived = iterate(configs, states, config)
      const nextN = {
        ex: rederived.map(s => Math.floor(s.exSpecialCount + 1e-6)),
        ult: rederived.map(s => Math.floor(s.ultimateCount + 1e-6)),
      }
      if (nextN.ex.every((v, i) => v === n.ex[i]) && nextN.ult.every((v, i) => v === n.ult[i])) break
      // 以重推态为新基线重走贪心装包
      const prev2 = rederived.map((s, i) => ({ ...s, exSpecialCount: nextN.ex[i], ultimateCount: nextN.ult[i] }))
      const base2 = iterate(configs, prev2, config, nextN)
      let spare2 = invBudget - base2.reduce((sum, s) => sum + s.necessaryTime, 0)
      const cands2: Array<{ slot: number; kind: 'ex' | 'ult'; frac: number; cost: number }> = []
      for (let i = 0; i < configs.length; i++) {
        const cfg = configs[i]
        const linearEx = !cfg.exSpecialCountFloor
        const fx = rederived[i].exSpecialCount - nextN.ex[i]
        const fu = rederived[i].ultimateCount - nextN.ult[i]
        if (linearEx && fx > 1e-9 && cfg.exSpecialActionTime > 0) cands2.push({ slot: i, kind: 'ex', frac: fx, cost: cfg.exSpecialActionTime })
        if (fu > 1e-9 && cfg.ultimateActionTime > 0) cands2.push({ slot: i, kind: 'ult', frac: fu, cost: cfg.ultimateActionTime })
      }
      cands2.sort((a, b) => b.frac - a.frac)
      for (const cand of cands2) {
        if (cand.cost <= spare2) {
          nextN[cand.kind][cand.slot] += 1
          spare2 -= cand.cost
        }
      }
      const prev3 = rederived.map((s, i) => ({ ...s, exSpecialCount: nextN.ex[i], ultimateCount: nextN.ult[i] }))
      states = iterate(configs, prev3, config, nextN)
      n = nextN
    }
  }

  // 失衡次数由外部失衡池不动点收敛后传入（连携次数 = chainCountPerStun × stunCount，见 iterate）
  const inputStunCount = config.stunCount ?? 0

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

    const energySrc = calcEnergySource(cfg, state, configs, config.shieldCount, config.energyShieldCount, chainCountTotal, config.totalTime)
    // 队友联动回能：与 iterate 同一函数（calcCrossAgentEnergy），保证展示明细与次数推导同口径。
    // 曾只补回 supportUltimateRegen，其余 5 项在界面上不可见（见 CrossAgentEnergy 注释）。
    const crossAgent = calcCrossAgentEnergy(i, configs, states)
    energySrc.crossAgent = crossAgent
    energySrc.supportUltimateRegen = crossAgent.supportUltimateRegen
    energySrc.total += crossAgent.total

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
    const executions = buildExecutions(cfg, state, chainCountTotal, teammateFrontlineSeconds)
    // 显示口径统一：前台时间 = **前台**执行行 ΣtotalTime（后台行不占共享轴，如莱卡恩围猎蓄力；
    // 含合轴，机制改写行/倍率表行都在内），后台 = 总时间 - 前台。
    // 折叠循环已把前台行对其账本收敛，故 Σ前台行 ≈ 账本 ≤ 战斗时间。
    const execFrontlineTimeRaw = executions.reduce((sum, e) => sum + (isFrontlineExecution(e) ? (e.totalTime ?? 0) : 0), 0)
    // 时间预算守卫：迭代必要时间是线性估计，模块物化行（结构性整数槽位如琉音三段等）
    // 可能超出估计——Σ前台 > 战斗时间时（实测琉音 solo 181.67/180），优先从 count=0 的
    // 纯时间载流平A行扣减溢出（平A是弹性填充桶）；扣尽仍溢出再按比例收缩全部前台行。
    let overflow = execFrontlineTimeRaw - totalTime
    if (overflow > 1e-6) {
      for (const e of executions) {
        if (overflow <= 1e-6) break
        if (!isFrontlineExecution(e) || (e.count ?? 0) !== 0) continue
        const t = e.totalTime ?? 0
        if (t <= 0) continue
        const cut = Math.min(t, overflow)
        e.totalTime = t - cut
        overflow -= cut
      }
      const afterFiller = executions.reduce((sum, e) => sum + (isFrontlineExecution(e) ? (e.totalTime ?? 0) : 0), 0)
      if (afterFiller > totalTime + 1e-6) {
        const k = totalTime / afterFiller
        for (const e of executions) if (isFrontlineExecution(e)) e.totalTime = (e.totalTime ?? 0) * k
      }
    }
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

  return {
    totalTime,
    stunCount: inputStunCount,
    characters,
    iterations: iter,
    converged,
    convergence: {
      timeBudgetConverged,
      timeBudgetPasses,
      timeBudgetResidualSeconds,
      timeBudgetIdleSeconds,
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
 */
export function findExSpecial(agentSkills: {
  categories: { id: string; moves: { id: string; name: { en?: string }; energyCost?: Record<string, string>; rows: { id: string; values: number[] }[]; actionTime?: number | null; comboAlignRatio?: number }[] }[]
}): { moveId: string; energyConsume: number; actionTime: number; decibelRecovery: number; energyCostRaw?: Record<string, string>; comboAlignRatio: number } | null {
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

  // 从 energyCost 提取数值
  let energyConsume = 0
  const energyCostRaw = fallbackMove.energyCost
  if (energyCostRaw) {
    // 优先取 "Energy Cost" 键，其次取第一个能解析为数字的值
    const keys = Object.keys(energyCostRaw)
    // 优先匹配纯 "Energy Cost" 或 "Activation Energy Cost"（激活消耗）
    const priorityKeys = ['Energy Cost', 'Activation Energy Cost', 'Energy Cost to Use']
    for (const pk of priorityKeys) {
      if (energyCostRaw[pk]) {
        const num = parseFloat(energyCostRaw[pk])
        if (!isNaN(num)) { energyConsume = num; break }
      }
    }
    // 如果优先键没匹配到，取第一个能解析为数字的
    if (energyConsume === 0) {
      for (const k of keys) {
        const num = parseFloat(energyCostRaw[k])
        if (!isNaN(num) && num > 0) { energyConsume = num; break }
      }
    }
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
    energyConsume,
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

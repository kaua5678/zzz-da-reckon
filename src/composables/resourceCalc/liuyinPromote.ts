/**
 * 琉音「好评转大」编排簇（从 useResourceCalc 抽离，纯函数化）。
 *
 * 因果链：抱拳（客诉）命中 → 好评≥90 打开大招选择窗口 → 60 转大（有连携窗口：替换目标队友连携）
 * 或 90 转大（无窗口：白送终结技）。转大终结技 daze 进失衡池 → 失衡次数变 → 60 抱拳默认按
 * 失衡次数 → 转大次数变（正反馈）；好评≥90 开窗次数（floor(好评/90)）是硬上限，正反馈单调
 * 有界必收敛（MAX_PROMOTE_ITER 轮兜底）。倍率表全走目标队友执行计划自然调用。
 */
import { calcStunPool } from '@/core/stunPool'
import { effectiveBattleTime, stunWindowDuration, stunWindowFraction } from '@/core/effectiveTime'
import type { StunSkillExecution } from '@/core/stunPool'
import { findUltimate, findChainAttack } from '@/core/resource'
import { computeLiuyinHugCounts, resolveUltimateTargetSlot } from '@/mechanics/agents/liuyin'
import type { TeamResourceResult, StunPoolResult } from '@/types/resource'
import type { PanelValues } from '@/types/catalog'
import type { useConfigStore } from '@/stores/config'
import type { useCatalogStore } from '@/stores/catalog'
import { findMoveById } from './helpers'

/** 琉音好评转大不动点迭代上限（好评≥90 开窗次数有界，正反馈单调收敛，8 轮兜底极端情况） */
export const MAX_PROMOTE_ITER = 8

/** 琉音好评转大参数（从某轮资源池结果构建：目标队友、连携/终结技 moveId、好评总量、客诉抱拳数） */
export interface LiuyinPromoteParams {
  goodReviewTotal: number
  hug60Setting: number
  targetSlot: number
  chainMoveId: string
  ultimateMoveId: string
  chainCountPerStun: number
  ultDaze: number
  ultElement: string
}

export interface PromoteFixpointResult {
  pool: StunPoolResult | null
  hug60: number
  promote: number
  targetSlot: number
  chainMoveId: string
  ultimateMoveId: string
}

export interface PromoteFixpointDeps {
  configStore: ReturnType<typeof useConfigStore>
  panels: PanelValues[]
}

/**
 * 叠加琉音好评转大修正的资源池结果：
 * 60 转大 → 目标队友连携 -1、终结技 +1（替换）；90 转大 → 终结技 +1（白送）。
 * 倍率表 damage/daze/anomaly_buildup 由目标队友执行计划自然调用。
 * adj 来自 promoteFixpoint 的收敛结果（runCalcRound 的 R0/R1 内层不动点）。
 */
export function applyLiuyinPromote(
  base: TeamResourceResult | null,
  adj: { promote: number; hug60: number; targetSlot: number; chainMoveId: string; ultimateMoveId: string } | null,
  catalogStore: ReturnType<typeof useCatalogStore>,
): TeamResourceResult | null {
  if (!base || !adj || adj.promote <= 0 || adj.targetSlot < 0) return base
  const { targetSlot, ultimateMoveId, promote } = adj
  return {
    ...base,
    characters: base.characters.map(char => {
      if (char.slot !== targetSlot) return char
      const skills = catalogStore.getAgentSkills(char.agentId)
      const ultMoveDef = findMoveById(skills, ultimateMoveId)
      const ultMult = ultMoveDef?.rows.find(r => r.id === 'damage')?.values[0] ?? 0
      const ultBuildUp = ultMoveDef?.rows.find(r => r.id === 'anomaly_buildup')?.values[0] ?? 0
      const ultActionTime = ultMoveDef?.actionTime ?? 0
      // 转大的终结技是真实动作（目标队友打一次终结技），必须占用前台时间——曾写死 0
      // 导致时间表/资源利用率页看不到转大耗时（用户 2026-09 般琉卢排查）。
      // 时间从目标的平A池挤出（basicAttackTime 扣减），总前台占用守恒，
      // 不额外撑破战斗预算（否则会误触轴退化判定，般岳等轴测试依赖该守恒）。
      const promoteTime = ultActionTime * promote
      // 2026-09-06：非轴模式下赠链时间已由引擎预留（iterate 必要时间计入 promote × 目标终结技时长、
      // 平A池随之收缩——守恒在引擎侧成立，见 TeamResourceResult.liuyinGiftTimeReserved）。
      // 旧 post-hoc carve 只抠 basic_attack 聚合行，目标平A时间住在分段行里时（希格莉德枪尖/
      // 般岳焚身/琉音猜拳）聚合行被抠剩 ~0 → 守恒破、净占用 +7.2s（实测 auto-1591-1481-1311）。
      // 轴模式无预留（轴内 60/90 转大次数由轴预设决定），保留旧 carve 路径。
      const reserved = (base as { liuyinGiftTimeReserved?: number }).liuyinGiftTimeReserved ?? 0
      const basicIdx = reserved > 0 ? -1 : char.executions.findIndex(e => e.moveId === 'basic_attack')
      const basicTime = basicIdx >= 0 ? (char.executions[basicIdx].totalTime ?? 0) : 0
      const carve = reserved > 0 ? 0 : Math.max(0, Math.min(basicTime, promoteTime))
      // 轴即最终次数：连携次数已从轴直接读出（N），60/90 转大只叠加赠送大招，不再「连携-1 大招+1」改写。
      // 转大白送的终结技独立成行（source='gift'），不并入目标原始终结技行——否则赠送归因（击破手对比的 gift 列）会丢失。
      return {
        ...char,
        ultimateCount: (char.ultimateCount ?? 0) + promote,
        executions: [
          ...char.executions.map((e, i) => i === basicIdx
            ? { ...e, totalTime: Math.max(0, (e.totalTime ?? 0) - carve) }
            : e),
          {
            moveId: ultimateMoveId,
            moveName: '好评转大·队友终结技',
            category: 'chain',
            count: promote,
            actionTime: ultActionTime,
            source: 'gift',
            comboAlignRatio: 0,
            totalTime: promoteTime,
            totalComboAlignTime: 0,
            energyConsume: 0,
            totalEnergyConsume: 0,
            decibelRecovery: 0,
            totalDecibelRecovery: 0,
            energyRecovery: 0,
            totalEnergyRecovery: 0,
            damageMultiplier: ultMult,
            damageMultiplierOverride: ultMult > 0,
            anomalyBuildUp: ultBuildUp,
            totalAnomalyBuildUp: ultBuildUp * promote,
            skillTableNote: '好评转大：赠送队友终结技（白送，不耗喧响/能量）',
            skillDamageTarget: 'ultimate',
          },
        ],
      }
    }),
  }
}

/** 从某轮资源池结果构建转大参数；队伍无琉音（1481）时返回 null */
export function buildPromoteParams(
  configStore: ReturnType<typeof useConfigStore>,
  catalogStore: ReturnType<typeof useCatalogStore>,
  rr: TeamResourceResult,
): LiuyinPromoteParams | null {
  const liuyinIdx = configStore.team.findIndex(char => {
    const a = char.agentId ? catalogStore.getAgent(char.agentId) : null
    return a?.id === '1481' || a?.teammateBuffId === '1481'
  })
  if (liuyinIdx < 0) return null
  const liuyinSrc = rr.characters.find(c => c.slot === liuyinIdx)?.liuyinMechanicSource
  if (!liuyinSrc) return null
  const hug60Setting = configStore.getMechanicSetting('liuyin.hug60Count', -1)
  const targetSetting = configStore.getMechanicSetting('liuyin.ultimateTargetSlot', -1)
  const targetSlot = resolveUltimateTargetSlot(liuyinIdx, configStore.team.length, targetSetting)
  const targetAgentId = configStore.team[targetSlot]?.agentId ?? ''
  const targetChar = rr.characters.find(c => c.slot === targetSlot)
  const targetSkills = targetAgentId ? catalogStore.getAgentSkills(targetAgentId) : undefined
  const ult = targetSkills ? findUltimate(targetSkills) : null
  const ultMove = ult?.moveId ? findMoveById(targetSkills, ult.moveId) : null
  const ultDaze = ultMove?.rows.find(r => r.id === 'daze')?.values[0] ?? 0
  const chain = targetSkills ? findChainAttack(targetSkills) : null
  const ultElement = (targetAgentId && catalogStore.getAgent(targetAgentId)?.damageElement) || 'physical'
  return {
    goodReviewTotal: liuyinSrc.goodReviewTotal,
    hug60Setting,
    targetSlot,
    chainMoveId: chain?.moveId ?? '',
    ultimateMoveId: ult?.moveId ?? '',
    chainCountPerStun: targetChar?.chainCountPerStun ?? 0,
    ultDaze,
    ultElement,
  }
}

/**
 * 转大不动点：抱拳命中→检查好评≥90 打开大招选择窗口→60 转大（有连携窗口：目标队友连携 -1、终结技 +1）
 * 或 90 转大（无连携窗口：终结技 +1）。倍率表全走目标队友执行计划自然调用。
 * 正反馈：转大终结技 daze 进失衡池 → 失衡次数变 → 60 抱拳默认按失衡次数 → 转大次数变；
 * 好评≥90 开窗次数（floor(好评/90)）是硬上限，正反馈单调有界必收敛（MAX_PROMOTE_ITER 轮兜底）。
 */
function adjustStunExecs(
  execs: StunSkillExecution[],
  p: LiuyinPromoteParams,
  hug60: number,
  promote: number,
  subtractChain = true,
): StunSkillExecution[] {
  if (hug60 <= 0 && promote <= 0) return execs
  const out: StunSkillExecution[] = []
  let ultPushed = false
  for (const e of execs) {
    if (e.slot === p.targetSlot && e.moveId === p.ultimateMoveId) {
      if (promote > 0) { out.push({ ...e, count: e.count + promote }); ultPushed = true }
      else out.push(e)
    } else if (e.slot === p.targetSlot && e.moveId === p.chainMoveId) {
      // 无轴兜底：60转大消耗连携窗口 → 连携 daze 减 hug60；有轴：连携与60转大独立列出，不互相改写
      if (subtractChain && hug60 > 0) out.push({ ...e, count: Math.max(0, e.count - hug60) })
      else out.push(e)
    } else out.push(e)
  }
  if (promote > 0 && !ultPushed && p.ultDaze > 0) {
    out.push({
      moveId: p.ultimateMoveId,
      moveName: '好评转大·队友终结技',
      slot: p.targetSlot,
      count: promote,
      baseDaze: p.ultDaze,
      element: p.ultElement,
      skillType: 'ultimate',
    })
  }
  return out
}

/** 转大不动点：给定基础失衡 execs 与畏缩覆盖率，迭代（失衡次数 ↔ 好评转大次数）至收敛 */
export function promoteFixpoint(
  baseExecs: StunSkillExecution[],
  flinchRate: number,
  p: LiuyinPromoteParams | null,
  axisHug: { hug60: number; hug90: number } | null,
  axisMode: boolean,
  deps: PromoteFixpointDeps,
  inAxisFractionProvider?: (stunCount: number, execs: StunSkillExecution[]) => Record<string, number>,
  refundStunRatio = 0,
): PromoteFixpointResult {
  const { configStore, panels } = deps
  const chainCountPerStun = configStore.team.reduce((sum, c) => sum + (c.chainCountPerStun ?? 0), 0)
  // 时间守恒（用户口径 2026-09-01）：窗口内的招式吃易伤但不攒条。
  // 轴模式已有逐招 inAxisFraction 精确扣除；**非轴模式**这里按「上一轮次数推出的窗口占比」折算，
  // 于是本不动点自带负反馈：次数↑ → 占比↑ → 有效攒条↓ → 次数↓，自己收敛到实战档位。
  const effTime = effectiveBattleTime(configStore.enemy)
  const windowDur = stunWindowDuration(
    configStore.enemy.stunTime,
    panels.reduce((sum, p) => sum + (p.stunDurationBonusSeconds ?? 0), 0),
  )
  const runPool = (execs: StunSkillExecution[], inAxisFraction?: Record<string, number>, prevStunCount = 0) => calcStunPool({
    executions: execs, panels, bossStunValue: configStore.enemy.stunValue,
    chainCountPerStun, enemyStunResistances: configStore.enemy.stunResistances ?? configStore.enemy.resistances ?? {},
    physicalFlinchCoverageRate: flinchRate,
    inAxisStunFractionByKey: inAxisFraction,
    refundStunRatio,
    stunGift: configStore.enemy.bossStunGift ?? 0,
    windowTimeFraction: axisMode ? 0 : stunWindowFraction(prevStunCount, windowDur, effTime),
  })

  let stunCount = 0
  let hug60 = 0
  let promote = 0
  let pool: StunPoolResult | null = null
  const seenStunCounts = new Set<number>()
  for (let k = 0; k < MAX_PROMOTE_ITER; k++) {
    // 有轴时：60/90 转大次数直接读轴（轴即最终次数，无连携↔大招改写），否则按好评/连携窗口推导
    let hug90 = 0
    if (p && axisMode) {
      hug60 = axisHug?.hug60 ?? 0
      hug90 = axisHug?.hug90 ?? 0
    } else if (p) {
      const chainExecCount = baseExecs.find(e => e.slot === p.targetSlot && e.moveId === p.chainMoveId)?.count ?? 0
      const targetChainTotal = Math.min(p.chainCountPerStun * stunCount, chainExecCount)
      const hug = computeLiuyinHugCounts(p.goodReviewTotal, stunCount, p.hug60Setting, targetChainTotal)
      hug60 = hug.hug60
      hug90 = hug.hug90
    }
    promote = hug60 + hug90
    const execs = p && promote > 0 ? adjustStunExecs(baseExecs, p, hug60, promote, !axisMode) : baseExecs
    const inAxisFraction = inAxisFractionProvider ? inAxisFractionProvider(stunCount, execs) : undefined
    // 传上一轮的 stunCount 折算窗口占比（首轮 0 = 与旧行为一致，之后逐轮收敛）
    pool = runPool(execs, inAxisFraction, stunCount)
    const next = pool?.stunCount ?? 0
    if (next === stunCount) break
    // 离散 floor 可能产生 2-循环（如 5→4→5），检测到重复即停，保留最后计算结果
    if (seenStunCounts.has(next)) break
    seenStunCounts.add(stunCount)
    stunCount = next
  }
  return {
    pool,
    hug60,
    promote,
    targetSlot: p?.targetSlot ?? -1,
    chainMoveId: p?.chainMoveId ?? '',
    ultimateMoveId: p?.ultimateMoveId ?? '',
  }
}

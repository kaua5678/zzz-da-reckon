/**
 * 伤害池行构建（从 useResourceCalc 抽离的纯函数；快照式入参，无 store/computed 依赖）。
 *
 * 职责：按角色/事件把执行计划拆成 直伤/异放/乱流/紊乱/灼烧感电侵蚀强击碎冰 等展示行——
 *  · 直伤行：resolveExecutionDamage 元素覆盖 → 轴内/轴外易伤拆分（捏轴认领、CD 自动行占比、
 *    诺姆赠送连携、希希芙毒素爆发、雨果/叶瞬光特判、技能表直读兜底）；
 *  · 异放/极性紊乱：Boss 异常状态轴归因（逐窗状态链取样）+ 失衡内占比拆段；
 *  · 异常 DoT：虚拟面板 + 按触发者分摊结算；角色专属直伤块（柏妮思余烬/琉音强特拆分/
 *    般岳影画6附伤等）也在本文件。
 *
 * 依赖注入：全部输入经 DamagePoolContext 快照传入（computed 在 useResourceCalc 侧解包），
 * computeWindowDuration 为例外（需要 configStore 实时窗口时长，函数注入保持单一职责）。
 */
import { calcDirectDamage, calcAnomalyDamage, resolveSpecialDamageProfile } from '@/core/damage'
import { attributeCountByStateChain } from '@/core/stunAxis/inStunAnomaly'
import { allocateAxisWindows } from '@/core/stunAxisStack'
import { ANOMALY_SINGLE_HIT_MULTIPLIER, getBaseElement, getMainApplierSlot, distributeIntegerByWeight, calcStunMultiplier } from '@/core/anomalyPool/helpers'
import { getAgentMechanic } from '@/mechanics'
import { LIUYIN_EX_MOVE_IDS, CINEMA6_ECHO_MAX, CINEMA6_ECHO_RATIO } from '@/mechanics/agents/liuyin'
import { YESHUGUANG_FULL_STUN_MOVES, veilStunMultiplier } from '@/mechanics/agents/yeshuguang'
import { HUGO_FULL_STUN_MOVES } from '@/mechanics/agents/hugo'
import { C6_ATTACH_RATIO, MINGWANG_BASE_PER_STACK } from '@/mechanics/agents/banyue'
import { CORIN_ADDITIONAL_DMG } from '@/mechanics/agents/corin'
import { SIGRID_INFECTION_DMG } from '@/mechanics/agents/sigrid'
import { PEILUO_KAGEROU_CRIT } from '@/mechanics/agents/specPanelBuffs'
import type { TeamResourceResult, StunPoolResult, AnomalyPoolResult, InStunAnomalySummary } from '@/types/resource'
import type { BossAnomalyStateResult } from '@/core/stunAxis/inStunAnomaly'
import type { StunAxis } from '@/types/resource'
import type { PanelValues } from '@/types/catalog'
import type { AnomalyEventExecution } from '@/types/resource'
import { getSkillLevelCoef } from '@/core/skillLevel'
import { fmt } from '@/utils/format'
import {
  parseReleaseMultiplier,
  safeElement,
  elementLabel,
  buildMechanicTeamMembers,
  getTeamAnomalyDurationBonus,
  getWindInfectionElement,
  buildAnomalyVirtualPanel,
  buildAnomalySettlementEntries,
  getRemielleLevelValue,
  remielleSpecialVoidflareCount,
  calcVoidflareDamage,
  findMoveById,
  type DamagePoolRow,
} from './helpers'

/** 伤害池构建入参：useResourceCalc 侧各 computed 的解包快照 */
export interface DamagePoolContext {
  configStore: ReturnType<typeof import('@/stores/config').useConfigStore>
  catalogStore: ReturnType<typeof import('@/stores/catalog').useCatalogStore>
  /** 转大修正后的资源池结果 */
  adjustedResourceResult: TeamResourceResult | null
  /** 结算面板（含霜寒/风化侵染盖章） */
  damagePanels: PanelValues[]
  /** 失衡易伤覆盖率（收敛值） */
  stunCoverage: number
  /** 轴内单位分配（栈遍历反推） */
  axisAllocation: Record<string, { slot: number; inAxisUnits: number }>
  /** 伴随事件易伤（child moveId → 0/1） */
  attachedInAxisMap: Record<string, number>
  anomalyPoolResult: AnomalyPoolResult | null
  inStunAnomalyState: InStunAnomalySummary | null
  bossAnomalyState: BossAnomalyStateResult | null
  stunPoolResult: StunPoolResult | null
  effectiveStunAxes: StunAxis[]
  /** 蕾米进场记录面板（特殊虚耀用） */
  remielleEntryPanels: PanelValues[]
  /** 蕾米异化系数倍率（1 + (异化度+提升)/100） */
  remielleAnomalyMultiplier: number
  /** 琉音转大收敛次数（余音直伤用） */
  liuyinPromoteCount: number
  agentNames: Record<string, string>
  autoActive: boolean
  stunAxisResult: unknown
  /** 般岳明王轴覆盖（moveId → 层数） */
  banyueMingwangStacks: Map<string, number>
  yixuanNingshenMap: Map<string, { critDmg: number; sheerDmg: number }>
  peiluoKagerouMap: Map<string, number>
  corinStunBonusMap: Map<string, number>
  /** 当前窗口时长（秒）：函数注入（读 configStore 失衡延时等实时口径） */
  computeWindowDuration: () => number
}

export function buildDamagePoolRows(ctx: DamagePoolContext): DamagePoolRow[] {

    const {
    configStore, catalogStore,
    adjustedResourceResult, damagePanels, stunCoverage, axisAllocation: allocMap, attachedInAxisMap: attachedInAxis,
    anomalyPoolResult, inStunAnomalyState, bossAnomalyState, stunPoolResult, effectiveStunAxes,
    remielleEntryPanels, remielleAnomalyMultiplier, liuyinPromoteCount, agentNames, autoActive,
    stunAxisResult, banyueMingwangStacks, yixuanNingshenMap, peiluoKagerouMap, corinStunBonusMap,
    computeWindowDuration,
  } = ctx
  if (!adjustedResourceResult || damagePanels.length === 0) return []
    const rows: DamagePoolRow[] = []
    const enemyDamageRes = configStore.enemy.damageResistances ?? configStore.enemy.resistances ?? {}
    const isAxis = (configStore.useStunAxis || autoActive) && stunAxisResult
    // 轴内涉及的槽位（有轴内动作的槽位）；其余槽位（如换了辅助、没进轴）走全局覆盖率「单独算」
    const axisSlots = new Set<number>()
    for (const a of Object.values(allocMap)) axisSlots.add(a.slot)
    // 记录已认领的轴内单位数，避免同 moveId 多行（如诺姆膛温换连携）重复认领
    const claimedInAxis: Record<string, number> = {}

    function agentName(agentId: string, slot: number) {
      return agentNames[agentId] || catalogStore.getAgent(agentId)?.name?.zhCN || `槽${slot + 1}`
    }
    const infectionElement = getWindInfectionElement(configStore, catalogStore)
    const windSlot = configStore.team.findIndex(c => {
      const agent = c.agentId ? catalogStore.getAgent(c.agentId) : null
      return agent?.damageElement === 'wind'
    })

    /** 把一个 (slot, moveId) 的总单位数切成轴内/轴外两段（轴外段无易伤） */
    function axisSplitFor(slot: number, moveId: string, totalUnits: number): { inUnits: number; outUnits: number } {
      if (!isAxis) return { inUnits: 0, outUnits: totalUnits }
      const key = `${slot}:${moveId === 'basic_attack' ? 'basic' : moveId}`
      const alloc = allocMap[key]
      if (!alloc || alloc.inAxisUnits <= 0) return { inUnits: 0, outUnits: totalUnits }
      const already = claimedInAxis[key] ?? 0
      const remainingIn = Math.max(0, alloc.inAxisUnits - already)
      const inUnits = Math.min(remainingIn, totalUnits)
      claimedInAxis[key] = already + inUnits
      return { inUnits, outUnits: totalUnits - inUnits }
    }

    /** 伴随事件易伤：非轴模式用全局覆盖率；轴模式跟随父动作是否完全落在窗口内（0/1） */
    function axisStunFor(moveId: string): number {
      if (!isAxis) return stunCoverage
      return attachedInAxis[moveId] ?? 0
    }

    function pushDirect(row: {
      id: string; slot: number; agentId: string; name: string; element: string; source: string; count: number; multiplier: number; note?: string; skillDamageTarget?: any; moveId?: string; critRateBonus?: number; critDmgBonus?: number; dmgBonus?: number; sheerDmgBonus?: number; flatDamageBonus?: number; resIgnore?: number; basisValueOverride?: number; basisLabelOverride?: string; stunOverride?: number; defIgnore?: number; penRatioBonus?: number; sourceTag?: 'gift' | 'stun' | 'self'
    }) {
      if (row.count <= 0 || row.multiplier <= 0) return
      const basePanel = damagePanels[row.slot]
      if (!basePanel) return
      // 行级穿透率（如希格莉德影画2 出枪式/敛枪式 +24%）：浅克隆面板叠加 penRatio，其余字段不变
      const panel = row.penRatioBonus
        ? { ...basePanel, penRatio: (basePanel.penRatio ?? 0) + row.penRatioBonus }
        : basePanel
      const stunForThis = row.stunOverride !== undefined
        ? row.stunOverride
        : stunCoverage
      // 叶瞬光帷幕易伤（口径见 yeshuguang.ts#veilStunMultiplier）：吃满「boss 基础失衡易伤 +
      // 全部失衡易伤加成」再按影画封顶。calcDirectDamage 内部还会加一次 bonus/100，
      // 所以这里把 bonus 反向扣掉，使最终落到 veilStunMultiplier 的值上。
      let stunBase = configStore.enemy.stunVuln
      if (row.agentId === '1431' && (panel as any).yeshuguangStunCapMult && stunForThis > 0) {
        const cap = Number((panel as any).yeshuguangStunCapMult) || 2.1
        const rawBonus = (panel.stunDmgMultiplierBonus ?? 0) + (panel.stunDmgMultiplierBonusAlways ?? 0)
        const capAlways = panel.stunDmgMultiplierBonusCapAlways ?? 0
        const bonusPct = capAlways > 0 ? Math.min(rawBonus, capAlways) : rawBonus
        stunBase = veilStunMultiplier(configStore.enemy.stunVuln, bonusPct, cap) - bonusPct / 100
      }
      const stunMultVal = stunForThis > 0
        ? 1 + (stunBase - 1) * stunForThis
        : 1
      const rowAgent = catalogStore.getAgent(row.agentId)
      const result = calcDirectDamage({
        panel,
        skillMultiplier: row.multiplier,
        damageElement: safeElement(row.element),
        damageBasis: 'atk',
        enemyDefense: configStore.enemy.defense,
        enemyDefReduction: row.defIgnore ?? 0,
        enemyDefFlatReduction: 0,
        enemyLevel: configStore.enemy.level,
        enemyResistance: enemyDamageRes[row.element] ?? 0,
        enemyResReduction: (panel.enemyResReduction ?? 0) + (row.resIgnore ?? 0),
        stunMultiplier: stunBase,
        stunned: stunForThis,
        critMode: 'expect',
        count: row.count,
        skillDamageTarget: row.skillDamageTarget,
        critRateBonus: row.critRateBonus,
        critDmgBonus: row.critDmgBonus,
        dmgBonus: row.dmgBonus,
        sheerDmgBonus: row.sheerDmgBonus,
        flatDamageBonus: row.flatDamageBonus,
        infectionElement,
        basisValueOverride: row.basisValueOverride,
        basisLabelOverride: row.basisLabelOverride,
        specialDamageProfile: rowAgent ? resolveSpecialDamageProfile(rowAgent) : undefined,
      })
      rows.push({
        id: row.id,
        slot: row.slot,
        agentId: row.agentId,
        agentName: agentName(row.agentId, row.slot),
        type: '直伤',
        name: row.name,
        element: row.element,
        source: row.source,
        count: row.count,
        perDamage: row.count > 0 ? result.damage / row.count : 0,
        totalDamage: result.damage,
        note: row.note ?? '',
        stunMult: stunMultVal,
        moveId: row.moveId,
        sourceTag: row.sourceTag,
        multiplier: row.multiplier,
      })
    }

    function pushRelease(row: { id: string; slot: number; agentId: string; name: string; count: number; multiplier: number; source: string; note?: string; element?: string; panel?: PanelValues; settlementPanel?: PanelValues; releaseCrit?: AnomalyEventExecution['releaseCrit']; stunnedOverride?: number }) {
      if (row.count <= 0 || row.multiplier <= 0) return
      const basePanel = row.panel ?? damagePanels[row.slot]
      const settlementPanel = row.settlementPanel ?? basePanel
      if (!basePanel) return
      const element = row.element ?? 'wind'
      const releaseMod = getAgentMechanic(row.agentId)?.releaseModifier?.({ panels: damagePanels })
        ?? { enemyResReduction: 0, note: '' }
      // 异放专属暴击（如爱芮影画1）：掌控超过阈值后每点额外加暴击率
      const critOverride = row.releaseCrit
        ? {
            rate: row.releaseCrit.ratePct
              + Math.max(0, (settlementPanel?.anomalyMastery ?? 0) - (row.releaseCrit.masteryThreshold ?? 0))
                * (row.releaseCrit.masteryPerPointRatePct ?? 0),
            dmg: row.releaseCrit.dmgPct,
            labelPrefix: '异放暴击',
          }
        : undefined
      const result = calcAnomalyDamage({
        panel: basePanel,
        settlementPanel,
        baseMultiplier: row.multiplier,
        element: element as any,
        enemyDefense: configStore.enemy.defense,
        enemyDefReduction: releaseMod.enemyDefReduction ?? 0,
        enemyDefFlatReduction: 0,
        enemyLevel: configStore.enemy.level,
        enemyResistance: enemyDamageRes[element] ?? 0,
        enemyResReduction: (settlementPanel?.enemyResReduction ?? 0) + releaseMod.enemyResReduction,
        stunned: row.stunnedOverride ?? stunCoverage,
        stunMultiplier: configStore.enemy.stunVuln,
        critMode: 'expect',
        damageKind: 'release',
        anomalyMultiplier: remielleAnomalyMultiplier,
        anomalyCritOverride: critOverride,
      })
      rows.push({
        id: row.id,
        slot: row.slot,
        agentId: row.agentId,
        agentName: agentName(row.agentId, row.slot),
        type: '异放',
        name: row.name,
        element,
        source: row.source,
        count: row.count,
        perDamage: result.damage,
        totalDamage: result.damage * row.count,
        note: `${row.note ?? ''}${releaseMod.note}`,
        multiplier: row.multiplier,
      })
    }

    /** 解析异放倍率：固定 releaseMultiplier（Type A）或「原异常单次倍率 × 比例」（Type B） */
    function releaseMultiplierFor(event: AnomalyEventExecution, element: string, triggerPanel: PanelValues, stunCov: number): number {
      if (event.releaseRatio) {
        const rr = event.releaseRatio
        const perTenPct = rr.perTenByElement[element] ?? 0
        const stunMult = (rr.stunBonusPct ?? 0) > 0 ? 1 + ((rr.stunBonusPct ?? 0) / 100) * stunCov : 1
        // 「相对于原属性异常伤害的比例」句式（南宫羽颤音异放）：倍率 = 原异常单次倍率 × 元素比例%
        if (rr.basis === 'anomalyDamageRatio') return (ANOMALY_SINGLE_HIT_MULTIPLIER[element] ?? 0) * (perTenPct / 100) * stunMult
        const basisValue = Number(triggerPanel[rr.basis] ?? 0)
        return (ANOMALY_SINGLE_HIT_MULTIPLIER[element] ?? 0) * (basisValue / 10) * (perTenPct / 100) * stunMult
      }
      return parseReleaseMultiplier(event)
    }

    // 失衡内异常系统 v2：轴模式下 dominant 归因候选 = 时间线实际活跃元素（窗均覆盖为权重，
    // 有触发但覆盖极小的元素给最小权重保底）；空数组 = 无时间线可用，回落全局覆盖率近似
    const inStunAttributionCandidates = (): Array<{ element: string; autoRatio: number }> =>
      (inStunAnomalyState?.elements ?? [])
        .filter(e => e.avgCoverage > 0 || e.triggerCount > 0)
        .map(e => ({ element: e.element, autoRatio: e.avgCoverage > 0 ? e.avgCoverage : 0.01 }))

    /**
     * 事件计数器（用户口径 2026-08-24「异放次数源」）：元素失衡内触发占比 =
     * 时间线轴内触发数 / 全局池触发数（基础元素归并）。池无该元素数据 → 0（全部视为轴外）。
     * 非轴场景不建逐事件状态机——轴外 = 总量 − 失衡内（用户裁决，平凡减法）。
     */
    const inWindowFraction = (element: string): number => {
      const base = getBaseElement(element)
      let total = 0
      for (const p of anomalyPoolResult?.perElement ?? []) {
        if (getBaseElement(p.element) === base) total += p.triggerCount ?? 0
      }
      if (total <= 0) return 0
      const inside = inStunAnomalyState?.elements.find(e => e.element === base)?.triggerCount ?? 0
      return Math.max(0, Math.min(1, inside / total))
    }

    /**
     * 轴内非风异常触发占比（维琳娜风异放）：乱流 = 风化窗口内非风异常触发，
     * 风异放随乱流触发 → 轴内占比 = 轴内非风触发 / 全局非风触发（风化覆盖率约掉）。
     * 非轴回落全局覆盖率（现状口径）。
     */
    const nonWindInAxisFraction = (): number => {
      if (!isAxis) return stunCoverage
      const inNonWind = (inStunAnomalyState?.elements ?? [])
        .filter(e => getBaseElement(e.element) !== 'wind')
        .reduce((s, e) => s + (e.triggerCount ?? 0), 0)
      let globalNonWind = 0
      for (const p of anomalyPoolResult?.perElement ?? []) {
        if (getBaseElement(p.element) !== 'wind') globalNonWind += p.triggerCount ?? 0
      }
      if (globalNonWind <= 0) return 0
      return Math.max(0, Math.min(1, inNonWind / globalNonWind))
    }

    /**
     * 终极技轴内占比（琉音6命余音/爱丽丝6命附伤等「终结技驱动附伤」）：指定槽位时只算该槽
     * （爱丽丝状态进入=自身 SW3+终结），缺省全队（琉音转大=队友终结技入场）。非轴回落全局覆盖率。
     */
    const ultimateInAxisFraction = (slot?: number): number => {
      if (!isAxis) return stunCoverage
      let inAxis = 0
      let total = 0
      for (const ch of adjustedResourceResult?.characters ?? []) {
        if (slot !== undefined && ch.slot !== slot) continue
        for (const e of ch.executions ?? []) {
          if (e.category !== 'chain' || !/终结技|ultimate/i.test(e.moveName ?? '')) continue
          total += e.count ?? 0
          inAxis += allocMap[`${ch.slot}:${e.moveId}`]?.inAxisUnits ?? 0
        }
      }
      return total > 0 ? Math.max(0, Math.min(1, inAxis / total)) : stunCoverage
    }

    /**
     * 异放失衡易伤拆分：inStunBound 事件全额记失衡内；其余按事件计数器占比拆
     * 「失衡内(stunned=1 全额易伤)/轴外(stunned=0 无易伤)」两段。非轴模式返回单段旧口径。
     */
    const releaseStunSegments = (
      event: AnomalyEventExecution,
      element: string,
      count: number,
      carrierInAxisFraction?: number,
    ): Array<{ count: number; stunned: number; suffix: string; tag: string }> => {
      if (!isAxis || count <= 0) return [{ count, stunned: -1, suffix: '', tag: '' }]
      if (event.inStunBound) return [{ count, stunned: 1, suffix: '-in', tag: '失衡内·全额失衡易伤' }]
      // 跟随载体招式（前台招式绑定，玩家捏轴可精确控制）：失衡内占比 = 载体块轴内单位 / 载体总数
      const frac = event.followCarrierInStun && carrierInAxisFraction !== undefined
        ? Math.max(0, Math.min(1, carrierInAxisFraction))
        : inWindowFraction(element)
      const countIn = Math.min(count, Math.round(count * frac))
      const segs: Array<{ count: number; stunned: number; suffix: string; tag: string }> = []
      if (countIn > 0) segs.push({ count: countIn, stunned: 1, suffix: '-in', tag: '失衡内·全额失衡易伤' })
      if (count - countIn > 0) segs.push({ count: count - countIn, stunned: 0, suffix: '-out', tag: '轴外·无易伤' })
      return segs
    }

    const seenDirectIds = new Map<string, number>()

    /** 希希芙蚀骨轴内占比：失衡内回复的毒素占总毒素比例（蛇吻手动消耗 → 失衡内爆发，用户口径 2026-08）。
     *  毒牙/终结/连携按轴内单位数折算；C2（连携/终结失衡命中）视为全轴内；平A吐信按非平A轴内占比近似。 */
    const xixifuToxinInAxisFraction = (slot: number, cr: any): number => {
      const toxin = cr.specResources?.['xixifu_toxin']
      const total = Math.max(0, (toxin?.initialValue ?? 0) + (toxin?.totalGain ?? 0))
      if (total <= 0) return 0
      const g = (toxin?.gains ?? {}) as Record<string, number>
      const totalEx = Math.max(1, cr.exSpecialCount ?? 0)
      const totalUlt = Math.max(1, cr.ultimateCount ?? 0)
      const totalChain = Math.max(1, cr.chainCountTotal ?? 0)
      const inEx = (allocMap[`${slot}:1521008`]?.inAxisUnits ?? 0) + (allocMap[`${slot}:1521009`]?.inAxisUnits ?? 0)
      const inUlt = allocMap[`${slot}:1521013`]?.inAxisUnits ?? 0
      const inChain = allocMap[`${slot}:1521012`]?.inAxisUnits ?? 0
      const duya = (g.toxin_duya_base ?? 0) + (g.toxin_duya_hold ?? 0)
      const ult = g.toxin_ultimate ?? 0
      const chain = g.toxin_chain ?? 0
      const c2 = g.toxin_c2_stunned_chain_ultimate ?? 0
      const basic = (g.toxin_tuxin_stage4 ?? 0) + (g.toxin_tuxin_stunned_bonus ?? 0)
      const nonBasicTotal = duya + ult + chain + c2
      const nonBasicIn = duya * (inEx / totalEx) + ult * (inUlt / totalUlt) + chain * (inChain / totalChain) + c2
      const basicIn = basic * (nonBasicTotal > 0 ? nonBasicIn / nonBasicTotal : 0)
      return Math.max(0, Math.min(1, (nonBasicIn + basicIn) / total))
    }

    for (const charResult of adjustedResourceResult.characters) {
      const slot = charResult.slot
      const agent = catalogStore.getAgent(charResult.agentId)
      const skills = catalogStore.getAgentSkills(charResult.agentId)

      for (const exec of charResult.executions) {
        if ((exec.damageMultiplier ?? 0) <= 0) continue
        // 秒均行（普通平A basic_attack 等）：count=0、totalTime=秒数、damageMultiplier=秒均倍率%。
        // 伤害 = 秒均倍率 × 时间，按 1 次、总倍率结算（通用逻辑：所有角色平A都是秒均倍率算的）。
        const isPerSecondRow = exec.count <= 0 && (exec.totalTime ?? 0) > 0
        if (!isPerSecondRow && exec.count <= 0) continue
        // 琉音三个强特（石头/剪刀/布）在非失衡轴模式下由下方专用块按“失衡次数”拆分易伤，跳过通用直伤。
        if (charResult.agentId === '1481' && !isAxis && LIUYIN_EX_MOVE_IDS.has(exec.moveId)) continue
        const move = findMoveById(skills, exec.moveId)
        const mechanic = getAgentMechanic(charResult.agentId)
        const burniceCinema = charResult.agentId === '1171' ? configStore.team[slot]?.cinemaLevel ?? 0 : 0
        const critRateBonus = (burniceCinema >= 4 && (exec.category === 'special' || exec.category === 'assist') ? 30 : 0) + (exec.critRateBonus ?? 0)
        const critDmgBonus = exec.critDmgBonus ?? 0
        // 招式限定抗性无视：执行字段（模块 patchExecutions 写入，如仪玄影画2 终/强特 15% 以太减抗）+ 柏妮思 C6 特判
        const resIgnore = (exec.resIgnore ?? 0) + (burniceCinema >= 6 && (exec.moveId === '1171012' || exec.moveId === '1171013') ? 25 : 0)
        const resolved = mechanic?.resolveExecutionDamage?.({
          slot,
          agent: agent ?? null,
          skills,
          move,
          exec,
          team: buildMechanicTeamMembers(configStore, catalogStore),
          cinemaLevel: configStore.team[slot]?.cinemaLevel ?? 0,
          potentialLevel: configStore.team[slot]?.potentialLevel ?? 6,
        })
        const element = resolved?.element ?? move?.damageElement ?? agent?.damageElement ?? 'physical'
        const execPanel = damagePanels[slot]
        const execSkillLevelBonus = execPanel?.skillLevelBonus ?? 0
        const execDamageCoef = execSkillLevelBonus > 0 ? getSkillLevelCoef(execSkillLevelBonus).damageCoef : 1
        // 同 slot 同 moveId 多行（如诺姆膛温替换连携 vs 通用连携）id 加序号去重
        const baseId = `direct-${slot}-${exec.moveId}`
        const dup = seenDirectIds.get(baseId) ?? 0
        seenDirectIds.set(baseId, dup + 1)
        const rowId = dup > 0 ? `${baseId}-${dup}` : baseId
        const unitMultiplier = (exec.damageMultiplier ?? 0) * execDamageCoef
        const totalUnits = isPerSecondRow ? (exec.totalTime ?? 0) : exec.count
        const baseNote = `${resolved?.note ?? exec.skillTableNote ?? ''}${isPerSecondRow ? '（平A：秒均倍率 × 时间）' : ''}${execSkillLevelBonus > 0 ? ` · 技能等级系数×${execDamageCoef.toFixed(4)}` : ''}`
        const emitExecDirect = (units: number, stunOverride: number, idSuffix: string, extraNote: string, sourceTag?: 'gift' | 'stun' | 'self') => {
          if (units <= 0 || unitMultiplier <= 0) return
          // 般岳明王：6命满覆盖（applyPanel 全局 +39%）；非6命轴模式按时间轴扫描层数（8s 窗口，怒相二连触发）；
          // 非6命非轴模式按覆盖率滑块近似（满层3×5%×覆盖率）
          let mingwangDmgBonus = 0
          const banyueCinema = configStore.team[slot]?.cinemaLevel ?? 0
          if (charResult.agentId === '1471' && (execPanel?.additionalAbilityActive ?? 0) > 0 && banyueCinema < 6) {
            if (isAxis) {
              const stacks = banyueMingwangStacks.get(exec.moveId ?? '') ?? 0
              if (stacks > 0) mingwangDmgBonus = stacks * MINGWANG_BASE_PER_STACK
            } else {
              const cov = Math.max(0, Math.min(1, configStore.getMechanicSetting('banyue.mingwangCoverage', 0.5)))
              mingwangDmgBonus = MINGWANG_BASE_PER_STACK * 3 * cov
            }
          }
          // 可琳额外能力扫除帮手：命中失衡敌人自身伤害+35%。
          // 轴模式按 buff 轴扫描（轴内所有招式都在失衡窗口内，普攻段归并 basic_attack 聚合行键），
          // 且只吃轴内段（stunOverride=0 的轴外段敌人未失衡，不符合「命中失衡敌人」条件）；
          // 非轴模式按覆盖率滑块近似（默认 0.5，用户口径）
          let corinStunBonus = 0
          if (charResult.agentId === '1061' && (execPanel?.additionalAbilityActive ?? 0) > 0) {
            if (isAxis) {
              corinStunBonus = stunOverride > 0 ? (corinStunBonusMap.get(exec.moveId ?? '') ?? 0) : 0
            } else {
              const cov = Math.max(0, Math.min(1, configStore.getMechanicSetting('corin.additionalStunCoverage', 0.5)))
              corinStunBonus = CORIN_ADDITIONAL_DMG * cov
            }
          }
          // 希格莉德额外能力·天际联军：命中[浸染]敌人伤害+15% × 风化侵染覆盖率
          // （用户口径 2026-02：直接读风化覆盖率；damagePanels 已盖章 windInfectionRate，无风角色=0）
          let sigridInfectionBonus = 0
          if (charResult.agentId === '1591' && (execPanel?.additionalAbilityActive ?? 0) > 0) {
            const rate = Math.max(0, Math.min(1, Number(execPanel?.windInfectionRate ?? 0)))
            sigridInfectionBonus = SIGRID_INFECTION_DMG * rate
          }
          // 悠真额外能力（失衡/异常并集 +40%）：轴模式「失衡专属 buff 轴内直加」（2026-09-03，
          // 可琳扫除帮手同款分段通道）——patchHarumasaExecutions 已把公共异常部分（40×异常覆盖率）
          // 摊入全部行，这里只补失衡独有部分 40×(1−异常覆盖)，且仅轴内段（stunOverride>0，敌人失衡）加；
          // 轴外段敌人未失衡、只吃异常部分。非轴走 patch 并集口径（不加此处）。
          let harumasaStunOnlyBonus = 0
          if (charResult.agentId === '1201' && isAxis && (exec as any).harumasaStunOnly !== undefined) {
            harumasaStunOnlyBonus = stunOverride > 0 ? Math.max(0, Number((exec as any).harumasaStunOnly)) : 0
          }
          // 仪玄凝神：6 命默认满覆盖（调息送大量符法千重，用户口径：暴伤+40% + 贯穿+20%，不走轴扫描），
          // yixuan.c6NingshenCoverage 滑块可调；非 6 命轴模式按 buff 轴扫描（大招后 15s 窗口），非轴模式按滑块近似（仅暴伤）
          const yixuanCinema = configStore.team[slot]?.cinemaLevel ?? 0
          const yixuanNingshen = charResult.agentId === '1371' && (execPanel?.additionalAbilityActive ?? 0) > 0
            ? (yixuanCinema >= 6
              ? {
                  critDmg: Math.round(40 * Math.max(0, Math.min(1, configStore.getMechanicSetting('yixuan.c6NingshenCoverage', 1)))),
                  sheerDmg: Math.round(20 * Math.max(0, Math.min(1, configStore.getMechanicSetting('yixuan.c6NingshenCoverage', 1)))),
                }
              : isAxis
                ? (yixuanNingshenMap.get(exec.moveId ?? '') ?? { critDmg: 0, sheerDmg: 0 })
                : { critDmg: Math.round(40 * Math.max(0, Math.min(1, configStore.getMechanicSetting('yixuan.ningshenCoverage', 0.5)))), sheerDmg: 0 })
            : { critDmg: 0, sheerDmg: 0 }
          // 佩洛伊斯阳炎：轴模式按 buff 轴扫描（上分支后 21s 窗口，仅上分支/决算终结吃），非轴按覆盖率滑块（默认满）
          const peiluoKagerouCoverage = Math.max(0, Math.min(1, configStore.getMechanicSetting('peiluo.kagerouCoverage', 1)))
          // 非轴模式配对折算：上分支全吃；决算按 min(上分支,决算)/决算 的比例吃（无上分支铺垫的决算不吃）
          const peiluoPairRatio = exec.moveId === '1551016' ? ((exec as any).peiluoKagerouPairRatio ?? 0) : 1
          const peiluoKagerouCrit = charResult.agentId === '1551'
            ? (isAxis
              ? (peiluoKagerouMap.get(exec.moveId ?? '') ?? 0)
              : PEILUO_KAGEROU_CRIT * peiluoKagerouCoverage * peiluoPairRatio)
            : 0
          pushDirect({
            id: `${rowId}${idSuffix}`,
            slot,
            agentId: charResult.agentId,
            name: exec.moveName,
            element,
            source: resolved?.source ?? exec.moveId,
            count: isPerSecondRow ? 1 : units,
            multiplier: unitMultiplier * (isPerSecondRow ? units : 1),
            note: `${baseNote}${extraNote}${mingwangDmgBonus > 0 ? ` · 明王+${mingwangDmgBonus.toFixed(1)}%${isAxis ? '（轴内覆盖）' : '（覆盖率近似）'}` : ''}${corinStunBonus > 0 ? ` · 失衡增伤+${corinStunBonus.toFixed(1)}%${isAxis ? '（buff轴）' : '（覆盖率近似）'}` : ''}${harumasaStunOnlyBonus > 0 ? ` · 失衡增伤+${harumasaStunOnlyBonus.toFixed(1)}%（轴内直加）` : ''}${sigridInfectionBonus > 0 ? ` · 浸染增伤+${sigridInfectionBonus.toFixed(1)}%（风化覆盖率×15%）` : ''}${yixuanNingshen.critDmg > 0 ? ` · 凝神暴伤+${yixuanNingshen.critDmg.toFixed(0)}%${isAxis ? '（buff轴）' : '（覆盖率近似）'}` : ''}${yixuanNingshen.sheerDmg > 0 ? ` · 凝神贯穿+${yixuanNingshen.sheerDmg.toFixed(0)}%` : ''}`,
            moveId: exec.moveId,
            critRateBonus,
            critDmgBonus: critDmgBonus + yixuanNingshen.critDmg + peiluoKagerouCrit,
            dmgBonus: (exec.dmgBonus ?? 0) + mingwangDmgBonus + corinStunBonus + sigridInfectionBonus + harumasaStunOnlyBonus,
            sheerDmgBonus: (exec.sheerDmgBonus ?? 0) + yixuanNingshen.sheerDmg,
            flatDamageBonus: exec.flatDamageBonus,
            basisValueOverride: exec.basisValueOverride,
            basisLabelOverride: exec.basisLabelOverride,
            resIgnore,
            defIgnore: exec.defIgnore ?? 0,
            penRatioBonus: exec.penRatioBonus,
            skillDamageTarget: exec.skillDamageTarget,
            stunOverride,
            sourceTag: sourceTag ?? exec.source,
          })
        }
        if (isAxis && exec.normaGiftChain) {
          // 诺姆膛温换连携（赠送连携招式=上一位队友本人的连携技，注入时带 normaGiftChain 标记）：
          // 吃失衡易伤的次数 = 轴内实际执行的赠块数（':gift' 后缀 key，受窗口时间门控：占时间、超窗跳过）
          // 或旧表达 norma-hat-chain 标记块；其余赠送在失衡外触发、不吃易伤。
          let giftInUnits = 0
          for (const [key, alloc] of Object.entries(allocMap)) {
            if (key.endsWith(':norma-hat-chain') || key.endsWith(':gift')) giftInUnits += alloc.inAxisUnits
          }
          const inUnits = Math.min(totalUnits, Math.max(0, giftInUnits))
          emitExecDirect(inUnits, 1, '', '', exec.source)
          emitExecDirect(totalUnits - inUnits, 0, '-out', ' · 轴外（无失衡易伤）')
        } else if (isAxis && exec.autoSplitByStun) {
          // CD 驱动的后台自动行（通用机制，如猫又超凶爪印每秒 dot）：不按捏轴认领、无放置语义，
          // 轴模式改按失衡时间占比拆「占比内吃满易伤 / 其余无易伤」（非轴模式本就走全局覆盖率）。
          // 附加在特定招式上的事件不走此路——它们经 attachedEvents 跟随父动作判断是否在轴内。
          const inUnits = Math.min(totalUnits, Math.round(totalUnits * Math.max(0, Math.min(1, stunCoverage))))
          emitExecDirect(inUnits, 1, '', ' · 失衡内（CD自动行按占比）')
          emitExecDirect(totalUnits - inUnits, 0, '-out', ' · 轴外（CD自动行按占比，无易伤）')
        } else if (isAxis && axisSlots.has(slot) && (exec.moveId === '1521019' || exec.moveId === 'xixifu_shigu_special')) {
          // 希希芙蚀骨：失衡内回复的毒素由蛇吻手动消耗 → 全部在失衡内爆发（吃满易伤），其余轴外无易伤
          const frac = xixifuToxinInAxisFraction(slot, charResult)
          const inUnits = Math.min(totalUnits, Math.round(totalUnits * frac))
          emitExecDirect(inUnits, 1, '', ' · 失衡内毒素爆发')
          emitExecDirect(totalUnits - inUnits, 0, '-out', ' · 轴外毒素（无失衡易伤）')
        } else if (isAxis && axisSlots.has(slot)) {
          // 捏轴：把总单位切成轴内（易伤=1）/轴外（易伤=0）两段
          const split = axisSplitFor(slot, exec.moveId, totalUnits)
          emitExecDirect(split.inUnits, 1, '', '', exec.source)
          emitExecDirect(split.outUnits, 0, '-out', ' · 轴外（无失衡易伤）')
        } else if (charResult.agentId === '1431' && YESHUGUANG_FULL_STUN_MOVES.has(exec.moveId)) {
          // 叶瞬光白毛：关键伤害一律满易伤（帷幕易伤），真失衡只送连携；上限 210%/300% 在 pushDirect 处理
          emitExecDirect(totalUnits, 1, '', ' · 明心境满易伤', exec.source)
        } else if (!isAxis && charResult.agentId === '1291') {
          // 雨果（非轴精确口径）：只有失衡赠送连携 + 决算招式吃满易伤，其余招式都在失衡外、无易伤。
          // 轴模式走上方 axisSplit（按捏轴内/外拆分），不在此兜底。
          const fullStun = HUGO_FULL_STUN_MOVES.has(exec.moveId)
          emitExecDirect(totalUnits, fullStun ? 1 : 0, '', fullStun ? ' · 失衡内（连携/决算满易伤）' : ' · 失衡外（无易伤）', exec.source)
        } else {
          // 未进轴的槽位（如换的辅助、没捏进轴）按全局覆盖率单独算
          emitExecDirect(totalUnits, stunCoverage, '', '', exec.source)
        }
      }

      // 轴内直读技能表（通用兜底）：动作池「[表]」块被放置但模块未生成执行行的招式——
      // 按放置块数×窗口数出直伤（吃全额易伤）；不占时间预算、窗内不产失衡值（引擎既定口径）
      if (isAxis) {
        const backed = new Set(charResult.executions.map(e => e.moveId))
        const tblAlloc = allocateAxisWindows(effectiveStunAxes, Math.round(stunPoolResult?.stunCount ?? 0))
        const placedTable = new Map<string, number>()
        effectiveStunAxes.forEach((axis, ai) => {
          const wins = tblAlloc[ai] ?? 0
          for (const act of axis.actions) {
            if (act.slot !== slot) continue
            const mid = act.moveId
            if (backed.has(mid) || !/^\d+$/.test(mid)) continue
            placedTable.set(mid, (placedTable.get(mid) ?? 0) + Math.max(0, Math.floor(act.count || 1)) * wins)
          }
        })
        const tblSkills = catalogStore.getAgentSkills(configStore.team[slot]?.agentId ?? '')
        for (const [mid, count] of placedTable) {
          if (count <= 0) continue
          const move = findMoveById(tblSkills, mid)
          const dmgRow = (move?.rows ?? []).find((r: any) => r.kind === 'damageMultiplier')
          const mult = Number(dmgRow?.values?.[0] ?? 0)
          if (!move || !(mult > 0)) continue
          pushDirect({
            id: `direct-${slot}-${mid}-table`,
            slot, agentId: charResult.agentId,
            name: `${move.name?.zhCN || mid}（表）`,
            element: move.damageElement ?? catalogStore.getAgent(charResult.agentId)?.damageElement ?? 'physical',
            source: '轴内·技能表直读',
            count, multiplier: mult,
            note: '该招式未单独建模：按技能表倍率直读，吃失衡易伤；不占时间预算、窗内不产失衡值',
            moveId: mid,
            stunOverride: 1,
          })
        }
      }

      for (const event of charResult.anomalyEventExecutions ?? []) {
        if (event.count <= 0) continue
        if (event.eventType === 'release') {
          const triggerPanel = damagePanels[slot]
          // 异放跟随载体招式（前台绑定，玩家捏轴可精确控制）：失衡内占比 = 载体块轴内单位 / 载体总数
          const carrierInAxisFraction = event.followCarrierInStun && event.carrierMoveId
            ? (() => {
                const inAxis = allocMap[`${slot}:${event.carrierMoveId}`]?.inAxisUnits ?? 0
                // 载体总次数：执行行 count → 模块显式 carrierTotalCount（事件次数与载体不成 1:1 时，
                // 如薇薇安落羽生花异放=落羽生花次数×命中异常占比，分母必须用落羽生花次数本身）
                // → 事件次数兜底（柏妮思灼热抛接法/格莉丝脉冲手雷只生成异放事件、无执行行，
                // 每次载体动作恰好触发一次异放）
                const total = charResult.executions.find(e => e.moveId === event.carrierMoveId)?.count
                  ?? event.carrierTotalCount
                  ?? Math.max(0, Math.floor(event.count))
                return total > 0 ? Math.max(0, Math.min(1, inAxis / total)) : 0
              })()
            : undefined
          if (event.element === 'dominant') {
            // 异放元素 = 目标当前异常状态。Boss 异常状态轴点时归因（v2.2，与极性紊乱同口径）：
            // 轴模式下事件次数按代表窗内均匀取样时刻查当时状态分摊——链上元素无手动
            // releaseShare 覆盖才启用，手动分配/非轴模式回落下方覆盖率权重路径。
            const totalRelease = Math.max(0, Math.floor(event.count))
            const bossRel = isAxis ? bossAnomalyState : null
            const relWindows = bossRel?.stateChainsPerWindow.length ?? 0
            const relAnySegment = !!bossRel && (bossRel.stateChainsPerWindow.some(c => c.length > 0) || bossRel.windOverlayPerWindow.some(c => c.length > 0))
            if (bossRel && relWindows > 0 && relAnySegment) {
              const relNs = event.eventId.split('_')[0] ?? 'release'
              const chainEls = [...new Set(
                bossRel.stateChainsPerWindow.flat().concat(bossRel.windOverlayPerWindow.flat()).map(s => s.element),
              )]
              const hasManualShare = chainEls.some(el => configStore.getMechanicSetting(`${relNs}.releaseShare:${el}`, -1) >= 0)
              if (!hasManualShare) {
                const D = bossRel.windowDuration && bossRel.windowDuration > 0 ? bossRel.windowDuration : computeWindowDuration()
                // 与极性紊乱同口径：总次数均分到各真实失衡窗，逐窗按该窗状态链取样
                const alloc = allocateAxisWindows(effectiveStunAxes, Math.round(stunPoolResult?.stunCount ?? 0))
                const rIdx = bossRel.windowEntryIdx ?? bossRel.stateChainsPerWindow.map((_, i) => i)
                const rWeights = rIdx.map(ei => alloc[ei] ?? 0)
                const winShares = rWeights.some(w => w > 0)
                  ? distributeIntegerByWeight(totalRelease, rWeights)
                  : distributeIntegerByWeight(totalRelease, Array(relWindows).fill(1))
                const merged = new Map<string, number>()
                for (let w = 0; w < relWindows; w++) {
                  const chain = [...(bossRel.stateChainsPerWindow[w] ?? []), ...(bossRel.windOverlayPerWindow[w] ?? [])]
                  for (const p of attributeCountByStateChain(winShares[w] ?? 0, chain, D, agent?.damageElement ?? 'physical')) {
                    merged.set(p.element, (merged.get(p.element) ?? 0) + p.count)
                  }
                }
                const parts = [...merged.entries()].map(([element, count]) => ({ element, count })).sort((a, b) => b.count - a.count)
                const shares = distributeIntegerByWeight(totalRelease, parts.map(p => p.count))
                for (let i = 0; i < parts.length; i++) {
                  const count = shares[i] ?? 0
                  if (count <= 0) continue
                  const element = parts[i].element
                  const prog = anomalyPoolResult?.perElement.find(p => p.element === element)
                  const baseSlot = prog ? getMainApplierSlot(prog.contributions) : slot
                  for (const seg of releaseStunSegments(event, element, count, carrierInAxisFraction)) {
                    pushRelease({
                      id: `release-${slot}-${event.eventId}-${element}${seg.suffix}`,
                      slot,
                      agentId: charResult.agentId,
                      name: event.eventName,
                      count: seg.count,
                      multiplier: releaseMultiplierFor(event, element, triggerPanel, seg.stunned < 0 ? stunCoverage : seg.stunned),
                      source: event.carrierMoveName || event.carrierMoveId || event.eventId,
                      note: `${event.note ?? ''}；${element}·Boss异常状态轴·按触发时刻状态归因${seg.tag ? `；${seg.tag}` : ''}`,
                      element,
                      panel: damagePanels[baseSlot] ?? triggerPanel,
                      settlementPanel: triggerPanel,
                      releaseCrit: event.releaseCrit,
                      stunnedOverride: seg.stunned < 0 ? undefined : seg.stunned,
                    })
                  }
                }
                continue
              }
            }
            const axisCandidates = isAxis ? inStunAttributionCandidates() : []
            let attributionLabel = '失衡内活跃元素归因'
            let candidates = axisCandidates
            if (candidates.length === 0) {
              attributionLabel = '异常覆盖占比分配'
              const coverageRates = anomalyPoolResult?.coverage?.perElementCoverageRate ?? {}
              candidates = Object.entries(coverageRates)
                .filter(([, rate]) => rate > 0)
                .map(([element, rate]) => ({ element, autoRatio: rate }))
              if (candidates.length === 0) candidates = [{ element: agent?.damageElement ?? 'physical', autoRatio: 1 }]
            }
            const settingNs = event.eventId.split('_')[0] ?? 'release'
            const userWeights = candidates.map(({ element, autoRatio }) => ({
              element,
              weight: Math.max(0, configStore.getMechanicSetting(`${settingNs}.releaseShare:${element}`, autoRatio)),
            }))
            const totalWeight = userWeights.reduce((sum, item) => sum + item.weight, 0)
            const effectiveWeights = totalWeight > 0
              ? userWeights
              : candidates.map(({ element, autoRatio }) => ({ element, weight: autoRatio }))
            const effectiveTotal = effectiveWeights.reduce((sum, item) => sum + item.weight, 0) || 1
            const counts = distributeIntegerByWeight(
              totalRelease,
              effectiveWeights.map(item => item.weight / effectiveTotal),
            )
            for (let i = 0; i < effectiveWeights.length; i++) {
              const count = counts[i] ?? 0
              if (count <= 0) continue
              const element = effectiveWeights[i].element
              const prog = anomalyPoolResult?.perElement.find(p => p.element === element)
              const baseSlot = prog ? getMainApplierSlot(prog.contributions) : slot
              for (const seg of releaseStunSegments(event, element, count, carrierInAxisFraction)) {
                pushRelease({
                  id: `release-${slot}-${event.eventId}-${element}${seg.suffix}`,
                  slot,
                  agentId: charResult.agentId,
                  name: event.eventName,
                  count: seg.count,
                  multiplier: releaseMultiplierFor(event, element, triggerPanel, seg.stunned < 0 ? stunCoverage : seg.stunned),
                  source: event.carrierMoveName || event.carrierMoveId || event.eventId,
                  note: `${event.note ?? ''}；${element}·${attributionLabel}${seg.tag ? `；${seg.tag}` : ''}`,
                  element,
                  panel: damagePanels[baseSlot] ?? triggerPanel,
                  settlementPanel: triggerPanel,
                  releaseCrit: event.releaseCrit,
                  stunnedOverride: seg.stunned < 0 ? undefined : seg.stunned,
                })
              }
            }
            continue
          }
          const fixElement = event.element ?? 'wind'
          for (const seg of releaseStunSegments(event, fixElement, event.count, carrierInAxisFraction)) {
            if (seg.count <= 0) continue
            pushRelease({
              id: `release-${slot}-${event.eventId}${seg.suffix}`,
              slot: slot,
              agentId: charResult.agentId,
              name: event.eventName,
              count: seg.count,
              multiplier: releaseMultiplierFor(event, fixElement, triggerPanel, seg.stunned < 0 ? stunCoverage : seg.stunned),
              source: event.carrierMoveName || event.carrierMoveId || event.eventId,
              note: `${event.note ?? ''}${seg.tag ? `；${seg.tag}` : ''}`,
              element: fixElement,
              settlementPanel: triggerPanel,
              releaseCrit: event.releaseCrit,
              stunnedOverride: seg.stunned < 0 ? undefined : seg.stunned,
            })
          }
        } else if (event.eventType === 'polar_disorder') {
          // 极性紊乱 = 原本[紊乱]效果的25%伤害（池收敛后取紊乱均伤），不清除目标异常状态；
          // C2 门控在模块侧。归因（用户口径 2026-08-24「看当前时间点是什么属性异常状态」）：
          // 轴模式 dominant 走 Boss 异常状态轴——事件次数按代表窗内均匀取样时刻查当时状态链
          // 分摊到元素（标准链优先、风化覆盖层补空档）；无状态轴数据时 dominant 回落覆盖率最高者。
          const dd = anomalyPoolResult?.disorderDamage
          const polarRatio = event.polarDisorderRatio ?? 0.25
          const perEvent = (dd?.avgDamage ?? 0) * polarRatio
          const boss = isAxis ? bossAnomalyState : null
          const bossWindows = boss?.stateChainsPerWindow.length ?? 0
          const anySegment = !!boss && (boss.stateChainsPerWindow.some(c => c.length > 0) || boss.windOverlayPerWindow.some(c => c.length > 0))
          let parts: Array<{ element: string; count: number }> = []
          if (perEvent > 0 && event.count > 0 && event.element === 'dominant' && boss && bossWindows > 0 && anySegment) {
            const D = boss.windowDuration && boss.windowDuration > 0 ? boss.windowDuration : computeWindowDuration()
            // 事件总次数均分到各真实失衡窗，逐窗按该窗状态链取样归因（展开后每窗链可能不同）
            // 事件总次数按各条目的失衡数加权分配到代表窗，逐窗按状态链取样归因
            const alloc = allocateAxisWindows(effectiveStunAxes, Math.round(stunPoolResult?.stunCount ?? 0))
            const wIdx = boss.windowEntryIdx ?? boss.stateChainsPerWindow.map((_, i) => i)
            const weights = wIdx.map(ei => alloc[ei] ?? 0)
            const winShares = weights.some(w => w > 0)
              ? distributeIntegerByWeight(Math.max(0, Math.floor(event.count)), weights)
              : distributeIntegerByWeight(Math.max(0, Math.floor(event.count)), Array(bossWindows).fill(1))
            const merged = new Map<string, number>()
            for (let w = 0; w < bossWindows; w++) {
              const chain = [...(boss.stateChainsPerWindow[w] ?? []), ...(boss.windOverlayPerWindow[w] ?? [])]
              for (const p of attributeCountByStateChain(winShares[w] ?? 0, chain, D, agent?.damageElement ?? 'ether')) {
                merged.set(p.element, (merged.get(p.element) ?? 0) + p.count)
              }
            }
            parts = [...merged.entries()].map(([element, count]) => ({ element, count })).sort((a, b) => b.count - a.count)
            const shares = distributeIntegerByWeight(Math.max(0, Math.floor(event.count)), parts.map(p => p.count))
            for (let i = 0; i < parts.length; i++) {
              const shareCount = shares[i] ?? 0
              if (shareCount <= 0) continue
              // 极性基数用「现在的基础值」（用户口径）：当前状态元素的紊乱明细均摊；
              // 池无该元素明细时回落全池均摊
              const el = parts[i].element
              const elDetails = (dd?.details ?? []).filter(d => getBaseElement(d.element) === getBaseElement(el))
              const elEvents = elDetails.reduce((s, d) => s + (d.events ?? 0), 0)
              const elDamage = elDetails.reduce((s, d) => s + (d.damage ?? 0), 0)
              const perEventEl = elEvents > 0 ? (elDamage / elEvents) * polarRatio : perEvent
              if (perEventEl <= 0) continue
              rows.push({
                id: `polar-${slot}-${event.eventId}-${el}`,
                slot,
                agentId: charResult.agentId,
                agentName: agentName(charResult.agentId, slot),
                type: '极性紊乱',
                name: event.eventName,
                element: safeElement(el),
                source: event.carrierMoveName || event.carrierMoveId || event.eventId,
                count: shareCount,
                perDamage: perEventEl,
                totalDamage: perEventEl * shareCount,
                note: `${event.note ?? ''}；${el}·Boss异常状态轴·按触发时刻状态归因·基数=该元素紊乱均摊`,
              })
            }
            continue
          }
          let polarElement = event.element
          if (polarElement === 'dominant') {
            const axisBest = [...(isAxis ? inStunAttributionCandidates() : [])]
              .sort((a, b) => b.autoRatio - a.autoRatio)[0]?.element
            if (axisBest) polarElement = axisBest
            else {
              const rates = anomalyPoolResult?.coverage?.perElementCoverageRate ?? {}
              polarElement = Object.entries(rates).filter(([, r]) => r > 0).sort((a, b) => b[1] - a[1])[0]?.[0]
                ?? agent?.damageElement ?? 'ether'
            }
          }
          if (perEvent > 0 && event.count > 0) {
            rows.push({
              id: `polar-${slot}-${event.eventId}`,
              slot,
              agentId: charResult.agentId,
              agentName: agentName(charResult.agentId, slot),
              type: '极性紊乱',
              name: event.eventName,
              element: safeElement(polarElement),
              source: event.carrierMoveName || event.carrierMoveId || event.eventId,
              count: event.count,
              perDamage: perEvent,
              totalDamage: perEvent * event.count,
              note: event.note ?? '',
            })
          }
        } else if (event.eventType === 'direct_damage') {
          // 直伤事件（如薇薇安预言 DoT、加农转子额外伤害）：倍率 = 攻击力 × damageMultiplier%。
          // 缺 damageMultiplier 的事件（spec 事件走专用结算块）跳过，避免双计。
          const mult = event.damageMultiplier ?? 0
          if (mult > 0 && event.count > 0) {
            pushDirect({
              id: `direct-damage-${slot}-${event.eventId}`,
              slot,
              agentId: charResult.agentId,
              name: event.eventName,
              element: event.element ?? agent?.damageElement ?? 'physical',
              source: event.carrierMoveName || event.carrierMoveId || event.eventId,
              count: event.count,
              multiplier: mult,
              note: event.note ?? event.formula ?? '',
            })
          }
        }
      }

      const burniceSrc = charResult.burniceMechanicSource
      if (charResult.agentId === '1171' && burniceSrc) {
        const burniceSkillCoef = (() => {
          const bonus = damagePanels[slot]?.skillLevelBonus ?? 0
          return bonus > 0 ? getSkillLevelCoef(bonus).damageCoef : 1
        })()
        if (burniceSrc.emberTotalTriggerCount > 0 && burniceSrc.emberDamageRatioWithMastery > 0) {
          pushDirect({
            id: 'burnice-ember',
            slot,
            agentId: charResult.agentId,
            name: '柏妮思余烬（含搅拌式附带）',
            element: 'fire',
            source: `普通余烬 ${burniceSrc.emberTriggerCount} 次 + 搅拌式附带 ${burniceSrc.stirringFreeEmberCount} 次`,
            count: burniceSrc.emberTotalTriggerCount,
            multiplier: burniceSrc.emberDamageRatioWithMastery,
            note: `${burniceSrc.emberDamageRatio}%攻击 × (1 + 精通加成)，基础积蓄60`,
            critRateBonus: burniceSrc.cinema4CritRateBonus,
            skillDamageTarget: 'assist',
          })
        }
        if (burniceSrc.stirringCount > 0 && burniceSrc.stirringDamageRatio > 0) {
          pushDirect({
            id: 'burnice-stirring',
            slot,
            agentId: charResult.agentId,
            name: '柏妮思搅拌式',
            element: 'fire',
            source: '溢出燃点消耗20点/次 · 支援攻击',
            count: burniceSrc.stirringCount,
            multiplier: burniceSrc.stirringDamageRatio * burniceSkillCoef,
            note: `Mixed Flame Blend #1 × 0.5 + #2，分类为支援攻击${burniceSkillCoef !== 1 ? ` · 技能等级系数×${burniceSkillCoef.toFixed(4)}` : ''}`,
            critRateBonus: burniceSrc.cinema4CritRateBonus,
            skillDamageTarget: 'assist',
          })
        }
        if (burniceSrc.tossingCount > 0 && burniceSrc.tossingDamageRatio > 0) {
          pushDirect({
            id: 'burnice-tossing',
            slot,
            agentId: charResult.agentId,
            name: '柏妮思灼热抛接法',
            element: 'fire',
            source: '消耗1点流火 · EX Special Attack: Intense Heat Tossing Method',
            count: burniceSrc.tossingCount,
            multiplier: burniceSrc.tossingDamageRatio * burniceSkillCoef,
            note: `强化特殊技，可吃4命暴击率+30%${burniceSkillCoef !== 1 ? ` · 技能等级系数×${burniceSkillCoef.toFixed(4)}` : ''}`,
            critRateBonus: burniceSrc.cinema4CritRateBonus,
            skillDamageTarget: 'exSpecial',
          })
        }
        if (burniceSrc.cinema6SpecialEmberCount > 0 && burniceSrc.cinema6SpecialEmberDamageRatio > 0) {
          pushDirect({
            id: 'burnice-c6-special-ember',
            slot,
            agentId: charResult.agentId,
            name: '柏妮思6命特殊余烬',
            element: 'fire',
            source: '双份命中触发 · 0.5s最多一次 · 不消耗燃点',
            count: burniceSrc.cinema6SpecialEmberCount,
            multiplier: burniceSrc.cinema6SpecialEmberDamageRatio,
            note: `固定${burniceSrc.cinema6SpecialEmberBaseRatio}%攻击，不吃1命/精通加成，无视火抗${burniceSrc.cinema6FireResIgnore}%`,
            critRateBonus: burniceSrc.cinema4CritRateBonus,
            resIgnore: burniceSrc.cinema6FireResIgnore,
            moveId: 'burnice-c6-special-ember',
            stunOverride: axisStunFor('burnice-c6-special-ember'),
            skillDamageTarget: 'assist',
          })
        }
      }

      // 琉音专属直伤（额外能力）：石头/剪刀/布重击命中时，按上一位队友特性追加伤害。
      const liuyinSrc = charResult.liuyinMechanicSource
      if (charResult.agentId === '1481' && liuyinSrc && liuyinSrc.extraAbilityActive && liuyinSrc.exHeavyCount > 0) {
        const prevSlot = liuyinSrc.previousTeammateSlot
        const prevPanel = damagePanels[prevSlot]
        const prevAgent = prevSlot >= 0 ? (configStore.team[prevSlot]?.agentId ? catalogStore.getAgent(configStore.team[prevSlot].agentId) : null) : null
        const isRupture = prevAgent?.specialty === 'rupture'
        const basisValue = prevPanel ? (isRupture ? prevPanel.atk * 0.3 + prevPanel.hp * 0.1 : prevPanel.atk) : 0
        const ratio = isRupture ? 400 : 320
        const basisLabel = isRupture ? '上一位队友贯穿力' : '上一位队友攻击力'
        if (basisValue > 0) {
          pushDirect({
            id: `liuyin-ex-direct-${prevSlot}`,
            slot,
            agentId: charResult.agentId,
            name: '琉音额外能力·重击附加伤害',
            element: 'physical',
            source: `上一位队友（${prevAgent?.name?.zhCN ?? `槽${prevSlot + 1}`}）${isRupture ? '贯穿力' : '攻击力'} × ${ratio}%`,
            count: liuyinSrc.exHeavyCount,
            multiplier: ratio,
            note: `额外能力专属直伤：${isRupture ? '命破队友 400% 贯穿力' : '强攻队友 320% 攻击力'}`,
            skillDamageTarget: 'exSpecial',
            basisValueOverride: basisValue,
            basisLabelOverride: basisLabel,
          })
        }
      }

      // 琉音三个强特（石头→剪刀→布）按“失衡次数×25 能量留给失衡内第一个强特，剩余非失衡按 1→3 连打”拆分易伤。
      // 非失衡轴模式下通用强特行已跳过，这里重放并拆失衡/非失衡；失衡轴模式仍走轴内易伤归属。
      // 般岳影画6：600% 贯穿力火伤附伤是倾山的自动触发事件，次数 = 倾山次数（不可调，不产生资源利用率行）
      if (charResult.agentId === '1471' && (configStore.team[slot]?.cinemaLevel ?? 0) >= 6) {
        const qingShanExec = charResult.executions.find(e => e.moveId === '1471009')
        const attachCount = Math.max(0, Math.floor(qingShanExec?.count ?? 0))
        if (attachCount > 0) {
          const panel = damagePanels[slot]
          pushDirect({
            id: 'banyue-c6-crush-attach',
            slot,
            agentId: charResult.agentId,
            name: '影画6·摧岳附伤（倾山自动触发）',
            element: 'fire',
            source: '倾山自动触发',
            count: attachCount,
            multiplier: C6_ATTACH_RATIO,
            note: `影画6：倾山命中时对周身造成 600% 贯穿力火伤；次数=倾山次数 ×${attachCount}（自动，不可调）`,
            basisValueOverride: panel.atk * 0.3 + (panel.hp ?? 0) * 0.1 + (panel.sheerForceFlat ?? 0),
            basisLabelOverride: '贯穿力（600%附伤）',
            moveId: 'banyue_c6_crush_attach',
            stunOverride: axisStunFor('banyue_c6_crush_attach'),
          })
        }
      }

      if (charResult.agentId === '1481' && liuyinSrc && !isAxis) {
        const stunCount = stunPoolResult?.stunCount ?? 0
        const exTotal = Math.max(0, Math.floor(liuyinSrc.exHeavyCount))
        const exMult = new Map<string, number>()
        for (const e of charResult.executions) {
          if (LIUYIN_EX_MOVE_IDS.has(e.moveId) && (e.damageMultiplier ?? 0) > 0) exMult.set(e.moveId, e.damageMultiplier!)
        }
        const mult = (id: string) => exMult.get(id) ?? 0
        const inStunCount = Math.min(stunCount, exTotal)
        const nonStunCount = Math.max(0, exTotal - inStunCount)
        // 非失衡按 1(石头)→2(剪刀)→3(布) 顺序连打
        const nsRock = Math.floor((nonStunCount + 2) / 3)
        const nsScissors = Math.floor((nonStunCount + 1) / 3)
        const nsPaper = Math.floor(nonStunCount / 3)
        const pushLiuyinEx = (moveId: string, name: string, count: number, stunOverride: number, tag: string) => {
          if (count <= 0 || mult(moveId) <= 0) return
          pushDirect({
            id: `liuyin-ex-${moveId}-${tag}`,
            slot,
            agentId: charResult.agentId,
            name,
            element: 'physical',
            source: tag === 'stun' ? '失衡内首个强特' : '非失衡 1→3 连打',
            count,
            multiplier: mult(moveId),
            note: tag === 'stun' ? '失衡内释放，吃满失衡易伤' : '非失衡释放，无易伤',
            skillDamageTarget: 'exSpecial',
            stunOverride,
          })
        }
        pushLiuyinEx('1481011', '强化特殊技：石头', inStunCount, 1, 'stun')
        pushLiuyinEx('1481011', '强化特殊技：石头', nsRock, 0, 'nonstun')
        pushLiuyinEx('1481012', '强化特殊技：剪刀', nsScissors, 0, 'nonstun')
        pushLiuyinEx('1481013', '强化特殊技：布！', nsPaper, 0, 'nonstun')
      }

      // 琉音影画6·余音：独立直伤，轴模式同样生效（非失衡轴模式下与强特拆分无关，不能包在 !isAxis 内）
      if (charResult.agentId === '1481' && liuyinSrc && liuyinSrc.cinemaLevel >= 6) {
        const promoteCount = liuyinPromoteCount
        const c6EchoMax = Math.max(0, Math.floor(configStore.getMechanicSetting('liuyin.c6EchoMax', CINEMA6_ECHO_MAX)))
        if (promoteCount > 0 && c6EchoMax > 0) {
          const echoCount = promoteCount * c6EchoMax
          pushDirect({
            id: 'liuyin-c6-echo',
            slot,
            agentId: charResult.agentId,
            name: '琉音影画6·余音',
            element: 'physical',
            source: `转大 ${promoteCount} 次 × ${c6EchoMax} 次 × 480%`,
            count: echoCount,
            multiplier: CINEMA6_ECHO_RATIO,
            // 附伤随「队友以终结技入场」的转大触发 → 轴内易伤跟随全队终极技轴内占比（用户口径 2026-08：
            // 6命附伤事件和动作绑定，理应该伴随计数并且吃易伤）；非轴回落全局覆盖率
            stunOverride: isAxis ? ultimateInAxisFraction() : undefined,
            note: `影画6余音：队友经核心被动以终结技入场后，其攻击命中时琉音追加 480% 攻击力物理伤害（视为强特）；每转大最多 ${c6EchoMax} 次（可在资源利用率页调整）。`,
            skillDamageTarget: 'exSpecial',
          })
        }
      }
    }

    const windChar = windSlot >= 0 ? configStore.team[windSlot] : null
    const windAgentId = windChar?.agentId ?? ''
    const windRate = anomalyPoolResult?.coverage?.windCoverageRate ?? 0

    for (const event of anomalyPoolResult?.anomalyEvents ?? []) {
      if (event.count <= 0 || windSlot < 0 || !windAgentId) continue
      if (event.type === 'release' && event.id.includes('velina-corrosion')) {
        // 风异放（微域145%/广域255%）随乱流触发：失衡轴内按「轴内非风异常触发占比」拆
        // in/out 两段（轴内异常触发→轴内乱流→轴内风异放，用户口径 2026-08）；非轴保持全局覆盖率
        const total = Math.floor(event.count)
        if (!isAxis) {
          pushRelease({
            id: `pool-release-${event.id}`,
            slot: windSlot,
            agentId: windAgentId,
            name: event.label,
            count: total,
            multiplier: parseReleaseMultiplier(event),
            source: event.source,
            note: event.note,
          })
          continue
        }
        const frac = nonWindInAxisFraction()
        const inCount = Math.min(total, Math.round(total * frac))
        const outCount = total - inCount
        if (inCount > 0) {
          pushRelease({
            id: `pool-release-${event.id}-in`,
            slot: windSlot,
            agentId: windAgentId,
            name: event.label,
            count: inCount,
            multiplier: parseReleaseMultiplier(event),
            source: event.source,
            note: `${event.note}；失衡内·全额失衡易伤`,
            stunnedOverride: 1,
          })
        }
        if (outCount > 0) {
          pushRelease({
            id: `pool-release-${event.id}-out`,
            slot: windSlot,
            agentId: windAgentId,
            name: event.label,
            count: outCount,
            multiplier: parseReleaseMultiplier(event),
            source: event.source,
            note: `${event.note}；轴外·无易伤`,
            stunnedOverride: 0,
          })
        }
      }
    }

    for (const detail of anomalyPoolResult?.turbulenceDamage?.details ?? []) {
      const applierAgentId = configStore.team[detail.applierSlot]?.agentId ?? ''
      rows.push({
        id: `turbulence-${detail.element}-${detail.applierSlot}`,
        slot: windSlot >= 0 ? windSlot : 0,
        agentId: windAgentId,
        agentName: windAgentId ? agentName(windAgentId, windSlot) : '风属性角色',
        type: '乱流',
        name: `${elementLabel(detail.element)}乱流`,
        element: detail.element,
        source: `${agentName(applierAgentId, detail.applierSlot)} 的${elementLabel(detail.element)}异常基础区`,
        count: detail.count ?? 0,
        perDamage: (detail.count ?? 0) > 0 ? detail.damage / (detail.count ?? 1) : detail.damage,
        totalDamage: detail.damage,
        multiplier: detail.turbulenceMultiplier,
        note: `T=${detail.remainingTime}s，倍率=${detail.turbulenceMultiplier}%${detail.boostedCount ? `，其中${detail.boostedCount}次吃风蚀+150%倍率` : ''}`,
      })
    }

    // ---- 紊乱伤害（入池，不再单独从 totalDamageWithDisorder 累加） ----
    for (const detail of anomalyPoolResult?.disorderDamage?.details ?? []) {
      if (detail.damage <= 0 || detail.events <= 0) continue
      const triggerAgentId = configStore.team[detail.triggerSlot]?.agentId ?? ''
      const applierAgentId = configStore.team[detail.applierSlot]?.agentId ?? ''
      rows.push({
        id: `disorder-${detail.element}-${detail.applierSlot}-${detail.triggerSlot}`,
        slot: detail.triggerSlot,
        agentId: triggerAgentId,
        agentName: agentName(triggerAgentId, detail.triggerSlot),
        type: '紊乱',
        name: `紊乱（覆盖${elementLabel(detail.element)}）`,
        element: detail.element,
        source: `${agentName(applierAgentId, detail.applierSlot)} 的${elementLabel(detail.element)}异常被${agentName(triggerAgentId, detail.triggerSlot)}覆盖`,
        count: detail.events,
        perDamage: detail.perEventDamage,
        totalDamage: detail.damage,
        multiplier: detail.disorderMultiplier,
        note: `T=${detail.remainingTime}s，倍率=${detail.disorderMultiplier}%，anomalyMass=${detail.anomalyMass}，settlement=${detail.settlementMultiplier}`,
      })
    }

    const anomalyDamageSpecs: Record<string, {
      label: string
      perTick?: number
      tickInterval?: number
      baseTicks?: number
      single?: number
      baseFormula: string
    }> = {
      fire: { label: '灼烧', perTick: 50, tickInterval: 0.5, baseTicks: 20, baseFormula: '灼烧基础 50% × 20 tick（10秒/0.5秒）' },
      electric: { label: '感电', perTick: 125, tickInterval: 1, baseTicks: 10, baseFormula: '感电基础 125% × 10 tick' },
      ether: { label: '侵蚀', perTick: 62.5, tickInterval: 0.5, baseTicks: 20, baseFormula: '侵蚀基础 62.5% × 20 tick（10秒/0.5秒）' },
      physical: { label: '强击', single: 713, baseFormula: '强击 713% 单次' },
      ice: { label: '碎冰', single: 500, baseFormula: '碎冰 500% 单次（冻结次数=碎冰次数）' },
      wind: { label: '风化', single: 1250, baseFormula: '风化 1250% 单次' },
    }
    // 风化窗口内的火/电/以太 DoT 与冰冻结类不生效，按 (1 - windRate) 折算；
    // 强击、极性强击这类事件伤害仍可触发，因此保留 physical/physical_polar_assault/wind 全额次数。
    const windBlockedAnomalyElements = new Set(['fire', 'electric', 'ether', 'ice'])
    for (const prog of anomalyPoolResult?.perElement ?? []) {
      const spec = anomalyDamageSpecs[prog.element]
      if (!spec || prog.triggerCount <= 0) continue
      const effectiveTriggerCount = windBlockedAnomalyElements.has(prog.element)
        ? prog.triggerCount * (1 - windRate)
        : prog.triggerCount
      if (effectiveTriggerCount <= 0) continue
      const build = buildAnomalyVirtualPanel(prog, damagePanels, configStore, catalogStore)
      if (!build) continue

      const durationBonus = getTeamAnomalyDurationBonus(configStore, catalogStore, prog.element)
      let multiplier = spec.single ?? 0
      let formula = spec.baseFormula
      if (!spec.single && spec.perTick && spec.tickInterval && spec.baseTicks) {
        const ticks = spec.baseTicks + (spec.tickInterval > 0 ? Math.round(durationBonus / spec.tickInterval) : 0)
        multiplier = spec.perTick * ticks
        formula = `${spec.perTick}% × ${ticks} tick${durationBonus > 0 ? `（含${durationBonus}秒延长）` : ''}`
      }

      // 维琳娜6命：对风化状态敌人再次施加风化，按平均剩余时长给风化事件增伤（每1s +2.5%，上限40%）
      if (prog.element === 'wind') {
        const windPanel = damagePanels[windSlot]
        const velinaC6 = (windPanel as any)?.velinaCinema6 ?? 0
        const windCount = prog.triggerCount
        if (velinaC6 && windCount > 1) {
          const avgRemaining = (30 * (windCount - 1) / windCount) / 2
          const c6BonusPct = Math.min(40, 2.5 * avgRemaining)
          multiplier *= (1 + c6BonusPct / 100)
          formula += ` · 6命风化期望+${c6BonusPct.toFixed(1)}%（平均剩余${avgRemaining.toFixed(1)}s）`
        }
      }

      // 按触发者分摊结算：每人用自己的面板独立结算
      const settlementEntries = buildAnomalySettlementEntries(build, damagePanels, effectiveTriggerCount, configStore, catalogStore)

      for (const entry of settlementEntries) {
        if (entry.triggerCount <= 0) continue
        const result = calcAnomalyDamage({
          panel: build.panel,
          settlementPanel: entry.panel,
          baseMultiplier: multiplier,
          element: prog.element as any,
          enemyDefense: configStore.enemy.defense,
          enemyDefReduction: 0,
          enemyDefFlatReduction: 0,
          enemyLevel: configStore.enemy.level,
          enemyResistance: enemyDamageRes[prog.element] ?? 0,
          enemyResReduction: entry.panel?.enemyResReduction ?? 0,
          stunned: stunCoverage,
          stunMultiplier: configStore.enemy.stunVuln,
          critMode: 'expect',
          damageKind: 'anomaly',
          anomalyMultiplier: remielleAnomalyMultiplier,
        })

        const perDamage = result.damage
        const totalDamage = perDamage * entry.triggerCount
        const noteParts = [`${formula}`]
        if (settlementEntries.length > 1) {
          noteParts.push(`${entry.name}结算 · 积蓄占比${(entry.share*100).toFixed(0)}% · ${entry.triggerCount}次`)
        }
        rows.push({
          id: `anomaly-damage-${prog.element}-${entry.slot}`,
          slot: entry.slot,
          agentId: configStore.team[entry.slot]?.agentId ?? '',
          agentName: agentName(configStore.team[entry.slot]?.agentId ?? '', entry.slot),
          type: spec.label as DamagePoolRow['type'],
          name: settlementEntries.length > 1
            ? `${spec.label}（${elementLabel(prog.element)}·${entry.name}结算）`
            : `${spec.label}（${elementLabel(prog.element)}虚拟面板）`,
          element: prog.element,
          source: `属性异常${settlementEntries.length > 1 ? '按积蓄占比分摊' : '虚拟面板'}结算`,
          count: entry.triggerCount,
          perDamage,
          totalDamage,
          multiplier,
          note: noteParts.join(' · '),
        })
      }
    }

    // ---- 柏妮思6命：双份火焰冲击命中灼烧敌人时，额外结算一次1800%灼烧伤害 ----
    const burniceSlot = configStore.team.findIndex(char => {
      const a = char.agentId ? catalogStore.getAgent(char.agentId) : null
      return a?.id === '1171' || a?.teammateBuffId === '1171'
    })
    const burniceSrc = burniceSlot >= 0
      ? adjustedResourceResult?.characters.find(c => c.slot === burniceSlot)?.burniceMechanicSource
      : undefined
    const fireProg = anomalyPoolResult?.perElement.find(prog => prog.element === 'fire')
    if (windRate < 1 && burniceSrc && burniceSrc.cinema6BurnBurstCount > 0 && fireProg && fireProg.triggerCount > 0) {
      const fireBuild = buildAnomalyVirtualPanel(fireProg, damagePanels, configStore, catalogStore)
      if (fireBuild) {
        const fireEffectiveCount = fireProg.triggerCount * (1 - windRate)
        const settlementEntries = buildAnomalySettlementEntries(fireBuild, damagePanels, fireEffectiveCount, configStore, catalogStore)
        const burnBurstStun = axisStunFor('burnice-c6-burn-burst')
        for (const entry of settlementEntries) {
          if (entry.triggerCount <= 0) continue
          const burstCount = Math.min(burniceSrc.cinema6BurnBurstCount, entry.triggerCount)
          if (burstCount <= 0) continue
          const burstResult = calcAnomalyDamage({
            panel: fireBuild.panel,
            settlementPanel: entry.panel,
            baseMultiplier: burniceSrc.cinema6BurnBurstDamageRatio,
            element: 'fire' as any,
            enemyDefense: configStore.enemy.defense,
            enemyDefReduction: 0,
            enemyDefFlatReduction: 0,
            enemyLevel: configStore.enemy.level,
            enemyResistance: enemyDamageRes.fire ?? 0,
            enemyResReduction: (entry.panel?.enemyResReduction ?? 0) + burniceSrc.cinema6FireResIgnore,
            stunned: burnBurstStun,
            stunMultiplier: configStore.enemy.stunVuln,
            critMode: 'expect',
            damageKind: 'anomaly',
            anomalyMultiplier: remielleAnomalyMultiplier,
          })
          rows.push({
            id: `burnice-c6-burn-burst-${entry.slot}`,
            slot: entry.slot,
            agentId: configStore.team[entry.slot]?.agentId ?? '',
            agentName: agentName(configStore.team[entry.slot]?.agentId ?? '', entry.slot),
            type: '灼烧',
            name: '柏妮思6命灼烧迸发',
            element: 'fire',
            source: '双份火焰冲击命中灼烧敌人 · 900%额外灼烧',
            count: burstCount,
            perDamage: burstResult.damage,
            totalDamage: burstResult.damage * burstCount,
            note: `${burniceSrc.cinema6BurnBurstDamageRatio}%（灼烧基础50% × 1800%），跟随双喷轴内易伤，无视火抗${burniceSrc.cinema6FireResIgnore}%，同一目标20秒最多一次`,
            moveId: 'burnice-c6-burn-burst',
          })
        }
      }
    }

    // ---- 极性强击伤害（赠送触发，不走虚拟面板） ----
    const polarAssaultProg = anomalyPoolResult?.perElement.find(prog => prog.element === 'physical_polar_assault')
    const polarAssaultSlot = configStore.team.findIndex(char => {
      const a = char.agentId ? catalogStore.getAgent(char.agentId) : null
      return a?.id === '1401' || a?.teammateBuffId === '1401'
    })
    if (polarAssaultProg && polarAssaultProg.triggerCount > 0 && polarAssaultSlot >= 0 && damagePanels[polarAssaultSlot]) {
      const alicePanel = damagePanels[polarAssaultSlot]
      // 轴模式：极性强击易伤跟随父动作 SW3(1401012) 的轴内占比；影画2 终结技额外触发的
      // 极性强击（c2UltSparkCount）跟随终结技轴内占比——按次数加权（2026-08 审计补接）
      const sw3Frac = axisStunFor('polar_assault')
      const aliceSm = adjustedResourceResult?.characters.find(c => c.slot === polarAssaultSlot)?.aliceSwordWillSource
      const ultExtra = Math.max(0, Math.floor(aliceSm?.c2UltSparkCount ?? 0))
      const sw3Count = Math.max(0, Math.floor(polarAssaultProg.triggerCount) - ultExtra)
      const polarStunFor = polarAssaultProg.triggerCount > 0
        ? (sw3Count * sw3Frac + ultExtra * ultimateInAxisFraction(polarAssaultSlot)) / polarAssaultProg.triggerCount
        : stunCoverage
      const result = calcAnomalyDamage({
        panel: alicePanel,
        settlementPanel: alicePanel,
        baseMultiplier: 713,
        element: 'physical' as any,
        enemyDefense: configStore.enemy.defense,
        enemyDefReduction: 0,
        enemyDefFlatReduction: 0,
        enemyLevel: configStore.enemy.level,
        enemyResistance: enemyDamageRes.physical ?? 0,
        enemyResReduction: alicePanel?.enemyResReduction ?? 0,
        stunned: polarStunFor,
        stunMultiplier: configStore.enemy.stunVuln,
        critMode: 'expect',
        damageKind: 'anomaly',
        anomalyMultiplier: remielleAnomalyMultiplier,
      })
      const perDamage = result.damage
      rows.push({
        id: 'polar-assault-damage',
        slot: polarAssaultSlot,
        agentId: configStore.team[polarAssaultSlot]?.agentId ?? '',
        agentName: agentName(configStore.team[polarAssaultSlot]?.agentId ?? '', polarAssaultSlot),
        type: '极性强击',
        name: `极性强击（三蓄赠送）`,
        element: 'physical_polar_assault',
        source: `三蓄赠送触发 · 无视积蓄进度 · 爱丽丝面板`,
        count: polarAssaultProg.triggerCount,
        perDamage,
        totalDamage: perDamage * polarAssaultProg.triggerCount,
        multiplier: 713,
        note: `713% 单次 × 爱丽丝面板 · 赠送触发不耗异常条${isAxis ? ` · 易伤按触发源加权轴内占比 ${fmt(polarStunFor, 2)}（SW3 ${fmt(sw3Frac, 2)}${ultExtra > 0 ? ` ×${sw3Count} + 终结 ${fmt(ultimateInAxisFraction(polarAssaultSlot), 2)} ×${ultExtra}` : ''}）` : ''}`,
      })
    }

    const janeSlot = configStore.team.findIndex(char => {
      const agent = char.agentId ? catalogStore.getAgent(char.agentId) : null
      return agent?.id === '1261' || agent?.teammateBuffId === '1261'
    })
    const janeCinema = configStore.team[janeSlot]?.cinemaLevel ?? 0
    if (janeSlot >= 0 && janeCinema >= 6 && damagePanels[janeSlot]) {
      const janePanel = damagePanels[janeSlot]
      const physicalProg = anomalyPoolResult?.perElement.find(prog => prog.element === 'physical')
      const assaultCritRate = Math.min(100, Math.max(0, janePanel.assaultCritRate ?? 0))
      const critCount = (physicalProg?.triggerCount ?? 0) * (assaultCritRate / 100)
      if (critCount > 0) {
        // 附伤随强击暴击触发 → 轴内易伤跟随物理强击触发轴内占比（用户口径 2026-08：
        // 6命附伤事件和动作绑定，理应该伴随计数并且吃易伤）；非轴回落全局覆盖率
        const janeStun = isAxis ? inWindowFraction('physical') : stunCoverage
        const janeStunMult = calcStunMultiplier(
          configStore.enemy.stunVuln,
          janePanel.stunDmgMultiplierBonus ?? 0,
          janePanel.stunDmgMultiplierBonusAlways ?? 0,
          janePanel.stunDmgMultiplierBonusCapAlways ?? 0,
          janeStun,
        )
        const perDamage = (janePanel.anomalyProficiency ?? 0) * 16 * janeStunMult
        rows.push({
          id: 'jane-c6-assault-followup',
          slot: janeSlot,
          agentId: configStore.team[janeSlot]?.agentId ?? '',
          agentName: agentName(configStore.team[janeSlot]?.agentId ?? '', janeSlot),
          type: '简6命附伤',
          name: '简6命强击暴击附伤',
          element: 'physical',
          source: '强击暴击后触发',
          count: critCount,
          perDamage,
          totalDamage: perDamage * critCount,
          note: `异常精通 ${fmt(janePanel.anomalyProficiency ?? 0)} × 1600%；按强击期望暴击次数 ${fmt(critCount, 2)} 次${isAxis ? ` · 易伤跟随物理强击轴内占比 ${fmt(janeStun, 2)}` : ''}`,
        })
      }
    }

    // ---- 爱丽丝六命决胜状态额外攻击 ----
    const aliceSlot = configStore.team.findIndex(char => {
      const agent = char.agentId ? catalogStore.getAgent(char.agentId) : null
      return agent?.id === '1401' || agent?.teammateBuffId === '1401'
    })
    const aliceCinema = configStore.team[aliceSlot]?.cinemaLevel ?? 0
    if (aliceSlot >= 0 && aliceCinema >= 6 && damagePanels[aliceSlot]) {
      const alicePanel = damagePanels[aliceSlot]
      const aliceResult = adjustedResourceResult?.characters.find(c => c.slot === aliceSlot)
      const smSrc = aliceResult?.aliceSwordWillSource

      if (smSrc && smSrc.sparkCount > 0) {
        // 状态进入次数 = sparkCount + ultimateCount（每次星芒圆舞曲#3 或终结技进入/刷新决胜状态）
        const ultimateCount = aliceResult.ultimateCount
        const stateEntries = smSrc.sparkCount + ultimateCount

        // 每状态额外攻击次数（默认5次；单轮最多6次，1秒CD）
        const perStateCount = configStore.getMechanicSetting('alice.cinema6PerStateCount', 5)

        // 总触发次数 = 状态进入次数 × 每次攻击次数
        const totalTriggers = stateEntries * perStateCount

        if (totalTriggers > 0) {
          // 附伤随决胜状态进入（SW3 1401012 / 终结技）触发 → 轴内易伤 = 状态进入的加权轴内占比
          // （用户口径 2026-08：6命附伤事件和动作绑定，理应该伴随计数并且吃易伤）；非轴回落全局覆盖率
          const sw3Frac = isAxis && smSrc.sparkCount > 0
            ? Math.max(0, Math.min(1, (allocMap[`${aliceSlot}:1401012`]?.inAxisUnits ?? 0) / smSrc.sparkCount))
            : stunCoverage
          const ultFrac = ultimateInAxisFraction(aliceSlot)
          const stateFrac = stateEntries > 0
            ? (smSrc.sparkCount * sw3Frac + ultimateCount * ultFrac) / stateEntries
            : stunCoverage
          const stunMult = calcStunMultiplier(
            configStore.enemy.stunVuln,
            alicePanel.stunDmgMultiplierBonus ?? 0,
            alicePanel.stunDmgMultiplierBonusAlways ?? 0,
            alicePanel.stunDmgMultiplierBonusCapAlways ?? 0,
            stateFrac,
          )
          // 必定暴击：damage = anomalyProficiency × 33 × (1 + critDmg/100)
          const proficiency = alicePanel.anomalyProficiency ?? 0
          const critDmg = alicePanel.critDmg ?? 50
          const perDamage = proficiency * 33 * (1 + critDmg / 100) * stunMult

          rows.push({
            id: 'alice-c6-decisive-extra-attack',
            slot: aliceSlot,
            agentId: configStore.team[aliceSlot]?.agentId ?? '',
            agentName: agentName(configStore.team[aliceSlot]?.agentId ?? '', aliceSlot),
            type: '爱丽丝6命附伤',
            name: '爱丽丝6命决胜状态额外攻击',
            element: 'physical',
            source: '三蓄/终结技进入决胜状态 → 全队攻击额外命中',
            count: totalTriggers,
            perDamage,
            totalDamage: perDamage * totalTriggers,
            note: `异常精通 ${fmt(proficiency)} × 3300% × 必定暴击(1+${fmt(critDmg)}%) → 单次 ${fmt(perDamage)} · 状态进入 ${stateEntries} 次 × 每次 ${perStateCount} 次 = ${totalTriggers} 次${isAxis ? ` · 易伤按状态进入加权轴内占比 ${fmt(stateFrac, 2)}（SW3 ${fmt(sw3Frac, 2)} / 终结 ${fmt(ultFrac, 2)}）` : ''}`,
          })
        }
      }
    }

    // ---- 爱丽丝被动 DOT（异常池 aliceCoweringDot 入池；畏缩/任意异常状态期间每 0.95s 强击伤害 2.5%） ----
    const coweringDot = anomalyPoolResult?.aliceCoweringDot
    if (aliceSlot >= 0 && coweringDot && coweringDot.totalDotDamage > 0) {
      rows.push({
        id: 'alice-cowering-dot',
        slot: aliceSlot,
        agentId: configStore.team[aliceSlot]?.agentId ?? '',
        agentName: agentName(configStore.team[aliceSlot]?.agentId ?? '', aliceSlot),
        type: '畏缩 DOT',
        name: '爱丽丝畏缩 DOT',
        element: 'physical',
        source: '畏缩状态 · 每 0.95s 强击伤害 2.5%',
        count: coweringDot.totalTicks,
        perDamage: coweringDot.dotDamagePerTick,
        totalDamage: coweringDot.totalDotDamage,
        note: `畏缩 DOT：每 ${coweringDot.dotInterval}s 造成强击伤害 ${coweringDot.dotRatio}% · ${fmt(coweringDot.totalTicks)} tick`,
      })
    }

    const remielleSlot = configStore.team.findIndex(char => {
      const agent = char.agentId ? catalogStore.getAgent(char.agentId) : null
      return agent?.id === '1581' || agent?.teammateBuffId === '1581'
    })
    if (remielleSlot >= 0 && damagePanels[remielleSlot] && remielleEntryPanels[remielleSlot]) {
      const remiellePanel = damagePanels[remielleSlot]
      const remielleEntryPanel = remielleEntryPanels[remielleSlot]
      const remielleSkills = catalogStore.getAgentSkills(configStore.team[remielleSlot]?.agentId ?? '')
      const otherSlots = [0, 1, 2].filter(slot => slot !== remielleSlot)
      const perSlotAnomaly = anomalyPoolResult?.perSlotAnomalyTriggers ?? []
      const voidflareBySlot = otherSlots
        .map(slot => ({
          slot,
          count: Math.max(0, Math.floor(perSlotAnomaly[slot] ?? 0)),
          element: catalogStore.getAgent(configStore.team[slot]?.agentId ?? '')?.damageElement ?? 'physical',
          panel: damagePanels[slot],
        }))
        .filter(item => item.count > 0 && item.panel)
      const voidflareTotal = voidflareBySlot.reduce((sum, item) => sum + item.count, 0)

      if (voidflareTotal > 0 && remielleSkills) {
        const skillLevelBonus = remiellePanel.skillLevelBonus ?? 0
        const c1ResIgnore = (remiellePanel.remielleCinema1SpecialVoidflareCount ?? 0) > 0 ? 50 : 0
        const c6LuminizeMultiplier = 1 + Math.max(0, remiellePanel.remielleCinema6LuminizeTriggerMultiplier ?? 0)
        const qBatches = Math.floor(voidflareTotal / 3)
        const firstOtherSlot = otherSlots[0]
        const secondOtherSlot = otherSlots[1]
        const firstPerBatch = otherSlots.length === 1
          ? 3
          : Math.max(0, Math.min(3, Math.floor(configStore.getTeamMechanicSetting(`remielle.q:${remielleSlot}`, 1))))
        const secondPerBatch = Math.max(0, 3 - firstPerBatch)
        const qCountBySlot: Record<string, number> = {}
        if (otherSlots.length === 1) {
          qCountBySlot[String(firstOtherSlot)] = qBatches * 3
        } else {
          qCountBySlot[String(firstOtherSlot)] = qBatches * firstPerBatch
          qCountBySlot[String(secondOtherSlot)] = qBatches * secondPerBatch
        }
        const actionRows = [
          {
            id: 'remielle-luminize-assist',
            name: '支援技花羽轮舞·耀变',
            moveId: '1581015',
            countsBySlot: Object.fromEntries(voidflareBySlot.map(item => [item.slot, item.count])),
          },
          {
            id: 'remielle-luminize-ultimate',
            name: '终结技缭乱终幕·耀变',
            moveId: '1581016',
            countsBySlot: qCountBySlot,
          },
          {
            id: 'remielle-luminize-basic',
            name: '普通攻击惊鸿·耀变',
            moveId: '1581008',
            countsBySlot: Object.fromEntries(voidflareBySlot.map(item => [item.slot, item.count * c6LuminizeMultiplier])),
          },
        ]

        for (const action of actionRows) {
          const move = findMoveById(remielleSkills, action.moveId)
          const luminizeRow = move?.rows.find(row => row.kind === 'luminizeMultiplier' || row.id === 'luminize_multiplier')
          const multiplier = getRemielleLevelValue(luminizeRow, skillLevelBonus)
          if (multiplier <= 0) continue
          const actionCount = Object.values(action.countsBySlot).reduce((a, b) => a + b, 0)
          if (actionCount <= 0) continue

          for (const item of voidflareBySlot) {
            const count = action.countsBySlot[String(item.slot)] ?? 0
            if (count <= 0 || !item.panel) continue
            const result = calcVoidflareDamage({
              sourcePanel: item.panel,
              remiellePanel,
              multiplier,
              element: item.element,
              enemyDefense: configStore.enemy.defense,
              enemyResistances: enemyDamageRes,
              stunMultiplier: configStore.enemy.stunVuln,
              stunned: stunCoverage,
              cinema1ResIgnore: c1ResIgnore,
            })
            rows.push({
              id: `${action.id}-${item.slot}`,
              slot: remielleSlot,
              agentId: configStore.team[remielleSlot]?.agentId ?? '',
              agentName: agentName(configStore.team[remielleSlot]?.agentId ?? '', remielleSlot),
              type: '耀变',
              name: action.name,
              element: item.element,
              source: `${agentName(configStore.team[item.slot]?.agentId ?? '', item.slot)} 的${elementLabel(item.element)}异常虚耀`,
              count,
              perDamage: result.damage,
              totalDamage: result.damage * count,
              note: `来源虚耀 ${count} 次 · ${result.formula}`,
            })
          }
        }

        const specialCount = remielleSpecialVoidflareCount(remiellePanel)
        if (specialCount > 0) {
          const rainbowMove = findMoveById(remielleSkills, '1581007')
          const rainbowLuminizeRow = rainbowMove?.rows.find(row => row.kind === 'luminizeMultiplier' || row.id === 'luminize_multiplier')
          const rainbowMultiplier = getRemielleLevelValue(rainbowLuminizeRow, skillLevelBonus)
          const specialMultiplier = rainbowMultiplier * 2.5
          if (specialMultiplier > 0) {
            const result = calcVoidflareDamage({
              sourcePanel: remielleEntryPanel,
              remiellePanel: remielleEntryPanel,
              multiplier: specialMultiplier,
              element: 'lumiflux',
              enemyDefense: configStore.enemy.defense,
              enemyResistances: enemyDamageRes,
              stunMultiplier: configStore.enemy.stunVuln,
              stunned: stunCoverage,
              cinema1ResIgnore: c1ResIgnore,
            })
            rows.push({
              id: 'remielle-special-voidflare',
              slot: remielleSlot,
              agentId: configStore.team[remielleSlot]?.agentId ?? '',
              agentName: agentName(configStore.team[remielleSlot]?.agentId ?? '', remielleSlot),
              type: '特殊虚耀',
              name: '普通攻击垂虹·特殊虚耀',
              element: 'lumiflux',
              source: '蕾米进场记录面板 × 2.5 特殊独立乘区',
              count: specialCount,
              perDamage: result.damage,
              totalDamage: result.damage * specialCount,
              note: `垂虹倍率 ${fmt(rainbowMultiplier)}% × 2.5 · ${result.formula}`,
            })
          }
        }
      }
    }

  return rows.filter(row => row.totalDamage > 0)
}
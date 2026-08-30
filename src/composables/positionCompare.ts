/**
 * 位置对比（预设队伍 × 各自预设轴 × 单个位置）
 *
 * 目标：回答「某个位置（主C / 击破手 / 辅助）选谁」——同一支队伍只换该位置的角色，
 * 按各自的预设轴跑完整局计算，横向对比该位置角色的贡献构成：
 *
 *   - 击破手 / 辅助（非输出位）：
 *       · 自身直伤：damagePoolRows 中该槽位、非赠送（source != 'gift'）的行
 *       · 送连携/赠送：source === 'gift' 的行（诺姆膛温换连携、琉音好评转大等白送动作）
 *       · 拐力提升（差分）：关掉该角色 teammate-buffs 后重算总伤，差值即拐力贡献
 *         （含失衡易伤/增伤/减抗及其带来的失衡次数变化）
 *       · 其他：总伤 − 自身 − 送连携 − 拐力（队友伤害 + 失衡送连携等）
 *   - 主C（输出位）：自身总伤拆成 直伤 / 异放 / 紊乱 / 其他异常 四块（其余异常 =
 *     灼烧/感电/侵蚀/风化/强击/碎冰/乱流/耀变/极性强击/极性紊乱/畏缩DOT 等），
 *     另加 失衡值/占比 与 积蓄量/占比。
 *
 * 对比基准（用户口径）：各自用预设队伍 + 自动匹配的预设轴（不同位置角色轴不同——
 * 如琉音必须有琉音转大轴，换人不同轴是预期行为）。
 *
 * 同款限定金数（用户口径）：所有参比队伍按同一金档应用各自预设 goldSteps
 * （options.gold，缺省 6），复用队伍对比页 applyGoldSteps——公平比较「换该位置」的边际。
 *
 * 位置识别按 specialty：主C = attack/anomaly/rupture；击破手 = stun；辅助 = support/defense。
 * 无对应位置角色时跳过该队伍（如 2 异常 + 1 击破 的队伍没有 support）。
 *
 * 失衡占比：该槽位失衡 / 全队失衡（失衡池 perSlotStun），后台自动招式
 * （莱卡恩围猎闪反/橘福福虎威/露西/丽娜邦布/仪玄合轴等）的 daze 已计入分子分母。
 *
 * 积蓄占比：按「异属性赠送归接收人」口径逐槽归因（与资源池页 teamOverview 同口径）——
 * 赋彩/赠送等异属性贡献（贡献元素 ≠ 角色伤害元素）记在该元素同属性主贡献者槽，不记赠送者。
 */
import { useConfigStore } from '@/stores/config'
import { useCatalogStore } from '@/stores/catalog'
import type { BossPreset, BossPresetPhase } from '@/types/bossPreset'
import type { TeamPreset } from '@/types/teamPreset'
import type { AnomalyPoolResult } from '@/types/resource'
import { applyGoldSteps, baseGoldOf, applyAxisBinding } from '@/composables/teamCompare'

type Calc = ReturnType<typeof import('@/composables/useResourceCalc').useResourceCalc>

/** 对比位置 */
export type ComparePosition = 'main' | 'breaker' | 'support'

/** 主C 职业：直伤型 / 异常型 / 命破型 */
const MAIN_SPECIALTIES = new Set(['attack', 'anomaly', 'rupture'])

export interface PositionCompareRow {
  presetId: string
  presetName: string
  position: ComparePosition
  agentId: string
  agentName: string
  slot: number

  /** 失衡次数（团队级，来自失衡池） */
  stunCount: number
  /** 全队总伤 */
  totalDamage: number

  /** 该位置自身伤害（该槽位、非赠送的行） */
  selfDamage: number
  /** 送连携/赠送（source='gift' 行，全队口径） */
  giftDamage: number
  /** 拐力提升（差分）：关掉该角色 teammate-buffs 重算的总伤差值 */
  buffContribution: number
  /** 其他（队友伤害等） */
  otherDamage: number

  /** 主C 视角：selfDamage 的构成拆解（非输出位同样计算，供展示/调试） */
  directDamage: number
  releaseDamage: number
  disorderDamage: number
  anomalyOtherDamage: number

  /** 该位置失衡值（含后台自动招式贡献） */
  daze: number
  /** 失衡占全队失衡比例（%） */
  dazeShare: number
  /** 该位置积蓄量（异属性赠送归接收人口径） */
  buildUp: number
  /** 积蓄占全队积蓄比例（%） */
  buildUpShare: number
}

/** 识别某位置的角色槽位（按 specialty），无则 -1 */
export function findPositionSlot(
  team: { agentId?: string | null }[],
  catalogStore: ReturnType<typeof useCatalogStore>,
  position: ComparePosition,
): number {
  for (let s = 0; s < team.length; s++) {
    const spec = catalogStore.getAgent(team[s]?.agentId ?? '')?.specialty ?? ''
    if (position === 'main' && MAIN_SPECIALTIES.has(spec)) return s
    if (position === 'breaker' && spec === 'stun') return s
    if (position === 'support' && (spec === 'support' || spec === 'defense')) return s
  }
  return -1
}

/**
 * 逐槽积蓄归因（与资源池页 teamOverview 同口径）：
 * 异属性赠送/赋彩贡献（贡献元素 ≠ 角色伤害元素）记在接收人头上（该元素同属性主贡献者槽），
 * 不记赠送者。返回 [槽0, 槽1, 槽2] 的有效积蓄贡献。
 */
export function computePerSlotBuildUp(
  anomalyPoolResult: AnomalyPoolResult | null,
  team: { agentId?: string | null }[],
  catalogStore: ReturnType<typeof useCatalogStore>,
): number[] {
  const perSlot = [0, 0, 0]
  for (const prog of anomalyPoolResult?.perElement ?? []) {
    // 接收人槽 = 该元素同属性（非赠送）贡献者中积蓄最大的槽
    let receiverSlot = -1
    const receivers = (prog.contributions ?? []).filter(c => {
      const el = catalogStore.getAgent(team[c.slot]?.agentId ?? '')?.damageElement
      return el === prog.element
    })
    if (receivers.length > 0) {
      receiverSlot = receivers.reduce((max, c) => (c.totalBuildUp > max.totalBuildUp ? c : max)).slot
    }
    for (const contrib of prog.contributions ?? []) {
      const agentEl = catalogStore.getAgent(team[contrib.slot]?.agentId ?? '')?.damageElement
      const gifted = !!agentEl && contrib.element !== agentEl
      const targetSlot = gifted && receiverSlot >= 0 ? receiverSlot : contrib.slot
      perSlot[targetSlot] = (perSlot[targetSlot] ?? 0) + contrib.totalBuildUp
    }
  }
  return perSlot
}

function snapshotStore(configStore: ReturnType<typeof useConfigStore>) {
  return {
    team: JSON.parse(JSON.stringify(configStore.team)),
    enemy: JSON.parse(JSON.stringify(configStore.enemy)),
    appliedBoss: configStore.appliedBoss,
    stunAxes: JSON.parse(JSON.stringify(configStore.stunAxes)),
    stunAxisPlans: JSON.parse(JSON.stringify(configStore.stunAxisPlans)),
    useStunAxis: configStore.useStunAxis,
    globalBuffs: JSON.parse(JSON.stringify(configStore.globalBuffs)),
    buffSelections: JSON.parse(JSON.stringify(configStore.teammateBuffSelections)),
  }
}

function restoreStore(configStore: ReturnType<typeof useConfigStore>, snap: ReturnType<typeof snapshotStore>) {
  configStore.team.splice(0, configStore.team.length, ...snap.team)
  configStore.setEnemy(snap.enemy)
  configStore.appliedBoss = snap.appliedBoss
  configStore.stunAxes.splice(0, configStore.stunAxes.length, ...(snap.stunAxes as never[]))
  configStore.stunAxisPlans.splice(0, configStore.stunAxisPlans.length, ...(snap.stunAxisPlans as never[]))
  configStore.useStunAxis = snap.useStunAxis
  configStore.globalBuffs.splice(0, configStore.globalBuffs.length, ...(snap.globalBuffs as never[]))
  const selections = configStore.teammateBuffSelections as Record<string, { enabled: boolean; coverage: number }>
  for (const key of Object.keys(selections)) delete selections[key]
  Object.assign(selections, snap.buffSelections)
}

function applyTeamToStore(configStore: ReturnType<typeof useConfigStore>, preset: TeamPreset) {
  for (let slot = 0; slot < 3; slot++) {
    configStore.setAgent(slot, preset.team[slot])
    if (preset.wEngines?.[slot]) configStore.setWEngine(slot, preset.wEngines[slot])
    const dd = preset.driveDiscs?.[slot]
    if (dd) {
      if (dd.fourPieceSetId) configStore.setFourPieceSet(slot, dd.fourPieceSetId)
      if (dd.twoPieceSetId) configStore.setTwoPieceSet(slot, dd.twoPieceSetId)
      for (const [pos, stat] of Object.entries(dd.mainStats ?? {})) {
        configStore.setMainStat(slot, Number(pos) as 4 | 5 | 6, stat)
      }
    }
    if (preset.chainCountPerStun) configStore.setChainCountPerStun(slot, preset.chainCountPerStun[slot])
    if (preset.basicAttackTimeWeight) configStore.setBasicAttackTimeWeight(slot, preset.basicAttackTimeWeight[slot])
  }
  for (const it of preset.interactions) {
    const slot = it.slot ?? 0
    if (it.type === 'parry') configStore.setParryCount(slot, it.count)
    else if (it.type === 'dodge') configStore.setDodgeCounterCount(slot, it.count)
    else if (it.type === 'quickAssist') configStore.setQuickAssistCount(slot, it.count)
    else if (it.type === 'block') configStore.setBlockCount(slot, it.count)
  }
}

export function computePositionCompare(
  calc: Calc,
  presets: TeamPreset[],
  boss: BossPreset,
  phase: BossPresetPhase,
  options: { gold?: number; position?: ComparePosition } = {},
): PositionCompareRow[] {
  const configStore = useConfigStore()
  const catalogStore = useCatalogStore()
  const position = options.position ?? 'breaker'
  const snap = snapshotStore(configStore)
  const out: PositionCompareRow[] = []
  try {
    const gold = options.gold ?? 6
    for (const preset of presets) {
      applyTeamToStore(configStore, preset)
      // 同款限定金数：所有参比队伍按同一金档应用预设 goldSteps（复用队伍对比页 applyGoldSteps 口径）
      const applied = applyGoldSteps(
        preset.goldSteps,
        gold,
        baseGoldOf(preset),
        preset.standardSteps ?? [],
        preset.wEngines ?? [],
      )
      for (let slot = 0; slot < 3; slot++) {
        configStore.setCinemaLevel(slot, applied.cinemas[slot])
        configStore.setWEngineModLevel(slot, applied.wengineMods[slot])
        if (applied.wEngines[slot]) configStore.setWEngine(slot, applied.wEngines[slot])
      }
      // 各自预设轴：先恢复快照轴状态，再按 preset.stunAxisPresetId 绑定变体轴（适用 5火10大 等变体）
      configStore.stunAxes.splice(0, configStore.stunAxes.length, ...(JSON.parse(JSON.stringify(snap.stunAxes)) as never[]))
      configStore.stunAxisPlans.splice(0, configStore.stunAxisPlans.length, ...(JSON.parse(JSON.stringify(snap.stunAxisPlans)) as never[]))
      configStore.useStunAxis = snap.useStunAxis
      applyAxisBinding(configStore, { stunAxes: snap.stunAxes, stunAxisPlans: snap.stunAxisPlans, useStunAxis: snap.useStunAxis }, preset)
      configStore.syncTeammateBuffsFromTeam()
      configStore.applyBossPreset({ id: boss.id }, phase, boss.monster, boss.defaults)

      // 识别目标位置角色
      const team = configStore.team.map(c => ({ agentId: c?.agentId ?? null }))
      const posSlot = findPositionSlot(team, catalogStore, position)
      if (posSlot < 0) continue
      const agentId = configStore.team[posSlot]?.agentId ?? ''
      const agentName = catalogStore.getAgent(agentId)?.name?.zhCN ?? agentId

      const total = calc.teamTotalDamage.value
      const rows = calc.damagePoolRows.value
      const selfDamage = rows
        .filter(r => r.slot === posSlot && r.sourceTag !== 'gift')
        .reduce((sum, r) => sum + r.totalDamage, 0)
      const giftDamage = rows
        .filter(r => r.sourceTag === 'gift')
        .reduce((sum, r) => sum + r.totalDamage, 0)
      // 自身伤害构成拆解（直伤 / 异放 / 紊乱 / 其余异常；均限非赠送行，与 selfDamage 口径一致）
      const directDamage = rows
        .filter(r => r.slot === posSlot && r.sourceTag !== 'gift' && r.type === '直伤')
        .reduce((sum, r) => sum + r.totalDamage, 0)
      const releaseDamage = rows
        .filter(r => r.slot === posSlot && r.sourceTag !== 'gift' && r.type === '异放')
        .reduce((sum, r) => sum + r.totalDamage, 0)
      const disorderDamage = rows
        .filter(r => r.slot === posSlot && r.sourceTag !== 'gift' && r.type === '紊乱')
        .reduce((sum, r) => sum + r.totalDamage, 0)
      const anomalyOtherDamage = Math.max(0, selfDamage - directDamage - releaseDamage - disorderDamage)

      // 拐力差分：仅非输出位（主C 的 buff 多为自拐，非「拐队友」，差分无对比意义且多一倍全量重算）
      let buffContribution = 0
      if (position !== 'main') {
        const group = catalogStore.getTeammateBuffGroup(agentId)
        if (group) {
          for (const buff of group.buffs ?? []) {
            configStore.toggleTeammateBuff(buff.id, false)
          }
          configStore.refreshTrigger++
          const withoutBuff = calc.teamTotalDamage.value
          buffContribution = Math.max(0, total - withoutBuff)
          // 恢复该角色 buff（其余保持）
          for (const buff of group.buffs ?? []) {
            configStore.toggleTeammateBuff(buff.id, true)
          }
          configStore.refreshTrigger++
        }
      }

      const pool = calc.stunPoolResult?.value
      const stunCount = pool?.stunCount ?? 0
      // 逐槽失衡（含后台自动招式贡献）：该槽占比 = 该槽 / 全队合计
      const perSlot = pool?.perSlotStun ?? []
      const daze = perSlot[posSlot] ?? 0
      const totalDaze = perSlot.reduce((sum, v) => sum + v, 0)
      const dazeShare = totalDaze > 0 ? Math.round((daze / totalDaze) * 10000) / 100 : 0

      // 逐槽积蓄（异属性赠送归接收人口径）
      const perSlotBuildUp = computePerSlotBuildUp(calc.anomalyPoolResult.value, team, catalogStore)
      const buildUp = perSlotBuildUp[posSlot] ?? 0
      const totalBuildUp = perSlotBuildUp.reduce((sum, v) => sum + v, 0)
      const buildUpShare = totalBuildUp > 0 ? Math.round((buildUp / totalBuildUp) * 10000) / 100 : 0

      out.push({
        presetId: preset.id,
        presetName: preset.name,
        position,
        agentId,
        agentName,
        slot: posSlot,
        stunCount,
        totalDamage: total,
        selfDamage,
        giftDamage,
        buffContribution,
        otherDamage: Math.max(0, total - selfDamage - giftDamage - buffContribution),
        directDamage,
        releaseDamage,
        disorderDamage,
        anomalyOtherDamage,
        daze,
        dazeShare,
        buildUp,
        buildUpShare,
      })
    }
  } finally {
    restoreStore(configStore, snap)
  }
  return out
}

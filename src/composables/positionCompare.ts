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
import { applyBossRoom } from '@/composables/bossRoom'
import { useCatalogStore } from '@/stores/catalog'
import type { BossPreset, BossPresetPhase } from '@/types/bossPreset'
import type { TeamPreset } from '@/types/teamPreset'
import type { AnomalyPoolResult } from '@/types/resource'
import { applyGoldToStore, applyAxisBinding, applyTeamToStore } from '@/composables/teamCompare' // CC-254：原私有副本漏 tauntCancel
import type { AnalysisContext } from '@/composables/analysisScenario'

/** 对比位置 */
/**
 * 对比位置 = **槽位号**（T180，用户口径 2026-10-16）。
 *
 * ## 沿革（为什么从「职业」改成「号位」）
 *
 * 原为 `'main' | 'breaker' | 'support'`（按**职业**选人），用户指出：
 * > 「位置对比中，分的职业，但是如果**多个同职业角色在同队就不能分辨了，不智能**，
 * >   希望改成**几号位的自由对比**。」
 *
 * 实测该缺陷真实：全库 **28+ 支预设队含同职业重复**（如 `auto-1541-1561-1581` 三人**全是
 * `anomaly`**），而原 `findPositionSlot` 遍历时**返回第一个匹配槽位** ⇒ 同职业时永远只认第一个，
 * 用户无法选另一个人。
 *
 * ⇒ 现按**槽位**（0/1/2 = 1/2/3 号位）自由对比，**无歧义**。
 * 展示名由页面按「该槽实际是谁」动态给出（见 `PositionComparePage#positionLabel`）。
 */
export type ComparePosition = 0 | 1 | 2

/** 主C 职业：直伤型 / 异常型 / 命破型（用途：判「该槽是否本队主C」⇒ 决定要不要算拐力差分与伤害构成列） */
export const MAIN_SPECIALTIES = new Set(['attack', 'anomaly', 'rupture'])

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
/**
 * 目标槽位（T180：**直接用号位**，不再按职业猜）。
 *
 * ⚠ 修前是按职业遍历 + 返回**第一个**匹配 ⇒ 同队两个同职业时用户无法选后者
 * （全库 28+ 支预设队有这种情况，如 `auto-1541-1561-1581` 三人全是 `anomaly`）。
 * 现 `position` 本身就是槽位号 ⇒ 直接返回；越界/该槽为空 ⇒ -1（调用方跳过该队）。
 */
function findPositionSlot(
  team: { agentId?: string | null }[],
  position: ComparePosition,
): number {
  if (position < 0 || position >= team.length) return -1
  return team[position]?.agentId ? position : -1
}

/**
 * 逐槽积蓄归因（与资源池页 teamOverview 同口径）：
 * 异属性赠送/赋彩贡献（贡献元素 ≠ 角色伤害元素）记在接收人头上（该元素同属性主贡献者槽），
 * 不记赠送者。返回 [槽0, 槽1, 槽2] 的有效积蓄贡献。
 */
export function computePerSlotBuildUp(
  anomalyPoolResult: AnomalyPoolResult | null,
  team: { agentId?: string | null }[],
  catalogStore: { getAgent: (agentId: string) => { damageElement?: string } | undefined },
): number[] {
  const perSlot = [0, 0, 0]
  for (const prog of anomalyPoolResult?.perElement ?? []) {
    // 接收人槽 = 该元素同属性（非赠送）贡献者中积蓄最大的槽
    let receiverSlot = -1
    const receivers = prog.contributions.filter(c => {
      const el = catalogStore.getAgent(team[c.slot]?.agentId ?? '')?.damageElement
      return el === prog.element
    })
    if (receivers.length > 0) {
      receiverSlot = receivers.reduce((max, c) => (c.totalBuildUp > max.totalBuildUp ? c : max)).slot
    }
    for (const contrib of prog.contributions) {
      const agentEl = catalogStore.getAgent(team[contrib.slot]?.agentId ?? '')?.damageElement
      const gifted = !!agentEl && contrib.element !== agentEl
      const targetSlot = gifted && receiverSlot >= 0 ? receiverSlot : contrib.slot
      perSlot[targetSlot] = (perSlot[targetSlot] ?? 0) + contrib.totalBuildUp
    }
  }
  return perSlot
}

export function computePositionCompare(
  scenario: AnalysisContext,
  presets: TeamPreset[],
  boss: BossPreset,
  phase: BossPresetPhase,
  options: { gold?: number; position?: ComparePosition } = {},
): PositionCompareRow[] {
  const { config: configStore, calc } = scenario
  const catalogStore = useCatalogStore()
  const position = options.position ?? 1
  const baseAxis = configStore.getAxisState()
  const out: PositionCompareRow[] = []
  const gold = options.gold ?? 6
  for (const preset of presets) {
    applyTeamToStore(configStore, preset)
    // 同款限定金数：所有参比队伍按同一金档应用预设 goldSteps（复用队伍对比页 applyGoldToStore 口径，CC-337）
    applyGoldToStore(configStore, preset, gold)
    // 各自预设轴：applyAxisBinding 内部先恢复快照轴状态，再按 preset.stunAxisPresetId 绑定变体轴（CC-337 删重复恢复）
    applyAxisBinding(configStore, baseAxis, preset)
    configStore.syncTeammateBuffsFromTeam()
    applyBossRoom(configStore, boss, phase)

    // 识别目标位置角色
    const team = configStore.team.map(c => ({ agentId: c.agentId }))
    const posSlot = findPositionSlot(team, position)
    if (posSlot < 0) continue
    const agentId = configStore.team[posSlot]?.agentId ?? ''
    const agentName = catalogStore.agentName(agentId)

    // CC-339：第一次计算（真实队友增益下）一次性读取总伤、伤害明细、失衡池、异常积蓄池，
    // 避免拐力差分关/开 buff 后触发第 3 次全量引擎求值，也防止盲目全开 group.buffs 绕过命座/额外能力门控污染失衡与积蓄
    const total = calc.teamTotalDamage.value
    const rows = calc.damagePoolRows.value
    const pool = calc.stunPoolResult.value
    const anomalyPool = calc.anomalyPoolResult.value
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

    /**
     * 拐力差分：仅**非主C位**（主C 的 buff 多为自拐，非「拐队友」，差分无对比意义且多一倍全量重算）。
     *
     * ⚠ T180 口径变更：原判据是 `position !== 'main'`（职业语义）。
     * 现 `position` 是槽位号 ⇒ 改为**该槽是不是本队的主C**——
     * 判据 = 「该槽角色职业 ∈ `MAIN_SPECIALTIES`」，与队伍顺序无关
     * （用户要的是「几号位自由对比」，所以「1 号位」不等于「主C」）。
     */
    const posIsMain = MAIN_SPECIALTIES.has(
      catalogStore.getAgent(agentId)?.specialty ?? '',
    )
    let buffContribution = 0
    if (!posIsMain) {
      const group = catalogStore.getTeammateBuffGroup(agentId)
      if (group && group.buffs.length > 0) {
        for (const buff of group.buffs) {
          configStore.toggleTeammateBuff(buff.id, false)
        }
        const withoutBuff = calc.teamTotalDamage.value
        buffContribution = Math.max(0, total - withoutBuff)
        // CC-339：按队伍真实门控（命座 / 额外能力 / 排他门）重同步恢复，禁止无条件全开 group.buffs
        configStore.syncTeammateBuffsFromTeam()
      }
    }

    const stunCount = pool?.stunCount ?? 0
    // 逐槽失衡（含后台自动招式贡献）：该槽占比 = 该槽 / 全队合计
    const perSlot = pool?.perSlotStun ?? []
    const daze = perSlot[posSlot] ?? 0
    const totalDaze = perSlot.reduce((sum, v) => sum + v, 0)
    const dazeShare = totalDaze > 0 ? Math.round((daze / totalDaze) * 10000) / 100 : 0

    // 逐槽积蓄（异属性赠送归接收人口径）
    const perSlotBuildUp = computePerSlotBuildUp(anomalyPool, team, catalogStore)
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
  return out
}

/**
 * 击破手对比（预设队伍 × 各自预设轴）
 *
 * 目标：同队伍换击破手（如诺姆↔琉音），对比每个击破手队伍的总伤构成：
 *   - 击破手自身直伤：damagePoolRows 中击破手槽位、非赠送（source != 'gift'）的行
 *   - 送连携/赠送：source === 'gift' 的行（诺姆膛温换连携=上一位队友本人连携技、琉音好评转大等）
 *   - 拐力提升（差分）：关掉击破手 teammate-buffs 重算，总伤差值（含失衡易伤/增伤/减抗，
 *     自然包含拐力带来的失衡次数变化）
 *   - 其他：总伤 − 自身 − 送连携 − 拐力（队友伤害 + 失衡送连携等）
 *
 * 对比基准（用户口径）：各自用预设队伍 + 自动匹配的预设轴（不同击破手轴不同——
 * 如琉音必须有琉音转大轴，换人不同轴是预期行为）。
 */
import { useConfigStore } from '@/stores/config'
import { useCatalogStore } from '@/stores/catalog'
import type { BossPreset, BossPresetPhase } from '@/types/bossPreset'
import type { TeamPreset } from '@/types/teamPreset'

type Calc = ReturnType<typeof import('@/composables/useResourceCalc').useResourceCalc>

export interface BreakerBreakdown {
  presetId: string
  presetName: string
  breakerAgentId: string
  breakerName: string
  breakerSlot: number
  totalDamage: number
  selfDamage: number
  giftDamage: number
  buffContribution: number
  otherDamage: number
  stunCount: number
}

function snapshotStore(configStore: ReturnType<typeof useConfigStore>) {
  return {
    team: JSON.parse(JSON.stringify(configStore.team)),
    enemy: JSON.parse(JSON.stringify(configStore.enemy)),
    appliedBoss: configStore.appliedBoss,
    stunAxes: JSON.parse(JSON.stringify(configStore.stunAxes)),
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
  configStore.useStunAxis = snap.useStunAxis
  configStore.globalBuffs.splice(0, configStore.globalBuffs.length, ...(snap.globalBuffs as never[]))
  const selections = configStore.teammateBuffSelections as Record<string, { enabled: boolean; coverage: number }>
  for (const key of Object.keys(selections)) delete selections[key]
  Object.assign(selections, snap.buffSelections)
}

/** 应用预设队伍（含装备/交互），不应用金数/buff 牌——保持与队伍对比页同口径 */
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

export function computeBreakerCompare(
  calc: Calc,
  presets: TeamPreset[],
  boss: BossPreset,
  phase: BossPresetPhase,
): BreakerBreakdown[] {
  const configStore = useConfigStore()
  const catalogStore = useCatalogStore()
  const snap = snapshotStore(configStore)
  const out: BreakerBreakdown[] = []
  try {
    for (const preset of presets) {
      applyTeamToStore(configStore, preset)
      // 各自预设轴：不手动设轴，队伍满 3 人自动匹配 stunAxisPresets（selectAutoStunAxisPreset）
      configStore.useStunAxis = false
      configStore.stunAxes.splice(0, configStore.stunAxes.length)
      configStore.syncTeammateBuffsFromTeam()
      configStore.applyBossPreset({ id: boss.id }, phase, boss.monster, boss.defaults)

      // 识别击破手（specialty = stun）
      let breakerSlot = -1
      let breakerId = ''
      for (let s = 0; s < 3; s++) {
        const agent = catalogStore.getAgent(configStore.team[s]?.agentId ?? '')
        if (agent?.specialty === 'stun') { breakerSlot = s; breakerId = agent.id; break }
      }
      if (breakerSlot < 0) continue
      const breakerName = catalogStore.getAgent(breakerId)?.name?.zhCN ?? breakerId

      const total = calc.teamTotalDamage.value
      const rows = calc.damagePoolRows.value
      const selfDamage = rows
        .filter(r => r.slot === breakerSlot && r.sourceTag !== 'gift')
        .reduce((sum, r) => sum + r.totalDamage, 0)
      const giftDamage = rows
        .filter(r => r.sourceTag === 'gift')
        .reduce((sum, r) => sum + r.totalDamage, 0)

      // 拐力差分：关掉击破手 teammate-buffs 组 → 重算 → 差值
      const breakerGroup = catalogStore.getTeammateBuffGroup(breakerId)
      let buffContribution = 0
      if (breakerGroup) {
        for (const buff of breakerGroup.buffs ?? []) {
          configStore.toggleTeammateBuff(buff.id, false)
        }
        configStore.refreshTrigger++
        const withoutBuff = calc.teamTotalDamage.value
        buffContribution = Math.max(0, total - withoutBuff)
        // 恢复击破手 buff（其余保持）
        for (const buff of breakerGroup.buffs ?? []) {
          configStore.toggleTeammateBuff(buff.id, true)
        }
        configStore.refreshTrigger++
      }

      const stunCount = calc.stunPoolResult?.value?.stunCount ?? 0
      out.push({
        presetId: preset.id,
        presetName: preset.name,
        breakerAgentId: breakerId,
        breakerName,
        breakerSlot,
        totalDamage: total,
        selfDamage,
        giftDamage,
        buffContribution,
        otherDamage: Math.max(0, total - selfDamage - giftDamage - buffContribution),
        stunCount,
      })
    }
  } finally {
    restoreStore(configStore, snap)
  }
  return out
}

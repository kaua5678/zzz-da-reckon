/**
 * Boss 阶段 buff 效果的一行文字描述（BossCard / BossSelectCard 共用）。
 * CC-214 前两张卡各有一份逐字相同的 effectLabel + STAT_LABELS + statLabelOf（30 行），元素名另写一份 EL_ZH。
 * 元素中文名走 `@/utils/agentLabelMaps#damageElementLabel`。
 */
import type { PhaseBuffEffect } from '@/types/bossPreset'
import { damageElementLabel } from '@/utils/agentLabelMaps'

export function bossBuffEffectLabel(e: PhaseBuffEffect): string {
  const cond: string[] = []
  if (e.cond?.countTier) cond.push(`${e.cond.countTier.specialty}${e.cond.countTier.thresholds[0]}/${e.cond.countTier.thresholds[1]}名`)
  if (e.cond?.specialty) cond.push(`${e.cond.specialty}限定`)
  const unit = e.stat === 'anomalyProficiency' ? '点' : '%'
  const parts = [statLabelOf(e.stat), `+${e.value}${unit}`]
  if (e.targetSkillType) parts.push(`→${e.targetSkillType}`)
  if (cond.length) parts.push(`[${cond.join('，')}]`)
  return parts.join(' ')
}

const STAT_LABELS: Record<string, string> = {
  critDmg: '暴伤', critRate: '暴击率', atkPct: '攻击%', anomalyProficiency: '精通',
  anomalyDmgBonus: '异常伤', anomalyBuildUpEfficiency: '积蓄效率',
  disorderDamageBonus: '紊乱伤', anomalyReleaseDmgBonus: '异放伤', turbulenceDamageBonus: '乱流伤',
  enemyResReduction: '全减抗', enemyDefReduction: '减防',
  stunDmgMultiplierBonus: '失衡易伤', enemyDamageTakenBonus: '易伤', enemyCritDmgTakenBonus: '受暴伤',
  sheerDmgBonus: '贯穿伤', sharpDmgBonus: '锐化伤', sharpCritDmg: '锐暴', penRatio: '穿透率',
  defPct: '防御%', hpPct: '生命%', stunBuildUpBonus: '失衡值', skillDmgBonus: '招式伤', dmgBonus: '伤害',
  decibelGainEfficiency: '喧响效率', energyGainEfficiency: '能量效率', flashEnergyGainEfficiency: '闪能效率',
}
function statLabelOf(stat: string): string {
  if (STAT_LABELS[stat]) return STAT_LABELS[stat]
  const el = stat.match(/^(physical|fire|ice|electric|ether|wind)Dmg$/)
  if (el) return `${damageElementLabel(el[1])}伤`
  const res = stat.match(/^enemy(Physical|Fire|Ice|Electric|Ether|Wind)ResReduction$/)
  if (res) return `${damageElementLabel(res[1].toLowerCase())}减抗`
  return stat
}

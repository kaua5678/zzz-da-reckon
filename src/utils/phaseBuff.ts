/**
 * 危局 buff 牌（当期可选牌 `selectable_buff` / 关卡固有 `layer_buff`）进计算的**唯一口径**（CC-341）。
 *
 * 解析器（`scripts/phase-buff-parser.mjs`）给效果带 `cond`：特性限定（二元）与特性人数分档。CC-341 前，
 * 条件只在队伍对比（`teamCompare#resolveBuffEffect`）写入全局 Buff 表**之前**按预设队伍解析；
 * 关卡固有 buff（`runArchiveDeploy#applyBossLayerBuffs`）与实战部署页的当期牌（`applyPeriodBuff`）
 * 写行时把 `cond` 丢掉 ⇒ 条件效果对任何队伍都满额生效（如 40003 在 690431 / 690441 两期的
 * 「强攻限定」暴伤 +60% / 攻击 +20% / 穿透率 +25% / 全减抗 10%，非强攻队照吃）。
 *
 * 现在的分工：
 * - 写入方只做「牌 → 行」映射（`phaseBuffRows`），**带上 `cond`**，不看队伍；
 * - 管线在 `resolveSlotPanelBuffInputs` 按**当前队伍**调 `resolvePhaseBuffValue` 解析（换人、批处理逐队求值都自动正确）；
 * - 调试页按同一函数展示「实际生效值」。
 * testOnly（测试服占位牌）是否写入由各调用方决定，不在这里判。
 */
import type { PhaseBuffCard, PhaseBuffEffect } from '@/types/bossPreset'
import type { SkillDamageTarget } from '@/types/catalog'
import { SPECIALTY_LABEL } from '@/utils/agentLabelMaps'

export type PhaseBuffCond = NonNullable<PhaseBuffEffect['cond']>

/** 解析器产出的特性中文名 → 引擎 specialty code：由 `SPECIALTY_LABEL` 反查（单一来源，CC-341 删 teamCompare 的手写反表）。 */
const SPECIALTY_CODE_OF_LABEL: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(SPECIALTY_LABEL).map(([code, label]) => [label, code]),
)

/** 特性中文名 → specialty code；未收录的名字原样返回（因此永远匹配不到在场角色 ⇒ 条件不成立）。 */
export function specialtyCodeOfLabel(label: string): string {
  return SPECIALTY_CODE_OF_LABEL[label] ?? label
}

/** 在场角色的 specialty code 列表（空槽 / 目录查不到的角色不计）。 */
export function teamSpecialtiesOf(
  team: ReadonlyArray<{ agentId?: string } | null | undefined>,
  specialtyOf: (agentId: string) => string | undefined,
): string[] {
  const out: string[] = []
  for (const member of team) {
    const specialty = member?.agentId ? specialtyOf(member.agentId) : undefined
    if (specialty) out.push(specialty)
  }
  return out
}

/**
 * 危局 buff 牌效果条件的**唯一解析**：返回对这支队生效的数值，`null` = 不生效。
 * - 无条件 ⇒ 原值；
 * - `specialty`（二元）：队伍里没有该特性角色 ⇒ `null`；
 * - `countTier`：该特性人数 ≥ `thresholds[1]` 取 `values[1]`，≥ `thresholds[0]` 取 `values[0]`，否则 `null`。
 * 两者并存时先判特性限定，再按人数分档取值（与 CC-341 前 `teamCompare#resolveBuffEffect` 逐分支相同）。
 */
export function resolvePhaseBuffValue(
  value: number,
  cond: PhaseBuffCond | undefined,
  teamSpecialties: readonly string[],
): number | null {
  if (!cond) return value
  if (cond.specialty && !teamSpecialties.includes(specialtyCodeOfLabel(cond.specialty))) return null
  if (cond.countTier) {
    const code = specialtyCodeOfLabel(cond.countTier.specialty)
    const n = teamSpecialties.filter(s => s === code).length
    const { thresholds, values } = cond.countTier
    return n >= thresholds[1] ? values[1] : n >= thresholds[0] ? values[0] : null
  }
  return value
}

/** 条件的一行中文说明（「强攻限定」「异常2/3名」）；无条件返回空串。Boss 卡效果标签与属性配置页共用。 */
export function phaseBuffCondLabel(cond: PhaseBuffCond | undefined): string {
  if (!cond) return ''
  const parts: string[] = []
  if (cond.countTier) parts.push(`${cond.countTier.specialty}${cond.countTier.thresholds[0]}/${cond.countTier.thresholds[1]}名`)
  if (cond.specialty) parts.push(`${cond.specialty}限定`)
  return parts.join('，')
}

/** `phaseBuffRows` 产出的行（结构上就是一条启用的全局 Buff 行，`stores/config#GlobalBuffRow` 可直接收）。 */
export interface PhaseBuffRow {
  id: string
  name: string
  stat: string
  value: number
  enabled: true
  targetSkillType: SkillDamageTarget
  cond?: PhaseBuffCond
}

/**
 * buff 牌 → 全局 Buff 行的**唯一映射**：逐条效果一行，`cond` 原样带上（由管线按当前队伍解析）。
 * 没有 `stat` 的效果跳过。行 id / 名称由调用方给（各通道前缀不同：`layer-buff:` / `period-buff:` / `phase-buff:`）。
 */
export function phaseBuffRows(
  card: PhaseBuffCard,
  idOf: (effect: PhaseBuffEffect, index: number) => string,
  name: string,
): PhaseBuffRow[] {
  return (card.effects ?? [])
    .filter(e => !!e.stat)
    .map((e, i) => ({
      id: idOf(e, i),
      name,
      stat: e.stat,
      value: e.value,
      enabled: true as const,
      targetSkillType: (e.targetSkillType ?? 'all') as SkillDamageTarget,
      ...(e.cond ? { cond: e.cond } : {}),
    }))
}

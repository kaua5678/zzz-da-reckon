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
import type { BossPresetFile, PhaseBuffCard, PhaseBuffEffect, PhaseView } from '@/types/bossPreset'
import type { SkillDamageTarget } from '@/types/catalog'
import { SPECIALTY_LABEL } from '@/utils/agentLabelMaps'

export type PhaseBuffCond = NonNullable<PhaseBuffEffect['cond']>

/** 当期可选牌的全局 Buff 行前缀（= `runArchiveDeploy#applyPeriodBuff` 的写法，改这里要同步那边的模板串） */
export const PERIOD_BUFF_PREFIX = 'period-buff:'

/** 关卡固有 buff 的全局 Buff 行前缀（= `bossRoom#LAYER_BUFF_PREFIX`；本文件只读判定，不写入） */
export const LAYER_BUFF_PREFIX = 'layer-buff:'

/**
 * 「不用当期牌」的哨兵值（单一来源）：UI 上「不用 / 某张牌」是按钮组，没有 null 态，
 * 两个入口（实战对比页「当期 Buff」行、属性配置页「危局环境 Buff」卡的当期可选牌）都用它表示「不用」。
 */
export const NONE_PERIOD_CARD = '__none__'

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

/**
 * 期数环境 buff（属性配置页「危局环境 buff」卡）的解析：**只读、纯函数、不碰 store**。
 *
 * 用户原话（2026-10-26）：「属性修改下面也列出了很多队友，似乎用不到了。右边是自创buff，没看到危局期数的环境buff」。
 * 现场：属性配置页左侧把全部 29 个角色的队友 Buff 全列出来（按队伍自动派生 ⇒ 平时不用看），
 * 右侧「全局 Buff」只有手填行 —— **当期可选牌（3 选 1）在本页无处可选**，关卡固有 buff 也只有
 * 「应用 Boss」之后才以 `layer-buff:` 行出现、看不出它是哪期的环境。
 *
 * 两种环境 buff 的分工（口径权威 = `composables/bossRoom.ts` 头注释，本文件不复述实现）：
 * - **关卡固有**（`layer_buff`）：属于房间，随应用 Boss 由 `applyBossRoom` 写进全局 Buff 表（前缀 `layer-buff:`）。
 *   本文件只判「写没写、写的是不是这一期」，**绝不重写**（重写 = 与房间入口双计）。
 * - **当期可选牌**（`selectable_buff`，3 选 1）：属于玩家的选择，写入唯一入口 = `runArchiveDeploy#applyPeriodBuff`
 *   （前缀 `period-buff:`，先清旧再写、`cond` 随行由管线按当前队伍解析）。
 */

/** 已应用的 Boss（只取判定所需两字段，与 `configStore.appliedBoss` 结构兼容） */
export interface PhaseAppliedBoss {
  presetId: string
  phaseId: string
}

/** 环境卡片里「已应用 Boss 的关卡固有 buff」段 */
export interface PhaseLayerSection {
  presetId: string
  bossName: string
  phaseId: string
  /** 该 Boss 该期的关卡固有 buff 牌（数据源 = 预设 phase 的 `layerBuffs`，与期视图 `bossBuffs` 同源） */
  cards: PhaseBuffCard[]
}

/** 一期的环境 buff（属性配置页用） */
export interface PhaseEnvironment {
  phaseId: string
  label: string
  version: string
  /** 当期可选牌（3 选 1；测试服占位牌也在列，由 UI 禁用） */
  selectable: PhaseBuffCard[]
  /** 已应用 Boss 的关卡固有 buff；没应用 / 该 Boss 查不到该期相位 ⇒ null（不编数据） */
  layer: PhaseLayerSection | null
}

/** 期视图按时间从新到旧（数据里已是新→旧；这里只做兜底排序，不改口径） */
export function sortedPhaseViews(file: BossPresetFile | null | undefined): PhaseView[] {
  const views = (file?.phaseViews ?? []).slice()
  return views.sort((a, b) => (b.begin || b.phaseId).localeCompare(a.begin || a.phaseId))
}

/** 最新一期的 phaseId（没有期视图 ⇒ null；页面拿它当缺省期数） */
export function latestPhaseIdOf(file: BossPresetFile | null | undefined): string | null {
  return sortedPhaseViews(file)[0]?.phaseId ?? null
}

/**
 * 解析某一期的环境 buff。
 * - 期视图不存在 ⇒ null（页面显示「该期无环境数据」，不编）；
 * - `layer` 只在**已应用 Boss 且正是本期**、且能在预设里定位到该相位时给出（查不到 = 数据漂移，给 null 也不编）。
 */
export function resolvePhaseEnvironment(
  file: BossPresetFile | null | undefined,
  applied: PhaseAppliedBoss | null | undefined,
  phaseId: string,
): PhaseEnvironment | null {
  const view = (file?.phaseViews ?? []).find(v => v.phaseId === phaseId)
  if (!view) return null
  let layer: PhaseLayerSection | null = null
  if (applied && applied.phaseId === phaseId) {
    const boss = (file?.bosses ?? []).find(b => b.id === applied.presetId)
    const phase = boss?.phases.find(p => p.phaseId === applied.phaseId)
    if (boss && phase) {
      layer = { presetId: boss.id, bossName: boss.name, phaseId: phase.phaseId, cards: phase.layerBuffs ?? [] }
    }
  }
  return { phaseId: view.phaseId, label: view.label, version: view.version, selectable: view.buffs, layer }
}

/**
 * 一张牌会写出的行签名（排序后的 `stat:value` 列表）。
 * 为什么用签名而不是「页面记住上次点了哪张」：用户可能在**别的页面**（实战对比 / 自由对比）写过当期牌，
 * 也可能手删了表里某行 ⇒「当前选中」必须由**全局 Buff 表本身**派生，否则两个入口各说各话。
 */
export function phaseBuffCardSignature(card: PhaseBuffCard): string {
  return card.effects
    .filter(e => !!e.stat)
    .map(e => e.stat + ':' + e.value)
    .sort()
    .join('|')
}

/** 全局 Buff 表里某期的当期牌行（`period-buff:<phaseId>:<stat>:<value>`）；不看 enabled——关掉仍算「选了这张」 */
export function periodBuffRowsOf(
  rows: ReadonlyArray<{ id: string | number }>,
  phaseId: string,
): Array<{ id: string | number }> {
  const prefix = `${PERIOD_BUFF_PREFIX}${phaseId}:`
  return rows.filter(r => String(r.id).startsWith(prefix))
}

/** 全局 Buff 表里某 Boss 某期的关卡固有 buff 行（`layer-buff:<presetId>:<phaseId>:<stat>:<value>`） */
export function layerBuffRowsOf(
  rows: ReadonlyArray<{ id: string | number }>,
  presetId: string,
  phaseId: string,
): Array<{ id: string | number }> {
  const prefix = `${LAYER_BUFF_PREFIX}${presetId}:${phaseId}:`
  return rows.filter(r => String(r.id).startsWith(prefix))
}

/** 行签名（periodBuffRowsOf 的产物，去掉 `period-buff:<phaseId>:` 前缀后排序拼接） */
export function periodBuffRowSignature(rows: ReadonlyArray<{ id: string | number }>): string {
  return rows
    .map(r => String(r.id).split(':').slice(2).join(':'))
    .sort()
    .join('|')
}

/**
 * 表里当前生效的是哪张牌：按签名匹配；匹配不到（表里那批行不对应本期任何一张牌 —— 例如别的页面按
 * `phase-buff:` 前缀写的）返回 null，页面据此显示「表里有行但不是这些牌」，不假装选中。
 */
export function selectedPeriodBuffCard(
  rows: ReadonlyArray<{ id: string | number }>,
  phaseId: string,
  cards: readonly PhaseBuffCard[],
): PhaseBuffCard | null {
  const sig = periodBuffRowSignature(periodBuffRowsOf(rows, phaseId))
  if (!sig) return null
  return cards.find(c => phaseBuffCardSignature(c) === sig) ?? null
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
  return card.effects
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

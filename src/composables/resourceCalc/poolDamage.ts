/**
 * 伤害池直伤 / 异常伤害的**唯一入参拼装点**（CC-176 直伤，2026-09-28；CC-177 异常，同日第 201 轮）。
 *
 * - 直伤 `calcDirectDamage` 契约：面板通用减防 / 固定减防 / 减抗由**调用方**从面板读出传入，函数内只再加定向额外量。
 * - 异常 `calcAnomalyDamage` 契约（CC-175）：结算面板（settlementPanel ?? panel）上的减防 / 减抗由**函数内部**读，
 *   入参只传面板之外的额外量（异放限定 releaseModifier、柏妮思 6 命无视火抗）。
 * 两条契约方向相反，历史上的双计 / 漏计（CC-175 三处、CC-176 附伤漏侵染区）全出在「各调用点自拼入参」上。
 * 现在伤害池正路与模块旁路都走本文件：正路直接调，模块经 `ExtraAnomalyRowsInput.directDamage` / `.anomalyDamage`
 * 闭包调（模块不 import `calcDirectDamage` / `calcAnomalyDamage`）。
 *
 * 新增环境量（敌人、染色、全局口径）只加在 `PoolDamageEnv`；新增行级字段加在对应 Row 类型。
 * **不要**在调用方另拼 core 伤害函数的入参。
 */
import { calcAnomalyDamage, calcDirectDamage, type AnomalyDamageInput, type DirectDamageInput } from '@/core/damage'
import { resolveStatElement } from '@/core/anomalyPool/helpers'
import type { PanelValues } from '@/types/catalog'
import { safeElement } from './helpers'

/** 同一次建池内不变的环境量 */
export interface PoolDamageEnv {
  enemy: { defense: number; level: number; stunVuln: number }
  enemyDamageRes: Record<string, number>
  /** 风化染色属性（anomalyPanels.ts#getWindInfectionElement；无风角色时为 'wind'） */
  infectionElement: string
  /** 全队异常伤害乘区（= DamagePoolContext.globalAnomalyMultiplier，蕾米异化系数等）；只有异常拼装读 */
  anomalyMultiplier: number
}

/** 一行直伤：面板 + 行级量。减防 / 减抗只传**行级额外量**（defIgnore / resIgnore），面板通用值由本函数读。 */
export interface PoolDirectRow extends Pick<DirectDamageInput,
  'skillMultiplier' | 'count' | 'stunned' | 'specialDamageProfile' | 'skillDamageTarget'
  | 'critRateBonus' | 'critDmgBonus' | 'dmgBonus' | 'sheerDmgBonus' | 'flatDamageBonus'
  | 'basisValueOverride' | 'basisLabelOverride'> {
  panel: PanelValues
  element: string
  /** 缺省 = env.enemy.stunVuln（叶瞬光帷幕由 pushDirect 传 veilStunVulnBase） */
  stunMultiplier?: number
  /** 缺省 'expect'（爱丽丝 6 命附伤必定暴击传 'crit'） */
  critMode?: DirectDamageInput['critMode']
  /** 行级减防 / 无视防御（moveId 限定值），与面板通用值加算 */
  defIgnore?: number
  /** 行级减抗 / 无视抗性，与面板通用值加算 */
  resIgnore?: number
}

export function calcPoolDirectDamage(env: PoolDamageEnv, row: PoolDirectRow): ReturnType<typeof calcDirectDamage> {
  const panel = row.panel
  return calcDirectDamage({
    panel,
    skillMultiplier: row.skillMultiplier,
    damageElement: safeElement(row.element),
    enemyDefense: env.enemy.defense,
    // 减防/无视防御（GAME_TERM_TO_CODE_FIELD §4）：面板通用值（妮可 40%/叶瞬光C1 20%/席德C2 20%/
    // 伊芙琳C1/爱芮C2/千夏C1/音擎 千面日陨·索魂影眸 等）+ 行级 moveId 限定值（叶瞬光C2/C6、雨果C2、
    // 雅1命、席德…），两者同字段加算。**2026-09-08 修**：此前只传行级 `row.defIgnore`，面板通用值被
    // 静默丢弃（直伤整条通道失效，实测 妮可队 -21%、席德+妮可队 -29%）。
    enemyDefReduction: (panel.enemyDefReduction ?? 0) + (row.defIgnore ?? 0),
    enemyDefFlatReduction: panel.enemyDefFlatReduction ?? 0,
    enemyLevel: env.enemy.level,
    enemyResistance: env.enemyDamageRes[resolveStatElement(row.element) ?? ''] ?? 0,
    enemyResReduction: (panel.enemyResReduction ?? 0) + (row.resIgnore ?? 0),
    stunMultiplier: row.stunMultiplier ?? env.enemy.stunVuln,
    stunned: row.stunned,
    critMode: row.critMode ?? 'expect',
    count: row.count,
    skillDamageTarget: row.skillDamageTarget,
    critRateBonus: row.critRateBonus,
    critDmgBonus: row.critDmgBonus,
    dmgBonus: row.dmgBonus,
    sheerDmgBonus: row.sheerDmgBonus,
    flatDamageBonus: row.flatDamageBonus,
    infectionElement: env.infectionElement,
    basisValueOverride: row.basisValueOverride,
    basisLabelOverride: row.basisLabelOverride,
    specialDamageProfile: row.specialDamageProfile,
  })
}

/** 一行异常伤害：基础区面板 + 结算面板 + 面板之外的额外减防减抗。 */
export interface PoolAnomalyRow extends Pick<AnomalyDamageInput, 'baseMultiplier' | 'stunned' | 'anomalyCritOverride'> {
  /** 基础区面板（虚拟面板 / 本人面板） */
  panel: PanelValues
  /** 结算面板（按触发者分摊时为触发者面板）；缺省 = panel */
  settlementPanel?: PanelValues
  element: string
  /** 缺省 'anomaly'；异放传 'release' */
  damageKind?: AnomalyDamageInput['damageKind']
  /** 面板之外的额外减防（异放限定 releaseModifier）；**不要**传面板值（calcAnomalyDamage 内部读，传了就双计） */
  extraDefReduction?: number
  /** 面板之外的额外减抗（异放限定 releaseModifier、柏妮思 6 命无视火抗）；同上 */
  extraResReduction?: number
}

export function calcPoolAnomalyDamage(env: PoolDamageEnv, row: PoolAnomalyRow): ReturnType<typeof calcAnomalyDamage> {
  return calcAnomalyDamage({
    panel: row.panel,
    settlementPanel: row.settlementPanel,
    baseMultiplier: row.baseMultiplier,
    element: row.element as AnomalyDamageInput['element'],
    enemyDefense: env.enemy.defense,
    enemyDefReduction: row.extraDefReduction ?? 0,
    // 面板外的固定减防来源目前没有；面板固定减防由 calcAnomalyDamage 内部读（CC-175 ③）
    enemyDefFlatReduction: 0,
    enemyLevel: env.enemy.level,
    enemyResistance: env.enemyDamageRes[resolveStatElement(row.element) ?? ''] ?? 0,
    enemyResReduction: row.extraResReduction ?? 0,
    stunned: row.stunned,
    stunMultiplier: env.enemy.stunVuln,
    critMode: 'expect',
    damageKind: row.damageKind ?? 'anomaly',
    anomalyMultiplier: env.anomalyMultiplier,
    anomalyCritOverride: row.anomalyCritOverride,
  })
}

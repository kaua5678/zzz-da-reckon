/**
 * 伤害池直伤的**唯一入参拼装点**（CC-176，2026-09-28）。
 *
 * `calcDirectDamage` 的契约（见 core/damage.ts#DirectDamageInput 与 ENGINE_PIPELINE_GUIDE 伤害乘区行）：
 * 面板通用减防 / 固定减防 / 减抗由**调用方**从面板读出传入，函数内部只再加定向额外量。
 * 这条「面板通用值 + 行级额外量」的拼装此前在三处各写一遍（伤害池 pushDirect、简 6 命附伤、
 * 爱丽丝 6 命附伤）；正路后来加了侵染区染色属性 `infectionElement`，两处模块旁路没跟上
 * ⇒ 染色目标为物理（简 / 爱丽丝本人）时，6 命附伤漏吃侵染区（CC-176 修）。
 * 现在三处都走本函数：正路直接调，模块经 `ExtraAnomalyRowsInput.directDamage` 闭包调
 * （模块不再 import `calcDirectDamage`，也就不可能再漏拼某个环境量）。
 *
 * 新增环境量（敌人、染色、全局口径）只加在 `PoolDirectEnv` 与本函数里；新增行级字段加在
 * `PoolDirectRow`。**不要**在调用方另拼 `calcDirectDamage` 入参。
 */
import { calcDirectDamage, type DirectDamageInput } from '@/core/damage'
import { resolveStatElement } from '@/core/anomalyPool/helpers'
import type { PanelValues } from '@/types/catalog'
import { safeElement } from './helpers'

/** 同一次建池内不变的环境量 */
export interface PoolDirectEnv {
  enemy: { defense: number; level: number; stunVuln: number }
  enemyDamageRes: Record<string, number>
  /** 风化染色属性（anomalyPanels.ts#getWindInfectionElement；无风角色时为 'wind'） */
  infectionElement: string
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

export function calcPoolDirectDamage(env: PoolDirectEnv, row: PoolDirectRow): ReturnType<typeof calcDirectDamage> {
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

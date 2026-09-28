/**
 * 音擎效果按精炼等级取值——展示层入口（CC-210）。
 *
 * 引擎口径是 `core/buff.ts#applyWEngineModLevel`：`modificationValues.value` 替换 `value`、
 * `modificationValues.valuePerStack` 替换 `valuePerStack`（各自越界时保留原值）。
 * 展示层（views/components 禁止值导入 core）此前各写一份：DebugPage 只替换 `value`、漏掉 `valuePerStack`
 * （43 条按精炼变每层值的音擎效果在精炼≠1 时显示原值），FinalPanel 生命构成（→ hpSourceBreakdown）同样漏；
 * TeamConfigPage 两个都替换但独立实现。现统一经此函数取「引擎实际用的那个 effect」再格式化。
 */
import { applyWEngineModLevel } from '@/core/buff'
import { wEngineConditionMet, wEngineEffectRequirementMet } from '@/core/wengineConditions'
import type { Agent, BuffEffect, BuffGroup, WEngine } from '@/types/catalog'

/** modLevel 缺省（非音擎来源）⇒ 原样返回 */
export function effectAtModLevel(effect: BuffEffect, modLevel: number | undefined): BuffEffect {
  return modLevel ? applyWEngineModLevel(effect, modLevel) : effect
}

/**
 * 音擎效果在当前装备者 / 敌人下是否被引擎发放；不发放时返回原因（CC-211）。
 * 口径 = `core/buff.ts#collectWEngineBuffs`：职业匹配 → 组级 `wEngineConditionMet` → 效果级 `wEngineEffectRequirementMet`，
 * 三个谓词直接复用引擎函数。展示层（DebugPage 备注 / hpSourceBreakdown 过滤）经此判定，不再只看职业。
 */
export function wEngineEffectBlockReason(
  wEngine: WEngine,
  group: BuffGroup | null | undefined,
  effect: BuffEffect,
  wearer: Agent,
  enemyWeakness?: readonly string[],
): string | null {
  if (wEngine.specialty !== wearer.specialty) return '职业不匹配'
  const ctx = { wearerAttribute: wearer.attribute, wearerSpecialty: wearer.specialty, wearerAgentId: wearer.id, enemyWeakness }
  if (!wEngineConditionMet(group?.condition, ctx)) return '装备者不克制当前弱点'
  if (!wEngineEffectRequirementMet(effect.requirement, ctx)) return '装备者不满足本条限定（属性 / 特化 / 指定角色）'
  return null
}

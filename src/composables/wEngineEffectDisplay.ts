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
import type { BuffEffect } from '@/types/catalog'

/** modLevel 缺省（非音擎来源）⇒ 原样返回 */
export function effectAtModLevel(effect: BuffEffect, modLevel: number | undefined): BuffEffect {
  return modLevel ? applyWEngineModLevel(effect, modLevel) : effect
}

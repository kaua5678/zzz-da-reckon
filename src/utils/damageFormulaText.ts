/**
 * 伤害行「公式链」文本（结果页·伤害池「说明」列的公式行，2026-10-31）。
 *
 * ## 为什么住这里而不是各页面自己拼
 * 用户口径（2026-10-31 反馈）：蕾米埃尔耀变行的 `来源虚耀 7 次 · 基础 …× 320% × 增伤(1+171%) × …`
 * 这种展示「做得很好」，但**只有耀变显示**——其余行还是普通说明。要的是**每一行都能看到自己吃到的乘区**。
 *
 * 单一事实源 = 引擎的 `DamageBreakdownItem[]`（`core/damage.ts#calcDirectDamage / calcAnomalyDamage`
 * 逐区 push 的那份）：展示层**不得**自己重算乘区（规则 11 / 规则 16 口径挂活代码）。
 * 引擎新增/删改乘区时，本函数自动跟上；顺序也与引擎一致（@fact engine:damage/乘区顺序）。
 *
 * ## 组成规则
 * - `label(formula)` 逐区用 ` × ` 连接（如 `增伤乘区(1 + 通用100% + 元素51%)`）；
 * - **跳过「次数」项**：行本身已有「次数 / 单次 / 总伤」列，公式按**单次**口径展示；
 * - 空 breakdown（模块自建行 / 旧数据）⇒ `undefined`，调用方回落普通说明。
 */
import type { DamageBreakdownItem } from '@/types/catalog'

export function damageFormulaText(breakdown: readonly DamageBreakdownItem[] | undefined): string | undefined {
  if (!breakdown || breakdown.length === 0) return undefined
  const parts: string[] = []
  let firstKept = true
  for (const item of breakdown) {
    if (item.label === '次数') continue
    if (!item.formula) continue
    // 基底区/基础伤害区的 `formula` 只是「atk」（不含数值），补上实际取值：
    // `攻击力区(atk = 4,052.53)` / `基础伤害(atk × 320% = 12,968.20)`。
    // 其余乘区的 formula 自带数值（如 `1 + 33%` / `0.455`），保持原样。
    const text = firstKept
      ? `${item.label}(${item.formula} = ${item.displayValue})`
      : `${item.label}(${item.formula})`
    parts.push(text)
    firstKept = false
  }
  return parts.length > 0 ? parts.join(' × ') : undefined
}

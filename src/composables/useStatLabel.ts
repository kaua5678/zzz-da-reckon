/**
 * 属性标签 / 数值格式化公共 composable
 *
 * catalog.statRules.statDisplay 中 label 在真实数据里是字符串，
 * 但类型声明为 LocalizedString，此处兼容两种形态。
 */
import { useCatalogStore } from '@/stores/catalog'
import { fmt, pct } from '@/utils/format'
import { getStatMeta } from '@/utils/statMeta'

export function useStatLabel() {
  const catalogStore = useCatalogStore()

  /** 取属性显示名 */
  function statLabel(stat: string): string {
    const entry = (catalogStore.statRules?.statDisplay as any)?.[stat]
    const lbl = entry?.label
    if (typeof lbl === 'string') return lbl
    if (lbl && typeof lbl === 'object') return lbl.zhCN ?? lbl.en ?? stat
    return getStatMeta(stat).label
  }

  /** 取属性展示类型：integer / percent / number */
  function statDisplay(stat: string): string {
    const entry = (catalogStore.statRules?.statDisplay as any)?.[stat]
    return entry?.display ?? 'number'
  }

  /**
   * 按属性展示类型格式化数值。
   * @param stat   属性 id
   * @param value  原始数值（百分比类已为百分数，如 30 表示 30%）
   * @param mode   buff 模式（pct/flat/decimal），仅作辅助判断
   */
  function formatStatValue(stat: string, value: number, mode?: string): string {
    if (value == null || !Number.isFinite(value)) return '-'
    const display = statDisplay(stat)
    if (display === 'percent' || mode === 'pct' || mode === 'decimal') {
      return pct(value)
    }
    return fmt(value, 0)
  }

  return { statLabel, statDisplay, formatStatValue }
}

/**
 * 属性标签 / 数值格式化公共 composable
 *
 * catalog.statRules.statDisplay 的 label 是字符串（r725 起类型与数据一致，由 validate:data 契约校验）。
 */
import { useCatalogStore } from '@/stores/catalog'
import { fmt, localized, pct } from '@/utils/format'
import { getStatMeta } from '@/utils/statMeta'

export function useStatLabel() {
  const catalogStore = useCatalogStore()

  /** 取属性显示名 */
  function statLabel(stat: string): string {
    return localized(catalogStore.statRules?.statDisplay[stat]?.label, getStatMeta(stat).label)
  }

  /** 取属性展示类型：integer / percent / number */
  function statDisplay(stat: string): string {
    const entry = catalogStore.statRules?.statDisplay[stat]
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

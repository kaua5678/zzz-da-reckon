/**
 * localized —— LocalizedString 解析的单一事实源（@fact utils/format#localized）。
 *
 * 存在意义是**终结手抄**（仓库里同约定曾有 ~20 份、含 4 个页面局部助手）。这里钉全形态矩阵，
 * 迁移调用点时才敢逐字节等价；尤其两条易错语义：
 * ① 空串 zhCN 是**有效值**（`??` 链不回退 en——曾见 `||` 版助手在这翻车）；
 * ② 数字/null 等形态一律走 fallback（不吃 `String(42)` 的意外产物）。
 */
import { describe, expect, it } from 'vitest'
import { fmt, localized } from '@/utils/format'

describe('fmt 快路径与 toLocaleString 参照实现逐字相同', () => {
  // 参照 = 快路径引入前的原式（2026-09-23 快路径：|r|<1000 且 ≤3 位小数直接 String(r)）
  const ref = (v: number, d: number) => (d === 0 ? Math.round(v) : Number(v.toFixed(d))).toLocaleString()
  it('边界值 + 伪随机 2 万例 × decimals 0..4', () => {
    const vals = [0, -0, 0.5, -0.5, 1e-7, -1e-7, 999.4, 999.5, 999.9994, 999.9995, -999.9995, 1000, 1234.5678, -12345.678, 1e21]
    let s = 12345
    for (let i = 0; i < 20000; i++) {
      s = (s * 1103515245 + 12345) % 2147483648
      vals.push((s / 2147483648 - 0.5) * 10 ** ((i % 7) - 1))
    }
    for (const v of vals) for (let d = 0; d <= 4; d++) expect(fmt(v, d), `${v}@${d}`).toBe(ref(v, d))
  })
})

describe('localized（字符串原样 / 对象 zhCN→en→fallback 的 nullish 链）', () => {
  it('字符串（含空串）原样返回', () => {
    expect(localized('直接字符串', 'fb')).toBe('直接字符串')
    expect(localized('', 'fb')).toBe('')
  })

  it('对象：zhCN 优先、无 zhCN 用 en、都无回 fallback', () => {
    expect(localized({ zhCN: '中', en: 'En' }, 'fb')).toBe('中')
    expect(localized({ en: 'En' }, 'fb')).toBe('En')
    expect(localized({}, 'fb')).toBe('fb')
    expect(localized({ zhCN: undefined, en: undefined }, 'fb')).toBe('fb')
  })

  it('★ 空串 zhCN 算有效值：不回退 en（?? 语义，不是 ||）', () => {
    expect(localized({ zhCN: '', en: 'En' }, 'fb')).toBe('')
  })

  it('null / undefined / 数字等其余形态 → fallback', () => {
    expect(localized(null, 'fb')).toBe('fb')
    expect(localized(undefined, 'fb')).toBe('fb')
    expect(localized(42, 'fb')).toBe('fb')
    expect(localized(false, 'fb')).toBe('fb')
  })

  it('fallback 缺省为空串', () => {
    expect(localized(undefined)).toBe('')
    expect(localized({ zhCN: '值' })).toBe('值')
  })
})

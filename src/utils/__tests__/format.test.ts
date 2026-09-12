/**
 * localized —— LocalizedString 解析的单一事实源（@fact utils/format#localized）。
 *
 * 存在意义是**终结手抄**（仓库里同约定曾有 ~20 份、含 4 个页面局部助手）。这里钉全形态矩阵，
 * 迁移调用点时才敢逐字节等价；尤其两条易错语义：
 * ① 空串 zhCN 是**有效值**（`??` 链不回退 en——曾见 `||` 版助手在这翻车）；
 * ② 数字/null 等形态一律走 fallback（不吃 `String(42)` 的意外产物）。
 */
import { describe, expect, it } from 'vitest'
import { localized } from '@/utils/format'

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

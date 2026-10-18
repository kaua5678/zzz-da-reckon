/**
 * 面板「敌方减益」必须显示**全部元素**的专属减抗/减防/减失衡抗/减积蓄抗（2026-10-18）。
 *
 * 修前只显示当前伤害元素那一项（`currentElementDebuffSummary`）⇒ 队友给别的属性上的减益不可见
 * （如莱卡恩「其他属性伤害 +30%」之外的元素减抗、音擎的 `enemyElectricDefReduction`）。
 * 本测试钉：① 面板字段族完整（7 元素 × 4 类都能被 `panelElementStat` 读到）；
 * ② StatPanel 对这四族都渲染行（源码锁：不许只渲染当前元素）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { DAMAGE_ELEMENTS } from '@/utils/enemyDebuffStats'
import { elementStatKey, panelElementStat } from '@/utils/elementStatKeys'
import { emptyPanel } from '@/core/panel'

const statPanel = readFileSync(new URL('../../components/StatPanel.vue', import.meta.url), 'utf8')

describe('敌方减益：元素专属字段可见', () => {
  it('7 元素 × 4 类减益字段都能被读到（面板字段族完整）', () => {
    const missing: string[] = []
    for (const element of DAMAGE_ELEMENTS) {
      for (const kind of ['enemyDef', 'enemyRes', 'enemyStunRes', 'enemyAnomalyRes'] as const) {
        const key = elementStatKey(kind, element)
        if (!key) { missing.push(`${kind}/${element} 无字段`); continue }
        const panel = emptyPanel()
        ;(panel as unknown as Record<string, number>)[key] = 5
        if (panelElementStat(panel, kind, element) !== 5) missing.push(`${kind}/${element} 读不到 ${key}`)
      }
    }
    expect(missing, missing.join('\n')).toEqual([])
  })

  it('源码锁：StatPanel 为「失衡抗性 / 积蓄抗性」两族渲染了全元素行（不只当前元素）', () => {
    expect(statPanel, '缺元素专属失衡抗性行').toContain('elementStunResRows')
    expect(statPanel, '缺元素专属积蓄抗性行').toContain('elementAnomalyResRows')
    // 行数据必须遍历全部元素，而不是只取 damageElement
    expect(statPanel).toMatch(/for \(const element of DAMAGE_ELEMENTS\)/)
  })
})

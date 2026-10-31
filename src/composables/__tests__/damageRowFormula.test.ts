/**
 * 伤害池「说明 / 公式」列的行级公式链（2026-10-31）。
 *
 * 用户口径（逐字）：「这个公式显示做得很好，但是只有耀变显示了，其他都没显示。」
 * ⇒ 每个引擎标准管线产出的行都必须带 `formula`（单一事实源 = `core/damage` 的 breakdown），
 *   模块自建行（蕾米埃尔耀变）继续用 note 里的自定义公式。
 *
 * 判据：
 *  T1 纯函数：`damageFormulaText` 逐区拼接、跳过「次数」、基底补实际取值。
 *  T2 真管线：直伤 / 异放 / 标准异常行都有公式，且含各自的关键乘区名（不是同一串通用文本）。
 *  T3 蕾米埃尔耀变行回归：自定义公式仍在 note 里（不被通用公式覆盖）。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { damageFormulaText } from '@/utils/damageFormulaText'

const STANDARD_ANOMALY_TYPES = new Set(['灼烧', '感电', '侵蚀', '风化', '强击', '碎冰'])

describe('T1 damageFormulaText（纯函数）', () => {
  it('逐区拼接 + 跳过次数 + 基底补取值', () => {
    const text = damageFormulaText([
      { label: '攻击力区', formula: 'atk', value: 100, displayValue: '100' },
      { label: '技能倍率区', formula: '320%', value: 320, displayValue: '320' },
      { label: '增伤乘区', formula: '1 + 33%', value: 425.6, displayValue: '425.6' },
      { label: '次数', formula: '× 2', value: 851.2, displayValue: '851.2' },
    ])
    expect(text).toBe('攻击力区(atk = 100) × 技能倍率区(320%) × 增伤乘区(1 + 33%)')
    expect(text).not.toContain('次数')
  })

  it('空 / 缺公式 ⇒ undefined（调用方回落普通说明）', () => {
    expect(damageFormulaText(undefined)).toBeUndefined()
    expect(damageFormulaText([])).toBeUndefined()
    expect(damageFormulaText([{ label: 'x', formula: '', value: 1, displayValue: '1' }])).toBeUndefined()
  })
})

describe('T2 真管线：每类引擎行都有公式链', () => {
  it('★ 直伤行全部带公式（含增伤/防御/抗性/易伤/失衡/暴击）', async () => {
    await setupHarness([{ agentId: '1261' }, { agentId: '1581' }, { agentId: '1641' }])
    const calc = useResourceCalc()
    const rows = calc.damagePoolRows.value
    const direct = rows.filter(r => r.type === '直伤')
    expect(direct.length, '前提：该队应有直伤行').toBeGreaterThan(0)
    for (const row of direct) {
      expect(row.formula, `直伤行缺公式：${row.name}`).toBeTruthy()
      for (const zone of ['增伤乘区', '防御乘区', '抗性乘区', '易伤乘区', '失衡乘区', '暴击乘区']) {
        expect(row.formula, `${row.name} 公式缺 ${zone}`).toContain(zone)
      }
      expect(row.formula, '公式按单次口径，不含次数项').not.toContain('次数')
    }
  }, 240_000)

  it('★ 异放 / 标准异常行带公式（异常精通、异常增伤或紊乱增伤）', async () => {
    await setupHarness([{ agentId: '1261' }, { agentId: '1581' }, { agentId: '1641' }])
    const calc = useResourceCalc()
    const rows = calc.damagePoolRows.value
    const release = rows.filter(r => r.type === '异放')
    const anomaly = rows.filter(r => STANDARD_ANOMALY_TYPES.has(r.type))
    expect(release.length + anomaly.length, '前提：该队应至少产出异放或标准异常行').toBeGreaterThan(0)
    for (const row of [...release, ...anomaly]) {
      expect(row.formula, `${row.type}行缺公式：${row.name}`).toBeTruthy()
      expect(row.formula, `${row.type}行公式应含异常精通`).toContain('异常精通')
      expect(row.formula, `${row.type}行公式应含防御乘区`).toContain('防御乘区')
    }
  }, 240_000)

  it('★ 紊乱 / 乱流行按明细字段拼公式（异常质量 × 结算区）', async () => {
    await setupHarness([{ agentId: '1261' }, { agentId: '1581' }, { agentId: '1641' }])
    const calc = useResourceCalc()
    const rows = calc.damagePoolRows.value
    const detailRows = rows.filter(r => r.type === '紊乱' || r.type === '乱流')
    for (const row of detailRows) {
      expect(row.formula, `${row.type}行缺公式：${row.name}`).toBeTruthy()
      expect(row.formula).toContain('异常质量')
      expect(row.formula).toContain('结算区')
    }
  }, 240_000)
})

describe('T3 蕾米埃尔耀变行回归：自定义公式仍在 note', () => {
  it('耀变行 note 保持「来源虚耀 N 次 · 基础 … × 增伤(…) × …」', async () => {
    await setupHarness([{ agentId: '1261' }, { agentId: '1581' }, { agentId: '1641' }])
    const calc = useResourceCalc()
    const rows = calc.damagePoolRows.value.filter(r => r.type === '耀变')
    expect(rows.length, '前提：蕾米埃尔在队且应有耀变行').toBeGreaterThan(0)
    for (const row of rows) {
      expect(row.note).toContain('来源虚耀')
      expect(row.note).toContain('× 增伤(')
    }
  }, 240_000)
})

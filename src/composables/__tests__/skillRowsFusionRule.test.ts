/**
 * CC-240：治疗量 / 专属资源回复（skillRows.getHealingAmount / getSpecialResourceRecovery）吃逻辑编辑器行规则
 * （作用面 = 该招式该行的一切倍率表取值，§24.85 ④）。修前按行直取原始 values[0]。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { setActiveRowFusionRules } from '@/logicEditor/fusion'
import type { RowFusionRule } from '@/logicEditor/types'
import type { SkillMove } from '@/types/catalog'
import { getHealingAmount, getSpecialResourceRecovery } from '@/composables/resourceCalc/skillRows'

afterEach(() => setActiveRowFusionRules([]))

const rule = (moveId: string, rowId: string): RowFusionRule => ({
  id: `t-${rowId}`, name: 't', agentId: 'x', moveId, rowId, multiplier: 2, enabled: true, note: '',
})
const move = (rows: Array<{ id: string; kind?: string; values: number[] }>): SkillMove =>
  ({ id: 'm1', name: { zhCN: 'm', en: 'm' }, rows }) as unknown as SkillMove

describe('CC-240 skillRows 治疗 / 专属回复吃行规则', () => {
  it('治疗行：规则 ×2 ⇒ 该行计入 ×2，其余行不变', () => {
    const m = move([{ id: 'heal_a', values: [10] }, { id: 'hp_recover_b', values: [5] }, { id: 'damage', values: [100] }])
    expect(getHealingAmount(m)).toBe(15)
    setActiveRowFusionRules([rule('m1', 'heal_a')])
    expect(getHealingAmount(m)).toBe(25)
  })

  it('专属回复：kind=special 首行与兜底 recovery 求和两条分支都吃规则', () => {
    const special = move([{ id: 'attack_data_0', kind: 'special', values: [11] }])
    const legacy = move([{ id: 'steel_recovery', values: [3] }, { id: 'energy_recovery', values: [7] }])
    expect(getSpecialResourceRecovery(special)).toBe(11)
    expect(getSpecialResourceRecovery(legacy)).toBe(3)
    setActiveRowFusionRules([rule('m1', 'attack_data_0'), rule('m1', 'steel_recovery')])
    expect(getSpecialResourceRecovery(special)).toBe(22)
    expect(getSpecialResourceRecovery(legacy)).toBe(6)
  })
})

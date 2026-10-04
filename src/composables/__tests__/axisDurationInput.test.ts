import { describe, expect, it } from 'vitest'
import { agentAxisDurationInput, agentAxisMoveBadge, agentAxisMoveSuffix } from '@/composables/agentMechanicView'
import { getRegisteredAgentMechanics } from '@/mechanics'

/** CC-446：StunAxisPage 仪玄 1371022 蓄力输入 / +30%失衡徽标硬编码 → 模块声明 */
describe('axisDurationInputs / axisMoveBadge（CC-446）', () => {
  it('仪玄 1371022 声明蓄力输入：0～2s、步长 0.1、默认满蓄 2（与原页面写死值逐字一致）', () => {
    const d = agentAxisDurationInput('1371', '1371022')
    expect(d).toBeDefined()
    expect(d!.label).toBe('蓄力')
    expect([d!.min, d!.max, d!.step, d!.default]).toEqual([0, 2, 0.1, 2])
    expect(d!.title).toContain('凝云术蓄力时长')
  })
  it('非该招式 / 非该角色 / 空槽 ⇒ 无输入框', () => {
    expect(agentAxisDurationInput('1371', '1371026')).toBeUndefined()
    expect(agentAxisDurationInput('1221', '1371022')).toBeUndefined()
    expect(agentAxisDurationInput(null, '1371022')).toBeUndefined()
  })
  it('徽标 = 后缀去掉前导「·」；仪玄 1371022/1371026 = +30%失衡，其余空串', () => {
    expect(agentAxisMoveSuffix('1371', '1371022')).toBe('·+30%失衡')
    expect(agentAxisMoveBadge('1371', '1371022')).toBe('+30%失衡')
    expect(agentAxisMoveBadge('1371', '1371026')).toBe('+30%失衡')
    expect(agentAxisMoveBadge('1371', '1371009')).toBe('')
    expect(agentAxisMoveBadge(undefined, '1371022')).toBe('')
  })
  it('全部声明自洽：min ≤ default ≤ max、step > 0', () => {
    for (const mod of getRegisteredAgentMechanics()) {
      for (const [moveId, d] of Object.entries(mod.axisDurationInputs ?? {})) {
        expect(d.min <= d.default && d.default <= d.max, `${mod.id} ${moveId}`).toBe(true)
        expect(d.step > 0, `${mod.id} ${moveId}`).toBe(true)
      }
    }
  })
})

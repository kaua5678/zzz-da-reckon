/**
 * CC-229 锁：保底4喧响提示直读引擎决策（convergence → CalcRoundResult.decibelGuarantee）。
 * 旧页面用收敛后主C喧响（已含注入弹刀）重算 ⌈缺口/215⌉ ⇒ 1291-1481-1161 引擎补 7 次、页面显示「已够」。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'

describe('CC-229 decibelGuarantee 引擎直出', () => {
  it('真队：parry = ⌈basisShort / perParry⌉ 且 > 0（注入后剩余缺口为 0 不影响次数）', async () => {
    const { config } = await setupHarness([{ agentId: '1291' }, { agentId: '1481' }, { agentId: '1161' }], { recommendedBuild: true })
    config.setMechanicSetting('guarantee.ultimate', 1)
    const g = useResourceCalc().decibelGuaranteeResult.value!
    expect(g.active).toBe(true)
    expect(g.parry).toBeGreaterThan(0)
    expect(g.parry).toBe(Math.ceil(g.basisShort / g.perParry))
    expect(g.basisShort).toBeLessThanOrEqual(g.roundThreshold)
    // CC-425：roundable 与阈值同源（页面提示插值 roundThreshold，不再手写 1500）
    expect(g.roundThreshold).toBe(1500)
    expect(g.roundable).toBe(g.residualShort <= g.roundThreshold)
  })
  it('补齐角色（般岳）在队 ⇒ active=false、parry=0', async () => {
    const { config } = await setupHarness([{ agentId: '1371' }, { agentId: '1471' }, { agentId: '1311' }], { recommendedBuild: true })
    config.setMechanicSetting('guarantee.ultimate', 1)
    const g = useResourceCalc().decibelGuaranteeResult.value!
    expect(g.active).toBe(false)
    expect(g.parry).toBe(0)
  })
  it('源码锁：TeamConfigPage 不再自算缺口 / 次数', () => {
    const src = readFileSync(resolve(__dirname, '../../views/TeamConfigPage.vue'), 'utf-8')
      .split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
    expect(src).not.toMatch(/\/\s*215\b/)
    expect(src).not.toMatch(/÷\s*215\b/)
    expect(src).not.toMatch(/ULTIMATE_COST_DEFAULT/)
    expect(src).not.toMatch(/\b1500\b/) // CC-425：阈值由 decibelGuarantee.roundThreshold 提供
    expect(src).toMatch(/decibelGuaranteeResult/)
  })
})

import { describe, expect, it } from 'vitest'
import { crossAgentEnergyLabels } from '@/composables/agentMechanicView'
import { getRegisteredAgentMechanics } from '@/mechanics'
import { LIGHTER_C4_BURST_CD, LIGHTER_C4_BURST_ENERGY } from '@/mechanics/agents/lighter'

/** CC-445：跨角色回能来源标签由提供者模块声明（原 ResourceResultCard.vue UI 侧标签表） */
describe('crossAgentEnergyLabels（CC-445）', () => {
  it('五个历史展示键都由模块声明，标签文案与原 UI 表一致', () => {
    const m = crossAgentEnergyLabels()
    expect(m.get('rinaUltEnergy')?.label).toBe('丽娜终结邻位')
    expect(m.get('soukakuUltEnergy')?.label).toBe('苍角终结邻位')
    expect(m.get('lucyEnergy')).toEqual({ key: 'lucyEnergy', label: '露西回能', detail: '终结邻位 + 影画1 回旋全队' })
    expect(m.get('lighterC4Energy')?.label).toBe('莱特影画4 喷发')
    expect(m.get('xideVanguardEnergy')?.label).toBe('席德正兵回能')
  })
  it('莱特说明文案引用模块常量（不再是 UI 抄写的 4 / 18）', () => {
    const d = crossAgentEnergyLabels().get('lighterC4Energy')?.detail ?? ''
    expect(d).toContain(`+${LIGHTER_C4_BURST_ENERGY}/次`)
    expect(d).toContain(`${LIGHTER_C4_BURST_CD}s`)
  })
  it('每个 crossAgentSupply.displayKey 都有对应标签声明（新提供者漏配会在此报警）', () => {
    for (const mod of getRegisteredAgentMechanics()) {
      const key = mod.crossAgentSupply?.displayKey
      if (!key) continue
      expect(crossAgentEnergyLabels().has(key), `${mod.id} displayKey ${key}`).toBe(true)
    }
  })
  it('同键先到者胜、键不重复', () => {
    const m = crossAgentEnergyLabels()
    const all = getRegisteredAgentMechanics().flatMap(mod => mod.crossAgentEnergyLabels ?? [])
    expect(new Set(all.map(e => e.key)).size).toBe(m.size)
  })
})

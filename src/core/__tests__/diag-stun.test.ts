import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'

// [DEBUG] 临时诊断：轴模式下 ①兜底平A是否算进必要时间 ②净失衡缩放是否与轴内失效双重扣减
describe('diag: stun axis', () => {
  it('reports axis stun internals', async () => {
    const { config } = await setupHarness([
      { agentId: '1371' }, // 仪玄 主C（普通平A聚合行）
      { agentId: '1251' }, // 青衣 击破
      { agentId: '1271' }, // 赛斯
    ])
    config.useStunAxis = true
    config.stunAxes = [{
      name: '诊断轴',
      count: 3,
      actions: [
        { slot: 1, moveId: '1251004', count: 1 }, // 青衣 一煞#4
        { slot: 0, moveId: '1371022', count: 2 }, // 仪玄 凝云
      ],
      basicFillerSlot: 0, // 仪玄兜底平A
    }]
    const calc = useResourceCalc()
    const sp = calc.stunPoolResult.value
    const rr = calc.resourceResult.value
    // eslint-disable-next-line no-console
    console.log('[DIAG]', JSON.stringify({
      rawStunCount: sp?.stunCount,
      totalStunBuildUp: sp?.totalStunBuildUp,
      grossStunBuildUp: sp?.grossStunBuildUp,
      inAxisStunTotal: sp?.inAxisStunTotal,
      bossStunValue: sp?.bossStunValue,
      basicContribs: sp?.contributions.filter(c => c.moveId === 'basic_attack').map(c => ({
        slot: c.slot, count: c.count, baseDaze: c.baseDaze, totalStun: c.totalStun,
        inAxisFraction: c.inAxisFraction, inAxisStun: c.inAxisStun,
      })),
      basicTimeBySlot: rr?.characters.map(c => ({ agent: c.agentId, basicAttackTime: c.timeAllocation?.basicAttackTime, necessaryTime: c.timeAllocation?.necessaryTime })),
      windowDuration: calc.windowDuration.value,
      stunCoverage: calc.stunAxisResult.value?.stunCoverage,
    }, null, 2))
    expect(sp).not.toBeNull()
  })
})

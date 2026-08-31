import { beforeEach, describe, expect, it } from 'vitest'
import { mockStaticFetch, newPinia } from '@/test/harness'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
const baseConfig = {
  wEngineId: '', wEngineModLevel: 5,
  driveDisc: { fourPieceSetId: '', twoPieceSetId: '', mainStats: { 4: 'atkPct' as any, 5: 'fireDmg' as any, 6: 'critRate' as any }, subStatAllocation: {} },
  parryCount: 10, dodgeCounterCount: 6, blockCount: 20, dualCounterCount: 5,
  quickAssistCount: 0, chainCountPerStun: 0, basicAttackTimeWeight: 1,
}
describe('般岳时间预算（回归）：金身弹刀/双反计入必做前台，总计不超 180s', () => {
  beforeEach(() => {
    newPinia()
    mockStaticFetch()
  })
  it('轴模式（般琉通用预设）：不动如山+冲霄时间计入 necessaryTime → 平A池压缩，总计 ≤ 180s', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    const config = useConfigStore()
    config.team[0] = { slot: 0, agentId: '1471', cinemaLevel: 0, ...baseConfig } as any
    config.team[1] = { slot: 1, agentId: '1481', cinemaLevel: 0, ...baseConfig } as any
    config.team[2] = { slot: 2, agentId: '1451', cinemaLevel: 0, ...baseConfig } as any
    config.useStunAxis = true
    const { default: preset } = await import('@/data/stunAxisPresets/般琉通用.json') as any
    config.stunAxisPlans = JSON.parse(JSON.stringify(preset.plans))
    config.stunAxes = []
    const calc = useResourceCalc()
    await new Promise(r => setTimeout(r, 120))
    const c0 = calc.resourceResult.value!.characters[0]
    // 金身弹刀+双反行存在且时间计入必做前台（necessaryTime 含不动如山 0.666s + 冲霄 ×25 次）
    const chongXiao = c0.executions.find(e => e.moveId === '1471029')
    const buDongRuShan = c0.executions.find(e => e.moveId === '1471011')
    expect(chongXiao).toBeDefined()
    expect(buDongRuShan).toBeDefined()
    const blockDualTime = (chongXiao!.count ?? 0) * ((chongXiao!.actionTime ?? 0) + (buDongRuShan!.actionTime ?? 0))
    expect(c0.timeAllocation.necessaryTime).toBeGreaterThanOrEqual(blockDualTime - 1e-6)
    // 总计（动作合计 + 平A）不超战斗时间 180s
    const rowsSum = (c0.executions ?? []).reduce((s, e) => s + (e.totalTime ?? 0), 0)
    const basic = c0.timeAllocation.basicAttackTime ?? 0
    expect(rowsSum + basic).toBeLessThanOrEqual(180 + 1e-6)
    // 后摇行命名（章鱼蓄力式：后摇（狮子吼·怒））
    const recovery = c0.executions.find(e => e.moveId === 'banyue-recovery-lundao')
    if (recovery) expect(recovery.moveName).toBe('后摇（狮子吼·怒）')
  })
})

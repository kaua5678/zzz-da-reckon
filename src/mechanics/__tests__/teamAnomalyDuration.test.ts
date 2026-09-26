/**
 * CC-35c（2026-09-27）：全队异常持续时间「通用规则臂」由模块能力 `teamAnomalyDurationBonus` 提供。
 * 丽娜分支另有 rina.test / helpersNightC 覆盖（额外能力门控）；这里锁柏妮思 / 简两臂与「无提供者 = 0」。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { getTeamAnomalyDurationBonus } from '@/composables/resourceCalc/helpers'

const ELEMENTS = ['physical', 'fire', 'ice', 'electric', 'ether'] as const

describe('CC-35c：teamAnomalyDurationBonus', () => {
  it('柏妮思在队：火 +3，其余属性 0', async () => {
    const { config, catalog } = await setupHarness([{ agentId: '1171' }, { agentId: '1331' }] as never)
    for (const el of ELEMENTS) expect(getTeamAnomalyDurationBonus(config, catalog, el), el).toBe(el === 'fire' ? 3 : 0)
  })

  it('简在第 2 槽：物理 +5，其余属性 0', async () => {
    const { config, catalog } = await setupHarness([{ agentId: '1331' }, { agentId: '1261' }] as never)
    for (const el of ELEMENTS) expect(getTeamAnomalyDurationBonus(config, catalog, el), el).toBe(el === 'physical' ? 5 : 0)
  })

  it('无提供者：全部 0', async () => {
    const { config, catalog } = await setupHarness([{ agentId: '1331' }, { agentId: '1221' }] as never)
    for (const el of ELEMENTS) expect(getTeamAnomalyDurationBonus(config, catalog, el), el).toBe(0)
  })
})

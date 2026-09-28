/**
 * CC-171（第 196 轮）：引擎面板的 potentialLevel 盖章必须跟随角色潜能设置。
 * 此前 computePanelPhases / computeEntrySnapshotPanel 不传 potentialLevel ⇒ core/panel.ts 缺省盖 6，
 * 读 cfg.panel.potentialLevel 的模块（柏妮思 buildExecutions、简 / 柏妮思资源结果）与潜能滑块脱钩。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { computeEntrySnapshotPanel, computePanelPhases } from '@/composables/resourceCalc/panelPhases'
import { useResourceCalc } from '@/composables/useResourceCalc'

describe('CC-171 面板潜能盖章跟随角色设置', () => {
  it('computePanelPhases 局外 / 局内与进场快照面板都盖角色自己的潜能档', async () => {
    const { config, catalog } = await setupHarness([{ agentId: '1171', potentialLevel: 2 }, { agentId: '1261', potentialLevel: 4 }, { agentId: '1311' }], { recommendedBuild: true })
    for (const [slot, lv] of [[0, 2], [1, 4], [2, 6]] as const) {
      const ph = computePanelPhases(slot, config, catalog)!
      expect(ph.outOfCombat.potentialLevel).toBe(lv)
      expect(ph.inCombat.potentialLevel).toBe(lv)
      expect(computeEntrySnapshotPanel(slot, config, catalog)!.potentialLevel).toBe(lv)
    }
  }, 60000)

  it('端到端：柏妮思资源结果（burniceMechanicSource）的潜能加成按角色潜能档取值', async () => {
    const { BURNICE_POTENTIAL_MASTERY_PER_0_1: PER } = await import('@/mechanics/agents/burnice')
    const read = async (p: number) => {
      await setupHarness([{ agentId: '1171', potentialLevel: p }, { agentId: '1311' }, { agentId: '1211' }], { recommendedBuild: true })
      const row = useResourceCalc().resourceResult.value!.characters.find(ch => ch.agentId === '1171')! as unknown as { burniceMechanicSource: { potentialAnomalyMasteryBonus: number } }
      return row.burniceMechanicSource.potentialAnomalyMasteryBonus
    }
    const m6 = await read(6)
    const m2 = await read(2)
    // 前提：推荐配装下潜能门控已触发且未封顶（否则本用例区分不了档位）
    expect(m6).toBeGreaterThan(0)
    expect(m6).toBeLessThan(25)
    const overCount = Math.round(m6 / PER[6]!)
    expect(m2).toBeCloseTo(overCount * PER[2]!, 9)
    expect(m2).not.toBe(m6) // 修复前两者恒等（面板盖章恒为 6）
  }, 60000)
})

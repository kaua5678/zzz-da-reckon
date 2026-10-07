/**
 * CC-35c-B（2026-09-27）：队友 buff 来源面板修正由模块能力 `adjustTeammateBuffSource` 提供（原 panelPhases 按 id 写死）。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { computePanelPhases } from '@/composables/resourceCalc/panelPhases'
import { emptyPanel } from '@/core/panel'
import { lighterMechanic } from '@/mechanics/agents/lighter'
import { yaojiayinMechanic } from '@/mechanics/agents/yaojiayin'

describe('CC-35c-B：adjustTeammateBuffSource', () => {
  it('莱特：局内冲击 ×1.2，局外不动', () => {
    const source = { inCombat: { ...emptyPanel(), impact: 100 }, outOfCombat: { ...emptyPanel(), impact: 100 } }
    lighterMechanic.adjustTeammateBuffSource!({ source, cinemaLevel: 0 })
    expect(source.inCombat.impact).toBeCloseTo(120, 12)
    expect(source.outOfCombat.impact).toBe(100)
  })

  it('耀嘉音：技能等级加成 C0→0、C3→2、C5→4，且取已有值与之的较大者', () => {
    const at = (cinemaLevel: number, existing = 0) => {
      const source = { inCombat: { ...emptyPanel(), skillLevelBonus: existing }, outOfCombat: { ...emptyPanel(), skillLevelBonus: existing } }
      yaojiayinMechanic.adjustTeammateBuffSource!({ source, cinemaLevel })
      return [source.outOfCombat.skillLevelBonus, source.inCombat.skillLevelBonus]
    }
    expect(at(0)).toEqual([0, 0])
    expect(at(3)).toEqual([2, 2])
    expect(at(5)).toEqual([4, 4])
    expect(at(3, 3)).toEqual([3, 3])
  })
})

describe('CC-35c-B：panelPhases 派发接线（包裹能力，记录调用）', () => {
  // perf dump 覆盖不到这两条（2026-09-27 实测：莱特 ×1.2→×1.3 dump 零差）；「移除能力 → 队友面板不变」在默认
  // harness 下也成立（莱特那条 buff 挂额外能力 / 可能顶上限，耀嘉音 buff 读 atk），所以改为直接锁调用：
  // computePanelPhases 必须以本角色 agentId 的来源条目和本槽命座调用能力。
  type Hook = (input: { source: { inCombat?: Record<string, number>; outOfCombat?: Record<string, number> }; cinemaLevel: number }) => void
  const record = async (mod: unknown, team: { agentId: string; cinemaLevel?: number }[], read: (src: { inCombat?: Record<string, number>; outOfCombat?: Record<string, number> }) => number) => {
    const { config, catalog } = await setupHarness(team as never)
    const m = mod as { adjustTeammateBuffSource: Hook }
    const saved = m.adjustTeammateBuffSource
    const calls: { before: number; after: number; cinemaLevel: number }[] = []
    m.adjustTeammateBuffSource = (input) => {
      const before = read(input.source)
      saved(input)
      calls.push({ before, after: read(input.source), cinemaLevel: input.cinemaLevel })
    }
    try {
      computePanelPhases(1, config, catalog)
    } finally {
      m.adjustTeammateBuffSource = saved
    }
    return calls
  }

  it('莱特在队：以莱特的来源条目调用一次，局内冲击 ×1.2', async () => {
    const calls = await record(lighterMechanic, [{ agentId: '1161' }, { agentId: '1191' }], src => src.inCombat?.impact ?? NaN)
    expect(calls.length).toBe(1)
    expect(calls[0].before).toBeGreaterThan(0)
    expect(calls[0].after).toBeCloseTo(calls[0].before * 1.2, 9)
  })

  it('耀嘉音 C5 在队：收到命座 5，局外技能等级加成 ≥ 4', async () => {
    const calls = await record(yaojiayinMechanic, [{ agentId: '1311', cinemaLevel: 5 }, { agentId: '1191' }], src => src.outOfCombat?.skillLevelBonus ?? NaN)
    expect(calls.length).toBe(1)
    expect(calls[0].cinemaLevel).toBe(5)
    expect(calls[0].after).toBeGreaterThanOrEqual(4)
  })

  it('两人都不在队：不调用', async () => {
    const calls = await record(lighterMechanic, [{ agentId: '1331' }, { agentId: '1191' }], src => src.inCombat?.impact ?? NaN)
    expect(calls.length).toBe(0)
  })
})

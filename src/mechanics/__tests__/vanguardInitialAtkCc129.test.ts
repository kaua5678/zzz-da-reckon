/**
 * CC-129：席德「将初始攻击力最高的[强攻]队友视为[正兵]」——选人读队友**局外攻击**
 * （cfg.outOfCombatPanel.atk，编排层 buildCharConfig 通用挂载），而不是角色 60 级基础攻击
 * level60.atkBase。缺失局外面板（手搓 cfg）时回退 atkBase（见 xide.test.ts 既有两条）。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { buildCharConfig, computePanelPhases } from '@/composables/resourceCalc/helpers'
import { xideMechanic } from '@/mechanics/agents/xide'

const mkMember = (slot: number, agentId: string, specialty: string, atkBase: number) => ({
  slot, agentId, cinemaLevel: 0, wEngineId: '', wEngineModLevel: 1,
  agent: { specialty, level60: { atkBase } },
}) as any

const runBuild = (characters: any[], team: any[]) =>
  xideMechanic.applyTeamConfig!({
    slot: 0, agent: null, cinemaLevel: 0, characters, team, settings: {},
    phase: 'build', combatTime: 180, exCounts: team.map(() => 0), stunCount: 0, teamEnergyConsumed: 0,
  } as any)

describe('CC-129 席德正兵按初始攻击力（局外攻击）选', () => {
  it('局外攻击与基础攻击排序相反时，按局外攻击选', () => {
    const characters = [
      { agentId: '1461', slot: 0 },
      { agentId: 'A', slot: 1, outOfCombatPanel: { atk: 2500 } },
      { agentId: 'B', slot: 2, outOfCombatPanel: { atk: 3100 } },
    ] as any
    const team = [
      mkMember(0, '1461', 'attack', 800),
      mkMember(1, 'A', 'attack', 950), // 基础攻击更高
      mkMember(2, 'B', 'attack', 880), // 局外攻击更高 ⇒ 正兵
    ]
    runBuild(characters, team)
    expect(characters[0].xideVanguardSlot).toBe(2)
  })

  it('非强攻队友局外攻击再高也排除', () => {
    const characters = [
      { agentId: '1461', slot: 0 },
      { agentId: 'A', slot: 1, outOfCombatPanel: { atk: 2000 } },
      { agentId: 'S', slot: 2, outOfCombatPanel: { atk: 9000 } },
    ] as any
    runBuild(characters, [mkMember(0, '1461', 'attack', 800), mkMember(1, 'A', 'attack', 900), mkMember(2, 'S', 'stun', 1000)])
    expect(characters[0].xideVanguardSlot).toBe(1)
  })

  it('真接线：buildCharConfig 挂的 outOfCombatPanel 与 computePanelPhases 局外面板同值，并决定正兵', async () => {
    const ids = ['1461', '1081', '1191']
    const { catalog, config } = await setupHarness(ids.map(agentId => ({ agentId, cinemaLevel: 0 })) as never, { recommendedBuild: true })
    const characters = ids.map((_, i) => buildCharConfig(i, config, catalog)!)
    const ooc = ids.map((_, i) => computePanelPhases(i, config, catalog)!.outOfCombat.atk)
    for (let i = 0; i < 3; i++) {
      expect(characters[i].outOfCombatPanel?.atk).toBe(ooc[i])
      expect(ooc[i]).toBeGreaterThan(0)
    }
    // 基础攻击故意设成与局外攻击相反的排序，证明选人只看局外面板
    const hi = ooc[1] >= ooc[2] ? 1 : 2
    const lo = hi === 1 ? 2 : 1
    const team = [mkMember(0, '1461', 'attack', 800), mkMember(hi, ids[hi], 'attack', 1), mkMember(lo, ids[lo], 'attack', 9999)]
      .sort((a, b) => a.slot - b.slot)
    runBuild(characters, team)
    expect(characters[0].xideVanguardSlot).toBe(hi)
  })
})

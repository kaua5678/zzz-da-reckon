/**
 * CC-207：模块钩子 teammateBuffGate 的正确性约束引擎也执行（此前只作用于 store 默认值）。
 * 判据：强行勾上被钩子否决的 buff ⇒ 面板与默认完全一致；判别力：关掉一条放行的同源 buff ⇒ 面板确实变化。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { computePanelPhases } from '@/composables/resourceCalc/panelPhases'
import { teammateBuffGateBlocks } from '@/mechanics/additionalAbilityGates'
import { buildMechanicTeamMembers } from '@/composables/resourceCalc/helpers'

type Team = Parameters<typeof setupHarness>[0]

async function load(team: Team) {
  const { config, catalog } = await setupHarness(team)
  const panel = (slot: number) => computePanelPhases(slot, config, catalog)!.inCombat
  return { config, catalog, panel }
}

describe('CC-207 teammateBuffGate 引擎侧执行', () => {
  it('波可娜 C6：基础条被否决，强行勾上不与影画六条双计', async () => {
    const { config, catalog, panel } = await load([{ agentId: '1351', cinemaLevel: 6 }, { agentId: '1191' }, ''])
    const blocked = teammateBuffGateBlocks(buildMechanicTeamMembers(config, catalog), catalog.teammateBuffGroups)
    expect(blocked.has('pulchra_extra_trap_followup')).toBe(true)
    expect(config.isTeammateBuffEnabled('pulchra_extra_trap_followup')).toBe(false)
    expect(config.isTeammateBuffEnabled('pulchra_cinema_6_trap_all')).toBe(true)
    const base = JSON.stringify(panel(1))
    config.toggleTeammateBuff('pulchra_extra_trap_followup', true)
    expect(JSON.stringify(panel(1))).toBe(base)
    // 判别力：关掉影画六条，队友面板确实变
    config.toggleTeammateBuff('pulchra_cinema_6_trap_all', false)
    expect(JSON.stringify(panel(1))).not.toBe(base)
  })

  it('波可娜 C0：基础条不被否决（钩子只管 C6）', async () => {
    const { config, catalog } = await load([{ agentId: '1351', cinemaLevel: 0 }, { agentId: '1191' }, ''])
    const blocked = teammateBuffGateBlocks(buildMechanicTeamMembers(config, catalog), catalog.teammateBuffGroups)
    expect(blocked.has('pulchra_extra_trap_followup')).toBe(false)
  })

  it('蕾米埃尔：互斥档位强行全勾，面板只吃当前档', async () => {
    const tiers = ['1581.additional_ability.atk_1_anomaly', '1581.additional_ability.atk_2_anomaly', '1581.additional_ability.atk_3_anomaly']
    const { config, panel } = await load([{ agentId: '1581' }, { agentId: '1261' }, ''])
    const on = tiers.filter(id => config.isTeammateBuffEnabled(id))
    expect(on).toHaveLength(1)
    const base = JSON.stringify(panel(1))
    for (const id of tiers) config.toggleTeammateBuff(id, true)
    config.toggleTeammateBuff('1581.core_passive.refringe_3_anomaly', true)
    expect(JSON.stringify(panel(1))).toBe(base)
    // 判别力：关掉当前档，队友面板确实变
    config.toggleTeammateBuff(on[0], false)
    expect(JSON.stringify(panel(1))).not.toBe(base)
  })
})

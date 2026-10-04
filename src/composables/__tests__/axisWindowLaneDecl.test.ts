/**
 * CC-448：轴编辑器专属窗口 lane 完整声明 `axisWindowLane`（对象）+ `teamAxisWindowLanes` 门面；
 * StunAxisPage 不再按 lane 种类各写一份（banyueSlot/yixuanSlot/mingwangTag/ningshenTag/…），也不再写死终结技 moveId。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { agentAxisNonDecibelUltimates, teamAxisWindowLanes, teamAxisWindowLaneSlot } from '@/composables/agentMechanicView'
import { getAgentMechanic } from '@/mechanics'

describe('CC-448 axisWindowLane 声明对象', () => {
  it('般岳 mingwang：8s 窗、怒相连段触发、6 命满覆盖；仪玄 ningshen：15s 窗、两种终结技触发、无满覆盖', async () => {
    await setupHarness([{ agentId: '1471' }, { agentId: '1371' }, ''])
    const mw = getAgentMechanic('1471')?.axisWindowLane
    const ns = getAgentMechanic('1371')?.axisWindowLane
    expect(mw?.kind).toBe('mingwang'); expect(mw?.name).toBe('明王'); expect(mw?.windowSeconds).toBe(8)
    expect(ns?.kind).toBe('ningshen'); expect(ns?.name).toBe('凝神'); expect(ns?.windowSeconds).toBe(15)
    const c0 = { cinemaLevel: 0 }, c6 = { cinemaLevel: 6 }
    expect(mw!.isTriggerBlock({ moveId: 'banyue-combo' }, c0)).toBe(true)
    expect(mw!.isTriggerBlock({ moveId: 'banyue-combo-didong' }, c0)).toBe(true)
    expect(mw!.isTriggerBlock({ moveId: '1471001' }, c0)).toBe(false)
    expect(mw!.fullCoverage?.(c0)).toBeNull()
    expect(mw!.fullCoverage?.(c6)).toBe('满覆盖 +39%')
    expect(mw!.banner(c0)).not.toBe(mw!.banner(c6))
    expect(mw!.window(undefined)).toEqual({ label: '明王×2层', cls: 'mw-l2' })
    expect(mw!.window({ trigger: true, active: true, layers: 3 })).toEqual({ label: '明王×3层', cls: 'mw-l3' })
    expect(mw!.blockTag({ trigger: true, active: true, layers: 2 })).toEqual({ text: '触发8s', cls: 'mw-trigger' })
    expect(mw!.blockTag({ trigger: false, active: true, layers: 3 })).toEqual({ text: '×3层', cls: 'mw-live' })
    expect(mw!.blockTag({ trigger: false, active: false, layers: 0 })).toBeNull()
    expect(ns!.isTriggerBlock({ moveId: '1371014' }, c0)).toBe(true)
    expect(ns!.isTriggerBlock({ moveId: '1371020' }, c0)).toBe(true)
    expect(ns!.isTriggerBlock({ moveId: '1371022' }, c0)).toBe(false)
    expect(ns!.fullCoverage).toBeUndefined()
    expect(ns!.window(undefined)).toEqual({ label: '凝神+40%', cls: 'mw-l2' })
    expect(ns!.blockTag({ trigger: true, active: true, layers: 0 })).toEqual({ text: '凝神15s', cls: 'mw-trigger' })
    expect(ns!.blockTag({ trigger: false, active: true, layers: 0 })).toEqual({ text: '凝神+40%', cls: 'mw-live' })
    expect(ns!.blockTag({ trigger: false, active: false, layers: 0 })).toBeNull()
    expect(agentAxisNonDecibelUltimates('1371')).toEqual(['1371020'])
    expect(agentAxisNonDecibelUltimates('1471')).toEqual([])
    expect(agentAxisNonDecibelUltimates('')).toEqual([])
  })
  it('teamAxisWindowLanes：按槽位序列出所有 lane；与 teamAxisWindowLaneSlot 一致；全 catalog 只有两名拥有者', async () => {
    const { catalog } = await setupHarness([{ agentId: '1371' }, { agentId: '1211' }, { agentId: '1471' }])
    const team = [{ agentId: '1371' }, { agentId: '1211' }, { agentId: '1471' }]
    const lanes = teamAxisWindowLanes(team)
    expect(lanes.map(l => [l.slot, l.decl.kind])).toEqual([[0, 'ningshen'], [2, 'mingwang']])
    for (const l of lanes) expect(teamAxisWindowLaneSlot(team, l.decl.kind)).toBe(l.slot)
    expect(teamAxisWindowLanes([{ agentId: '1211' }, null, { agentId: '' }])).toEqual([])
    const owners = [...catalog.agentsMap.keys()].filter(id => getAgentMechanic(id)?.axisWindowLane)
    expect(owners.sort()).toEqual(['1371', '1471'])
  })
  it('StunAxisPage 只有一份泛型 lane 渲染：无 per-kind 符号、无终结技 moveId 字面量', () => {
    const src = readFileSync(resolve(__dirname, '../../views/StunAxisPage.vue'), 'utf8')
    for (const bad of ['banyueSlot', 'yixuanSlot', 'mingwangTag', 'ningshenTag', 'mingwangWindowsFor', 'ningshenWindowsFor', 'teamAxisWindowLaneSlot']) {
      expect(src.includes(bad), bad).toBe(false)
    }
    expect(/['"]1[0-9]{2}1[0-9]{3}['"]/.test(src), 'moveId 字面量').toBe(false)
    expect(src.includes('isPromotable(act)')).toBe(true)
    expect(src.includes('v-for="lane in windowLanes"')).toBe(true)
  })
})

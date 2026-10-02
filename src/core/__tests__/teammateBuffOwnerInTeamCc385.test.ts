import { describe, it, expect } from 'vitest'
import { setupHarness } from '@/test/harness'
import { resolveSlotPanelBuffInputs } from '@/composables/resourceCalc/panelPhases'

/**
 * r411（CC-385）：**队友 buff 只来自在队拥有者**——引擎侧不变式，在唯一收集入口 `core/inCombatBuffs.ts#collectInCombatTeamBuffs`。
 *
 * 此前引擎完全依赖 store `syncTeammateBuffsFromTeam` 把不在队拥有者的勾选关掉；选择表是按 buff id 存的，
 * 残留勾选（存档恢复 / defer 路径 / 独立调用方）会直接进面板。实测：队伍 1041+1191（两人均无 buff 组）时把其余拥有者的 132 条全勾，95 条漏进；本测试用有 buff 组的 1311+1151 以便反空洞。
 * 同时这条规则让 `teammateBuffGate` 对不在队拥有者的询问成为死路径 ⇒ 门控只问在队拥有者、`self` 必填。
 */
describe('r411 CC-385：队友 buff 只来自在队拥有者', () => {
  it('不在队拥有者的 buff 即使选择表里 enabled 也不进面板；在队拥有者的照常进入', async () => {
    const { config, catalog } = await setupHarness([{ agentId: '1311' }, { agentId: '1151' }, ''])
    const groups = catalog.teammateBuffGroups
    expect(groups.length, '夹具自检：buff 组已加载').toBeGreaterThanOrEqual(40)
    expect(groups.filter(g => !catalog.agentsMap.get(g.id)).map(g => g.id), '组 id 必须是角色 id（规则前提）').toEqual([])

    const inTeam = new Set(['1311', '1151'])
    const all = groups.flatMap(g => (g.buffs ?? []).filter(b => b.singleSourced !== true).map(b => ({ id: b.id, owner: g.id })))
    for (const b of all) config.teammateBuffSelections[b.id] = { enabled: true, coverage: 100 }

    const got = new Set(resolveSlotPanelBuffInputs(0, config, catalog).teammateBuffs.map(b => b.id))
    const leaked = all.filter(b => !inTeam.has(b.owner) && got.has(b.id)).map(b => b.id)
    expect(leaked).toEqual([])
    // 反空洞：在队拥有者至少有一条进了面板（防规则写成「全部丢弃」后假绿）
    expect(all.some(b => inTeam.has(b.owner) && got.has(b.id))).toBe(true)
  })
})

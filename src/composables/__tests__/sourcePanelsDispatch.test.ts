/**
 * 全队源面板表的**透传判据**（2026-10-25，1601/1661 收尾批）。
 *
 * 背景：`core/buff#SourcePanelsByOwner`（ownerId → 局外/局内面板）一直只喂 buff 公式通道；
 * 角色模块的 `applyPanel` / `teamPanelEffects` 是**按槽位**工作的，此前拿不到源面板 ⇒ 想「读队友面板」
 * 的角色只能自建第二份表（60 个模块各抄一遍）。本批把它沿 `computePanelPhases → applyPanel/teamPanelEffects`
 * 与 `applyAgentPanelHooks`（`core/agentPanelPhases.ts`）两处派发点原样透传，并提供 `panelOfSlot` 槽位访问器。
 *
 * 判据三件：
 * ① 接入**零 delta**：没有模块读它 ⇒ 结构改动不得改数（面板与派发顺序逐位不变）；
 * ② 派发**同源同实例**：钩子拿到的源面板 = `calcPanel` 的 `sourcePanelsByOwner` 里那一批对象（不是拷贝）；
 * ③ 访问器**按槽位**取（判据 17）：`panelOfSlot` 用槽位号，不是下标——前导/中间空槽时必须返回 undefined。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { buildSourcePanelsBySlot, panelOfSlot } from '@/core/sourcePanels'
import { resolveSlotPanelBuffInputs, computePanelPhases } from '@/composables/resourceCalc/panelPhases'
import { getAgentMechanic } from '@/mechanics/registry'
import { emptyPanel } from '@/core/panel'

describe('全队源面板表（sourcePanels）', () => {
  it('① buildSourcePanelsBySlot：按槽位折表、值不拷贝、空槽不产条目', async () => {
    const { config, catalog } = await setupHarness([{ agentId: '1601' }, '', { agentId: '1661' }])
    const { sourcePanelsByOwner } = resolveSlotPanelBuffInputs(0, config, catalog)
    const team = config.team.map((c, i) => ({ slot: i, agentId: c.agentId }))
    const bySlot = buildSourcePanelsBySlot(sourcePanelsByOwner, team)
    expect(Object.keys(bySlot).map(Number).sort()).toEqual([0, 2]) // 槽1 空 ⇒ 无条目
    // 同源同实例：不是拷贝（adjustTeammateBuffSource 的改写必须对它可见）
    expect(bySlot[0]!.inCombat).toBe(sourcePanelsByOwner['1601']!.inCombat)
    expect(bySlot[2]!.outOfCombat).toBe(sourcePanelsByOwner['1661']!.outOfCombat)
    // 源面板 = 角色自身配置（不含队友 buff）：局外面板 hp 就是角色白值 + 配装，非 0
    expect(panelOfSlot(bySlot, 2, 'outOfCombat')!.hp).toBeGreaterThan(0)
    // 判据 17：按槽位号查，不是下标——槽 1 是空槽 ⇒ undefined
    expect(panelOfSlot(bySlot, 1, 'inCombat')).toBeUndefined()
  }, 60000)

  it('② 钩子拿到的是同一批源面板对象（applyPanel 与 teamPanelEffects 两处派发都透传且互相同实例）', async () => {
    const { config, catalog } = await setupHarness([{ agentId: '1601' }, { agentId: '1661' }, { agentId: '1101' }])
    const { sourcePanelsByOwner, team } = resolveSlotPanelBuffInputs(0, config, catalog)
    const bySlot = buildSourcePanelsBySlot(sourcePanelsByOwner, team)
    const seenPanel: unknown[] = []
    const seenTeam: unknown[] = []
    const sun = getAgentMechanic('1601')!
    const robin = getAgentMechanic('1661')!
    const origApply = sun.applyPanel
    const origTeam = robin.teamPanelEffects
    expect(origApply).toBeTypeOf('function')
    expect(origTeam).toBeTypeOf('function')
    sun.applyPanel = (input) => { seenPanel.push(input.sourcePanels); return origApply!(input) }
    robin.teamPanelEffects = (input) => { seenTeam.push(input.sourcePanels); return origTeam!(input) }
    let phases: ReturnType<typeof computePanelPhases>
    try {
      // 槽0 = 1601（applyPanel 探针）；同一次派发里 1661 的 teamPanelEffects 也会被调到（它给槽0 上防御 buff）
      phases = computePanelPhases(0, config, catalog)
    } finally {
      sun.applyPanel = origApply
      robin.teamPanelEffects = origTeam
    }
    expect(seenPanel.length).toBe(1)
    expect(seenTeam.length).toBeGreaterThan(0)
    // 两处派发点拿到的是**同一个对象**（同一次 computePanelPhases 里建一次、两处透传）
    for (const s of seenTeam) expect(s).toBe(seenPanel[0])
    const table = seenPanel[0] as Record<number, { inCombat?: Record<string, unknown> }>
    // 与 calcPanel 的来源表同值（同一份 buildTeammateBuffSourceContext 的产出，逐位一致）
    expect(table[1]!.inCombat).toEqual(sourcePanelsByOwner['1661']!.inCombat as never)
    expect(table[0]!.inCombat).toEqual(sourcePanelsByOwner['1601']!.inCombat as never)
    // 判据 17：键是槽位号，不是下标——槽 1 的源面板是 1661 的，不能是 1601 的
    expect(table[1]!.inCombat!.hp).toBeCloseTo(sourcePanelsByOwner['1661']!.inCombat!.hp as number, 6)
    expect(table[1]!.inCombat!.hp).not.toBeCloseTo(sourcePanelsByOwner['1601']!.inCombat!.hp as number, 1)
    // 面板本体不受影响（接入零 delta：只是多收一个入参）
    expect(phases!.inCombat.critRate).toBeGreaterThan(0)
    // 源面板视图与 calcPanel 的 owner 表是同一批对象（不是拷贝）
    expect(bySlot[0]!.inCombat).toBe(sourcePanelsByOwner['1601']!.inCombat)
  }, 60000)

  it('③ 面板数量本身不被本批改动影响（接入零 delta：钩子只是多收一个入参）', async () => {
    const { config, catalog } = await setupHarness([{ agentId: '1601' }, { agentId: '1661' }, { agentId: '1101' }])
    const phases = computePanelPhases(0, config, catalog)!
    expect(phases.inCombat.critRate).toBeGreaterThan(0)
    expect(Number.isFinite(phases.inCombat.def)).toBe(true)
    // 空槽 ⇒ null（producer 语义不变）
    expect(computePanelPhases(9, config, catalog)).toBeNull()
  }, 60000)

  it('④ panelOfSlot 缺省容忍：undefined 表 / 未知槽位都返回 undefined（不编造空面板）', () => {
    expect(panelOfSlot(undefined, 0, 'inCombat')).toBeUndefined()
    expect(panelOfSlot({}, 0, 'inCombat')).toBeUndefined()
    const p = emptyPanel()
    expect(panelOfSlot({ 2: { inCombat: p } }, 2, 'inCombat')).toBe(p)
    expect(panelOfSlot({ 2: { inCombat: p } }, 2, 'outOfCombat')).toBeUndefined()
  })
})

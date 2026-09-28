/**
 * CC-52：computeSubstatAllocationForSlot 收拢 ImpactChart 的优化器调用。
 * 第 194 轮：队友 buff 输入与伤害管线同源（`resolveSlotPanelBuffInputs`）。
 * CC-183 / 185（第 206 / 208 轮）：只有一种模式——core useDefault 快速分配作起点 → 真实伤害精修（readDamage 必填）。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { computeOptimalSubStats, getTemplate } from '@/core/substatOptimizer'
import { buildTeammateBuffSourceContext } from '@/core/teammateBuffSource'
import { computeSubstatAllocationForSlot } from '@/composables/substatOptimizer'
import { resolveSlotPanelBuffInputs } from '@/composables/resourceCalc/panelPhases'
import { useResourceCalc } from '@/composables/useResourceCalc'

type Harness = Awaited<ReturnType<typeof setupHarness>>
const sum = (a: Record<string, number>) => Object.values(a).reduce((x, y) => x + y, 0)
function damageOf(h: Harness, slot: number, a: Record<string, number>): number {
  const calc = useResourceCalc()
  const disc = h.config.team[slot]!.driveDisc
  const keep = disc.subStatAllocation
  disc.subStatAllocation = { ...a }
  const d = calc.teamTotalDamage.value ?? 0
  disc.subStatAllocation = keep
  return d
}
const realDamage = () => { const calc = useResourceCalc(); return { readDamage: () => calc.teamTotalDamage.value ?? 0 } }

describe('computeSubstatAllocationForSlot', () => {
  it('起点 = core useDefault 分配（队友 buff 同源）；精修后真实伤害不低于起点、总步数不变（三个槽位）', async () => {
    const h = await setupHarness([{ agentId: '1161' }, { agentId: '1311' }, { agentId: '1211' }], { recommendedBuild: true })
    const { config, catalog } = h
    const seed = (slot: number) => {
      const char = config.team[slot]!
      const agent = catalog.getAgent(char.agentId!)!
      const setInfo = resolveSlotPanelBuffInputs(slot, config, catalog)
      const sc = getTemplate(agent).stats.length
      const tsk = sc <= 2 ? 'optimizer.totalSteps2' : sc === 3 ? 'optimizer.totalSteps3' : 'optimizer.totalSteps4'
      return computeOptimalSubStats({
        agent, wEngine: char.wEngineId ? catalog.getWEngine(char.wEngineId) : undefined,
        driveDiscConfig: char.driveDisc, setsMap: catalog.driveDiscSetsMap,
        teammateBuffs: setInfo.teammateBuffs, statRules: catalog.statRules,
        statCap: config.getMechanicSetting('optimizer.substatCap', 20), totalSteps: config.getMechanicSetting(tsk, 0),
        useDefault: true,
        config: { cinemaLevel: char.cinemaLevel ?? 0, wEngineModLevel: char.wEngineModLevel ?? 1, potentialLevel: char.potentialLevel, sourcePanelsByOwner: setInfo.sourcePanelsByOwner, effectCoverageMap: setInfo.effectCoverageMap, enemyWeakness: config.enemy.weakness },
      }).subStatAllocation
    }
    for (const slot of [0, 1, 2]) {
      const s0 = seed(slot)
      // maxEvals=1 ⇒ 只评估起点、不挪步：返回值即起点本身（钉「起点 = useDefault」）
      expect(computeSubstatAllocationForSlot(slot, config, catalog, { ...realDamage(), maxEvals: 1 })).toEqual(
        Object.fromEntries(Object.entries(s0).filter(([, n]) => n > 0)))
      const got = computeSubstatAllocationForSlot(slot, config, catalog, realDamage())!
      expect(Object.keys(got).length).toBeGreaterThan(0)
      expect(sum(got)).toBe(sum(s0))
      expect(damageOf(h, slot, got)).toBeGreaterThanOrEqual(damageOf(h, slot, s0))
    }
  }, 60000)

  it('空槽 ⇒ null', async () => {
    const { config, catalog } = await setupHarness([{ agentId: '1161' }, '', ''])
    expect(computeSubstatAllocationForSlot(1, config, catalog, { readDamage: () => 0 })).toBeNull()
  }, 60000)
})

describe('副词条优化器的队友 buff 输入与伤害管线同源（第 194 轮）', () => {
  it('席德 + 命破队友（额外能力不触发）：原始上下文含「明攻」，管线输入按门控剔除', async () => {
    const { config, catalog } = await setupHarness([{ agentId: '1461' }, { agentId: '1441' }, ''], { recommendedBuild: true })
    const effectIds = (buffs: { effects?: { id: string }[] }[]) => new Set(buffs.flatMap(b => (b.effects ?? []).map(e => e.id)))
    const raw = buildTeammateBuffSourceContext(config.team, {
      teammateBuffGroups: catalog.teammateBuffGroups,
      driveDiscSetsMap: catalog.driveDiscSetsMap,
      statRules: catalog.statRules,
      getAgent: (id) => catalog.getAgent(id),
      getWEngine: (id) => catalog.getWEngine(id),
      isTeammateBuffEnabled: (id) => config.isTeammateBuffEnabled(id),
      enemyWeakness: config.enemy.weakness,
    })
    const brightIds = [...effectIds(raw.enabledTeammateBuffs
      .filter(b => b.id === 'seed.core_vanguard_bright_attack'))]
    expect(brightIds.length).toBeGreaterThan(0) // 原始上下文里有明攻：否则本用例无判别力
    const piped = effectIds(resolveSlotPanelBuffInputs(1, config, catalog).teammateBuffs)
    for (const id of brightIds) expect(piped.has(id), id).toBe(false)
  }, 60000)

  // CC-183（第 206 轮）：真实伤害精修。1591 精修相对推荐分配（= useDefault 起点）严格改进，用作判别样本。
  it('refine：真实伤害严格高于推荐分配、恢复原分配、maxEvals 封顶', async () => {
    const h = await setupHarness([{ agentId: '1591' }, '', ''], { recommendedBuild: true })
    const { config, catalog } = h
    const original = { ...config.team[0]!.driveDisc.subStatAllocation }
    const calc = useResourceCalc()
    let evals = 0
    const refined = computeSubstatAllocationForSlot(0, config, catalog, { readDamage: () => { evals++; return calc.teamTotalDamage.value ?? 0 } })!
    expect(config.team[0]!.driveDisc.subStatAllocation).toEqual(original)
    expect(evals).toBeGreaterThan(1)
    expect(evals).toBeLessThanOrEqual(80)
    expect(sum(refined)).toBe(sum(original)) // 只挪步不增步
    expect(damageOf(h, 0, refined)).toBeGreaterThan(damageOf(h, 0, original)) // 本样本有严格改进，否则用例无判别力
    let capped = 0
    computeSubstatAllocationForSlot(0, config, catalog, { readDamage: () => { capped++; return calc.teamTotalDamage.value ?? 0 }, maxEvals: 5 })
    expect(capped).toBeLessThanOrEqual(5)
  }, 60000)

  // CC-184（第 207 轮）：打分式看不到的属性（克拉蕾吃防御）边际恒 0，旧版贪心提前终止只分 20/39 步。
  // CC-185 起编排层不走贪心，此用例改钉 core 贪心本身（store useDefault=0 分支仍用它）。
  it('core 贪心分配用满步数预算（与推荐快速路径同总步数）', async () => {
    const { config, catalog } = await setupHarness([{ agentId: '1611' }, '', ''], { recommendedBuild: true })
    const char = config.team[0]!
    const rec = sum(char.driveDisc.subStatAllocation ?? {})
    expect(rec).toBe(39)
    const greedy = computeOptimalSubStats({
      agent: catalog.getAgent('1611')!, wEngine: char.wEngineId ? catalog.getWEngine(char.wEngineId) : undefined,
      driveDiscConfig: char.driveDisc, setsMap: catalog.driveDiscSetsMap, teammateBuffs: [], statRules: catalog.statRules,
      config: { cinemaLevel: char.cinemaLevel ?? 0, wEngineModLevel: char.wEngineModLevel ?? 1, potentialLevel: char.potentialLevel, enemyWeakness: config.enemy.weakness },
    }).subStatAllocation
    expect(sum(greedy)).toBe(rec)
  }, 60000)
})

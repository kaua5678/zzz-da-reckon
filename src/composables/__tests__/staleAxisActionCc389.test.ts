/**
 * CC-389 锁：失衡轴里「换人后残留的别人的动作」不得执行。
 *
 * 轴动作存 `{ slot, moveId }`，换人不改轴。修前新角色招式表查不到旧 moveId ⇒ buildStackAxes 成本全 0 ⇒
 * 栈遍历当免费零时长动作执行（换上来的 1311 执行席德 1461015 ×4、连段 xide-bengzhui ×6，伤害 +6.5%）。
 * 判据：带旧轴换人 = 换人前先删掉该槽动作（同一条 setAgent 路径，配装 / 命座一致，只差轴）。
 * 反向：全部预设（固定轴 + 条件方案的固定轴）在各自原队伍上没有一个动作被判残留（残留判据只丢「能证明属于别人」的动作）。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { stunAxisPresets, cloneStunAxes } from '@/data/stunAxisPresets'
import type { StunAxis } from '@/types/resource'
import { isStaleAxisActionFor } from '@/composables/resourceCalc/roundInputs'

const tick = () => new Promise(r => setTimeout(r, 40))
const REPLACEMENT = '1311'
const FIXED = stunAxisPresets.filter(p => p.axes && p.axes.length > 0 && !p.team.includes('*') && !p.team.includes(REPLACEMENT))

function staleSlotOf(axes: StunAxis[]): number {
  const slots = new Set(axes.flatMap(a => a.actions.map(x => x.slot)))
  return [...slots].find(x => x !== 0) ?? 0
}

async function run(team: readonly string[], axes: StunAxis[], swap?: { slot: number; agentId: string }) {
  const { config } = await setupHarness(team.map(agentId => ({ agentId })))
  config.autoYidhariAxis = false
  config.stunAxes = axes
  config.stunAxisPlans = []
  config.useStunAxis = true
  const calc = useResourceCalc()
  await tick()
  if (swap) { config.setAgent(swap.slot, swap.agentId); await tick() }
  const executed = (calc.stackTraversalResult.value as { executed?: Record<string, { count: number }> } | null)?.executed ?? {}
  const effectiveActions = calc.effectiveStunAxes.value.reduce((n, a) => n + a.actions.length, 0)
  return { dmg: calc.teamTotalDamage.value, executed, effectiveActions }
}

describe('CC-389 失衡轴残留的别人的动作不执行', () => {
  it('夹具前提：至少一个固定轴预设可用', () => {
    expect(FIXED.length).toBeGreaterThan(0)
  })

  for (const preset of FIXED) {
    it(`${preset.id}：带旧轴换人 = 换人前删掉该槽动作；该槽无执行记录`, async () => {
      const s = staleSlotOf(preset.axes!)
      const staleCount = preset.axes!.reduce((n, a) => n + a.actions.filter(x => x.slot === s).length, 0)
      expect(staleCount, '反空洞：该槽在轴里确有动作').toBeGreaterThan(0)
      const swap = { slot: s, agentId: REPLACEMENT }
      const stale = await run(preset.team, cloneStunAxes(preset.axes!), swap)
      const stripped = await run(preset.team,
        cloneStunAxes(preset.axes!).map(ax => ({ ...ax, actions: ax.actions.filter(x => x.slot !== s) })), swap)
      expect(Object.keys(stale.executed).filter(k => k.startsWith(`${s}:`))).toEqual([])
      expect(stale.dmg / stripped.dmg - 1).toBeCloseTo(0, 9)
    })
  }

  it('判据反向：全部预设在原队伍上零误判（谁都不认领的合成行如雨果 1291_ultimate_verdict_bonus 也保留）', async () => {
    const { catalog } = await setupHarness([{ agentId: '1211' }, { agentId: '1181' }, { agentId: '1031' }])
    let checked = 0
    const misjudged: string[] = []
    for (const p of stunAxisPresets) {
      const team = p.team.map(id => ({ agentId: id === '*' ? '' : id }))
      const axesList = [...(p.axes ? [p.axes] : []), ...(p.plans ?? []).filter(pl => pl.axes).map(pl => pl.axes!)]
      for (const axes of axesList) for (const ax of axes) for (const act of ax.actions) {
        if (p.team[act.slot] === '*') continue
        checked++
        if (isStaleAxisActionFor(act, team, catalog)) misjudged.push(`${p.id}:${act.slot}:${act.moveId}`)
      }
    }
    expect(checked, '反空洞').toBeGreaterThan(100)
    expect(misjudged).toEqual([])
  })

  it('判据正向：旧角色的招式 / 连段放到别人槽上判残留；basic 不判', async () => {
    const { catalog } = await setupHarness([{ agentId: '1211' }, { agentId: '1181' }, { agentId: '1031' }])
    const team = [{ agentId: '1311' }, { agentId: '1181' }, { agentId: '1031' }]
    expect(isStaleAxisActionFor({ slot: 0, moveId: '1461015', count: 1 }, team, catalog)).toBe(true)
    expect(isStaleAxisActionFor({ slot: 0, moveId: 'xide-bengzhui', count: 1 }, team, catalog)).toBe(true)
    expect(isStaleAxisActionFor({ slot: 0, moveId: 'basic', count: 3 }, team, catalog)).toBe(false)
  })
})

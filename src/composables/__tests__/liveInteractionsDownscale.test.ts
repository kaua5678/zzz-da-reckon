/**
 * CC-263：难度 x 的交互次数必须按引擎非轴降配（`interactionScale`）同口径缩放。
 * 修前 x 读 store 原值：auto-1431-1341-1481 引擎 scale 0.5 实打弹刀 / 闪反各减半，x 仍按满额计。
 * 单一来源：`resourceCalc/feasibilitySearch#DOWNSCALED_INTERACTION_FIELDS` + `downscaleInteractionCount`。
 *
 * ⚠ 夹具沿革（2026-10-09，预设库重生成 85→77 条）：原夹具 `auto-1431-1481-1341` 已从库中消失
 * （同 3 名角色槽序不同 ⇒ 新 id `auto-1431-1341-1481`，且来自另一条实战 run：金数 5→6、
 * 照的音擎由 `14134` 变空、琉音由 `14148` 变 `13005`）。
 * 换成**存活且仍处于降配态**的 `auto-1431-1341-1481`（实测 scale 0.5，与旧夹具同档）。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { teamPresets } from '@/data/teamPresets'
import { applyTeamToStore } from '@/composables/teamCompare'
import { engineInteractionItems, liveInteractions } from '@/composables/liveInteractions'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { DOWNSCALED_INTERACTION_FIELDS, downscaleInteractionCount } from '@/composables/resourceCalc/feasibilitySearch'

describe('CC-263 难度 x 认引擎降配', () => {
  it('取整口径：缺省 / ≥1 原值，否则 round(raw × scale)', () => {
    expect(downscaleInteractionCount(6, undefined)).toBe(6)
    expect(downscaleInteractionCount(6, 1)).toBe(6)
    expect(downscaleInteractionCount(6, 0.5)).toBe(3)
    expect(downscaleInteractionCount(5, 0.625)).toBe(3)
    expect(downscaleInteractionCount(10, 0.875)).toBe(9)
  })

  it('降配队：engineInteractionItems 的弹刀 / 闪反 = Σ round(store × scale)，liveInteractions 随之缩', async () => {
    const { config } = await setupHarness(['', '', ''], { recommendedBuild: false })
    const calc = useResourceCalc()
    const preset = teamPresets.find(p => p.id === 'auto-1431-1341-1481')!
    applyTeamToStore(config, preset)
    /**
     * ⚠ **必须显式给交互次数**（2026-10-23 修，判据本意不变）：2026-10-21「交互默认全 0」之后，
     * 预设不再预填弹刀/闪反 ⇒ 全 0 的队不会触发降配（实测 interactionScale === undefined，
     * 本用例的「样例须处于降配态」前提失效 ⇒ toBeLessThan 对 undefined 抛 TypeError）。
     * 本用例量的是「降配后 x 认引擎缩量」，不是「某个预设当前恰好处于降配态」⇒ 显式造出降配态。
     * 实测该夹具在本值上 scale = 0.625（三槽 parry/dodge 各 6 ⇒ 各缩到 4）。
     */
    for (let slot = 0; slot < 3; slot++) {
      config.setActionCount(slot, 'parryCount', 6)
      config.setActionCount(slot, 'dodgeCounterCount', 6)
    }
    const rr = calc.resourceResult.value!
    const scale = rr.convergence?.interactionScale
    expect(scale, '样例须处于降配态').toBeLessThan(1)
    const items = engineInteractionItems(config, (_s, raw) => raw, scale)
    const sumScaled = (field: 'parryCount' | 'dodgeCounterCount') =>
      config.team.reduce((a, c) => a + downscaleInteractionCount(Number(c[field] ?? 0), scale), 0)
    expect(items.find(i => i.type === 'parry')!.count).toBe(sumScaled('parryCount'))
    expect(items.find(i => i.type === 'dodge')!.count).toBe(sumScaled('dodgeCounterCount'))
    const total = (xs: { count: number }[]) => xs.reduce((a, i) => a + i.count, 0)
    const live = total(liveInteractions(config, preset, rr))
    const unscaled = total(liveInteractions(config, preset, { ...rr, convergence: { ...rr.convergence, interactionScale: undefined } }))
    expect(live).toBeLessThan(unscaled)
  }, 120_000)

  it('源码锁：引擎按单一来源字段表缩放，不再逐字段手写', () => {
    const src = readFileSync(new URL('../resourceCalc/convergence.ts', import.meta.url), 'utf8')
      .split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
    expect(src).toMatch(/for \(const f of DOWNSCALED_INTERACTION_FIELDS\)/)
    expect(src).not.toMatch(/merged\.(parryCount|blockCount|dualCounterCount|dodgeCounterCount) = Math\.round/)
    expect([...DOWNSCALED_INTERACTION_FIELDS]).toEqual(['parryCount', 'blockCount', 'dualCounterCount', 'dodgeCounterCount', 'autoEvadeCount'])
  })
})

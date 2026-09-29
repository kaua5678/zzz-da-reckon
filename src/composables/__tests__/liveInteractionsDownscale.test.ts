/**
 * CC-263：难度 x 的交互次数必须按引擎非轴降配（`interactionScale`）同口径缩放。
 * 修前 x 读 store 原值：auto-1431-1481-1341 引擎 scale 0.5 实打弹刀 / 闪反各减半，x 仍按满额计（60.7 → 应为 42.7）。
 * 单一来源：`resourceCalc/feasibilitySearch#DOWNSCALED_INTERACTION_FIELDS` + `downscaleInteractionCount`。
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
    const preset = teamPresets.find(p => p.id === 'auto-1431-1481-1341')!
    applyTeamToStore(config, preset)
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
    expect([...DOWNSCALED_INTERACTION_FIELDS]).toEqual(['parryCount', 'blockCount', 'dualCounterCount', 'dodgeCounterCount'])
  })
})

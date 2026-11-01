/**
 * 二元相位时序（`core/stunPhaseTimeline.ts`）的验收锁。
 *
 * 三件事：
 * ① **恒等式**（零容差）：`Σ phases[].seconds === effectiveTime`，且 `buildSeconds + windowSeconds === effectiveTime`；
 * ② **二元交替**：`build → window → build → window → … → build`（余量段收尾），窗段的 `stunBuildUp` 恒 0（窗内失衡作废）；
 * ③ **不编造**：非轴队 / net=0 ⇒ `hasTrace=false`、`phases` 空；一窗没开 ⇒ 整局一段积攒。
 *
 * 真管线面（3 支般岳队 + 佩洛伊斯决算队）：函数吃 `useResourceCalc` 的真读数，恒等式照样成立。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { buildStunTimeline, type StunWindowTrace } from '@/core/stunTimeline'
import { buildStunPhaseTimeline } from '@/core/stunPhaseTimeline'
import { teamPresets } from '@/data/teamPresets'

const trace = (i: number, over: Partial<StunWindowTrace> = {}): StunWindowTrace => ({
  index: i, axisIndex: 0, fillerDefaulted: false, fillSegments: [], idleSegments: [],
  nominalSeconds: 16, extendSeconds: 0, endSeconds: 16, truncated: false,
  actions: [], actionSeconds: 0, overlapSeconds: 0, fillSeconds: 0, ...over,
})

describe('buildStunPhaseTimeline 纯函数（二元相位骨架）', () => {
  it('① 恒等式零容差 + 二元交替 + 窗段不攒条', () => {
    // 2 窗 × 16s、战斗 100s ⇒ 窗外 68s；b=10、net=25 ⇒ 开窗成本 20、余量 5
    const tl = buildStunTimeline({
      stunCount: 2, windowDuration: 16, effectiveTime: 100,
      windows: [
        trace(0, { actionSeconds: 16, actions: [{ slot: 0, moveId: 'burst', count: 1, inAxisCount: 1, startTime: 0, actionTime: 16 }] }),
        trace(1, { actionSeconds: 16 }),
      ],
    })
    const ph = buildStunPhaseTimeline({ timeline: tl, totalStunBuildUp: 25, bossStunValue: 10 })
    expect(ph.hasTrace).toBe(true)
    expect(ph.phases.map(p => p.kind)).toEqual(['build', 'window', 'build', 'window', 'build'])
    expect(ph.phases.reduce((s, p) => s + p.seconds, 0), 'Σ 相位秒 === 有效战斗时间').toBe(100)
    expect(ph.buildSeconds + ph.windowSeconds).toBe(100)
    expect(ph.windowSeconds).toBe(32)
    expect(ph.windowCount).toBe(2)
    expect(ph.trailingStun, '余量 = net − Σ开窗成本').toBe(5)
    expect(ph.trailingSeconds).toBeCloseTo(5 / (25 / 68), 9)
    expect(ph.phases.filter(p => p.kind === 'window').every(p => p.stunBuildUp === 0), '窗内失衡作废').toBe(true)
    expect(ph.phases.filter(p => p.kind === 'build').reduce((s, p) => s + p.stunBuildUp, 0), '积攒段失衡值合计 = net').toBe(25)
    // 窗段携带**有序**的吃易伤动作；积攒段无逐动作顺序（引擎只有分桶总量）
    expect(ph.phases.filter(p => p.kind === 'window')[0]!.actions.map(a => a.moveId), '第 1 窗动作').toEqual(['burst'])
    expect(ph.phases.filter(p => p.kind === 'build').every(p => p.actions.length === 0), '积攒段无逐动作顺序').toBe(true)
    // 部分窗（候选分母 A = 余量/b）：余量 5 / b 10 = 0.5 窗 ⇒ 0.5 × 16 = 8s
    expect(ph.trailingFraction, '候选分母 A：余量/b').toBeCloseTo(0.5, 9)
    expect(ph.trailingWindowSeconds, '部分窗时长 = frac × 名义窗长').toBeCloseTo(8, 9)
  })

  it('② 非轴队 / net=0 ⇒ 不编造（phases 空）', () => {
    const noTrace = buildStunTimeline({ stunCount: 2, windowDuration: 16, effectiveTime: 100 })
    expect(buildStunPhaseTimeline({ timeline: noTrace, totalStunBuildUp: 25, bossStunValue: 10 }).hasTrace).toBe(false)
    const tl = buildStunTimeline({ stunCount: 2, windowDuration: 16, effectiveTime: 100, windows: [trace(0)] })
    const zeroNet = buildStunPhaseTimeline({ timeline: tl, totalStunBuildUp: 0, bossStunValue: 10 })
    expect(zeroNet.hasTrace).toBe(false)
    expect(zeroNet.phases).toEqual([])
  })

  it('③ 一窗没开（slots 空）⇒ 整局一段积攒', () => {
    const tl = buildStunTimeline({ stunCount: 0, windowDuration: 16, effectiveTime: 100, windows: [trace(0)] })
    expect(tl.slots.length).toBe(0)
    const ph = buildStunPhaseTimeline({ timeline: tl, totalStunBuildUp: 7, bossStunValue: 10 })
    expect(ph.hasTrace).toBe(true)
    expect(ph.phases.length).toBe(1)
    expect(ph.phases[0]!.kind).toBe('build')
    expect(ph.phases[0]!.seconds).toBe(100)
    expect(ph.phases[0]!.stunBuildUp).toBe(7)
  })
})

describe('真管线：相位恒等式（3 般岳 + 佩洛伊斯）', () => {
  const IDS = ['banyue-jufufu-lucia', 'banyue-trigger-lucia', 'banyue-roxy-lucia']
  it('每队 Σ相位秒 === 有效战斗时间', async () => {
    for (const id of IDS) {
      const preset = teamPresets.find(p => p.id === id)
      expect(preset, `预设 ${id} 不存在`).toBeTruthy()
      const { catalog } = await setupHarness(['', '', ''])
      await catalog.loadBuildRecommendations()
      const config = useConfigStore()
      for (let i = 0; i < 3; i++) config.setAgent(i, preset!.team[i])
      config.applyTeamPreset(preset!.team as [string, string, string])
      const calc = useResourceCalc()
      const pool = calc.stunPoolResult.value
      const ph = calc.stunPhaseTimeline.value
      expect(pool, `${id} 无池`).toBeTruthy()
      expect(ph, `${id} 无相位读数`).toBeTruthy()
      if (ph!.hasTrace) {
        expect(ph!.phases.reduce((s, p) => s + p.seconds, 0), `${id} 恒等式`).toBe(ph!.effectiveTime)
        expect(ph!.buildSeconds + ph!.windowSeconds, `${id} 积攒+窗`).toBe(ph!.effectiveTime)
      }
    }
  }, 900_000)
})
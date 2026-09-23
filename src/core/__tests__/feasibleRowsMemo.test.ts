/**
 * `feasibleRows` 作用域内单槽记忆 + 环检测快照存引用 + `resolveMechanicSettings` 直读 state
 * 的等价性与边界（2026-09-23 mcp-engine-r2，口径见 `core/resource/rowBuild.ts#withFeasibleRowsMemo`）。
 *
 * ① 作用域外恒重算（返回新数组），作用域内同参数命中（返回同一数组），任一键变化即重算；
 * ② 作用域退出清槽，不跨调用持有引用；嵌套作用域沿用外层；fn 抛错后作用域也正确关闭；
 * ③ 端到端：多预设 × 命座 0/6 的完整 resourceResult 在「记忆命中」路径下与「逐次重算」路径逐位相同
 *    （以 `feasibleRows` 的 mock 强制关闭记忆作对照臂）且确有命中；
 * ④ resolveMechanicSettings 直读口径 = `configStore.getMechanicSetting` 逐项相同（含非有限值回落 default）。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { mockStaticFetch, newPinia, setupHarness } from '@/test/harness'
import { feasibleRows, getFeasibleRowsMemoHits, setFeasibleRowsMemoEnabled, withFeasibleRowsMemo } from '@/core/resource/rowBuild'
import { setCalcOutputMemoEnabled, useResourceCalc } from '@/composables/useResourceCalc'
import { applyTeamToStore } from '@/composables/teamCompare'
import { resolveMechanicSettings } from '@/composables/resourceCalc/panelPhases'
import { getRegisteredMechanicSettings } from '@/mechanics'
import { teamPresets } from '@/data/teamPresets'
import { clearWarmStartCache } from '@/core/resource'
import type { CharacterOperationConfig, IterationState } from '@/types/resource'

beforeEach(() => { newPinia(); mockStaticFetch(); clearWarmStartCache() })

const enc = (v: unknown) => JSON.stringify(v, (_k, x) =>
  typeof x === 'number' ? (Number.isNaN(x) ? '#NaN' : !Number.isFinite(x) ? `#${x}` : Object.is(x, -0) ? '#-0' : x) : x)

async function firstCfgAndState(presetId: string) {
  const { catalog, config } = await setupHarness(['', '', ''], { recommendedBuild: false })
  await catalog.loadBuildRecommendations()
  const calc = useResourceCalc()
  applyTeamToStore(config, teamPresets.find(p => p.id === presetId)!)
  const rc = calc.resourceConfig.value!
  const rr = calc.resourceResult.value!
  const cfg = rc.characters[0]! as CharacterOperationConfig
  const c0 = rr.characters[0]!
  const state: IterationState = {
    basicAttackTime: c0.timeAllocation?.basicAttackTime ?? 60,
    exSpecialCount: c0.exSpecialCount, ultimateCount: c0.ultimateCount,
    chainCountTotal: c0.chainCountTotal ?? 0, totalEnergy: 0, totalDecibel: 0,
    necessaryTime: c0.timeAllocation?.necessaryTime ?? 0, frontlineTime: 120, backstageTime: 60,
    comboAlignTime: 0, comboAlignCredit: 0,
  }
  return { cfg, state, calc, config }
}

describe('feasibleRows 作用域记忆', () => {
  it('作用域外恒重算；作用域内同参数命中、改任一键即重算；退出清槽', async () => {
    const { cfg, state } = await firstCfgAndState('auto-1461-1521-1361')
    const a = feasibleRows(cfg, state, 3, 50)
    const b = feasibleRows(cfg, state, 3, 50)
    expect(b).not.toBe(a)
    expect(enc(b)).toBe(enc(a))

    const h0 = getFeasibleRowsMemoHits()
    withFeasibleRowsMemo(() => {
      const x = feasibleRows(cfg, state, 3, 50)
      expect(feasibleRows(cfg, state, 3, 50)).toBe(x)
      expect(getFeasibleRowsMemoHits() - h0).toBe(1)
      // 每个键单独变化都失效
      expect(feasibleRows(cfg, state, 4, 50)).not.toBe(x)
      expect(feasibleRows(cfg, state, 3, 51)).not.toBe(x)
      expect(feasibleRows(cfg, { ...state }, 3, 50)).not.toBe(x)
      expect(feasibleRows({ ...cfg }, state, 3, 50)).not.toBe(x)
      expect(feasibleRows(cfg, state, 3, 50, 10)).not.toBe(x)
      // 内容与作用域外逐位相同
      expect(enc(feasibleRows(cfg, state, 3, 50))).toBe(enc(a))
      // 嵌套作用域沿用外层（不提前关闭）
      const y = feasibleRows(cfg, state, 3, 50)
      withFeasibleRowsMemo(() => { expect(feasibleRows(cfg, state, 3, 50)).toBe(y) })
      expect(feasibleRows(cfg, state, 3, 50)).toBe(y)
    })
    // 退出后清槽：不再命中
    const h1 = getFeasibleRowsMemoHits()
    feasibleRows(cfg, state, 3, 50)
    expect(getFeasibleRowsMemoHits()).toBe(h1)
    // 抛错后作用域仍关闭
    expect(() => withFeasibleRowsMemo(() => { throw new Error('boom') })).toThrow('boom')
    const c1 = feasibleRows(cfg, state, 3, 50)
    expect(feasibleRows(cfg, state, 3, 50)).not.toBe(c1)
  }, 120_000)

  it('端到端 A/B：多预设 × 命座 0/6 × 降配扫描，记忆开/关完整结果逐位相同且确有命中', async () => {
    const { catalog, config } = await setupHarness(['', '', ''], { recommendedBuild: false })
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    setCalcOutputMemoEnabled(false)
    const run = (on: boolean) => {
      setFeasibleRowsMemoEnabled(on)
      const trail: string[] = []
      for (const id of ['auto-1461-1521-1361', 'banyue-liuyin-lucia', 'auto-1041-1161-1311', 'auto-1431-1481-1491']) {
        const p = teamPresets.find(x => x.id === id)
        expect(p, id).toBeTruthy()
        for (const c of [0, 6]) {
          clearWarmStartCache()
          applyTeamToStore(config, p!)
          config.setCinemaLevel(0, c)
          // 命座→队友 buff 的重同步走异步 watch；同步读之前显式同步，否则会继承上一预设同槽命座的残留 buff
          // （两臂起点不同 ⇒ 假阳性；2026-09-23 排查实锤，见 docs/mcp-engine-perf-r2.md）
          config.syncTeammateBuffsFromTeam()
          trail.push(`${calc.teamTotalDamage.value}|${enc(calc.resourceResult.value)}`)
        }
        // 交互加码 ⇒ 逼出非轴降配扫描（多档 runOuterLoop）
        config.team[0]!.parryCount = (config.team[0]!.parryCount ?? 0) + 25
        config.team[0]!.dodgeCounterCount = (config.team[0]!.dodgeCounterCount ?? 0) + 25
        clearWarmStartCache()
        trail.push(`${calc.teamTotalDamage.value}|${enc(calc.resourceResult.value)}`)
      }
      return trail
    }
    try {
      const off = run(false)
      const h0 = getFeasibleRowsMemoHits()
      expect(getFeasibleRowsMemoHits() - h0, '关闭臂不得命中').toBe(0)
      const on = run(true)
      expect(getFeasibleRowsMemoHits() - h0).toBeGreaterThan(0)
      expect(on.length).toBe(off.length)
      for (let i = 0; i < on.length; i++) expect(on[i], `case ${i}`).toBe(off[i])
    } finally {
      setCalcOutputMemoEnabled(true)
      setFeasibleRowsMemoEnabled(true)
    }
  }, 300_000)
})

describe('resolveMechanicSettings 直读 state', () => {
  it('与 configStore.getMechanicSetting 逐项相同（含非有限值回落 default）', async () => {
    const { config } = await setupHarness([{ agentId: '1461' }, { agentId: '1521' }, { agentId: '1361' }], { recommendedBuild: false })
    const regs = getRegisteredMechanicSettings()
    expect(regs.length).toBeGreaterThan(10)
    // 三类值：用户有限值 / NaN / Infinity（绕过 setMechanicSetting 的归一，直接写 state）
    config.mechanicSettings[regs[0]!.id] = 0.37
    config.mechanicSettings[regs[1]!.id] = Number.NaN
    config.mechanicSettings[regs[2]!.id] = Number.POSITIVE_INFINITY
    ;(config.mechanicSettings as Record<string, unknown>)[regs[3]!.id] = '5'
    const got = resolveMechanicSettings(config)
    for (const s of regs) expect(got[s.id], s.id).toBe(config.getMechanicSetting(s.id, s.default))
    expect(got[regs[0]!.id]).toBe(0.37)
    expect(got[regs[1]!.id]).toBe(regs[1]!.default)
    expect(got[regs[2]!.id]).toBe(regs[2]!.default)
    expect(got[regs[3]!.id]).toBe(regs[3]!.default)
  })
})


/**
 * 伤害影响分析采样（composables/impactSampling，CC-345）判据：
 * ① 隔离：曲线（含「未设置 ⇒ 取覆盖率自动值」的异放占比变量、逐点优化副词条、快照换队）与响应面跑完，
 *    UI config store 的 $state 逐字不变，采样途中（每次进度回报时）也不变——旧实现逐点改写 UI store、跑完写回原值，
 *    写回会把「未设置」变成显式值（机制设置里凭空多出一个键）；
 * ② 等值：曲线上每个点 = 在 UI store 上把变量写成该值、等一拍后读到的总伤（旧实现的读数口径）；
 * ③ 边界：变量不属于场景 ⇒ 曲线空 / 响应面 null；取消 ⇒ 曲线返回已算部分、响应面 complete=false。
 * 与旧组件内采样循环的 A/B（逐字节相同）见 docs/mcp-analyzer-scenario-isolation.md §3.6。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { withAnalysisScenario } from '@/composables/analysisScenario'
import { impactVariableView, sampleImpactCurve, sampleImpactSurface } from '@/composables/impactSampling'
import { readImpactVariable, writeImpactVariable } from '@/composables/impactVariables'

const tick = () => new Promise(resolve => setTimeout(resolve, 0))
const TEAM = [{ agentId: '1171' }, { agentId: '1021' }, { agentId: '1131' }]
const SHARE_VAR = 'setting.burnice.releaseShare:fire'

async function source() {
  const h = await setupHarness(TEAM, { recommendedBuild: true })
  await tick()
  return h
}

describe('伤害影响分析采样（独立场景）', () => {
  it('① 曲线与响应面不改写 UI store（途中与跑完）', async () => {
    const { config } = await source()
    expect(config.mechanicSettings[SHARE_VAR.slice('setting.'.length)]).toBeUndefined()
    const before = JSON.stringify(config.$state)
    const during: string[] = []
    const snapTeam = JSON.parse(JSON.stringify(config.team))
    snapTeam[0].cinemaLevel = 6
    const main = await withAnalysisScenario(s => sampleImpactCurve(s, {
      varId: SHARE_VAR, points: 4, optimizePerPoint: true, onProgress: () => during.push(JSON.stringify(config.$state)),
    }))
    const snap = await withAnalysisScenario(s => sampleImpactCurve(s, {
      varId: SHARE_VAR, points: 4, team: snapTeam, onProgress: () => during.push(JSON.stringify(config.$state)),
    }))
    const surface = await withAnalysisScenario(s => sampleImpactSurface(s, {
      varX: SHARE_VAR, varY: 'bossStunValue', n: 3, onProgress: () => during.push(JSON.stringify(config.$state)),
    }))
    expect(main).toHaveLength(4)
    expect(snap).toHaveLength(4)
    expect(surface?.complete).toBe(true)
    expect(new Set(main.map(p => p.y)).size).toBeGreaterThan(1)
    expect(during.length).toBeGreaterThan(0)
    for (const s of during) expect(s).toBe(before)
    expect(JSON.stringify(config.$state)).toBe(before)
  }, 60000)

  it('① 反例：旧实现的「写回原值」恢复会改写现场（未设置 ⇒ 显式值）', async () => {
    const { config } = await source()
    const calc = useResourceCalc()
    const { settingMap } = impactVariableView({ config, calc })
    const coverage = calc.anomalyPoolResult.value?.coverage?.perElementCoverageRate
    const before = JSON.stringify(config.$state)
    const orig = readImpactVariable(SHARE_VAR, config, settingMap, coverage)
    writeImpactVariable(SHARE_VAR, 0, config, settingMap)
    writeImpactVariable(SHARE_VAR, orig, config, settingMap)
    await tick()
    expect(config.mechanicSettings[SHARE_VAR.slice('setting.'.length)]).toBeDefined()
    expect(JSON.stringify(config.$state)).not.toBe(before)
  }, 60000)

  it('② 曲线点 = UI store 上写该值后的读数', async () => {
    const { config } = await source()
    const pts = await withAnalysisScenario(s => sampleImpactCurve(s, { varId: 'bossStunValue', points: 3 }))
    expect(pts).toHaveLength(3)
    const calc = useResourceCalc()
    const { settingMap } = impactVariableView({ config, calc })
    for (const p of pts) {
      writeImpactVariable('bossStunValue', p.x, config, settingMap)
      await tick()
      expect(calc.teamTotalDamage.value).toBe(p.y)
    }
  }, 60000)

  it('③ 未知变量 ⇒ 空；取消 ⇒ 已算部分', async () => {
    await source()
    expect(await withAnalysisScenario(s => sampleImpactCurve(s, { varId: 'nope', points: 3 }))).toEqual([])
    expect(await withAnalysisScenario(s => sampleImpactSurface(s, { varX: 'nope', varY: 'bossStunValue', n: 3 }))).toBeNull()
    const ac = new AbortController()
    const part = await withAnalysisScenario(s => sampleImpactCurve(s, {
      varId: 'bossStunValue', points: 10, control: { signal: ac.signal }, onProgress: done => { if (done === 2) ac.abort() },
    }))
    expect(part).toHaveLength(2)
    const ac2 = new AbortController()
    const surf = await withAnalysisScenario(s => sampleImpactSurface(s, {
      varX: 'bossStunValue', varY: 'totalTime', n: 4, control: { signal: ac2.signal }, onProgress: () => ac2.abort(),
    }))
    expect(surf?.complete).toBe(false)
  }, 60000)
})

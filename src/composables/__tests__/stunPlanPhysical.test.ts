/**
 * CC-140（第 164 轮）：计数通道 `stunPlanProjection = 'physical'`（编码 4）。
 * 背景与实测见 docs/mcp-stun-dual-source.md §4–§5：外层计划值被必要时间约束压低，
 * 21/104 队「失衡 N 次、失衡连携 0 次」。本模式让连携/喧响/能量计数改读上一外层轮的池物理次数。
 *
 * 缺省仍是 'off'（未切默认，理由见文档 §5）。第二个用例**钉住现行缺陷**：若有人改好了缺省口径，
 * 这条会红——那时把它改成「缺省下也有失衡连携」并更新文档，不要删。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { teamPresets } from '@/data/teamPresets'
import { projectStunPlanForCounts, stunPlanProjectionFromCode, STUN_PLAN_PROJECTION_MODES } from '@/core/stunPlanProjection'

describe('projectStunPlanForCounts: physical 模式', () => {
  it('编码 4 = physical；越界仍回落 off', () => {
    expect(STUN_PLAN_PROJECTION_MODES[4]).toBe('physical')
    expect(stunPlanProjectionFromCode(4)).toBe('physical')
    expect(stunPlanProjectionFromCode(5)).toBe('off')
  })
  it('有物理次数时用物理次数；首轮缺省回落计划值；其他模式忽略 physical 参数', () => {
    expect(projectStunPlanForCounts(0.37, 'physical', 3)).toBe(3)
    expect(projectStunPlanForCounts(0.37, 'physical', undefined)).toBe(0.37)
    expect(projectStunPlanForCounts(0.37, 'physical', Number.NaN)).toBe(0.37)
    expect(projectStunPlanForCounts(0.37, 'off', 3)).toBe(0.37)
    expect(projectStunPlanForCounts(2.6, 'floor', 5)).toBe(2)
  })
})

async function stunChainSeconds(presetId: string, projectionCode: number) {
  const p = teamPresets.find(x => x.id === presetId)
  expect(p, `预设 ${presetId} 缺失：换一个「失衡 ≥1、规划 0」的队并更新文档 §5`).toBeTruthy()
  const { catalog, config } = await setupHarness(['', '', ''])
  await catalog.loadBuildRecommendations()
  const calc = useResourceCalc()
  for (let i = 0; i < 3; i++) config.setAgent(i, p!.team[i])
  config.applyTeamPreset(p!.team as [string, string, string])
  config.setMechanicSetting('time.stunPlanProjection', projectionCode)
  const rr = calc.resourceResult.value
  expect(rr).toBeTruthy()
  let chain = 0
  for (const c of rr!.characters) for (const e of c.executions ?? []) {
    if (e.category === 'chain' && e.source === 'stun' && e.timeBucket !== 'backstage') chain += e.totalTime ?? 0
  }
  // 轴态信号（用于区分两条连携口径，§20.5-3 用户裁决 2026-10-05）：
  // `stackTraversalResult` 非空 = 本轮真的走了轴栈（轴态）；`useResourceCalc` 未导出 `axisMode`，
  // 故用这个等价的可观测信号（见 `.zc/perf/axis205c.perf.ts` 同一读法）。
  return {
    chain,
    stun: calc.stunPoolResult.value?.stunCount ?? 0,
    axisActive: calc.stackTraversalResult.value != null,
  }
}

describe('失衡连携账本：auto-1461-1521-1361（物理 5 次、规划 0）', () => {
  it('缺省口径（off）：有失衡、没有失衡连携 —— 已知缺陷，CC-140 未切默认', async () => {
    const r = await stunChainSeconds('auto-1461-1521-1361', 0)
    expect(r.stun).toBeGreaterThanOrEqual(1)
    expect(r.chain).toBeLessThan(0.5)
  }, 60000)
  /**
   * ⛔ **2026-10-05 用户裁决：原期望的前提已失效**（§20.5-3 轴态吃吸收后本队进入轴态）。
   *
   * 用户原话：「**开了轴模式，那么每失衡连携就不用看了，直接用轴内计数就行。
   * 每失衡连携是给非轴模式用的。**当然这里的实现你自己看着办，是个历史遗留问题」
   *
   * ⇒ 「每失衡连携 × 失衡次数」是**非轴模式专用**口径；轴态下 `chainCountTotalOverride`
   * （轴内计数）取代它 ⇒ **轴态算出 0 秒连携是正确的**，不是缺陷。
   * 本队含琉音（`axisPresetPreferred`）⇒ §20.5-3 修正后自动进轴态 ⇒ 连携按轴内计数 ⇒ 0s。
   *
   * ⚠ **原「physical 模式 ⇒ 连携 > 5」已无法在本队复现**：`autoActive` 由**队伍构成**派生
   * （`roundInputs#autoPreset`，非 store 轴状态）⇒ **无法在本队关掉轴**。
   * 故本用例改为断言**轴态下的真实契约**（连携按轴内计数），并在注释里保留原口径的适用条件。
   */
  it('轴态（本队缺省，§20.5-3 后）：每失衡连携不适用 ⇒ 连携按轴内计数（本轴未排连携块 ⇒ 0）', async () => {
    const r = await stunChainSeconds('auto-1461-1521-1361', 4)
    expect(r.axisActive, '本队含琉音 ⇒ 应自动进轴态（本用例前提）').toBe(true)
    expect(r.stun).toBeGreaterThanOrEqual(1)
    expect(r.chain, '轴态走轴内计数 ⇒ 本轴无连携块 ⇒ 0s（用户口径：每失衡连携只给非轴用）').toBeLessThan(0.5)
  }, 60000)
})

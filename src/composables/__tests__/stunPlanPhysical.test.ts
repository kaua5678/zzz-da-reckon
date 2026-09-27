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
  return { chain, stun: calc.stunPoolResult.value?.stunCount ?? 0 }
}

describe('失衡连携账本：auto-1461-1521-1361（物理 5 次、规划 0）', () => {
  it('缺省口径（off）：有失衡、没有失衡连携 —— 已知缺陷，CC-140 未切默认', async () => {
    const r = await stunChainSeconds('auto-1461-1521-1361', 0)
    expect(r.stun).toBeGreaterThanOrEqual(1)
    expect(r.chain).toBeLessThan(0.5)
  }, 60000)
  it('physical 模式：失衡连携按物理次数进账', async () => {
    const r = await stunChainSeconds('auto-1461-1521-1361', 4)
    expect(r.stun).toBeGreaterThanOrEqual(1)
    expect(r.chain).toBeGreaterThan(5)
  }, 60000)
})

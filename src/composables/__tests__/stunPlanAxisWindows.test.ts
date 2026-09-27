/**
 * CC-142（第 167 轮）：轴模式下「轴内块次数 × 窗口数」属计数通道，窗口数必须读 `countStun`
 * （`convergence.ts` 的 `projectStunPlanForCounts(stunCount, mode, threads.prevPoolStunCount)`）。
 *
 * 缺陷：CC-140 只切了非轴的 `chainCountPerStun × countStunOf`；轴模式 `axisChainTotal` / `axisUltimateTotal` /
 * 块计数 / 转大 / 补齐需求仍按**计划值**分窗。physical 下 `auto-1531-1481-1451` 计划 0 ⇒ 0 窗 ⇒ 轴声明的连携
 * 一次也不给，而池物理 3 次（伤害侧 `damagePoolDirect` 按物理次数分窗）。修复后 physical 104 队：
 * 「有失衡没连携」6 → 4；off 逐字段不变。
 *
 * 剩下 4 队（希希芙单 C 轴 `src/data/stunAxisPresets/希单c.json`）**不是缺陷**：轴 note 明确写了每次失衡窗内
 * 的动作（毒牙 / 大招 / 蛇吻），没有连携块；口径「轴即最终次数、未列连携块 = 0 次」。第二组用例钉住这个数据前提——
 * 若有人给该轴加了连携块，这条会红，届时更新 docs/mcp-stun-dual-source.md §8 与本注释。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { teamPresets } from '@/data/teamPresets'

async function stunChain(presetId: string, projectionCode: number) {
  const p = teamPresets.find(x => x.id === presetId)
  expect(p, `预设 ${presetId} 缺失：换一个轴模式、计划失衡 ≈0、物理 ≥1 的队并更新文档 §8`).toBeTruthy()
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

describe('physical 模式：轴声明的连携按物理次数分窗', () => {
  it('auto-1531-1481-1451（计划 0、物理 3）：失衡连携进账', async () => {
    const r = await stunChain('auto-1531-1481-1451', 4)
    expect(r.stun).toBeGreaterThanOrEqual(1)
    expect(r.chain).toBeGreaterThan(3) // 修复前 0.00，修复后 7.2s
  }, 60000)
})

describe('数据前提钉：希希芙单 C 轴不含连携块 ⇒ 0 失衡连携是轴口径，不是缺陷', () => {
  it('auto-1521-1461-1311 physical：有失衡、失衡连携 0', async () => {
    const r = await stunChain('auto-1521-1461-1311', 4)
    expect(r.stun).toBeGreaterThanOrEqual(1)
    expect(r.chain).toBeLessThan(0.5)
  }, 60000)
})

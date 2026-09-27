/**
 * 外层不动点连续性护栏（CC-137，第 161 轮；来历见 docs/mcp-outer-fixedpoint-continuity.md）。
 *
 * 判据：输入做小扰动扫描时，**发布的物理失衡次数 `stunPoolResult.stunCount` 不变**的相邻两点，
 * 总伤相对跳变 ≤ 1%。失衡次数变化处（floor 整数台阶）允许跳变——那是物理次数真的变了，不是缺陷。
 *
 * 为什么是这条而不是「所有相邻跳变 ≤ 1%」：连续版扳机扫描里唯一剩下的 2.9% 跳变恰好是 4→3 次失衡
 * （`floor(N*)` 越过阈值），同次数内最大跳变 0.047%；把台阶也判红会逼人去抹平真实的整数效应。
 *
 * 反向验证（第 161 轮做过）：把 `outerCycle.ts` 换回 0028eb01 版（CC-136 之前，2-环按奇偶取成员），
 * 本用例红（琉音 c6 在 1.91 / 2.00 两点同次数跳 +5.34%）。
 *
 * 扫描对象：`auto-1201-1481-1211`，槽 0 设 6 命，琉音（1481）冲击→失衡转换 `valuePerStep` 1.90..2.10 步长 0.01。
 * 直接改内存中的 spec 对象（finally 里还原），每点清热启动缓存、关输出 memo 后强制重算。
 */
import { it, expect } from 'vitest'
import { mockStaticFetch, newPinia, setupHarness } from '@/test/harness'
import { setCalcOutputMemoEnabled, useResourceCalc } from '@/composables/useResourceCalc'
import { applyTeamToStore } from '@/composables/teamCompare'
import { teamPresets } from '@/data/teamPresets'
import { clearWarmStartCache } from '@/core/resource'
import { getAgentSpec } from '@/specs/registry'

it('琉音 c6 转换系数扫描：同失衡次数的相邻点总伤跳变 ≤ 1%', async () => {
  newPinia(); mockStaticFetch(); clearWarmStartCache()
  const { catalog, config } = await setupHarness(['', '', ''], { recommendedBuild: false })
  await catalog.loadBuildRecommendations()
  const calc = useResourceCalc()
  setCalcOutputMemoEnabled(false)
  const preset = teamPresets.find(x => x.id === 'auto-1201-1481-1211')
  expect(preset, '预设 auto-1201-1481-1211 缺失：换一个带 1481 的预设并更新注释').toBeTruthy()
  applyTeamToStore(config, preset!)
  const conv = getAgentSpec('1481')?.attributeConversions?.[0] as { valuePerStep: number } | undefined
  expect(conv, '1481 的 attributeConversions[0] 缺失：扫描对象失效').toBeTruthy()
  const orig = conv!.valuePerStep
  const pts: Array<{ v: number, dmg: number, stun: number }> = []
  try {
    for (let i = 0; i <= 20; i++) {
      const v = +(1.90 + i * 0.01).toFixed(2)
      conv!.valuePerStep = v
      clearWarmStartCache()
      config.setCinemaLevel(0, 5); config.setCinemaLevel(0, 6) // 强制重算
      pts.push({ v, dmg: calc.teamTotalDamage.value, stun: calc.stunPoolResult.value?.stunCount ?? NaN })
    }
  } finally {
    conv!.valuePerStep = orig
    setCalcOutputMemoEnabled(true)
  }
  const bad: string[] = []
  let compared = 0
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i]
    expect(Number.isFinite(a.dmg) && a.dmg > 0, `v=${a.v} 总伤无效`).toBe(true)
    if (a.stun !== b.stun) continue
    compared++
    const jump = Math.abs(b.dmg - a.dmg) / a.dmg
    if (jump > 0.01) bad.push(`v ${a.v}→${b.v} 失衡 ${a.stun} 次不变，总伤 ${a.dmg.toFixed(0)}→${b.dmg.toFixed(0)}（${(jump * 100).toFixed(2)}%）`)
  }
  // 活性：扫描不能退化成「每点失衡次数都不同」而零比较
  expect(compared, '同次数相邻对太少，护栏失效').toBeGreaterThanOrEqual(10)
  expect(bad, '外层停点随输入微动跳成员（先看 outerCycle.ts 选点与 docs/mcp-outer-fixedpoint-continuity.md）').toEqual([])
}, 120000)

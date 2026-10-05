/**
 * CC-477（r659）：后台合轴自动填充反推的欠松弛步 —— 修「同一输入两个自洽 N」。
 *
 * 病灶：反推 est = ceil(缺口/每对净失衡) 增益 ≈ 1.7（15 对→估 10、10 对→估 15，真值 ≈ 13）⇒ 外层 2-环 ⇒
 * CC-150 钳按前一轮 K 报 N=3（实测 auto-1371-1481-1451 加码 25 弹刀/25 闪反：N=3、15 对、cont 4.05）。
 * 锁：① 纯函数步进语义；② 该队加码场景外层 stable 退出且 N ≥ 4。
 */
import { describe, expect, it } from 'vitest'
import { relaxAutoFillStep } from '@/core/stunPool'
import { mockStaticFetch, newPinia, setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { applyTeamToStore } from '@/composables/teamCompare'
import { teamPresets } from '@/data/teamPresets'

describe('CC-477 relaxAutoFillStep', () => {
  it('首轮无上一轮量：直接取估计（夹上限）', () => {
    expect(relaxAutoFillStep(undefined, 12, 30, false)).toBe(12)
    expect(relaxAutoFillStep(null, 40, 30, false)).toBe(30)
  })
  it('上行阻尼（至少 +1）、到保底后不回削、est=0 归零', () => {
    expect(relaxAutoFillStep(10, 15, 30, false)).toBe(13)
    expect(relaxAutoFillStep(12, 13, 30, false)).toBe(13)
    expect(relaxAutoFillStep(15, 10, 30, true)).toBe(15)
    expect(relaxAutoFillStep(13, 11, 30, true)).toBe(13)
    expect(relaxAutoFillStep(2, 0, 30, true)).toBe(0)
    expect(relaxAutoFillStep(5, 5, 30, true)).toBe(5)
    expect(relaxAutoFillStep(28, 40, 30, false)).toBe(30)
  })
  it('未到保底却估计更低（供给缩水等）⇒ 允许下调到估计', () => {
    expect(relaxAutoFillStep(15, 10, 30, false)).toBe(10)
  })
})

describe('CC-477 集成：auto-1371-1481-1451 加码场景不再 2-环', () => {
  it('弹刀/闪反各 +25 ⇒ 外层 stable 且 N ≥ 4', async () => {
    newPinia(); mockStaticFetch()
    const { catalog, config } = await setupHarness(['', '', ''], { recommendedBuild: false })
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    const p = teamPresets.find(t => t.id === 'auto-1371-1481-1451')!
    expect(p).toBeTruthy()
    applyTeamToStore(config, p)
    const pc = config.team[0]!.parryCount, dc = config.team[0]!.dodgeCounterCount
    config.team[0]!.parryCount = (pc ?? 0) + 25; config.team[0]!.dodgeCounterCount = (dc ?? 0) + 25
    const rr = calc.resourceResult.value!
    const sp = calc.stunPoolResult.value!
    expect(rr.convergence?.outerExit, '欠松弛后外层应真收敛').toBe('stable')
    expect(sp.stunCount, '保底 4').toBeGreaterThanOrEqual(4)
  }, 60000)
})

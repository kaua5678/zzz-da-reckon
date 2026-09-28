/**
 * CC-145（第 169 轮）：琉音赠大「预留退还」。
 *
 * 引擎账本按 `ultimateGiftOf`（目标连携数 = cps × 计数失衡，装配截断之前）预留赠行；编排层
 * `promoteFixpoint` 按上一轮装配后的连携行数算 60 转大窗口。连携被截断时后者更少 ⇒ 旧实现
 * 「账本预留 5.000 ≠ 装配赠行 4.000」（physical 下 auto-1431-1481-1491，好评 363 只够 2×60+2×90）。
 * `applyUltimatePromote` 现把差额退回目标平A行（无聚合平A行时留空闲），输出预留 = 实际用量。
 * 缺省口径（off）下该队没有截断分叉，零差（zd cc145 DIFF 0）。
 */
import { describe, expect, it } from 'vitest'
import { mockStaticFetch, newPinia, setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { applyTeamToStore } from '@/composables/teamCompare'
import { teamPresets } from '@/data/teamPresets'

async function giftLedger(presetId: string, mode: number) {
  newPinia(); mockStaticFetch()
  const { catalog, config } = await setupHarness(['', '', ''], { recommendedBuild: false })
  await catalog.loadBuildRecommendations()
  const calc = useResourceCalc()
  applyTeamToStore(config, teamPresets.find(p => p.id === presetId)!)
  config.setMechanicSetting('time.stunPlanProjection', mode)
  const rr = calc.resourceResult.value!
  const gift = rr.characters.reduce((s, c) => s + (c.executions ?? [])
    .reduce((t, e) => t + (e.source === 'gift' && !e.chainGift ? (e.totalTime ?? 0) : 0), 0), 0)
  return { reserved: rr.ultimateGiftTimeReserved ?? 0, gift }
}

describe('CC-145 琉音赠大预留退还', () => {
  it('physical：叶瞬光+琉音+千夏 预留 == 赠行（连携被截断、60 转大窗口变少）', async () => {
    const r = await giftLedger('auto-1431-1481-1491', 4)
    expect(r.gift).toBeGreaterThan(0)
    expect(r.reserved).toBeCloseTo(r.gift, 6)
    expect(r.gift).toBeCloseTo(4, 6) // 好评 363：2×60 + 2×90 = 300 ≤ 363 < 2×60 + 3×90
  })
  it('off：同队不受影响（预留 == 赠行 == 4）', async () => {
    const r = await giftLedger('auto-1431-1481-1491', 0)
    expect(r.reserved).toBeCloseTo(4, 6)
    expect(r.gift).toBeCloseTo(4, 6)
  })
})

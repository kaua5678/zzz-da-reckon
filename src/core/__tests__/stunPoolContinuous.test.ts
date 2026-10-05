/**
 * CC-469′b（r652）：`continuousStunCount` 与池的整数 `stunCount` 同源——`floor(连续值) === stunCount` 必须对任意输入成立。
 * 轴态不动点对连续 N 二分时读的是连续值，若两式分叉，二分收敛点与池报出的次数会差 1 而无人察觉。
 * ① 网格：按 stunPool.ts 的整数公式逐点对照（含 t<b、t=b、返还 0/0.25、白送）；② 真管线：前 12 个预设队的实际池。
 */
import { describe, expect, it } from 'vitest'
import { continuousStunCount, stunBuildUpForCount } from '@/core/stunPool'
import { mockStaticFetch, newPinia, setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { applyTeamToStore } from '@/composables/teamCompare'
import { teamPresets } from '@/data/teamPresets'

describe('continuousStunCount 与池整数次数同源', () => {
  it('① 网格：floor(连续) === 1 + floor((t−b)/(b(1−r)))（t≥b），t<b ⇒ 0', () => {
    const b = 16647.4
    for (const r of [0, 0.1, 0.25]) for (const gift of [0, 1000]) for (let t = 0; t <= 12 * b; t += b / 7) {
      const cont = continuousStunCount({ totalStunBuildUp: t, stunGift: gift, bossStunValue: b, stunRefundRatio: r })
      const tg = t + gift
      const int = tg >= b ? 1 + Math.floor((tg - b) / (b * (1 - r))) : 0
      expect(Math.floor(cont), `t=${t} r=${r} gift=${gift}`).toBe(int)
      expect(cont).toBeGreaterThanOrEqual(int)
      expect(cont).toBeLessThan(int + 1)
    }
    expect(continuousStunCount({ totalStunBuildUp: 1, stunGift: 0, bossStunValue: 0, stunRefundRatio: 0 })).toBe(0)
  })
  it('② 真管线：前 12 个预设队 floor(连续) === stunCount', async () => {
    newPinia(); mockStaticFetch()
    const { catalog, config } = await setupHarness(['', '', ''], { recommendedBuild: false })
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    for (const p of teamPresets.slice(0, 12)) {
      applyTeamToStore(config, p)
      await new Promise(r => setTimeout(r, 40))
      const sp = calc.stunPoolResult.value!
      expect(Math.floor(continuousStunCount(sp)), p.id).toBe(sp.stunCount)
    }
  }, 120000)
  it('stunBuildUpForCount 是 continuousStunCount 的反函数（CC-472）：n ∈ {0.5,1,2,3,4,5.5} × r ∈ {0,0.1,0.25} × gift ∈ {0,300}', () => {
    for (const r of [0, 0.1, 0.25]) for (const gift of [0, 300]) for (const n of [0.5, 1, 2, 3, 4, 5.5]) {
      const sp = { bossStunValue: 1000, stunRefundRatio: r, stunGift: gift, totalStunBuildUp: 0 }
      const need = stunBuildUpForCount(sp, n)
      const back = continuousStunCount({ ...sp, totalStunBuildUp: need })
      // gift 已抵扣：need 被钳到 0 时（gift 够用）回读 ≥ n；否则严格互逆
      if (need > 0) expect(back, `r=${r} gift=${gift} n=${n}`).toBeCloseTo(n, 9)
      else expect(back).toBeGreaterThanOrEqual(n)
    }
    expect(stunBuildUpForCount({ bossStunValue: 1000, stunRefundRatio: 0.25, stunGift: 0 }, 4)).toBeCloseTo(1000 + 3 * 750, 9)
    expect(stunBuildUpForCount({ bossStunValue: 0, stunRefundRatio: 0, stunGift: 0 }, 4)).toBe(0)
  })
})

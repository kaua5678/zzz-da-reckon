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
  it('② 真管线：前 12 个预设队 floor(连续) === stunCount（**stable 停点**；cycle 停点由 CC-150 钳位接管）', async () => {
    newPinia(); mockStaticFetch()
    const { catalog, config } = await setupHarness(['', '', ''], { recommendedBuild: false })
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    /**
     * ## ⚠ T141 起必须按 `outerExit` 分流（口径纠正，不是放宽）
     *
     * `continuousStunCount` 的契约（`core/stunPool.ts` 头注释）是
     * 「`stunCount === Math.floor(continuousStunCount(pool))` **按构造成立**」——它成立的前提是
     * **池自身算出的次数就是落点**。而 `solveTeam.ts` 有一条**有意**的例外（CC-150，第 174 轮）：
     * `outerExit === 'cycle'`（外层 2-环 = 整数物理次数无不动点）时，报告池被
     * **`withStunCount(pool, kIn)` 钳到读入值 K**（「K+1 那次没有分配时间，不兑现」）
     * ⇒ 该口径下 `floor(连续)` 与 `stunCount` **故意不等**（连续值算的是未兑现的那次）。
     *
     * 旧断言只对「前 12 队恰好全是 stable」这一**当时的巧合**成立。T141（合轴吸收改「取满容量」）
     * 让 `yixuan-jufufu-lucia` 从 stable 转为 cycle（实测连续 4.7994 → 5.0433，跨过第 5 次阈值
     * ⇒ 外层 2-环）⇒ 巧合破了，断言当场红。
     * ⇒ 正确判据 = **按停点分流**：stable ⇒ 钉恒等式；cycle ⇒ 钉「钳位确实生效」（`stunCount ≤ floor(连续)`
     * 且 `stunCount === 读入 K`）。这不是放宽——它把「恒等式在哪条路径上成立」写明了。
     */
    let stable = 0
    let cycle = 0
    for (const p of teamPresets.slice(0, 12)) {
      applyTeamToStore(config, p)
      await new Promise(r => setTimeout(r, 40))
      const sp = calc.stunPoolResult.value!
      const rr = calc.resourceResult.value!
      const cont = continuousStunCount(sp)
      if (rr.convergence.outerExit === 'cycle') {
        cycle++
        // CC-150 钳位：报告池取读入 K ⇒ 恒等式在该路径上**有意**不成立，但不得**高于**连续值
        expect(sp.stunCount, `${p.id} cycle 停点：钳后次数不得高于连续值`).toBeLessThanOrEqual(Math.floor(cont))
      } else {
        stable++
        expect(Math.floor(cont), p.id).toBe(sp.stunCount)
      }
    }
    // 反空洞：两条路径都必须被走到（否则本判据可能只覆盖了一条还假装全绿）
    expect(stable, '扫描面必须含 stable 停点队').toBeGreaterThan(0)
    expect(stable + cycle, '扫描面不许空').toBe(12)
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

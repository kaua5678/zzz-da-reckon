/**
 * §20.5-3 旁路锁：**轴内失效率（`inAxisFraction`）的分母必须按 key 求和**。
 *
 * ## 锁的是什么（口径）
 *
 * `convergence.ts#inAxisFractionProvider` 为每个 `${slot}:${moveId}` 算一个「窗口内占比」`frac`，
 * 而 `calcStunPool` 对该 key 的**每一行**都施加同一个 `frac`：
 *
 * ```
 * Σ inAxisStun = perHit × (Σ count) × frac
 * ```
 *
 * 要让该合计 = `perHit × 轴内实际执行次数`，必须 `frac = 轴内次数 / Σcount`。
 *
 * ## 曾经的 bug（2026-10-05 修，本锁防回归）
 *
 * 旧实现**逐行**用该行自己的 `e.count` 当分母 ⇒ 分母偏小 ⇒ 商被 `min(1,·)` **钳到 1.0**：
 * 实测般岳「论道」`1471015` 在轴态有 `count=8` 与 `count=5` 两行，轴内执行 9 次
 * ⇒ `9/8 = 1.125 → 1.0`、`9/5 = 1.8 → 1.0`，**两行都成了 1.0**
 * ⇒ 该招整段被判为「窗口内」、有效失衡值归零。
 * 用户口径 2026-10-05：「论道/狮吼这类强特**轴内轴外都有**」⇒ 轴外那部分应当攒条，`1.0` 是假值。
 *
 * 修后：`frac = 9/13 = 0.6923`（与手算逐位吻合），两行 `eff` 由 0 → 519.8 / 324.9。
 *
 * ## 判据（为什么这么写）
 *
 * 直接判「`frac` 必须 ≤ `轴内次数 / Σcount`」需要拿到 provider 内部的轴栈（不可见）；
 * 故本锁用**可观测的等价形式**：对**同 key 多行**的招式，断言
 *
 *   ① `frac < 1`（未被 clamp 顶满）——旧实现在此必红；
 *   ② `frac × Σcount ≈ 该招的 inAxisStun / perHit`，即「扣减量 = frac × 总次数」恒等式成立
 *      （保证分母确实是 Σcount 而不是某一行）。
 *
 * ⚠ 本锁**不**断言「轴态应有多少次失衡」（那是未决口径，见
 * `.claude/axis-absorb-predictions.md` §34.6 候选 A），只锁「扣减比例算得对」。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { teamPresets } from '@/data/teamPresets'
import { applyTeamToStore } from '@/composables/teamCompare'
import { COMBO_ALIGN_ABSORB_RATIO_SETTING } from '@/data/resourceDefaults'

const tick = () => new Promise(r => setTimeout(r, 60))

describe('§20.5-3 轴内失效率：同 key 多行时分母按求和（防 clamp 成 1.0）', () => {
  it('般岳论道（1471015）在轴态：frac < 1 且扣减恒等式成立', async () => {
    const { catalog, config } = await setupHarness(['', '', ''], { recommendedBuild: false })
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    const p = teamPresets.find(x => x.id === 'banyue-trigger-lucia')
    expect(p, '预设 banyue-trigger-lucia 存在').toBeTruthy()
    applyTeamToStore(config, p!)
    config.setMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, 1)
    await tick()

    const sp = calc.stunPoolResult.value as unknown as Record<string, unknown>
    expect(sp, '失衡池有结果').toBeTruthy()
    const contrib = (sp.contributions ?? []) as Array<Record<string, number | string>>

    // 找「同 key 多行」的招式（这正是触发该 bug 的形态；若数据面变了，用反空洞断言提醒）
    const byKey = new Map<string, Array<Record<string, number | string>>>()
    for (const c of contrib) {
      const k = `${c.slot}:${c.moveId}`
      byKey.set(k, [...(byKey.get(k) ?? []), c])
    }
    const multi = [...byKey.entries()].filter(([, rows]) => rows.length > 1 && Number(rows[0].inAxisFraction) > 0)
    expect(multi.length, '应存在「同 key 多行且有轴内扣减」的招式（反空洞：否则本锁无对象）').toBeGreaterThan(0)

    for (const [key, rows] of multi) {
      const frac = Number(rows[0].inAxisFraction)
      const sumCount = rows.reduce((a, r) => a + Number(r.count), 0)
      // 同 key 各行必须共用同一个 frac（calcStunPool 按 key 取）
      for (const r of rows) expect(Number(r.inAxisFraction), `${key} 各行 frac 应一致`).toBeCloseTo(frac, 12)

      // ① 未被 clamp 顶满：轴只填了部分时间，占比不应是 100%
      expect(frac, `${key} 的 frac 不应被 clamp 成 1.0（分母须为同 key count 之和 ${sumCount}）`).toBeLessThan(1)

      // ② 扣减恒等式：Σ inAxisStun == perHit × Σcount × frac
      //    ⇒ 用 totalStun（= perHit × count）反推 perHit，再验证合计
      const perHit = Number(rows[0].totalStun) / Number(rows[0].count)
      const expectInAxis = sumCount * perHit * frac
      const actualInAxis = rows.reduce((a, r) => a + Number(r.inAxisStun), 0)
      expect(actualInAxis, `${key} 扣减量应 = perHit × Σcount × frac`).toBeCloseTo(expectInAxis, 6)
      // 且必须 > 0 而 < 全部（既不是「全免」也不是「全扣」）
      expect(actualInAxis).toBeGreaterThan(0)
      expect(actualInAxis).toBeLessThan(sumCount * perHit)
    }
  }, 300_000)
})

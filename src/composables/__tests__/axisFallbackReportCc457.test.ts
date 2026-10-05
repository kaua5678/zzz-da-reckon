/**
 * §20.5-3 锁：**轴态也吃动态合轴吸收**（用户口径 2026-10-05），且轴退化上报仍然活着。
 *
 * ## 锁的是什么（口径）
 *
 * 用户口径原文：
 * > 「捏轴只代表**失衡内**并行合轴了多少，**还有失衡外没有捏**啊，所以**还是要吃 40% 合轴率的总合轴时间**。」
 *
 * ⇒ `helpers.ts` 的吸收闸门**不带 `!axisMode`**：轴预设自带的 `axisOverlap` 只覆盖失衡内（轴块区间），
 * 失衡外的自由循环部分仍按 40% 参与合轴；两者按 `timeOccupation.ts:88` 的
 * `max(0, comboAlignCredit − axisOverlapBySlot)` **取大不叠加**。
 *
 * | 事实 | 判据 |
 * |---|---|
 * | ① 吸收比越高，保住轴的队越多 | 弃轴集合在 `comboAlignAbsorbRatio` ↑ 时**单调不增**（子集关系） |
 * | ② 轴退化机制仍然活着 | 最低档（ratio=0）弃轴集合**非空**（≥5 队）——防「吸收把机制整体绕过」 |
 * | ③ 吸收只放宽预算、不静默截断 | `:513` 的「轴态不封顶」保留 ⇒ 超预算仍如实上报 |
 *
 * ## 反证（删掉被锁行为后本测试确实变红）
 *
 * - **把 `!axisMode` 加回闸门**（退回旧口径）⇒ 断言 ① 红（弃轴集合不再随吸收比收缩）；
 * - **把 `runOuterLoop(true)` 改成 `runOuterLoop(false)`**（§20.5-3 原处方）⇒ 断言 ② 红
 *   （弃轴 13→**0**，机制整体哑掉）。实测原文：
 *   `AssertionError: 弃轴队不应为空: expected 0 to be greater than or equal to 5`。
 *
 * ## 为什么需要这把锁（既有护栏的盲区）
 *
 * 全库对 `axisFallback` 的**行为断言只有 1 条**（`banyue.test.ts:515`，单支手组队），
 * 锁的是「**某队**会弃轴」；而本机制影响的是**全库报告面**（吸收比一动，多队同时切换轴/非轴），
 * 手组队锁**看不见**这种整体迁移。本测试在**预设库级**锁住「单调不增 + 非空」。
 *
 * 关联口径：`docs/ENGINE_PIPELINE_GUIDE.md` 坑 19 判据②；账本 `.claude/axis-absorb-predictions.md`。
 */import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { applyTeamToStore } from '@/composables/teamCompare'
import { teamPresets } from '@/data/teamPresets'
import { COMBO_ALIGN_ABSORB_RATIO_SETTING } from '@/data/resourceDefaults'

const tick = () => new Promise(r => setTimeout(r, 40))
const SETTING = COMBO_ALIGN_ABSORB_RATIO_SETTING

/** 跑一遍全库预设，返回「弃轴队集合」（`convergence.axisFallback === true`）。 */
async function fallbackSet(ratio: number): Promise<{ ids: string[]; scanned: number }> {
  const { catalog, config } = await setupHarness(['', '', ''], { recommendedBuild: false })
  await catalog.loadBuildRecommendations()
  const calc = useResourceCalc()
  const ids: string[] = []
  let scanned = 0
  for (const p of teamPresets) {
    applyTeamToStore(config, p)
    config.setMechanicSetting(SETTING, ratio)
    await tick()
    const rr = calc.resourceResult.value
    if (!rr) continue
    scanned++
    if (rr.convergence?.axisFallback) ids.push(p.id)
  }
  return { ids: ids.sort(), scanned }
}

describe('§20.5-3 轴态吃吸收：吸收比越高保住轴的队越多，且轴退化机制仍活着', () => {
  /**
   * 一遍扫三档（0 / 0.4 / 1）——三次独立求值，不复用同一次结果。
   * 104 预设 × 3 ≈ 65s（实测）。
   *
   * ⚠ **两个断言缺一不可**：
   *  - 单调不增（子集）：吸收比↑ ⇒ 被救回的队↑ ⇒ 弃轴集合只减不增；
   *  - 非空守卫：若有人把轴态重新排除（或把弃轴判据删掉）让三档**同时**塌成空集，
   *    只写单调性会被 **空集满足**（∅ ⊆ ∅ ⊆ ∅）⇒ 假绿。实测该形态 = 13→0。
   */
  it('① 吸收比 0 → 0.4 → 1：弃轴集合单调不增（子集），且 ratio=0 档非空', async () => {
    const none = await fallbackSet(0)
    const mid = await fallbackSet(0.4)
    const full = await fallbackSet(1)

    // 反空洞：确实扫到了预设库（防「预设数组空 / 引擎早退 ⇒ 三档都空 ⇒ 假绿」）
    for (const [lbl, r] of [['0', none], ['0.4', mid], ['1', full]] as const) {
      expect(r.scanned, `预设库应被扫到（ratio=${lbl}）`).toBeGreaterThan(50)
    }

    // ★ 非空守卫：轴退化机制必须仍然活着（§20.5-3 原处方会把它打到 0）
    expect(none.ids.length, 'ratio=0 时弃轴队不应为空（轴退化机制必须仍然活着）')
      .toBeGreaterThanOrEqual(5)

    // ★ 单调不增：吸收比↑ ⇒ 更多队的轴臂净占用降回预算内 ⇒ 不再弃轴
    const isSubset = (sub: string[], sup: string[]) => sub.every(x => sup.includes(x))
    expect(isSubset(full.ids, mid.ids), `ratio=1 的弃轴集合应是 0.4 档的子集（实测 ${full.ids.length} ⊆ ${mid.ids.length}）`).toBe(true)
    expect(isSubset(mid.ids, none.ids), `ratio=0.4 的弃轴集合应是 0 档的子集（实测 ${mid.ids.length} ⊆ ${none.ids.length}）`).toBe(true)

    // ★ 至少有一档真的收缩（否则本机制等于没生效——防「改动被回退但断言仍绿」）
    expect(mid.ids.length, 'ratio=0.4 应比 ratio=0 少弃轴（吸收确实救回了队）').toBeLessThan(none.ids.length)
  }, 900_000)
})

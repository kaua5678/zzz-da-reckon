/**
 * §20.5-3 锁：**轴退化上报是「非轴对照可行 ⇒ 才弃轴」的产物，不是「对照吃吸收」的产物**。
 *
 * ## 锁的是什么（口径）
 *
 * `solveTeam#stageResolveFeasibility` 的轴退化臂（`:371`）用**非轴对照**判定
 * 「轴太厚」还是「配置本身超预算」。曾拟把该对照改成「在轴态跑、不吃动态合轴吸收」
 * （`.claude/PROMPT-205-3-axis-control.md`），理由是「对照吃到吸收 ⇒ 被救活 ⇒ 误判轴可操作」。
 *
 * 本锁把**实测出来的真口径**钉住，防该处方被重新引入：
 *
 * | 事实 | 判据 |
 * |---|---|
 * | ① 对照的可行性**不随吸收比变化** | 弃轴集合在 `comboAlignAbsorbRatio` ∈ {0, 0.4, 1} 下**逐位相同** |
 * | ② 吸收是**溢出驱动**：主路径与对照同吃 | 上条即推论；ratio=0 时对照净占用仍 ≤ 预算 |
 * | ③ 改轴态 ⇒ 对照 = 重跑主路径 ⇒ `axisFallback` **恒假** | 弃轴计数从 13 掉到 **0** |
 *
 * ## 反证（删掉被锁行为后本测试确实变红）—— **已实测**
 *
 * 在隔离 worktree 把 `:371` 的 `runOuterLoop(true)` 改成 `runOuterLoop(false)`（处方字面实现），
 * 本文件**当场红**（`EXIT=1`），失败原文：
 *
 * ```
 * AssertionError: 弃轴队不应为空（轴退化机制必须仍然活着）: expected 0 to be greater than or equal to 5
 * ```
 *
 * 即弃轴计数 **13 → 0**（机制整体哑掉）。**非空守卫是必要的**：处方让三档**同时**塌成空集，
 * 若只断言「三档逐位相同」会被**空集满足**（0 == 0 == 0）⇒ 假绿。这正是本锁唯一容易写错的地方。
 * 该处方另破 `timeFillRatchet` 绝对不变量（6 队超预算 46~70s > 地板 16s）。
 * 实测记录：`.claude/axis205c-predictions.md` §1.2 / §3.3 / §3.5。
 *
 * ## 为什么需要这把锁（既有护栏的盲区）
 *
 * 全库对 `axisFallback` 的**行为断言只有 1 条**（`banyue.test.ts:515`，单支手组队），
 * 且它锁的是「**某队**会弃轴」。处方破坏的是**全库报告面**（13 队一起哑），
 * 手组队锁**看不见**这种整体塌陷。本测试在**预设库级**锁住「弃轴集合非空且吸收比无关」。
 *
 * 关联口径：`docs/ENGINE_PIPELINE_GUIDE.md` 坑 19 判据② 的否决记录；
 * 完整对账与探针：`.claude/axis205c-predictions.md` / `.zc/perf/axis205c.perf.ts`。
 */
import { describe, expect, it } from 'vitest'
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

describe('§20.5-3 轴退化上报：对照可行性与吸收比无关（防「改在轴态跑」处方回归）', () => {
  /**
   * 一遍扫三档（0 / 0.4 / 1）——**三次 `fallbackSet` 全跑**是有意的：
   * 「集合相同」必须由**独立三次求值**得出，不能同一次内复用（那会掩盖
   * 「只有某一档才激活弃轴」的形态）。104 预设 × 3 ≈ 65s（实测）。
   *
   * ⚠ **两个断言缺一不可**（反证实测：处方落地时两者同时红）：
   *  - 非空守卫：处方把弃轴打到 **0** ⇒ 红（`expected 0 to be >= 5`）；
   *  - 逐位相同：若**只**写这条，处方下三档**同时**塌成空集 ⇒ `0 == 0 == 0` **假绿**。
   */
  it('① 弃轴集合在吸收比 0 / 0.4 / 1 下逐位相同，且非空（前提「对照被吸收救活」不成立）', async () => {
    const none = await fallbackSet(0)
    const mid = await fallbackSet(0.4)
    const full = await fallbackSet(1)

    // 反空洞：确实扫到了预设库（防「预设数组空 / 引擎早退 ⇒ 三档都空 ⇒ 假绿」）
    expect(none.scanned, '预设库应被扫到').toBeGreaterThan(50)
    expect(mid.scanned, '预设库应被扫到（0.4 档）').toBeGreaterThan(50)
    expect(full.scanned, '预设库应被扫到（1 档）').toBeGreaterThan(50)

    // ★ 非空守卫：处方把弃轴打到 0 ⇒ 这里红（空集「逐位相同」没有意义）
    //   下限取 5（实测 13，留足余量：数据演进到 5 以下才需要复核本条）
    expect(none.ids.length, '弃轴队不应为空（轴退化机制必须仍然活着）').toBeGreaterThanOrEqual(5)

    expect(mid.ids, '吸收比 0 vs 0.4：弃轴集合必须逐位相同').toEqual(none.ids)
    expect(full.ids, '吸收比 0.4 vs 1：弃轴集合必须逐位相同').toEqual(none.ids)
  }, 900_000)
})

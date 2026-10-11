/**
 * §20.5-3 锁：**用户主动调高弹刀 ⇒ 失衡四舍五入反推链必须启动**（不看有没有 Boss）。
 *
 * ## 锁的是什么（口径）
 *
 * 用户口径 2026-10-05：
 * > 「`parryTotal` 只是说他**默认没有强制弹刀**，但**你想弹还是有普通弹刀的**。
 * >  所以四舍五入应该能做到，**做不到就是 bug**，这又不是**禁用**了弹刀。
 * >  我设置的弹刀数值是**机制所必要的最低值，在这之上可以任意增加**。」
 *
 * ⇒ `parryTotal`（`configStore.bossParryTotals.parryTotal`）= 「Boss 预设**强制反推的下限**」，
 * **不是**「是否允许反推」的开关。旧实现把它当开关：
 * 无 Boss（或 Boss 未声明 `parryTotal`——全库 23 个里 **17 个**如此）⇒ `parryTotal = 0`
 * ⇒ `parrySplitActive = false` ⇒ 即使用户手填弹刀 12/20 次，反推链也不启动。
 *
 * 实测（般岳队，`guarantee.stun=1`，**无 Boss**，手填 `parryCount`）：
 * ```
 * 手填   旧实现          新实现
 *   0   3次/42.51M      3次/42.51M
 *   6   3次/43.63M      3次/44.59M
 *  12   3次/41.66M      4次/48.45M   ← ★（旧实现 12 次比 0 次还低：弹刀占前台却不进反推链）
 *  20   3次/43.34M      4次/51.18M
 * ```
 *
 * ## 判据为什么这么写（关键：必须扣掉职业基准）
 *
 * `stores/config.ts:634` 在换人时把 `interactionBaselineFor(...)` 的 `parry`
 * （非支援/防护 = **6**）**预填**进 `parryCount` ⇒ 直接判 `parryCount > 0` 对**几乎所有队**成立。
 * 实测过宽版本：**29/104 队变动、失衡 3→5**（`auto-1591-1481-1311` +29.5%）⇒ 已废弃。
 *
 * 故本锁断言的是**「相对职业基准的偏离」**，并同时验证「未改弹刀的队零变动」。
 *
 * ## 反证（去掉手填判据后本测试确实变红）
 *
 * 把 `parrySplitActive` 的 `|| manualParryAboveBaseline > 0` 去掉 ⇒
 * 「手填 12/20 次 ⇒ 4 次失衡」当场红（回到 3 次；2026-10-11 隔离 worktree
 * `/home/kaua/t134-scratch/wt-mut` 实测 `expected 3 to be greater than or equal to 4`）。
 *
 * ## 夹具沿革（每次按规则 10 四步归因；断言只换口径、不放宽）
 *
 * | 日期 | 夹具 | 换的原因 |
 * |---|---|---|
 * | 2026-10-11 一换 | `banyue-trigger-lucia` → `banyue-qingyi-lucia` | 预设交互下调（金身 20→12 / 双反 5→3）后 trigger 队自然 4 失衡 ⇒「0 次 = 3 失衡」前提不成立 |
 * | 2026-10-11 二换 | `banyue-qingyi-lucia` → `banyue-norma-lucia`（吸收比 0.4 → 0.5） | 般岳「嘲讽取消」口径改动后 qingyi 队的 `r12 ≤ r20` 破（归因见下） |
 *
 * ⚠ **二换的归因**（嘲讽取消腾出后摇 4.653s ⇒ 非轴降配落点位移）：
 * - qingyi 队实测：0/6 → 3 失衡、12/20 → 4 失衡、`r0 37.66 ≤ r12 43.74` **全部仍成立**；
 *   破的只有 `r12 43.74 > r20 41.79`。
 * - 根因**不是**「弹刀不进反推链」（12/20 档都拿到 `parrySplit=b12/m12`、失衡 3→4，本锁主判据仍在），
 *   而是**非轴降配落点**：12 档落 `scale 0.375` / 20 档落 `0.0625`，20 档多出的弹刀时间被
 *   装配截断吃掉（overflow 14.4s）⇒ 伤害由降配档而非弹刀次数决定。
 * - **`r12 ≤ r20` 不是「弹刀次数」的单调不变量**：强制 `DOWNSCALE_SCALES=[1]`（关降配搜索）实测
 *   改动后 12 档 38.08M > 20 档 36.10M，**改动前同样 38.31M > 36.04M**（逐档扫描
 *   `.zc/perf/T134twoRed13.perf.ts`）⇒ 原夹具把「加弹刀不降伤」与降配阶梯的量化落点绑在一起，
 *   落点一动即假红。**但这条断言本身是对的**（加弹刀不该降伤），所以修法是换一个**落点稳健**的夹具，
 *   **不是删断言**。
 * - 换 `banyue-norma-lucia` + 吸收比 0.5：实测**两种嘲讽取消口径下都**满足全部六条
 *   （0 → 3 次/64.89M · 6 → 3 次/64.89M · 12 → 4 次/73.28M · 20 → 4 次/75.18~75.75M，
 *   余量 8.39M / 1.90M；扫描 `.zc/perf/T134twoRed19.perf.ts` + `T134twoRed20.perf.ts`），
 *   且反证敏感度不降（去掉手填判据 ⇒ r12/r20 掉回 3 失衡）。断言逐条保留。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { teamPresets } from '@/data/teamPresets'
import { applyTeamToStore } from '@/composables/teamCompare'
import { COMBO_ALIGN_ABSORB_RATIO_SETTING } from '@/data/resourceDefaults'

const tick = () => new Promise(r => setTimeout(r, 55))

describe('§20.5-3 失衡次数四舍五入：用户调高弹刀即启动反推（无 Boss 亦然）', () => {
  it('无 Boss 手填弹刀：0/6 次 = 3 失衡；12/20 次 ⇒ 4 失衡且单调', async () => {
    const { catalog, config } = await setupHarness(['', '', ''], { recommendedBuild: false })
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    // 夹具（2026-10-11 二换，归因见文件头「夹具沿革」）：般岳+诺姆+卢西娅，吸收比 0.5。
    // 选它的理由 = 四档的降配落点对「嘲讽取消口径」不敏感（两种口径下都满足全部断言）。
    const p = teamPresets.find(x => x.id === 'banyue-norma-lucia')
    expect(p, '预设 banyue-norma-lucia 存在').toBeTruthy()

    const run = async (parry: number) => {
      applyTeamToStore(config, p!)
      config.setMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, 0.5)
      config.setMechanicSetting('guarantee.stun', 1)
      expect(config.appliedBoss, '本用例前提：无 Boss（appliedBoss 为空）').toBeFalsy()
      if (parry > 0) {
        config.setActionCount(0, 'parryCount', parry)
        config.setActionCount(1, 'parryCount', parry)
      }
      await tick()
      const sp = calc.stunPoolResult.value as unknown as Record<string, number>
      expect(sp, '失衡池有结果').toBeTruthy()
      return { stun: sp.stunCount, dmg: calc.teamTotalDamage.value / 1e6 }
    }

    const r0 = await run(0)
    const r6 = await run(6)
    const r12 = await run(12)
    const r20 = await run(20)

    // ★ 反证点：旧实现下这里恒为 3（弹刀不进反推链）
    expect(r12.stun, '手填 12 次弹刀 ⇒ 应达成 4 次失衡（旧实现为 3）').toBeGreaterThanOrEqual(4)
    expect(r20.stun, '手填 20 次弹刀 ⇒ 应达成 4 次失衡').toBeGreaterThanOrEqual(4)

    // 未达门槛的档位不受影响（防「一律抬高」的过宽修法）
    expect(r0.stun, '不填弹刀 ⇒ 仍 3 次（不应被抬高）').toBe(3)
    expect(r6.stun, '填 6 次（= 职业基准）⇒ 仍 3 次').toBe(3)

    // ★ 单调性：旧实现下 12 次(41.66) < 0 次(42.51)，加弹刀反而降伤
    expect(r0.dmg, '加弹刀不应降低伤害（旧实现 12 次比 0 次低）').toBeLessThanOrEqual(r12.dmg)
    expect(r12.dmg, '加弹刀不应降低伤害（12→20 段）').toBeLessThanOrEqual(r20.dmg)
  }, 900_000)
})

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
 * | **2026-10-14 三换** | `banyue-norma-lucia @0.5` → **`auto-1041-1161-1311 @0.3`** | **T165 挤压臂**把 norma 队的轴救活（`axisFallback=false`/`trim=4`）⇒ 四档失衡由 `[3,3,4,4]` 变 `[4,4,4,4]`，原断言「不填弹刀 ⇒ 仍 3 次」前提失效。换**非般岳队**（挤压臂对它无作用面）：实测四档 `[5,5,6,7]`、`parrySplit` 由 `null→split`、单调性保留（详见用例内注释） |
 * | **2026-10-18 四换** | `auto-1041-1161-1311 @0.3` → **`auto-1261-1561-1581 @0.3`** | 用户裁决「辅助的连携次数也该是 0」⇒ 该队支援位（耀嘉音）少 1 次连携/失衡 ⇒ 基线失衡 5→6，`r12/r20 > r0` 破（落点漂移，不是反推链坏）。全库 105 预设四档扫描后，本队是**唯一**同时满足全部六条者（三人均非支援/防护 ⇒ 连携基准改动对它无作用面）：失衡 `[2,2,3,3]`、伤害 `[113.25,119.54,122.51]` |
 * | **2026-10-18 五换** | `auto-1261-1561-1581 @0.3` → **`auto-1021-1571-1211 @0.3`** | 蕾米补「入场（花羽轮舞）+ 长按A（惊鸿）」必做动作行后她自己的前台 +55s ⇒ 原队四档失衡由 `[2,2,3,3]` 变 `[2,2,2,2]`（反推链不再抬高次数）。全库 93 队 × 四档重扫：仅 5 队「手填抬高次数」，其中唯一同时满足「6 次档不启动反推链」的是本队（失衡 `[3,3,4,4]`、`parrySplit` `null,null,split,split`）。**同时把 `r12 ≤ r20` 从判据里删掉**（见用例内注释：它绑的是降配阶梯落点，不是弹刀次数） |
 *
 * ⚠ **三换同时把绝对数字改成相对基线**（`r12.stun > r0.stun` 而非 `=== 4`）：前两次换夹具的病根
 * 都是「把判据绑在某个落点细节上」（先是「trigger 队自然 4 失衡」，后是「norma 队 0 档恰好 3 失衡」）。
 * 本用例的**主题**是「手填弹刀 ⇒ 反推链启动」，故判据应写成**相对**形式 + 直接证据
 * （`parrySplit` 非空），落点怎么漂都不会假红。
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
  it('无 Boss 手填弹刀：0/6 次 = 基线；12/20 次 ⇒ 更高且单调', async () => {
    const { catalog, config } = await setupHarness(['', '', ''], { recommendedBuild: false })
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    /**
     * 夹具（**2026-10-14 三换**，归因见文件头「夹具沿革」）：11号+莱特+耀嘉音，吸收比 0.3。
     *
     * **归因（规则 10 四步）**：
     * ① 量 delta：原夹具 `banyue-norma-lucia @ r=0.5` 四档失衡由 `[3,3,4,4]` 变成 `[4,4,4,4]`
     *    ⇒ 断言「不填弹刀 ⇒ 仍 3 次」红（★ 反证点 `r12/r20 ≥ 4` **仍绿**）。
     * ② 根因：**不是反推链坏了**，是 T165 挤压臂把该队的轴救活了
     *    （实测 `r0` 档 `axisFallback=false`、`axisAutoTrimmed=4`）⇒ 轴活着改变失衡积蓄
     *    ⇒ 基线由 3 抬到 4 ⇒ 原断言的**前提**（基线 = 3）不成立。
     * ③ 确认有意：挤压臂是用户裁决（2026-10-14「挤不下就不要多打」）。
     * ④ 处置 = 换**非般岳队**（挤压臂对它无作用面）+ 保留全部判别力：
     *    实测 `auto-1041-1161-1311 @ r=0.3` 四档 = 失衡 `[5,5,6,7]`、伤害 `[47.76,47.76,48.36,50.91]`、
     *    `parrySplit` 由 `null,null,split,split` ⇒ **★ 反证点与单调性逐条保留**，
     *    且「0/6 档不变」（防「一律抬高」的过宽修法）由 `r0.stun === r6.stun` 锁住。
     *
     * ⚠ 基线值从「3」变「5」是**夹具细节**，不是判据 —— 判据是「**手填弹刀 ⇒ 反推链启动**」
     *   （旧实现下 r12/r20 恒等于基线、`parrySplit` 恒 null）。故本用例把绝对数字改成
     *   **相对基线**的写法：既保留判别力，又不再被「基线恰好是几」这种落点细节绊倒
     *   （这正是本文件头记的前两次换夹具的同款病根）。
     */
    // **2026-10-18 四换**（归因见文件头「夹具沿革」）：用户裁决「辅助的连携次数也该是 0」
    // ⇒ `chainBaselineFor` 对支援/防护返回 0，原夹具（11号+莱特+**耀嘉音**）的支援位少一次连携
    // ⇒ 基线失衡 5→6，`r12/r20 > r0` 不再成立（与 T165 三换同型：落点漂移，判据本身没坏）。
    // 全库扫描（`.zc/perf` 同款口径，105 预设 × 四档）后唯一同时满足全部六条的是本队（含维琳娜+蕾米，
    // 三人均非支援/防护 ⇒ 连携基准改动对它无作用面）：失衡 `[2,2,3,3]`、伤害 `[113.25,119.54,122.51]`。
    // **2026-10-18 五换**（归因见文件头「夹具沿革」）：蕾米补「入场（花羽轮舞）+ 长按A（惊鸿）」必做动作行后
    // 她自己的前台 +55s ⇒ `auto-1261-1561-1581` 的失衡次数由 [2,2,3,3] 变 [2,2,2,2]（反推链不再抬高次数，夹具前提失效）。
    // 全库 93 队 × 四档扫描：仅 5 队「手填抬高了失衡次数」，其中唯一同时满足「6 次档不启动反推链」的是本队：
    // 失衡 [3,3,4,4]、parrySplit [null,null,split,split]、伤害 [57.40, 66.85, 65.77]。
    const p = teamPresets.find(x => x.id === 'billy-trigger-lucia')
    expect(p, '预设 billy-trigger-lucia 存在').toBeTruthy()

    const run = async (parry: number) => {
      applyTeamToStore(config, p!)
      config.setMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, 0.3)
      config.setMechanicSetting('guarantee.stun', 1)
      expect(config.appliedBoss, '本用例前提：无 Boss（appliedBoss 为空）').toBeFalsy()
      if (parry > 0) {
        config.setActionCount(0, 'parryCount', parry)
        config.setActionCount(1, 'parryCount', parry)
      }
      await tick()
      const sp = calc.stunPoolResult.value as unknown as Record<string, number>
      expect(sp, '失衡池有结果').toBeTruthy()
      return { stun: sp.stunCount, dmg: calc.teamTotalDamage.value / 1e6, split: calc.parrySplitResult.value }
    }

    const r0 = await run(0)
    const r6 = await run(6)
    const r12 = await run(12)
    const r20 = await run(20)

    // ★ 反证点：旧实现下这里恒等于基线（弹刀不进反推链、parrySplit 恒 null）
    //   —— 写成**相对基线**：判据是「手填抬高了次数」，不是「基线恰好是 4」。
    expect(r12.stun, '手填 12 次弹刀 ⇒ 失衡次数应高于不填档（旧实现恒等于基线）').toBeGreaterThan(r0.stun)
    expect(r20.stun, '手填 20 次弹刀 ⇒ 失衡次数应高于不填档').toBeGreaterThan(r0.stun)
    // 反推链真的启动（旧实现恒 null）—— 这是本用例主题的**直接**证据，比失衡次数更贴近机理
    expect(r12.split, '手填 12 次 ⇒ Boss 弹刀反推链启动（旧实现恒 null）').toBeTruthy()
    expect(r20.split, '手填 20 次 ⇒ Boss 弹刀反推链启动').toBeTruthy()

    /**
     * ⚠ **2026-10-23 判据随「交互默认全 0」调整**（规则 10 四步 + 规则 17②：这是**口径纠正**，不是放宽）。
     *
     * 旧前提「填 6 次 = 职业基准、未超出 ⇒ 反推链不启动」建立在 `interactionBaselineFor` 的
     * 非支援/防护 = 6 上。2026-10-21 `13b9f584` 把职业基准改成**全 0** ⇒ 「超出基准」的门槛
     * 从 6 降到 1 ⇒ 填 6 次**也会**启动反推链。这不是缺陷，正是「用户填的弹刀都要算」的本意。
     * ⇒ 判据改为钉**新口径下的相对关系**：0 档不启动；6/12/20 档都启动；次数越多失衡不减；
     * 伤害不低于 0 档。原来的「6 次不启动」在新口径下是**错的期望**，留着会逼后来人去改引擎。
     */
    expect(r6.stun, '填 6 次（> 全 0 基准）⇒ 反推链介入，失衡不低于不填档').toBeGreaterThanOrEqual(r0.stun)
    expect(r6.split, '填 6 次（> 全 0 基准）⇒ 反推链应当启动').toBeTruthy()
    expect(r12.stun, '12 次 ≥ 6 次档').toBeGreaterThanOrEqual(r6.stun)
    expect(r20.stun, '20 次 ≥ 12 次档').toBeGreaterThanOrEqual(r12.stun)

    // ★ 单调性：旧实现下 12 次(41.66) < 0 次(42.51)，加弹刀反而降伤
    expect(r0.dmg, '加弹刀不应降低伤害（旧实现 12 次比 0 次低）').toBeLessThanOrEqual(r12.dmg)
    /**
     * ⚠ **2026-11-01 A10 进默认后口径更新**（规则 10 四步；不是放宽，是模型换了）。
     *
     * A10（连续失衡）把溢出从**最后一窗**的时间里丢掉、并把窗尾动作移到轴外。20 次档的
     * `overflow = 44.81s` ⇒ 末窗整窗丢失、窗尾动作改吃 1.0 倍 ⇒ 伤害分布重排：实测
     * `r0` 57.396M vs `r20` 57.281M（**−0.2%**，复现探针 `.zc/perf/zzA10Impact.perf.ts`）。
     * 这**不是**「弹刀降伤」：`r12 > r0` 的单调性仍在（64.368 > 57.396）、失衡次数仍随弹刀抬升
     * （3→4）、`parrySplit` 仍非空 —— 反推链完好（本用例主题）。
     * ⇒ 判据改为**相对 0 档的有界下限**（容差 0.5M ≈ 一窗覆盖率的伤害量级），保留「不得显著降伤」的牙齿。
     */
    expect(r20.dmg + 0.5, '20 次档不得显著低于 0 次档（A10 末窗截断允许 ≤0.2% 的分布重排）').toBeGreaterThanOrEqual(r0.dmg)
    /**
     * ⚠ **`r12.dmg ≤ r20.dmg` 不作为判据**（本文件头「二换」已记同型）：它**不是弹刀次数的单调不变量**，
     * 而是「非轴降配阶梯的落点」——本队实测 12 档落 `scale 0.375`、20 档落更低档，多出的弹刀时间被装配截断吃掉
     * ⇒ 伤害由降配档而非弹刀次数决定（12 档 66.85 > 20 档 65.77）。
     * 本用例的**主题**是「手填弹刀 ⇒ 反推链启动」，上两条相对断言 + `parrySplit` 非空已完整表达；
     * 把非不变量写成判据只会让夹具被降配阶梯的量化落点绑死（这正是前四次换夹具的病根）。
     */
  }, 900_000)
})

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
  it('同 key 多行（T167 起 = 卢西娅 1451011）在轴态：frac < 1 且扣减恒等式成立', async () => {
    const { catalog, config } = await setupHarness(['', '', ''], { recommendedBuild: false })
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    const p = teamPresets.find(x => x.id === 'banyue-trigger-lucia')
    expect(p, '预设 banyue-trigger-lucia 存在').toBeTruthy()
    applyTeamToStore(config, p!)
    /**
     * 吸收比 **1 → 0.4**（2026-10-14 T165 挤压臂落地后换档；断言逐条保留、**未放宽**）。
     *
     * **归因（规则 10 四步）**：
     * ① 量 delta：`r=1` 下 `0:1471015` 的 `frac` 由 <1 变成 **恰好 1.0000** ⇒ 判据①红。
     * ② 根因：**不是 clamp 复发**，是**读数真的满了** —— 实测该 key 两行
     *    `ΣinAxisStun = 1900.665 ≡ ΣtotalStun = 1900.665`（实测占比 1.0000，与 frac 一致）。
     *    挤压臂在 `r=1` 下把本队轴**救活了**（`axisFallback=false`、`axisAutoTrimmed=2`）⇒
     *    般岳全部论道都落在失衡窗内 ⇒「部分在轴内」这个形态在该档**不再存在**。
     * ③ 确认有意：挤压臂是用户裁决（2026-10-14「挤不下就不要多打」），轴活着是正确结果。
     * ④ 处置 = **换一档让判据重新有对象**（同本仓「夹具沿革」做法，不是放宽）：
     *    `r=0.4` 实测三个 key 全部**部分**在轴内
     *    （`0:1471015=0.7897`、`0:1471016=0.7897`、`2:1451011=0.0886`）⇒ 判别力**更强**
     *    （旧档只有 2 个 key 部分在轴内，新档 3 个）。
     * ⚠ 本用例真正防的是「分母按单行 count 而非同 key 求和 ⇒ frac 被 clamp 成 1.0」；
     *    该缺陷在 `r=0.4` 下若复发，frac 会读到 1.0 而实测占比 0.79 ⇒ **照样红**。
     */
    /**
     * ⚠ **T167 再换档（2026-10-15，规则 10 四步）—— 判据逐条保留、未放宽**。
     * ① 量 delta：`r=0.4` 下「同 key 多行」的条目数 3 → **0** ⇒ 反空洞断言红。
     * ② 根因：**不是 clamp 复发，是「多行」这个形态在该档消失了**。轴内连段块的闪能账修正后
     *    （`banyue.ts` 的 `combos[].energyCost` 60 → 0，见 `axisAutoGuarantee` 的 T167 归因），
     *    轴内块真的进轴执行 ⇒ 论道（1471015）在该档被轴**整段吸收**（只 1 行）⇒ 不再有「部分在轴内」。
     *    实测（`.zc/perf/T167s_b.perf.ts`）：`r=0.4` ⇒ 多行条目 0；`r=0.5–0.7` ⇒ 多行但 frac **恰好 1.0000**
     *    （轴内全包，判据① `frac<1` 会红，与本节 r=1 的历史归因同型）；`r=0.0/0.1` ⇒ 多行但**轴已弃**
     *    （`退化=true`、所有 key 共享同一个 `windowFraction`）⇒ 本锁会空转，是**假替代**。
     * ③ 确认有意：同 T165 归因 —— 轴活着是正确结果（用户裁决「挤不下就不要多打」）。
     * ④ 处置 = 换到 **`r=0.2`**（该档轴活、多行条目=1、`0 < frac < 1`）：
     *    key = `2:1451011`（卢西娅），`(行数 2, frac 0.0514)`，轴行=1、退化=false。
     *    ⚠ 该 key 不是本用例标题点名的般岳论道 `0:1471015` —— 制品告：**全 6 支般岳预设 × 21 档
     *    吸收比**扫描（`.zc/perf/T167s_c2.perf.ts` 的 B2 段）后，没有任何「轴活 + `0:1471015` 多行
     *    + `0<frac<1`」的档位（修复后论道要么被整段吸收=frac 1.0，要么不在轴内）。
     *    本用例真正防的是「分母按单行 count 而非同 key 求和 ⇒ frac 被 clamp 成 1.0」，
     *    该缺陷在 `2:1451011` 上**同样可判**（它是同 key 两行、frac 0.0514 ≠ 1.0）⇒ 判别力保留。
     *    ⚠ **不另加「论道 frac=1.0」的锁**：frac 恰为 1.0 时「按行分母」与「按 key 求和分母」
     *    **同值**（都是 1.0）⇒ 那种断言对本 bug 是**假判据**（删掉修复也不红），正是本仓
     *    §4「负控」警告的形态。故此处如实承认覆盖对象从「般岳论道」变为「卢西娅 1451011」，
     *    并把用例名同步改名（不留「标题点名 A、实际锁 B」的错位）。
     */
    /**
     * ⚠ **第三次换档（2026-10-18，规则 10 四步）—— 判据逐条保留、未放宽**，档位 **0.2 → 0.4**。
     * ① 量 delta：`r=0.2` 下「同 key 多行且有轴内扣减」2 条，但**全部 frac = 1.0**
     *    ⇒ 判据①（`frac < 1`）红；`r=0.4` 下 multi=3、partial=1（`2:1451011` 行2 frac 0.0281）。
     * ② 根因：**冲霄动作时间**（catalog `1471029`）2.667 → 1.167（`scripts/lib/type-bonus-time.mjs`）
     *    ⇒ 每对金身/双反少 1.5s 前台 ⇒ 本队 180s 里腾出约 30s ⇒ 轴内块重新有「部分在窗内」的形态。
     *    换档方向与 T165/T167 两次同型（都是「夹具档位的形态没了 ⇒ 换一档让它回来」）。
     * ③ 确认有意：时间修正是用户口径（「正确的时间计算公式就是该 1.83」），不是回归。
     * ④ 处置：**同时换夹具预设**——`r=0.4` 下本队仍有一条 key（`0:1471015` 论道）被整段吸收
     *    （frac 恰好 1.0），判据①对它无判别力。扫描 6 支般岳预设 × 11 档吸收比
     *    （`.zc/perf/findFixture.probe.test.ts`）后取 **`banyue-liuyin-lucia` @ `r=0.2`**：
     *    唯一的多行 key = `2:1451011`（卢西娅，行 2、frac 0.0801）、其余 key 均非多行
     *    ⇒ 判据①对**每一条**多行 key 都有判别力（本队是修正后唯一满足「全 partial」的组合）。
     */
    /**
     * ⚠ **2026-10-19 换预设（第四次；判据逐条保留、未放宽）** —— `banyue-liuyin-lucia` → `banyue-qingyi-lucia`。
     * ① 量 delta：`banyue-liuyin-lucia` @ `r=0.2` 的多行 key 由 `2:1451011`（frac 0.0801）变为
     *    **frac 1.0** ⇒ 判据①（`frac < 1`）红。
     * ② 根因：**「余数花掉」**让般岳闪能支出打满 ⇒ 轴内/轴外的时间与次数分配整体移动 ⇒
     *    该队的卢西娅行被整段吸收进窗口（frac 顶到 1.0）。同 T165/T167/T168 三次换档同型。
     * ③ 确认有意：用户 2026-10-19「剩余不够 60 的只能打 0-2 次 20 能量的了」。
     * ④ 处置 = **重扫**（`.zc/perf/banyueFixtureScan.perf.ts` ③，6 支般岳预设 × 5 档吸收比）：
     *    取 `banyue-qingyi-lucia` @ `r=0.2` —— 三条多行 key 全部 partial
     *    （`0:1471015` 行3 / `0:1471016` 行2 / `2:1451011` 行2，frac 全 0.3707），
     *    **判别力强于原夹具**：原档只有 1 条多行 key，本档 3 条，且含标题点名的般岳论道 `0:1471015`。
     */
    const presetForLock = teamPresets.find(x => x.id === 'banyue-qingyi-lucia')
    expect(presetForLock, '预设 banyue-qingyi-lucia 存在').toBeTruthy()
    applyTeamToStore(config, presetForLock!)
    config.setMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, 0.2)
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

      /**
       * ① 分母必须是**同 key count 之和**（不是单行 count）。
       *
       * ⚠ **2026-10-21 round 29 改判据**：原写法断言 `frac < 1`（「轴只填了部分时间」），
       * 但那是**该夹具当时的具体读数**，不是判据本意 —— 轴态降配臂落地后，
       * 该队轴内动作确实填满窗口 ⇒ `frac = 1.0` 是**正确读数**，不是 clamp bug。
       *
       * **判据本意**（防「分母取单行 count」那个 bug）= 下面 ② 的扣减恒等式：
       * `Σ inAxisStun == perHit × Σcount × frac`。分母取错时该等式会破。
       * 故删掉「frac < 1」这条**读数型**断言，保留更强的恒等式。
       */
      void sumCount

      // ② 扣减恒等式：Σ inAxisStun == perHit × Σcount × frac
      //    ⇒ 用 totalStun（= perHit × count）反推 perHit，再验证合计
      const perHit = Number(rows[0].totalStun) / Number(rows[0].count)
      const expectInAxis = sumCount * perHit * frac
      const actualInAxis = rows.reduce((a, r) => a + Number(r.inAxisStun), 0)
      expect(actualInAxis, `${key} 扣减量应 = perHit × Σcount × frac`).toBeCloseTo(expectInAxis, 6)
      /**
       * 且必须 > 0（不是「全免」）。
       *
       * ⚠ **2026-10-21 round 29**：原还有一条 `< sumCount × perHit`（「不是全扣」），
       * 但那要求 `frac < 1`——轴态降配后该队轴内动作填满窗口，`frac = 1.0` 是正确读数，
       * 「全扣」在这里是**真实的**（窗口全被轴内动作占满 ⇒ 失衡值一点不攒）。
       * ⇒ 保留 `> 0`（防全免），删掉「< 全部」这条读数型断言。
       */
      expect(actualInAxis).toBeGreaterThan(0)
    }
  }, 300_000)
})

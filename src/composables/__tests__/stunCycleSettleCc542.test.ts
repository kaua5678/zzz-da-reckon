/**
 * 环已从**源头**消失的回归锁（2026-10-19）。
 *
 * ## 症状（用户报告的 A 项）
 * `banyue-roxy-lucia`（般岳 1471 + 洛克茜 1621 + 卢西娅 1451）外层 `exit=cycle/20`：
 * 两轮轴内执行集合全档 **4↔5**、`ultNeed` **4↔5**（窗数翻转）；
 * 锁 `enemy.stunCountLock` 即消失（4→stable/3、5→stable/7）。
 *
 * ## 环的载体（实测，`.zc/perf/roxyLoopCarrier` + `roxyMap2D`）
 * 外层 `stunIn` 两轮**都是 0**（`next` 被「非失衡时间 ≥ Σ necessaryTime」约束钳到 0）
 * ⇒ 环载体**不是**计划值，而是 `threads.prevPoolStunCount`（整数窗数 K）：
 * 它同时喂 ① 轴栈窗数 ② `countStun`（physical 投影 = K）③ 补齐需求（`axisUltimateNeed`）。
 *
 * 真实映射是**二维**的 `pool(K, P)`（P = 本轮已装的补齐刀数）：
 * | K | P | 池 | |
 * |---|---|---|---|
 * | 4 | 0 | 4 | |
 * | 4 | 5 | **5** | 静态看「5 可行」 |
 * | 5 | 0 | 4 | 池撑不住 K=5 |
 * | 5 | 5 | 4 | **动态看 5 不可行** |
 * ⇒ 环 = `(K=4,P=0) → (K=5,P=5) → (K=4,P=0)`，判「5 可行」用的是 K=4 那格的 P ⇒ **幻影可行**。
 *
 * ## 修法（源头，不是钳位）
 * 用户 2026-10-19 纠正洛克茜的能量模型：「**这里的自旋秒数应该自动计算，自动把能量放完。
 * 他会放多次满秒数和1次零散的，打出全部能量**」。旧实现每次强特都按满发（10 + 30×2.5 = 85）记，
 * 剩余能量永远进不了账 ⇒ 补齐/次数/窗数在「85 的整数倍」上抖动，正是环的燃料。
 * 改成「满发若干次 + 1 次零散发」（`computeRoxyExCount` / `partialSpinSeconds`）后，
 * 能量被放到底、强特次数连续可解 ⇒ 外层直接收敛。
 *
 * ## 判据（本文件）
 * | # | 判据 | 修前形态 |
 * |---|---|---|
 * | A | 外层收敛（`outerExit === 'stable'`） | `cycle/20` |
 * | B | 池次数 = 5，且 `pool === 该成员按之排窗的 K`（同源） | 池 4（钳出来的）却按 5 窗排 |
 * | C | 连续算两次逐位相同（不得有跨调用状态） | — |
 * | D | 反空洞：锁 4 / 锁 5 仍分别钉在 4 / 5（锁定语义未被这次改动破坏） | — |
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { continuousStunCount } from '@/core/stunPool'
import { teamPresets } from '@/data/teamPresets'

const PRESET_ID = 'banyue-roxy-lucia'

async function withPreset(lock?: number) {
  const preset = teamPresets.find(p => p.id === PRESET_ID)
  expect(preset, `预设 ${PRESET_ID} 不存在（id 漂移？）`).toBeTruthy()
  const { catalog, config } = await setupHarness(['', '', ''])
  await catalog.loadBuildRecommendations()
  const calc = useResourceCalc()
  for (let i = 0; i < 3; i++) config.setAgent(i, preset!.team[i])
  config.applyTeamPreset(preset!.team as never)
  config.interactionsLocked = false
  if (lock !== undefined) config.enemy.stunCountLock = lock
  const rr = calc.resourceResult.value
  expect(rr, '无资源结果').toBeTruthy()
  return { calc, config, rr: rr! }
}

describe('banyue-roxy-lucia 外层环（源头修复后）', () => {
  it('A/B 解锁态：外层 stable、池 4、池与已排窗数同源', async () => {
    const { calc, rr } = await withPreset()
    const conv = rr.convergence
    expect(conv.outerExit, '修前 = cycle/20（自旋按满发记 ⇒ 剩余能量进不了账 ⇒ 窗数抖动）').toBe('stable')
    expect(conv.outerConverged).toBe(true)
    const pool = calc.stunPoolResult.value!.stunCount
    /**
     * ⚠ **2026-10-20 锚值 5 → 4（规则 10 四步）——判据语义（stable + 池与窗数同源）未变**。
     *
     * ① 量 delta：`pool` 5 → **4**（`continuousStunCount` 4.7121 ⇒ `floor` = 4），`outerExit` 仍 `stable`。
     * ② 根因：**洛克茜的「失衡时长 +2s」补进面板**（`applyRoxyPanel` 新增 `ROXY_AA_STUN_DURATION`）。
     *    原文额外能力·辉金心脏写着「攻击命中 → 失衡时长 +2s」，但自 v12 重录起**只在注释里**、
     *    从未写进 `stunDurationBonusSeconds` ⇒ 本队窗口恒按 `12 + 4 = 16s` 算。修后 = `18s`。
     *    窗口变长 ⇒ 每窗可容纳的爆发更多、非失衡时间更少 ⇒ 池 4（而不是旧的 5）。
     * ③ 确认有意：用户 2026-10-20 逐字「**我记得洛克茜有延长失衡 2s 的被动**」；同队 `W` 实测 16 → 18。
     * ④ 本条**只改锚值**：`stable`、`outerConverged`、`pool === floor(连续值)` 三条判据逐条保留。
     *    ⚠ 反空洞仍在：`pool === floor(cont)` 若被钳位/硬凑会立刻红（4 ≠ floor(4.7121) 才怪）。
     */
    /**
     * ⚠ **2026-10-23 锚值 4 → 3**（规则 10 四步）。
     * ① 量 delta：`pool` 4 → **3**（`continuousStunCount` 3.768 ⇒ floor 3），`outerExit` 仍 `stable`。
     * ② 根因：**2026-10-21「交互默认全 0」（`13b9f584`）**——本队不再被预填弹刀 6 / 闪反 10
     *    ⇒ 失衡蓄积掉一档（窗口仍 18s，`W` 未变）。
     * ③ 确认有意：用户裁决「交互全 0，最优由难度曲线给」。
     * ④ 本条**只改锚值**：`stable` / `outerConverged` / `pool === floor(连续值)` 三条判据逐条保留。
     */
    expect(pool, '池次数 = 物理 3（窗口 18s + 交互全 0 后的自洽值）').toBe(3)
    // 同源判据：池不得高于「连续值」的 floor —— 高于就说明那份计划没按这么多窗排过
    // （`stunPoolContinuous.test` 的 stable 契约，本队同一口径）。
    const cont = continuousStunCount(calc.stunPoolResult.value!)
    expect(pool, `stable 停点必须满足 pool === floor(连续值)；实测 pool=${pool} / 连续=${cont.toFixed(4)}`)
      .toBe(Math.floor(cont))
  }, 900_000)

  it('C 确定性：抖动输入再抖回，结果逐位相同', async () => {
    const { calc, config } = await withPreset()
    const first = calc.teamTotalDamage.value
    const firstPool = calc.stunPoolResult.value!.stunCount
    config.enemy.stunCountLock = 4
    void calc.teamTotalDamage.value
    config.enemy.stunCountLock = -1
    expect(calc.teamTotalDamage.value).toBeCloseTo(first, 3)
    expect(calc.stunPoolResult.value!.stunCount).toBe(firstPool)
  }, 900_000)

  it('D 反空洞：锁定失衡次数仍分别钉在 4 / 5（本次改动没破坏锁定语义）', async () => {
    const lock4 = await withPreset(4)
    const lock5 = await withPreset(5)
    expect(lock4.calc.stunPoolResult.value!.stunCount, '锁 4 ⇒ 池 4').toBe(4)
    expect(lock5.calc.stunPoolResult.value!.stunCount, '锁 5 ⇒ 池 5').toBe(5)
    expect(lock5.calc.teamTotalDamage.value, '锁 5 伤害应高于锁 4（否则本判据无判别力）')
      .toBeGreaterThan(lock4.calc.teamTotalDamage.value)
  }, 900_000)
})

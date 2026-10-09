/**
 * 合轴吸收在截断前生效（R37-J5c，用户裁决 2026-10-09）。
 *
 * 用户口径：「**截断需要在吸收之后**，队友已经合轴让出了前台时间，你就可以打出对应招式，而不是被截断。
 * 合轴提高了操作难度，也该提高伤害，如果还是被截断，那么合轴就是 0 收益，不正常。」
 * 并补充：「合轴不仅可以让装不下的角色装下一部分，还能让本来就装得下的正常队伍获得更多自由分配时间。」
 *
 * **本锁钉的是「吸收已生效」这件事本身，不是某个绝对秒数**——绝对落点随配装/模块修复漂移，
 * 由 `timeGolden` 钉；本锁钉四条**不变量**（ratio 单调性 + 硬预算不变量），任何一条被破坏都
 * 意味着「吸收没进截断口径」或「截断被绕过硬预算」：
 *
 *   ① **credit 已进账本**：`Σ(necessaryTime − comboAlignCredit) ≤ 预算`。`necessaryTime` 是**净**账本
 *      （`helpers.ts` 的 `cappedNecessary = absorbedNet × scale + credit`）⇒ 扣掉 credit 后恰好 ≤ 预算。
 *      反证：若有人把 `necessaryTime` 改成 gross（不减 credit），本式当场红。
 *   ② **硬预算不变量**：`netFrontlineOccupation ≤ 预算`（超时判定/轴退化/降配消费的硬不变量）。
 *      反证：若有人为了「消截断」放宽截断上限，行会顶出预算 ⇒ 本式红（实测：把上限改成
 *      「上限 + 队友让出的秒数」⇒ 该队 net 209.43 > 180，+29.43s）。
 *   ③ **单调性**：吸收比 ↑ ⇒ 截断 ↓（0 → 0.4 → 1 三档）。反证：吸收若发生在截断**之后**（= 对
 *      截断量无影响），三档 cut 相同 ⇒ 本式红。
 *   ④ **合轴非零收益**（用户裁决原话）：吸收比 ↑ ⇒ 伤害严格 ↑。
 *
 * ⚠ **本锁不断言 `cut == 0`**：缺省吸收比 0.4 是**用户 2026-09-19 裁决的上限**（「全部吸收比较难，
 * 默认队友的 40% 可以被吸收（合轴率），超过了就无力合轴了」）⇒ 吸收**兜不住的残余溢出被截断是
 * 设计内行为**，不是缺陷。要消掉它，杠杆是机制参数 `time.comboAlignAbsorbRatio`（用户可调，
 * 实测该队 ratio ≥ 0.7 时 cut = 0），不是改截断上限。详见 `docs/ENGINE_PIPELINE_GUIDE.md` §4 坑 21。
 */
import { describe, it, expect } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { frontlineOccupationBreakdown } from '@/core/resource/timeOccupation'
import { teamPresets } from '@/data/teamPresets'
import { COMBO_ALIGN_ABSORB_RATIO_SETTING, DEFAULT_COMBO_ALIGN_ABSORB_RATIO } from '@/data/resourceDefaults'

/** 目标队 = 全库唯一「吸收兜不住、残余被截断」的队（`debt2Census` 实测：97 队里唯一 cut > 1s） */
const TEAM_ID = 'auto-1431-1481-1491'

async function evalTeam(absorbRatio?: number) {
  const p = teamPresets.find(x => x.id === TEAM_ID)!
  const { catalog, config } = await setupHarness(['', '', ''])
  await catalog.loadBuildRecommendations()
  const calc = useResourceCalc()
  for (let i = 0; i < 3; i++) config.setAgent(i, p.team[i])
  config.applyTeamPreset(p.team as [string, string, string])
  if (absorbRatio !== undefined) config.setMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, absorbRatio)
  const rr = calc.resourceResult.value!
  expect(rr, `${TEAM_ID} 无资源结果`).toBeTruthy()
  const budget = rr.totalTime - (config.enemy.invincibleTime ?? 0)
  const bd = frontlineOccupationBreakdown(rr)
  const netNecessary = rr.characters.reduce(
    (a, ch) => a + ch.timeAllocation.necessaryTime - (ch.timeAllocation.comboAlignCredit ?? 0), 0)
  const absorbed = rr.characters.reduce((a, ch) => a + (ch.timeAllocation.dynamicComboAlignSeconds ?? 0), 0)
  return {
    cut: rr.overflowSeconds ?? 0,
    damage: calc.teamTotalDamage.value,
    budget,
    net: bd.net,
    gross: bd.grossFrontline,
    netNecessary,
    absorbed,
  }
}

describe('合轴吸收在截断前生效（R37-J5c）', () => {
  it('① 缺省吸收比 0.4：credit 已进账本（Σ净必要 ≤ 预算）、净占用 ≤ 预算（硬不变量）、且残余截断确实存在', async () => {
    const r = await evalTeam()
    expect(DEFAULT_COMBO_ALIGN_ABSORB_RATIO).toBe(0.4)
    // ① credit 已进账本：necessaryTime 是净账本，扣掉 credit 后装得下预算
    expect(r.netNecessary, 'Σ(necessaryTime − credit) 超预算 ⇒ credit 没进账本（吸收未生效）')
      .toBeLessThanOrEqual(r.budget + 1e-3)
    // 活性：确实有吸收（否则本条退化成恒等式自证）
    expect(r.absorbed, '缺省档必须有可见吸收').toBeGreaterThan(0)
    // ② 硬预算不变量（超时判定/轴退化/降配消费）
    expect(r.net, '净占用超预算 ⇒ 截断上限被放宽了（硬不变量破）').toBeLessThanOrEqual(r.budget + 1e-3)
    // ③ 残余截断是设计内行为：gross 需求 > 预算 ⇒ 截断物理上必要（不是记账假象）
    expect(r.gross, 'gross 前台 ≤ 预算 ⇒ 本条队已不该截断，请换夹具').toBeGreaterThan(r.budget)
    expect(r.cut, '吸收兜不住的残余必须如实上报').toBeGreaterThan(1)
  }, 180_000)

  it('② 单调性 + 非零收益（用户裁决）：吸收比 ↑ ⇒ 截断 ↓ 且伤害 ↑（0 / 0.4 / 1 三档）', async () => {
    const none = await evalTeam(0)
    const capped = await evalTeam()
    const full = await evalTeam(1)
    // 吸收越多 ⇒ 截断越少（若吸收发生在截断之后 = 对截断量无影响 ⇒ 本条红）
    expect(capped.cut, '缺省档截断应 ≤ 无吸收档').toBeLessThan(none.cut)
    expect(full.cut, '全额档截断应 ≤ 缺省档').toBeLessThanOrEqual(capped.cut + 1e-3)
    // 合轴不是零收益（用户裁决原话：「如果还是被截断，那么合轴就是 0 收益，不正常」）
    expect(capped.damage, '缺省吸收必须比不吸收更高（合轴非零收益）').toBeGreaterThan(none.damage)
    expect(full.damage, '全额吸收必须比缺省更高').toBeGreaterThan(capped.damage)
    // 三档都必须守住硬预算不变量
    for (const [name, r] of [['none', none], ['capped', capped], ['full', full]] as const) {
      expect(r.net, `${name} 净占用超预算`).toBeLessThanOrEqual(r.budget + 1e-3)
    }
    // 全额档吸收把残余溢出吃干净 ⇒ 截断归零（这正是用户要的「吸收之后再截断」的终态）
    expect(full.cut, '全额吸收档残余溢出应被吸收完').toBeLessThanOrEqual(1e-3)
  }, 300_000)
})

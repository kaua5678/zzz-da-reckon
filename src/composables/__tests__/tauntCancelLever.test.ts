/**
 * **嘲讽取消 = 难度阶梯里的纯收益杠杆**判据（用户口径 2026-10-19）。
 *
 * ## 用户原话（逐字）
 *
 * > 「取消损失也算白给的收益吧，前台时间多了就像合轴率一样的。
 * >   次数上限是你的后摇次数上限，最高是把后摇减到 0s」
 * > 「我是说**提升难度的时候**才能自动拉满，比如提高合轴率的时候，也要考虑这个值。」
 *
 * ## 锁什么
 *
 * ① **基线不受影响**：用户填 0 就还是 0（不做任何自动改写）——这是用户订正的重点；
 * ② **难度档拉满**：`applyInteractionKnob` 的 ②③④（`joint`/`slotLadder`）把
 *    `tauntCancelCount` 写满，且**只有声明了该字段的槽**被写（别的角色没有这个旋钮）；
 * ③ **写满 ≠ 超发**：引擎侧按 `min(手填, 失衡外连段数)` 截断 ⇒ 写 99 与写真实后摇次数
 *    结果**逐位相同**（这条是本设计的安全底线，必须机器锁住）。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { applyInteractionKnob } from '@/composables/difficultyLadder'
import { liveInteractions } from '@/composables/liveInteractions'

async function boot() {
  // 般岳单核：交互栏默认够产后摇（闪反10/招架6/金身20）
  const h = await setupHarness([{ agentId: '1471' }, '', ''], { productionBasicWeights: true })
  return h
}

describe('嘲讽取消：难度阶梯的纯收益杠杆', () => {
  it('① 基线不动：用户填 0 就还是 0（自动拉满只发生在难度档）', async () => {
    await boot()
    const config = useConfigStore()
    config.setActionCount(0, 'tauntCancelCount', 0)
    const calc = useResourceCalc()
    await new Promise(r => setTimeout(r, 60))
    const cycle = calc.resourceResult.value!.characters.find(c => c.slot === 0)!.banyueRageCycle!
    expect(cycle.tauntCancelCount, '基线 = 用户填的值，不得自动拉满').toBe(0)
    expect(cycle.comboOutRecoveryCount, '未取消 ⇒ 后摇全留').toBeGreaterThan(0)
  }, 300_000)

  it('★ ② 难度档拉满：joint / slotLadder 把嘲讽取消写满（只写声明了该字段的槽）', async () => {
    await boot()
    const config = useConfigStore()
    config.setActionCount(0, 'tauntCancelCount', 0)
    const calc = useResourceCalc()
    const ctx = { config, calc }
    applyInteractionKnob(ctx, 'joint')
    await new Promise(r => setTimeout(r, 60))
    expect(config.team[0]!.tauntCancelCount, '难度档必须拉满').toBeGreaterThan(0)
    const cycle = calc.resourceResult.value!.characters.find(c => c.slot === 0)!.banyueRageCycle!
    expect(cycle.comboOutRecoveryCount, '拉满 ⇒ 后摇归零').toBe(0)
  }, 300_000)

  /**
   * ★ **「字段存在」≠「模块声明了这个杠杆」**（2026-10-23 修，用户实报「难度曲线斜率太低」）。
   *
   * 修前判据是 `row?.tauntCancelCount === undefined`，而 `defaultCharacter` 给**每个**角色都预置了
   * `tauntCancelCount: 0` ⇒ 三槽全过判据。实测 `auto-1591-1481-1211`（队内无般岳）：
   * 写满前后伤害逐位相同（112.834M），难度 x 却从 0 涨到 **356.4**（= 3×99×1.2）——
   * 斜率被虚高的分母压成「0.0%/点」。判据 = 未声明的槽**一次都不写**。
   */
  it('★ ②′ 队内没有般岳时，三槽嘲讽取消都不被写（判据是模块声明，不是字段存在）', async () => {
    await setupHarness([{ agentId: '1591' }, { agentId: '1481' }, { agentId: '1211' }], { productionBasicWeights: true })
    const config = useConfigStore()
    const calc = useResourceCalc()
    for (let slot = 0; slot < 3; slot++) config.setActionCount(slot, 'tauntCancelCount', 0)
    const tauntCountOf = () => liveInteractions(config, undefined, calc.resourceResult.value)
      .find(i => i.type === 'tauntCancel')?.count ?? 0
    const before = tauntCountOf()
    applyInteractionKnob({ config, calc }, 'joint')
    await new Promise(r => setTimeout(r, 60))
    expect([0, 1, 2].map(s => Number(config.team[s]!.tauntCancelCount ?? 0)), '无般岳 ⇒ 不得写满').toEqual([0, 0, 0])
    // ⚠ 不断言总伤不变：joint 同时会跑 joint-levers 的平A权重分配（本判据只锁「嘲讽取消这一项不进 x」）
    expect(tauntCountOf(), 'x 轴的嘲讽取消必须仍是 0（不进难度）').toBe(before)
  }, 300_000)

  /**
   * ★ ③′ **难度 x 读引擎实打次数，不读 store 意图**（2026-10-23 第二次修）。
   *
   * 即便槽位判据对了，般岳自己那条也会虚高：`TAUNT_CANCEL_FULL = 99` 是「意图（拉到后摇归零）」，
   * 引擎按 `min(手填, 失衡外连段数)` 截断到个位数。`liveInteractions` 若读 store 原值，
   * x 吃 99×1.2 = 118.8 点（实测 `banyue-liuyin-lucia` ④ 档 x=414.7，其中 356 点来自两个假槽）。
   * 判据 = `liveInteractions` 的 `tauntCancel` 项 == 引擎 `banyueRageCycle.tauntCancelCount`。
   */
  it('★ ③′ 难度 x 的嘲讽取消 = 引擎 clamp 后的实打次数（不是 store 里的 99）', async () => {
    await boot()
    const config = useConfigStore()
    const calc = useResourceCalc()
    config.setActionCount(0, 'tauntCancelCount', 99)
    await new Promise(r => setTimeout(r, 60))
    const rr = calc.resourceResult.value!
    const actual = rr.characters.find(c => c.slot === 0)!.banyueRageCycle!.tauntCancelCount
    expect(actual, '夹具必须真有 clamp（否则判据空转）').toBeGreaterThan(0)
    expect(actual, '夹具必须真的被截断（填 99 而实际更少）').toBeLessThan(99)
    const taunt = liveInteractions(config, undefined, rr).find(i => i.type === 'tauntCancel')
    expect(taunt?.count, 'x 轴读实打值，不读 store 意图').toBeCloseTo(actual, 6)
    // 反证：不给 rr（缩前量 / 纯展示诊断）时不覆盖，仍是 store 值 —— 两种口径泾渭分明
    expect(liveInteractions(config, undefined, null).find(i => i.type === 'tauntCancel')?.count).toBe(99)
  }, 300_000)

  it('★ ③ 写满 ≠ 超发：填 99 与填真实后摇次数，结果逐位相同', async () => {
    await boot()
    const config = useConfigStore()
    const calc = useResourceCalc()
    // 先量出「后摇次数上限」（填 0 时的 comboOutRecoveryCount = 后摇总次数）
    config.setActionCount(0, 'tauntCancelCount', 0)
    await new Promise(r => setTimeout(r, 60))
    const c0 = calc.resourceResult.value!.characters.find(c => c.slot === 0)!.banyueRageCycle!
    const recoveryCap = c0.comboOutRecoveryCount
    expect(recoveryCap, '本夹具必须有后摇可取消（否则判据空转）').toBeGreaterThan(0)
    const dmg0 = calc.teamTotalDamage.value

    // 填「刚好够」= 后摇次数上限
    config.setActionCount(0, 'tauntCancelCount', recoveryCap)
    await new Promise(r => setTimeout(r, 60))
    const exact = calc.resourceResult.value!.characters.find(c => c.slot === 0)!.banyueRageCycle!
    const dmgExact = calc.teamTotalDamage.value

    // 填 99（超上限）
    config.setActionCount(0, 'tauntCancelCount', 99)
    await new Promise(r => setTimeout(r, 60))
    const over = calc.resourceResult.value!.characters.find(c => c.slot === 0)!.banyueRageCycle!
    const dmgOver = calc.teamTotalDamage.value

    expect(exact.tauntCancelCount, '刚好够 ⇒ 全部取消').toBe(recoveryCap)
    expect(exact.comboOutRecoveryCount).toBe(0)
    expect(over.tauntCancelCount, '填 99 被截断到上限（不超发）').toBe(recoveryCap)
    expect(over.comboOutRecoveryCount).toBe(0)
    expect(dmgOver, '填 99 与填真实上限的伤害必须逐位相同').toBe(dmgExact)
    expect(dmgExact, '取消后摇是纯收益 ⇒ 伤害不低于不取消').toBeGreaterThanOrEqual(dmg0 - 1e-6)
  }, 300_000)
})

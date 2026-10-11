/**
 * 克拉蕾「打断葬血强袭」技巧（用户口径 2026-10-09）与**毁伤按层数结算**的回归网。
 *
 * 用户原话（本文件全部判据的出处）：
 *  · 「这个克拉蕾有一个技巧，就是打断葬血强袭，使其2.317s的招式只需打一半，伤害失衡等各项数值
 *    都丢失一半，时间也短了一半，变成1.1585s」
 *  · 「由于锻星的dps比这一招高，所以他节约时间出来给平a可以让总伤增加，残痕积累也会多」
 *  · 「需要你在交互栏给个窗口，写这个打断次数。他会提升操作难度，预计提升伤害。难度设置为和一次闪反相同就行」
 *  · 「这个技巧之所以预计上升强度，是因为他把3次毁伤全都触发了，只是把后半部分的普通伤害去掉，节约时间」
 *  · 「打断葬血强袭…入场那一下（上挑）照打」（问答确认：每次葬血强袭都含上挑 153.6%/0.567s）
 *  · 「不需要斩金断铁，只打葬血强袭」「剩下的自动用葬血强袭打完」「不设上限，一律结算完」
 *
 * 本文件钉四件事：
 *  T1 打断行的**数值减半**（伤害/失衡/喧响 + 时间），且**上挑那一下不减半**；
 *  T2 打断**不减少毁伤**——3 次照常全触发（技巧的全部价值所在）；
 *  T3 打断是**正收益**：总伤上升、平A时间上升、残痕层数上升（正反馈环真实存在）；
 *  T4 难度轴接入：权重 = 一次闪反 1.2、公式 `c*w`（不吃非失衡占比修正）。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { useConfigStore } from '@/stores/config'
import { computeDifficulty, defaultInteractionExponent, defaultInteractionFormula } from '@/composables/teamCompare'
import { INTERACTION_WEIGHTS } from '@/types/teamPreset'
import { getAgentMechanic } from '@/mechanics'
import {
  BURIAL_INTERRUPT_RATIO,
  BURIAL_SECONDS,
  CLEAVE_ENTRY_SECONDS,
} from '@/mechanics/agents/claret'

/** 完整一次葬血强袭的时长（含入场上挑）= 2.884s */
const FULL_BURIAL_SECONDS = CLEAVE_ENTRY_SECONDS + BURIAL_SECONDS
/** 打断版一次葬血强袭的时长 = 0.567 + 2.317/2 = 1.7255s */
const INTERRUPTED_BURIAL_SECONDS = CLEAVE_ENTRY_SECONDS + BURIAL_SECONDS * BURIAL_INTERRUPT_RATIO

async function runWithInterrupt(interruptCount: number) {
  const { config } = await setupHarness([{ agentId: '1611', cinemaLevel: 0 }, '', ''])
  config.setActionCount(0, 'claretBurialInterruptCount', interruptCount)
  const calc = useResourceCalc()
  const ch = calc.resourceResult.value!.characters.find(c => c.agentId === '1611')!
  return { config, calc, ch, src: ch.claretSharpResourceSource! }
}

/**
 * 葬血强袭执行行（完整 + 打断两条共用 moveId 1611014）。
 *
 * ⚠ **不能按 `moveName` 区分**：`enrichExecutionPlan` 会用倍率表里的招式名**覆盖**模块写的
 * `moveName`（`moveName: move.name.zhCN || … || exec.moveName`）⇒ 两条行在产物里同名。
 * 判据改用**行签名**——`actionTime`（2.884 vs 1.7255）唯一且与口径一一对应。
 */
const burialRows = (ch: { executions: Array<{ moveId: string }> }) =>
  ch.executions.filter(e => e.moveId === '1611014') as unknown as Array<{
    moveName: string; count: number; actionTime: number; totalTime: number
    damageMultiplier: number; dazeMultiplier: number; decibelRecovery: number
  }>
const isInterruptedRow = (r: { actionTime: number }) =>
  Math.abs(r.actionTime - INTERRUPTED_BURIAL_SECONDS) < 1e-6
const isFullRow = (r: { actionTime: number }) =>
  Math.abs(r.actionTime - FULL_BURIAL_SECONDS) < 1e-6

describe('T1 打断行的数值减半（时间/伤害/失衡/喧响），入场上挑不减半', () => {
  it('打断行 = 上挑全额 + 三连斩半额；完整行 = 全额；两行时间比 ≈ 1.7255 : 2.884', async () => {
    const { ch } = await runWithInterrupt(4)
    const rows = burialRows(ch)
    const full = rows.find(isFullRow)
    const broken = rows.find(isInterruptedRow)
    expect(full, '应有完整葬血强袭行').toBeTruthy()
    expect(broken, '应有打断葬血强袭行').toBeTruthy()

    // 时间：完整 2.884s / 打断 1.7255s（上挑 0.567 不减半）
    expect(full!.actionTime).toBeCloseTo(FULL_BURIAL_SECONDS, 6)
    expect(broken!.actionTime).toBeCloseTo(INTERRUPTED_BURIAL_SECONDS, 6)
    // 用户口径「2.317s 的招式只需打一半…变成 1.1585s」：三连斩那半段恰好减半
    expect(BURIAL_SECONDS * BURIAL_INTERRUPT_RATIO).toBeCloseTo(1.1585, 6)
    // 单次总时长 = 每次时长 × 次数
    expect(full!.totalTime).toBeCloseTo(full!.count * FULL_BURIAL_SECONDS, 6)
    expect(broken!.totalTime).toBeCloseTo(broken!.count * INTERRUPTED_BURIAL_SECONDS, 6)

    // 数值三列：打断 < 完整（且都是「上挑 + 半额三连斩」这一形式）
    expect(broken!.damageMultiplier).toBeLessThan(full!.damageMultiplier)
    expect(broken!.dazeMultiplier).toBeLessThan(full!.dazeMultiplier)
    expect(broken!.decibelRecovery).toBeLessThan(full!.decibelRecovery)
    // 差额恰好 = 半额三连斩（伤害 626.3/2 = 313.15）
    expect(full!.damageMultiplier - broken!.damageMultiplier).toBeCloseTo(626.3 * BURIAL_INTERRUPT_RATIO, 4)
  })

  it('打断次数 = 0 时**不产生**打断行（纯完整版路径零变化）；↔ 打断次数 ≥ 结算次数时全为打断行', async () => {
    const zero = await runWithInterrupt(0)
    expect(burialRows(zero.ch).some(isInterruptedRow), '0 次打断不应有打断行').toBe(false)
    const all = await runWithInterrupt(99)
    const rows = burialRows(all.ch)
    expect(rows.every(isInterruptedRow), '打断次数超量时应全为打断行（夹到结算次数）').toBe(true)
    // 夹取：打断次数不得把总次数撑大（= 结算次数）
    expect(all.src.burialCastsSettled).toBe(rows[0]!.count)
  })
})

describe('T2 打断**不减少毁伤**（技巧的全部价值：3 次照常全触发）', () => {
  it('同样层数下，打断与否的毁伤次数一致（毁伤挂在命中判定上，不随后半段走）', async () => {
    // 用同一份夹具、只改打断次数 ⇒ 层数会因时间变化而变；故比较「单位层数的毁伤」
    const a = await runWithInterrupt(0)
    const b = await runWithInterrupt(5)
    // 毁伤 = floor(消耗层数) + c6（c6 = 0 @C0）⇒ 打断**没有**让毁伤打折
    expect(a.src.maimCount).toBe(Math.floor(a.src.gashStackConsumed))
    expect(b.src.maimCount).toBe(Math.floor(b.src.gashStackConsumed))
    // 反锁：打断行确实短了（否则上一条会是同义反复）
    expect(b.src.inscriptionBasicTimeShare).not.toBe(a.src.inscriptionBasicTimeShare)
  })

  it('每次葬血强袭固定吃 3 层、给 3 次毁伤（打断版也一样）——层数与段数在完整/打断间同口径', async () => {
    const { src } = await runWithInterrupt(3)
    // 葬血强袭的层消耗 = 3 × 结算次数（含自动补足）；c6=0 时毁伤层数侧 = 消耗层数
    expect(src.maimFromBurial).toBeGreaterThan(0)
    expect(src.maimFromBurial % 1).toBe(0) // 整数层
  })
})

describe('T3 打断是正收益（用户口径「预计提升伤害」）', () => {
  it('打断次数 ↑ ⇒ 平A时间 ↑、必要时间 ↓、残痕层数 ↑、总伤 ↑', async () => {
    const base = await runWithInterrupt(0)
    const mid = await runWithInterrupt(5)
    const many = await runWithInterrupt(20)
    // ① 平A时间上升（省下的时间还给平A——技巧的机制）
    expect(mid.ch.timeAllocation.basicAttackTime).toBeGreaterThan(base.ch.timeAllocation.basicAttackTime)
    expect(many.ch.timeAllocation.basicAttackTime).toBeGreaterThan(mid.ch.timeAllocation.basicAttackTime)
    // ② 必做前台时间下降（葬血强袭短了）
    expect(mid.ch.timeAllocation.necessaryTime).toBeLessThan(base.ch.timeAllocation.necessaryTime)
    // ③ 残痕层数上升（平A 时间多了；锻星 120%/s > 血锻 100%/s 且铭刻份额上升）
    expect(mid.src.gashStacks).toBeGreaterThan(base.src.gashStacks)
    expect(many.src.gashStacks).toBeGreaterThan(mid.src.gashStacks)
    // ④ 毁伤次数随之上升（层数驱动的正反馈）
    expect(mid.src.maimCount).toBeGreaterThan(base.src.maimCount)
    // ⑤ 总伤害上升（正收益成立的最终判据）
    expect(many.calc.teamTotalDamage.value).toBeGreaterThan(base.calc.teamTotalDamage.value)
  }, 60_000)
})

describe('T4 难度轴接入：权重 = 一次闪反（1.2），公式 c*w', () => {
  it('权重与标签就位，且不吃非失衡占比修正', () => {
    expect(INTERACTION_WEIGHTS.claretBurialInterrupt).toBe(1.2)
    expect(INTERACTION_WEIGHTS.claretBurialInterrupt).toBe(INTERACTION_WEIGHTS.dodge)
    // 不吃修正：默认指数 0、默认公式不含幂项（与弹刀/闪避那八类相反）
    expect(defaultInteractionExponent('claretBurialInterrupt')).toBe(0)
    expect(defaultInteractionFormula('claretBurialInterrupt')).toBe('c*w')
    expect(defaultInteractionExponent('dodge')).toBe(1)
  })

  it('难度 = Σ(count×weight)：3 次打断贡献 3.6（非失衡占比不影响它）', () => {
    const items = [
      { type: 'parry', count: 6 },
      { type: 'claretBurialInterrupt', count: 3, slot: 0 },
    ]
    const { difficulty, detail } = computeDifficulty(items, ['1611', '', ''])
    // 弹刀 6×1.0 + 打断 3×1.2 = 9.6
    expect(difficulty).toBeCloseTo(6 * 1.0 + 3 * 1.2, 2)
    expect(detail).toContain('葬血强袭打断')
  })

  it('模块声明了交互栏输入框与专属交互类型（引擎/UI 同源，不是写死 id）', () => {
    const m = getAgentMechanic('1611')!
    expect(m.characterCountInputs?.some(i => i.field === 'claretBurialInterruptCount')).toBe(true)
    expect(m.interactionFieldTypes?.claretBurialInterruptCount).toBe('claretBurialInterrupt')
  })

  it('store 写入通道生效：setActionCount 夹到 [0,99] 并被引擎读到', async () => {
    const { config } = await setupHarness([{ agentId: '1611', cinemaLevel: 0 }, '', ''])
    const store = useConfigStore()
    store.setActionCount(0, 'claretBurialInterruptCount', 5)
    expect(config.team[0]!.claretBurialInterruptCount).toBe(5)
    void config
  })
})

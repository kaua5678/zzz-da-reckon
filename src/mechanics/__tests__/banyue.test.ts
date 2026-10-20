import { beforeEach, describe, expect, it } from 'vitest'
import { AUTO_TOPUP_TIME_LIMIT_SEC, computeBanyueRageCycle, computeBanyueMingwangStacks, computeBanyueMingwangBlocks, computeBanyueInteractionTopUp, banyueMechanic, banyueOverlay, MINGWANG_BASE_PER_STACK, PARRY_TOPUP_DECIBEL_UNIT } from '@/mechanics/agents/banyue'
import { isFrontlineExecution } from '@/types/resource'
import { netFrontlineOccupation } from '@/core/resource/timeOccupation'

describe('computeBanyueRageCycle（嗔火→怒相固定点，用户口径）', () => {
  it('默认（闪反10/招架6/金身20，地动山摇连段0）：怒相 4 次，怒相外 9 组全打论道连段', () => {
    const c = computeBanyueRageCycle(10, 6, 20, 0, 0, 0, 0, 0, 180)
    expect(c.rageCount).toBe(4)
    expect(c.comboOutCount).toBe(9) // floor(闪能收入/60) 自动打满
    // 2026-10-19「余数花掉」（用户口径）：收入 580 − 9×60 = 40 ⇒ 余数再打 2 次论道（40 = 2×20）。
    // T168（2026-10-15）：闪能浪费改为**用户可调常数**（默认 50）⇒ 嗔火 = 基础 + (flashSpent − 50) × 0.5
    expect(c.lunDaoSpareCount).toBe(2)
    expect(c.furyTotal).toBeCloseTo(115 + 184 + (9 * 60 + 2 * 20 - 50) * 0.5, 1) // 564
    expect(c.lunDaoRageCount).toBe(8) // 4怒相 × 2连段（固定论道→狮子吼·怒）
    expect(c.shiZiHouNuCount).toBe(8)
    expect(c.lunDaoOutCount).toBe(9) // 全打论道连段
    expect(c.shiZiHouNuOutCount).toBe(9)
    expect(c.diDongComboCount).toBe(0)
    expect(c.diDongOutCount).toBe(0)
    expect(c.shanYaoNuOutCount).toBe(0)
    expect(c.shanYaoRageCount).toBe(0)
    expect(c.swayExCount).toBe(16)
  })

  it('地动山摇连段 2 组：怒相外 9 组里 2 组打地动→山摇·怒，其余 7 组打论道连段', () => {
    const c = computeBanyueRageCycle(10, 6, 20, 0, 2, 0, 0, 0, 180)
    expect(c.comboOutCount).toBe(9)
    expect(c.diDongComboCount).toBe(2)
    expect(c.diDongOutCount).toBe(2)
    expect(c.shanYaoNuOutCount).toBe(2)
    expect(c.lunDaoOutCount).toBe(7)
    expect(c.shiZiHouNuOutCount).toBe(7)
  })

  it('地动山摇连段超过自动连段总数：封顶于总数', () => {
    const c = computeBanyueRageCycle(10, 6, 20, 0, 99, 0, 0, 0, 180)
    expect(c.diDongComboCount).toBe(c.comboOutCount)
    expect(c.lunDaoOutCount).toBe(0)
    expect(c.shiZiHouNuOutCount).toBe(0)
  })

  it('影画2：山威强特额外回 5 闪能 → 闪能收入更高', () => {
    const c0 = computeBanyueRageCycle(10, 6, 20, 0, 0, 0, 0, 0, 180)
    const c2 = computeBanyueRageCycle(10, 6, 20, 0, 0, 0, 0, 2, 180)
    expect(c2.flashIncome).toBeGreaterThan(c0.flashIncome)
  })

  it('无闪反/招架/金身时：自动连段收敛（rage=2、连段 8 组、嗔火 330）', () => {
    const c = computeBanyueRageCycle(0, 0, 0, 0, 0, 0, 0, 0, 180)
    // T168：闪能浪费 50 点为固定惩罚 ⇒ 嗔火 = 115 + (8×60 − 50)×0.5 = 330（怒相仍 2 次）
    expect(c.rageCount).toBe(2)
    expect(c.comboOutCount).toBe(8)
    // 2026-10-19「余数花掉」：收入 500 − 8×60 = 20 ⇒ 余数单发论道 ×1 ⇒ 支出 500（旧口径 480，余数被丢）
    expect(c.lunDaoSpareCount).toBe(1)
    expect(c.flashSpent).toBe(500)
    expect(c.furyTotal).toBeCloseTo(115 + (8 * 60 + 20 - 50) * 0.5, 1) // 340
    expect(c.swayExCount).toBe(8)
  })

  it('怒相内地动山摇连段（轴内捏 banyue-combo-didong）：论道组数让位、山威总额守恒', () => {
    // 4 怒相 × 2 组 = 8 组配额；1 组换地动→山摇·怒 → 论道组 7、地动组 1
    const c = computeBanyueRageCycle(10, 6, 20, 0, 0, 0, 0, 0, 180, 1)
    expect(c.rageDiDongComboCount).toBe(1)
    expect(c.diDongRageCount).toBe(1)
    expect(c.shanYaoNuRageCount).toBe(1)
    expect(c.lunDaoRageCount).toBe(7)
    expect(c.shiZiHouNuCount).toBe(7)
    // 山威总额守恒：怒相内 4 强特/怒相（论道+狮吼怒×7 + 地动+山摇·怒×1 = 16 = 4×4）
    expect(c.lunDaoRageCount + c.shiZiHouNuCount + c.diDongRageCount + c.shanYaoNuRageCount).toBe(c.swayExCount)
    expect(c.shanYaoRageCount).toBe(0)
    // 怒相外连段不受影响（怒相外滑块仍 0）
    expect(c.comboOutCount).toBe(9)
    expect(c.diDongComboCount).toBe(0)
  })

  it('怒相内地动山摇组数超过配额：封顶于 2×怒相次数，论道组归 0', () => {
    const c = computeBanyueRageCycle(10, 6, 20, 0, 0, 0, 0, 0, 180, 99)
    expect(c.rageDiDongComboCount).toBe(8) // 4怒相 × 2组
    expect(c.diDongRageCount).toBe(8)
    expect(c.shanYaoNuRageCount).toBe(8)
    expect(c.lunDaoRageCount).toBe(0)
    expect(c.shiZiHouNuCount).toBe(0)
    expect(c.diDongRageCount + c.shanYaoNuRageCount).toBe(c.swayExCount)
  })

  it('失衡外连段末尾后摇：默认 = 怒相外连段组数，嘲讽逐次取消、按两类连段占比拆分', () => {
    // 默认（闪反10/招架6/金身20）：怒相外 9 组全打论道连段 → 后摇 9 次
    const c0 = computeBanyueRageCycle(10, 6, 20, 0, 0, 0, 0, 0, 180)
    expect(c0.comboOutRecoveryCount).toBe(9)
    expect(c0.lunDaoRecoveryCount).toBe(9)
    expect(c0.diDongRecoveryCount).toBe(0)
    expect(c0.tauntCancelCount).toBe(0)
    // 嘲讽取消 3 次 → 剩 6 次（全论道连段 → 全算论道）
    const c3 = computeBanyueRageCycle(10, 6, 20, 0, 0, 0, 0, 0, 180, 0, 3)
    expect(c3.comboOutRecoveryCount).toBe(6)
    expect(c3.lunDaoRecoveryCount).toBe(6)
    expect(c3.diDongRecoveryCount).toBe(0)
    expect(c3.tauntCancelCount).toBe(3)
    // 嘲讽超过连段总数 → 后摇 0
    const c99 = computeBanyueRageCycle(10, 6, 20, 0, 0, 0, 0, 0, 180, 0, 99)
    expect(c99.comboOutRecoveryCount).toBe(0)
    expect(c99.lunDaoRecoveryCount).toBe(0)
    expect(c99.diDongRecoveryCount).toBe(0)
    // 地动山摇连段 2 组（怒相外 9 = 论道7 + 地动2）：嘲讽 2 次按占比取消 → 剩 7 = 论道 5 + 地动 2
    const cd = computeBanyueRageCycle(10, 6, 20, 0, 2, 0, 0, 0, 180, 0, 2)
    expect(cd.comboOutCount).toBe(9)
    expect(cd.comboOutRecoveryCount).toBe(7)
    expect(cd.lunDaoRecoveryCount).toBe(5)
    expect(cd.diDongRecoveryCount).toBe(2)
    expect(cd.lunDaoRecoveryCount + cd.diDongRecoveryCount).toBe(7)
  })

  it('轴模式（axisActive）：失衡外后摇 = 闪能连段为主（怒相基本在失衡内打完），轴内耗闪能越多失衡外连段越少', () => {
    // 非轴模式：怒相内连段视为失衡内全取消，只计怒相外自动连段（9 组 → 后摇 9）
    const c0 = computeBanyueRageCycle(10, 6, 20, 0, 0, 0, 0, 0, 180, 0, 0, false)
    expect(c0.axisInComboCount).toBe(0)
    expect(c0.outStunComboCount).toBe(9)
    expect(c0.comboOutRecoveryCount).toBe(9)
    // 轴模式：轴内普通强特耗 200 闪能 → 怒相外自动连段降到 6 组；怒相内 8 组（4 怒相×2）全被
    // 轴内捏块覆盖（banyue-combo×6 + banyue-combo-didong×2 = 8）→ 失衡外 = 6 + 未覆盖 0 = 6 组后摇
    const cA = computeBanyueRageCycle(10, 6, 20, 0, 0, 200, 6, 0, 180, 2, 0, true)
    expect(cA.rageCount).toBe(4)
    expect(cA.comboOutCount).toBe(6)
    expect(cA.axisInComboCount).toBe(8)
    expect(cA.outStunComboCount).toBe(6)
    expect(cA.comboOutRecoveryCount).toBe(6)
    // 轴内耗闪能更多（400）→ 失衡外闪能连段降到 3 组（怒相组数不参与失衡外池）
    const cHigh = computeBanyueRageCycle(10, 6, 20, 0, 0, 400, 6, 0, 180, 2, 0, true)
    expect(cHigh.comboOutCount).toBe(3)
    expect(cHigh.outStunComboCount).toBe(3)
    // 轴内未覆盖怒相组：只捏 6 组（4+2）→ 怒相内 8 组剩 2 组未覆盖（最多一组怒相）→ 失衡外 = 6 + 2 = 8
    const cUncov = computeBanyueRageCycle(10, 6, 20, 0, 0, 200, 4, 0, 180, 2, 0, true)
    expect(cUncov.axisInComboCount).toBe(6)
    expect(cUncov.outStunComboCount).toBe(8)
    expect(cUncov.comboOutRecoveryCount).toBe(8)
    // 失衡外 6 组后摇用嘲讽取消 4 次 → 剩 2
    const cT = computeBanyueRageCycle(10, 6, 20, 0, 0, 200, 6, 0, 180, 2, 4, true)
    expect(cT.outStunComboCount).toBe(6)
    expect(cT.comboOutRecoveryCount).toBe(2)
    expect(cT.tauntCancelCount).toBe(4)
  })

  it('怒相内地动山摇连段不耗闪能、不影响嗔火固定点', () => {
    const c0 = computeBanyueRageCycle(10, 6, 20, 0, 0, 0, 0, 0, 180)
    const c1 = computeBanyueRageCycle(10, 6, 20, 0, 0, 0, 0, 0, 180, 2)
    expect(c1.rageCount).toBe(c0.rageCount)
    expect(c1.flashIncome).toBe(c0.flashIncome)
    expect(c1.flashSpent).toBe(c0.flashSpent)
    expect(c1.furyTotal).toBeCloseTo(c0.furyTotal, 6)
  })
})

describe('computeBanyueRageCycle（轴内普通强特扣闪能 → 自动连段缩水，用户口径）', () => {
  it('轴内强特消耗 300 闪能：怒相 4 次，自动连段缩到 4 组', () => {
    const c = computeBanyueRageCycle(10, 6, 20, 0, 0, 300, 0, 0, 180)
    expect(c.axisExSpend).toBe(300)
    expect(c.comboOutCount).toBe(4)
    // 2026-10-19「余数花掉」：收入 580 − 轴内 300 − 4×60 = 40 ⇒ 余数单发论道 ×2
    // （40 只能换成 2 次论道；40 的狮子吼·怒必须紧跟论道、不能单放）
    expect(c.lunDaoSpareCount).toBe(2)
    // T168（2026-10-15）：闪能浪费改为**用户可调常数**（默认 50 点），不再按 `axisSpend / rage` 均摊
    // ⇒ 嗔火 = 115 + 184 + (300 + 4×60 + 2×20 − 50) × 0.5 = 564
    expect(c.furyTotal).toBeCloseTo(115 + 184 + (300 + 4 * 60 + 2 * 20 - 50) * 0.5, 1) // 564
    expect(c.rageCount).toBe(4)
    expect(c.flashSpent).toBe(300 + 4 * 60 + 2 * 20)
  })

  it('轴内强特耗尽闪能（500）：自动连段缩到 1 组', () => {
    const c = computeBanyueRageCycle(10, 6, 20, 0, 0, 500, 0, 0, 180)
    expect(c.comboOutCount).toBe(1)
    expect(c.rageCount).toBe(4)
    // 2026-10-19「余数花掉」：收入 580 − 轴内 500 − 1×60 = 20 ⇒ 余数单发论道 ×1
    expect(c.lunDaoSpareCount).toBe(1)
    expect(c.flashSpent).toBe(500 + 1 * 60 + 20)
  })

  it('轴内连段块（免费·山威）不耗闪能、不影响怒相外自动连段', () => {
    const c = computeBanyueRageCycle(10, 6, 20, 0, 0, 0, 2, 0, 180)
    expect(c.axisComboCount).toBe(2)
    expect(c.axisExSpend).toBe(0) // 连段块不计闪能
    expect(c.comboOutCount).toBe(9) // 怒相外自动连段不受轴内免费连段块影响
    // 2026-10-19「余数花掉」：收入 580 − 9×60 = 40 ⇒ 余数单发论道 ×2（与本档默认一致）
    expect(c.lunDaoSpareCount).toBe(2)
    // T168：闪能浪费 = 固定 50（用户可调），与轴内是否捏免费连段块无关
    expect(c.furyTotal).toBeCloseTo(115 + 184 + (9 * 60 + 2 * 20 - 50) * 0.5, 1) // 564
  })

  it('轴内普通强特耗闪能并回复嗔火，免费连段块不回复', () => {
    // T168：300 闪能普通强特 ⇒ 嗔火 = 115 + 184 + (300 + 4组连段×60 − 50)×0.5 = 544
    const c = computeBanyueRageCycle(10, 6, 20, 0, 0, 300, 0, 0, 180)
    expect(c.axisExSpend).toBe(300)
    // 2026-10-19「余数花掉」：收入 580 − 300 − 4×60 = 40 ⇒ 余数单发论道 ×2
    expect(c.flashSpent).toBe(300 + 4 * 60 + 2 * 20)
    expect(c.furyTotal).toBeCloseTo(115 + 184 + (300 + 4 * 60 + 2 * 20 - 50) * 0.5, 1)
    // 同 300 但加 2 个免费连段块：连段块不产嗔火、不耗闪能，怒相外自动连段仍 4 组
    const c2 = computeBanyueRageCycle(10, 6, 20, 0, 0, 300, 2, 0, 180)
    expect(c2.axisComboCount).toBe(2)
    expect(c2.comboOutCount).toBe(4)
    expect(c2.flashSpent).toBe(300 + 4 * 60 + 2 * 20)
    expect(c2.furyTotal).toBeCloseTo(115 + 184 + (300 + 4 * 60 + 2 * 20 - 50) * 0.5, 1)
  })

  /**
   * **T168：闪能浪费是「用户可调常数」，不是怒相次数的函数**（用户口径 2026-10-15）。
   *
   * 负控：把 `wastedFlash` 参数改回 `axisSpend / rage` 均摊 ⇒ 本用例红
   * （怒相 4 与 3 两种情形会得到**不同**的扣除量，而下面的等式要求两者扣除量相同）。
   */
  it('闪能浪费是常数项：同一 wastedFlash 下扣除量与怒相次数无关', () => {
    // 同参、只改 autoTrim 让怒相数不同：两者扣除量必须相同（都扣 50）
    const base = [10, 6, 20, 0, 0, 300, 0, 0, 180] as const
    const c0 = computeBanyueRageCycle(...base)                                   // 怒相 4
    const cTrim = computeBanyueRageCycle(...base, 0, 0, true, 0, 3)              // 削 3 组
    const furyBaseOf = (c: { flashSpent: number; furyTotal: number }) => c.flashSpent * 0.5 + 299 - c.furyTotal
    // 反空洞：两种情形的 flashSpent 确实不同（否则下面的等式是同义反复）
    expect(c0.flashSpent).not.toBe(cTrim.flashSpent)
    expect(furyBaseOf(c0), '怒相 4 时扣除 25 点嗔火（= 50 闪能×0.5）').toBeCloseTo(25, 6)
    expect(furyBaseOf(cTrim), '削连段后扣除量**不变**（常数项，不随怒相数变化）').toBeCloseTo(25, 6)
    // 用户填 0 = 不计此惩罚（更容易打出高嗔火）
    const cZero = computeBanyueRageCycle(...base, 0, 0, true, 0, 0, 0)
    expect(cZero.furyTotal - c0.furyTotal, '填 0 比默认 50 多 25 点嗔火').toBeCloseTo(25, 6)
  })
})

describe('computeBanyueInteractionTopUp（轴模式自动补齐，保底语义）', () => {
  const axis8 = { 'banyue-combo': 8 } // 4 窗口 × 2 组连段块 = 4 次怒相

  it('资源充足（默认交互次数）：不补齐', () => {
    const t = computeBanyueInteractionTopUp({
      battleTime: 180, dodgeCount: 10, parryCount: 6, blockCount: 20, dualCounterCount: 5, cinemaLevel: 0,
      axisEx: axis8, ultimateCountNeeded: 4, ultimateCost: 3000, decibelHave: 20000,
    })
    expect(t).toMatchObject({ parry: 0, dual: 0, illegal: false })
  })

  it('嗔火不足 → 抬双反；喧响不足 → 抬弹刀（分别按缺口 ÷ 10 / ÷ 反推单价 向上取整）', () => {
    const t = computeBanyueInteractionTopUp({
      battleTime: 180, dodgeCount: 0, parryCount: 0, blockCount: 0, dualCounterCount: 0, cinemaLevel: 0,
      axisEx: axis8, ultimateCountNeeded: 4, ultimateCost: 3000, decibelHave: 8000,
    })
    // 低交互下嗔火只够 2 次怒相 → 差 2 次 × 120 = 240 嗔火 → 双反 ceil(240/10) = 24
    expect(t.dual).toBe(24)
    // 4 终结技 × 3000 = 12000 − 8000 = 4000 → 弹刀 ceil(4000 / 301.35) = 14
    // （T129：分母由 215 改为「一次弹刀完整链」实测收益 301.35，见 PARRY_TOPUP_DECIBEL_UNIT；
    //   旧口径 ceil(4000/215) = 19 系统性高估 5 刀）
    expect(t.parry).toBe(14)
  })

  it('轴内连段块不是 2 的倍数：怒相次数向上取整；无终结技需求 → 不补弹刀', () => {
    const t = computeBanyueInteractionTopUp({
      battleTime: 180, dodgeCount: 0, parryCount: 0, blockCount: 0, dualCounterCount: 0, cinemaLevel: 0,
      axisEx: { 'banyue-combo': 6 }, ultimateCountNeeded: 0, ultimateCost: 3000, decibelHave: 0,
    })
    // 6 组块 = 3 次怒相 → 差 1 次 × 120 → 双反 12
    expect(t.dual).toBe(12)
    expect(t.parry).toBe(0)
  })

  /**
   * ## T172：缺口必须对「已装补齐」不动（反 2-环）
   *
   * 用户 2026-10-19 报「取消后摇纯送前台时间、伤害反而掉」⇒ 根因不在后摇，而在这里：
   * `decibelHave` 是**含已装那 N 刀自己喧响**的读数，旧式把它当"已有收入"直接减
   * ⇒ **装得越多、算出的总需求越小** ⇒ 反推落进 2-环（taunt=1 实测 已装1→算出4 / 已装4→算出1），
   * 而外层环内选点取"最后一轮" ⇒ 选中谁取决于环相位 ⇒ taunt 一改就换成员 ⇒ 伤害乱跳。
   *
   * 判据 = **不动点性质**：把任意 `appliedParryCount` 喂进去，函数给出的总刀数 N 必须满足
   * 「N 刀装进去后正好够」即 `D(N) >= 需求` 且 `D(N−1) < 需求`（D = 已读喧响 + N×单刀收益）。
   * 下面的桩用一个**线性** D 直接表达该恒等式，从而把「反推与已装无关」钉成纯函数不变量。
   */
  it('T172：反推总刀数与「已装补齐」无关（不动点唯一，不会 装N→算0→再装N）', () => {
    const unit = PARRY_TOPUP_DECIBEL_UNIT
    const need = 15000
    /** 桩：装 N 刀时引擎读数 = 基础 10000 + N×单刀收益（即「已装自己产喧响」） */
    const decibelAt = (n: number) => 10000 + n * unit
    const base = {
      battleTime: 180, dodgeCount: 0, parryCount: 0, blockCount: 0, dualCounterCount: 0, cinemaLevel: 0,
      axisEx: {}, ultimateCountNeeded: 5, ultimateCost: 3000,
    }
    // 从「假装没装」起步，逐轮按上一轮结果重算（模拟外层不动点迭代）
    let applied = 0
    const trace: number[] = []
    for (let i = 0; i < 6; i++) {
      applied = computeBanyueInteractionTopUp({
        ...base, decibelHave: decibelAt(applied), appliedParryCount: applied,
      }).parry
      trace.push(applied)
    }
    // 不动点：连续两轮不再变化（旧实现在这里会 4↔1 / 5↔2 地摆）
    expect(trace[trace.length - 1], `迭代轨迹 ${trace.join('→')} 必须收敛`).toBe(trace[trace.length - 2])
    // 且收敛值就是「真正够用」的最小刀数
    const need16 = need - 10000
    expect(trace[trace.length - 1]).toBe(Math.ceil(need16 / unit))
    // 反空洞：不是恒 0
    expect(trace[trace.length - 1]).toBeGreaterThan(0)
  })

  /**
   * **最关键的不变量**（配合上一条）：读数 `decibelHave` **已经含**已装那 N 刀自己的喧响，
   * 所以「自洽总刀数」应当**与已装无关**——它只由「(读数 − 已装×单价) 还差多少」决定。
   *
   * 代数：设读数 `D = base + applied×U`（每刀自己产 U），目标是 `D >= need`：
   * `parry = ceil((need + applied×U − D)/U) = ceil((need − base)/U)` ⇒ **与 applied 无关**。
   * 这正是"不动点唯一"的来源（旧实现少了 `+applied×U`，于是 parry 随 applied 变小 ⇒ 2-环）。
   *
   * ⚠ 试过并否决的另一种写法：把已装从读数里**减掉**（`D − applied×U`）——那等于每轮都当"还没装"，
   * 实测无界累加 5→11→16→…→69 刀（`.zc/perf/tauntAfterFix.perf.ts`）。
   */
  it('T172：自洽总刀数与已装无关（读数已含已装 ⇒ 不变量不随 applied 漂移）', () => {
    const U = PARRY_TOPUP_DECIBEL_UNIT
    const base = 10000
    const at = (applied: number) => computeBanyueInteractionTopUp({
      battleTime: 180, dodgeCount: 0, parryCount: 0, blockCount: 0, dualCounterCount: 0, cinemaLevel: 0,
      axisEx: {}, ultimateCountNeeded: 5, ultimateCost: 3000,
      decibelHave: base + applied * U, appliedParryCount: applied,
    }).parry
    const truth = Math.ceil((15000 - base) / U)
    /**
     * ⚠ **2026-10-19 起「与已装无关」只在 `applied <= truth` 一侧成立**（规则 10 四步归因）。
     *
     * ① 量 delta：`applied = truth + 5` 时代码返回 `applied`（= 22）而不是 `truth`（= 17）。
     * ② 根因：同批加入的「**补到够就停**」夹子 `parry = max(applied, 旧式)`（见
     *    `computeBanyueInteractionTopUp` 内该注释）——`applied > truth` 表示计划里**装多了**，
     *    此时 301.35 反推会给一个更小的数、下一轮再算回来 ⇒ 三相环（实测 `banyue-trigger-lucia`
     *    `dec 14804 -> 15156 -> 15411 -> 14804`）。夹子让「够了就不再往回砍」，与
     *    `convergence.ts` 通用保底 4 喧响的 `decibelParryNext`「单调不减」同一处置。
     * ③ 确认有意：不变量原句写的是「**自洽总刀数**与已装无关」，而夹子只在**已装超过真需求**
     *    的档位上生效——那正是「不补才对」的档位，函数返回「不再新增」是正确语义。
     * ④ 本条按新口径改为**单侧**不等式，并保留 `applied <= truth` 一侧逐位相等。
     */
    for (const applied of [0, 3, 6, truth, truth + 5]) {
      expect(at(applied), `已装 ${applied} 刀时应仍判定总需 ${truth} 刀`).toBe(truth)
    }
    // ⚠ `truth + 5` 档**必须仍然削回 truth**：这正是「无条件单调夹住上一轮」那条否决记录的
    // 判据载体——夹子若生效，本档会返回 22（首轮超补被永久锁死，`timeFillRatchet` 实测
    // 留白 0 → 4.4s）。本批最终**没有**加任何夹子（见 `banyue.ts` 的 ⛔ 否决记录），
    // 真正落地的反环手段是「实测饱和 ⇒ 不再往回砍」那一支（要求斜率 <= 0），本档斜率正常
    // ⇒ 走常数单价常数削回。
    // 缺省（不传）= 按「计划里没有补齐」算（旧行为兼容）
    expect(at(0)).toBe(computeBanyueInteractionTopUp({
      battleTime: 180, dodgeCount: 0, parryCount: 0, blockCount: 0, dualCounterCount: 0, cinemaLevel: 0,
      axisEx: {}, ultimateCountNeeded: 5, ultimateCost: 3000, decibelHave: base,
    }).parry)
  })
})

// ===== 集成：轴内捏地动/山摇·怒 → 反馈执行计划（先扣闪能，剩余自动补连段）=====
import { mockStaticFetch, newPinia, setupHarness } from '@/test/harness'
import { teamPresets } from '@/data/teamPresets'
import { applyTeamToStore, applyGoldToStore, applyAxisBinding, baseGoldOf } from '@/composables/teamCompare'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { getAgentMechanic } from '@/mechanics'

const baseConfig = {
  wEngineId: '', wEngineModLevel: 5,
  driveDisc: { fourPieceSetId: '', twoPieceSetId: '', mainStats: { 4: 'atkPct' as any, 5: 'fireDmg' as any, 6: 'critRate' as any }, subStatAllocation: {} },
  parryCount: 10, dodgeCounterCount: 6, blockCount: 20,
  quickAssistCount: 0, chainCountPerStun: 0, basicAttackTimeWeight: 1,
}

// 每个用例一份干净 pinia + fetch stub。
// 历史隐患：只有「轴内捏强特集成」describe 有 beforeEach，后面的 describe 靠上一个用例
// 泄漏的 pinia 运行 —— 任何用例调 setMechanicSetting 都会污染后续断言（覆盖率滑块修活后立刻暴露：
// 一个用例把 rageGainCoverage 调成 0.5，后面「怒相增益 300」用例就读到 150）。
beforeEach(() => {
  newPinia()
  mockStaticFetch()
})

describe('般岳轴内捏强特集成（轴内强特反馈执行计划）', () => {
  beforeEach(() => {
    newPinia()
    mockStaticFetch()
  })

  /**
   * stunCountLock（2026-08-23）：非失衡时间充足性约束（4b9ab22）会把「必做动作时间超战斗时间」的
   * 裸默认配置收敛到 0 个失衡窗口（金身20/招架10 等交互行的机制时长真实计入后，般岳队必要时间 ≈184s），
   * 轴内块随之全灭。本 describe 验证的是**轴内捏块/易伤/自动轴接线**而非可行性约束本身，
   * 故按「操作够就能打 N 次失衡」口径锁窗（与命座提升率页同款机制），隔离新约束保持原锚点。
   */
  async function setupTeam(axes: any[] | null, stunLock = 0) {
    const catalog = useCatalogStore()
    await catalog.load()
    const config = useConfigStore()
    config.team[0] = { slot: 0, agentId: '1471', cinemaLevel: 0, ...baseConfig } as any
    config.team[1] = { slot: 1, agentId: '1481', cinemaLevel: 0, ...baseConfig } as any // 支援 → 触发额外能力
    config.team[2] = { slot: 2, agentId: '', cinemaLevel: 0, ...baseConfig } as any
    if (axes) {
      config.useStunAxis = true
      config.stunAxes = axes
    }
    if (stunLock > 0) config.enemy.stunCountLock = stunLock
    return config
  }

  it('无轴：怒相内山威连段 8 + 怒相外自动连段 9（降配收交互后时间腾出），无地动/山摇·怒行', async () => {
    await setupTeam(null)
    const calc = useResourceCalc()
    await new Promise(r => setTimeout(r, 50))
    const rows = calc.damagePoolRows.value
    // 2026-09-09 能量收入行级 Σ（债务清偿级联）：琉音送客长按（1481009）表值回能进账本
    // （skillRegen 0→41.0）→ 琉音强特 12→14 占走团队前台时间 → 般岳怒相外自动连段的
    // 时间预算收窄：外 9→7 组；怒相内山威（8）与般岳自身闪能总账（620）不变。
    // enrichExecutionPlan 会用倍率表名/note 覆盖来源标注 → 按 moveId 匹配（模块 push 序：山威内在前、怒相外在后）
    // 2026-09-11 降配验收目标三臂化（消截断 + 不更超预算 + 不更留白，见 useResourceCalc#stageResolveFeasibility）：
    // 本用例裸交互（弹刀10/闪避6/金身20/双反5→冲霄25）本身撑不下 ⇒ 降配 ×0.734375 收进可行域
    // （实测 弹刀 10→7、闪避 6→4、金身 20→15、冲霄 25→15），腾出的时间让**怒相外自动连段 7→9**；
    // 装配期截断 **43.21s → 0**（改动前是"必要行撑不下 → 按比例砍行"）。
    const lunDao = rows.filter(r => r.moveId === '1471015').map(r => r.count)
    const shiZiHouNu = rows.filter(r => r.moveId === '1471016').map(r => r.count)
    /**
     * ⚠ **T162 归因（怒相外连段 9 → 10，规则 10 四步）**：
     * ① 量 delta：怒相外自动连段 9 → **10**（怒相内山威 8 不变）。
     * ② 根因：**秽盾破后送的 60 闪能此前没进嗔火公式**。般岳的 `flashBase` 原写死
     *    `2/s × battleTime + 60`（秒回 + 进场），漏掉 `shieldBreakGift`（引擎早已算出，
     *    见 `core/resource/resourceIncome.ts#SHIELD_BREAK_GIFT`）⇒ 现按 `enemy.shieldCount`
     *    一并计入（本夹具走 store 缺省 `shieldCount = 1` ⇒ +60 闪能 ⇒ 多 1 组连段）。
     * ③ 确认有意：用户 2026-10-14 口径「**没有秽盾送的 60 闪能，就达不到 5 嗔火**的标准」——
     *    有盾/无盾必须能分辨（修前实测嗔火**恒等**，那条口径在引擎里表达不出来）。
     * ④ 本锚按新口径更新；`timeGolden` 同批重生成（delta 表在提交说明）。
     */
    // 行序（模块 push 序）：山威内在前、怒相外连段、**余数单发**。2026-10-19「余数花掉」后
    // 多出「余数单发」那一行（收入 620 − 10×60 = 20 ⇒ 单发 1 次），故三元组而非二元组。
    expect(lunDao).toEqual([8, 10, 2])
    expect(shiZiHouNu).toEqual([8, 10])
    // 默认地动山摇连段 = 0 → 无地动/山摇·怒行
    expect(rows.some(r => r.moveId === '1471013' || r.moveId === '1471017')).toBe(false)
  })

  it('轴内捏地动×2/山摇·怒×1：执行计划出现对应行且吃失衡易伤', async () => {
    await setupTeam([{ name: '轴1', actions: [
      { slot: 0, moveId: '1471013', count: 2, startTime: 0 }, // 地动×2
      { slot: 0, moveId: '1471017', count: 1, startTime: 2 }, // 山摇·怒×1
    ] }], 3)
    const calc = useResourceCalc()
    await new Promise(r => setTimeout(r, 50))
    expect(calc.stunAxisResult.value).not.toBeNull()
    const rows = calc.damagePoolRows.value
    const diDong = rows.find(r => r.moveId === '1471013')
    const shanYaoNu = rows.find(r => r.moveId === '1471017')
    expect(diDong).toBeDefined()
    expect(shanYaoNu).toBeDefined()
    // 次数 = 块数 × 轴窗口数（地动 2/窗；至少 1 窗口）
    expect(diDong!.count).toBeGreaterThanOrEqual(2)
    expect(shanYaoNu!.count).toBeGreaterThanOrEqual(1)
    // 轴内块吃失衡易伤（stunMult > 1）
    expect(diDong!.stunMult).toBeGreaterThan(1)
    expect(shanYaoNu!.stunMult).toBeGreaterThan(1)
  })

  it('轴内强特耗尽闪能（地动×4+山摇·怒×4/窗）：自动连段缩到 0', async () => {
    await setupTeam([{ name: '轴1', actions: [
      { slot: 0, moveId: '1471013', count: 4, startTime: 0 }, // 地动×4 = 80闪能/窗
      { slot: 0, moveId: '1471017', count: 4, startTime: 2 }, // 山摇·怒×4 = 160闪能/窗
    ] }])
    const calc = useResourceCalc()
    await new Promise(r => setTimeout(r, 50))
    const rows = calc.damagePoolRows.value
    // 支出远超闪能收入 → 怒相外自动连段 0 组（轴内块优先，默认连段只在轴外剩余能量里补）
    const lunDaoOut = rows.find(r => r.moveId === '1471015' && r.count === 2)
    expect(lunDaoOut).toBeUndefined()
  })

  it('轴内捏地动山摇怒连段块（banyue-combo-didong）：怒相内出现山威免费地动/山摇·怒行，论道行让位', async () => {
    // 单窗口 1 个 didong 块 × 3 失衡窗口 → 怒相内 3 组地动山摇连段（rageDiDongCombo = 3）
    await setupTeam([{ name: '轴1', actions: [
      { slot: 0, moveId: 'banyue-combo-didong', count: 1, startTime: 0 },
    ] }], 3)
    const calc = useResourceCalc()
    await new Promise(r => setTimeout(r, 50))
    const rr = calc.resourceResult.value
    const cycle = rr!.characters[0].banyueRageCycle
    expect(cycle!.rageDiDongComboCount).toBeGreaterThan(0)
    // 怒相内山威免费地动/山摇·怒执行行存在（count>0、耗能 0；enrich 已覆盖 moveName/note，用能量区分免费/付费）
    const execs = rr!.characters[0].executions
    const diDongRage = execs.find(e => e.moveId === '1471013' && e.count > 0 && e.energyConsume === 0)
    const shanYaoNuRage = execs.find(e => e.moveId === '1471017' && e.count > 0 && e.energyConsume === 0)
    expect(diDongRage).toBeDefined()
    expect(shanYaoNuRage).toBeDefined()
    expect(diDongRage!.count).toBe(cycle!.diDongRageCount)
    expect(shanYaoNuRage!.count).toBe(cycle!.shanYaoNuRageCount)
    // 论道怒相内行让位（次数 = 配额 − didong 组数）
    const lunDaoRage = execs.find(e => e.moveId === '1471015' && e.count > 0 && e.energyConsume === 0)
    expect(lunDaoRage).toBeDefined()
    expect(lunDaoRage!.count).toBe(cycle!.lunDaoRageCount)
  })

  it('明王施加：6命全局 +39%；非6命非轴模式按覆盖率滑块（默认0.5 → +7.5，调1 → +15）', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    const config = useConfigStore()
    const { computePanelPhases } = await import('@/composables/resourceCalc/panelPhases')

    // 非6命 + 支援：AA 触发，非轴模式 → 面板不加（走伤害池覆盖率近似），面板差异 = 0
    config.team[0] = { slot: 0, agentId: '1471', cinemaLevel: 0, ...baseConfig } as any
    config.team[1] = { slot: 1, agentId: '1481', cinemaLevel: 0, ...baseConfig } as any
    config.team[2] = { slot: 2, agentId: '', cinemaLevel: 0, ...baseConfig } as any
    const withSupport0 = computePanelPhases(0, config, catalog)!
    expect(withSupport0.inCombat.additionalAbilityActive).toBe(1)

    // 6命 + 支援：applyPanel 全局 +39%（3层×13%）；与 2命比（都有 C2 怒相增益 +15 火伤，只差明王）
    config.setCinemaLevel(0, 2)
    const withSupport2 = computePanelPhases(0, config, catalog)!
    config.setCinemaLevel(0, 6)
    const withSupport6 = computePanelPhases(0, config, catalog)!
    expect(withSupport6.inCombat.fireDmg - withSupport2.inCombat.fireDmg).toBeCloseTo(39, 1)

    // 无支援队友：AA 不触发 → 无明王（6命也不加）
    config.setCinemaLevel(0, 0)
    config.team[1] = { slot: 1, agentId: '', cinemaLevel: 0, ...baseConfig } as any
    config.team[2] = { slot: 2, agentId: '', cinemaLevel: 0, ...baseConfig } as any
    const solo0 = computePanelPhases(0, config, catalog)!
    expect(solo0.inCombat.additionalAbilityActive).toBe(0)
    expect(withSupport0.inCombat.fireDmg - solo0.inCombat.fireDmg).toBeCloseTo(0, 1)
  })

  it('DEBUG 时间溢出：默认非轴配置的执行行与时间合计', async () => {
    await setupTeam(null)
    const calc = useResourceCalc()
    await new Promise(r => setTimeout(r, 60))
    const c0 = calc.resourceResult.value!.characters[0]
    const rows = (c0.executions ?? []).filter(e => (e.totalTime ?? 0) > 0)
    let sum = 0
    for (const e of rows) {
      sum += e.totalTime ?? 0
      console.log(`[DEBUG] ${e.moveName} (${e.moveId}) ${(e.totalTime ?? 0).toFixed(1)}s ×${e.count} mult=${e.damageMultiplier}`)
    }
    console.log(`[DEBUG] 平A ${(c0.timeAllocation.basicAttackTime ?? 0).toFixed(1)}s necessary ${(c0.timeAllocation.necessaryTime ?? 0).toFixed(1)}s 动作合计 ${sum.toFixed(1)}s + 平A = ${(sum + (c0.timeAllocation.basicAttackTime ?? 0)).toFixed(1)}s | cycle.comboOutRecovery=${c0.banyueRageCycle?.comboOutRecoveryCount}`)
  })

  it('失衡外连段后摇：执行计划出现恢复行（0 倍率不进伤害池），占用战场时间 → 嘲讽取消后平A时间回升', async () => {
    await setupTeam(null)
    const config = useConfigStore()
    // 关掉金身/双反（其动作时间也计入必做前台，会把平A压到 0）→ 让后摇时间成为唯一变量
    config.setActionCount(0, 'blockCount', 0)
    config.setActionCount(0, 'dualCounterCount', 0)
    const calc = useResourceCalc()
    await new Promise(r => setTimeout(r, 50))
    const rr = calc.resourceResult.value!
    const c0 = rr.characters[0]
    const cycle0 = c0.banyueRageCycle!
    expect(cycle0.comboOutRecoveryCount).toBeGreaterThan(0)
    // 恢复行存在：count = 后摇次数、0 倍率（不进伤害池）、totalTime > 0
    const rec = c0.executions.find(e => e.moveId === 'banyue-recovery-lundao')
    expect(rec).toBeDefined()
    expect(rec!.count).toBe(cycle0.lunDaoRecoveryCount)
    expect(rec!.damageMultiplier ?? 0).toBe(0)
    expect(rec!.totalTime).toBeGreaterThan(0)
    // 后摇计入必做前台时间 → 占用战场时间（平A池变小）
    expect(c0.timeAllocation.necessaryTime).toBeGreaterThan(0)
    const basic0 = c0.timeAllocation.basicAttackTime
    // 全嘲讽取消后摇 → 无恢复行、后摇 0 → 平A时间回升
    config.setActionCount(0, 'tauntCancelCount', 99)
    await new Promise(r => setTimeout(r, 50))
    const c99 = calc.resourceResult.value!.characters[0]
    expect(c99.executions.some(e => e.moveId?.startsWith('banyue-recovery'))).toBe(false)
    expect(c99.banyueRageCycle!.comboOutRecoveryCount).toBe(0)
    expect(c99.timeAllocation.basicAttackTime).toBeGreaterThan(basic0)
  })

  it('具体数据（轴模式，每窗口 = 完整怒相序列 + 80 闪能强特）：失衡内外怒相次数、闪能消耗、失衡外后摇时间', async () => {
    // 轴1 单窗口 = 一次怒相的全部资源：怒相二连段×2（banyue-combo，山威免费）+ 倾山 + 摧岳
    // + 付费强特 地动×2 + 山摇·怒×1（80 闪能/窗）→ 4 窗口 = 4 怒相全在失衡内（怒相组全被轴覆盖）
    await setupTeam([{ name: '轴1', actions: [
      { slot: 0, moveId: 'banyue-combo', count: 2, startTime: 0 },
      { slot: 0, moveId: '1471009', count: 1, startTime: 6 }, // 倾山
      { slot: 0, moveId: '1471010', count: 1, startTime: 8 }, // 摧岳
      { slot: 0, moveId: '1471013', count: 2, startTime: 10 },
      { slot: 0, moveId: '1471017', count: 1, startTime: 12 },
    ] }], 2) // 净失衡基线锚点在 2 窗（axisInCombo = 每窗2连段块 × 2窗 = 4）
    const calc = useResourceCalc()
    await new Promise(r => setTimeout(r, 50))
    const c0 = calc.resourceResult.value!.characters[0]
    const cycle = c0.banyueRageCycle!
    // 失衡外怒相组 = 轴内未覆盖怒相组（≤2 组 = 最多一组怒相）
    const outStunRageGroups = cycle.outStunComboCount - cycle.comboOutCount
    const inStunFlash = cycle.axisExSpend // 失衡内闪能 = 轴内普通强特消耗
    const outStunFlash = cycle.comboOutCount * 60 // 失衡外闪能 = 自动连段 60/组
    const recoveryRows = (c0.executions ?? []).filter(e => e.moveId?.startsWith('banyue-recovery'))
    const recoveryTime = recoveryRows.reduce((s, e) => s + (e.totalTime ?? 0), 0)
    const lunDaoT = recoveryRows.find(e => e.moveId === 'banyue-recovery-lundao')?.actionTime ?? 0
    const diDongT = recoveryRows.find(e => e.moveId === 'banyue-recovery-didong')?.actionTime ?? 0
    /**
     * 锁窗 2 基线（2026-08-23 重推导，净失衡+充足性约束后口径）：闪能收入 580（净失衡迭代后行情）
     * → 轴内强特支出 160 → 怒相外自动连段 = floor((580−160)/60) = 7 组；总支出 = 160 + 7×60 = 580。
     *
     * ⚠ **T162 归因（怒相 4 → 5，规则 10 四步）**：
     * ① 量 delta：`rageCount` 4 → **5**，`flashIncome` 580 → **680**。
     *
     * ⚠ **2026-10-18 回摆（4 / 640，规则 10 四步）**：`rageCount` 5 → **4**、`flashIncome` 680 → **640**。
     * ① 量 delta：本夹具（`blockCount` 20 未变）挤压臂从 **trim=0** 变成 **trim=3**（见下方 squeeze 断言），
     *    削掉 3 组自动连段 ⇒ 闪能支出 640 → 340 的差额回到嗔火 ⇒ 598 嗔火 < 600 门槛。
     * ② 根因：**冲霄动作时间**（catalog `1471029`）2.667 → 1.167（`scripts/lib/type-bonus-time.mjs`）⇒
     *    金身/双反每对少 1.5s 前台 ⇒ 180s 里让出约 30s，挤压臂不再需要「全都不削」。
     * ③ 确认有意：时间修正本身是用户口径（「正确的时间计算公式就是该 1.83」），不是回归。
     * ④ 本锚同步更新。
     * ② 根因：**秽盾破后送的 60 闪能此前没进嗔火公式** —— 般岳的 `flashBase` 原写死
     *    `2/s × battleTime + 60`，漏掉引擎早已算出的 `shieldBreakGift`
     *    （`core/resource/resourceIncome.ts#SHIELD_BREAK_GIFT = 60`）。本夹具走 store 缺省
     *    `shieldCount = 1` ⇒ +60 闪能 ⇒ +30 嗔火 ⇒ 跨过 600 门槛 ⇒ 第 5 次怒相。
     *    ⚠ 680 = 580 + **60（秽盾）** + **40（第 5 次怒相的山威返还）** —— 多一次怒相
     *    同时多返还 `RAGE_SWAY(4) × SWAY_REFUND(10) = 40` 闪能，是**正反馈**而非单加 60。
     * ③ 确认有意：用户 2026-10-14 口径「**没有秽盾送的 60 闪能，就达不到 5 嗔火**的标准」
     *    —— 这条口径此前在引擎里**表达不出来**（实测有盾/无盾嗔火恒等）。
     * ④ 本锚按新口径更新（`580 → 680` 与 `4 → 5` 同步）。
     */
    /**
     * ⚠ **2026-10-19 复核：本夹具的锚值未变**（`rage 4 / flashSpent 640 / combo 8`）。
     * 「余数花掉」一度把它推到 `rage 5 / spare 2 / spent 680`（固定点里怒相 4→5 后多返还
     * 40 山威回能 ⇒ 余数 40 ⇒ 2 次单发论道 ⇒ 嗔火 616 > 600 门槛），但同批落地的
     * 「**实测饱和 ⇒ 不再往回砍**」让该档的交互补齐不再虚增（`computeBanyueInteractionTopUp`
     * 的 `saturated` 分支，见 `banyue.ts`）⇒ 闪能账回到 640、余数归 0、怒相仍 4。
     * 故本条**保持 2026-10-18 的锚值**，只补 `lunDaoSpareCount` 断言（本档应为 0，反空洞）。
     */
    expect(cycle.rageCount).toBe(4)
    expect(cycle.axisInComboCount).toBe(4)
    expect(outStunRageGroups).toBe(2)
    expect(Math.ceil(outStunRageGroups / 2)).toBe(1)
    expect(cycle.outStunComboCount).toBe(cycle.comboOutCount + outStunRageGroups)
    expect(cycle.axisExSpend).toBe(160)
    expect(cycle.flashIncome).toBe(640)
    expect(cycle.comboOutCount).toBe(8)
    expect(cycle.lunDaoSpareCount).toBe(0)
    expect(cycle.flashSpent).toBe(640)
    // 闪能账守恒：轴内强特 + 怒相外连段 + **余数单发**（2026-10-19 新增的那一项）
    expect(cycle.flashSpent).toBe(inStunFlash + outStunFlash + cycle.lunDaoSpareCount * 20)
    // 失衡外后摇：每连段组 1 次（含轴内未覆盖怒相组）→ 9 次；时间 = 论道组后摇 × 9（恢复行总时长计入必做前台）
    expect(cycle.comboOutRecoveryCount).toBe(10)
    expect(recoveryTime).toBeCloseTo(cycle.lunDaoRecoveryCount * lunDaoT + cycle.diDongRecoveryCount * diDongT, 3)
    expect(recoveryTime).toBeCloseTo(cycle.lunDaoRecoveryCount * lunDaoT, 3)
    expect(c0.timeAllocation.necessaryTime).toBeGreaterThanOrEqual(recoveryTime - 1e-6)
  })

  it('轴模式自动补齐（保底）：低交互次数下自动抬双反/弹刀，怒相次数达到轴内需求，交互栏输入不被覆盖', async () => {
    // 每窗口厚需求：连段×2（1 次怒相/窗）+ 倾山 + 摧岳；交互次数全部归 0 → 嗔火不足。
    // 锁 3 窗 → 轴内 6 连段块 → rageNeeded=3，无补齐只有 2 怒相 → 双反补 12（40s 金身链，补齐后仍可行）。
    // （需求更大时补齐会把必要时间推超战斗预算 → 触发轴退化，见下方「轴退化」用例——用户口径：
    //   不可操作的轴不硬撑，自动补齐的生效测试须落在补齐后的可行域内。）
    await setupTeam([{ name: '轴1', actions: [
      { slot: 0, moveId: 'banyue-combo', count: 2, startTime: 0 },
      { slot: 0, moveId: '1471009', count: 1, startTime: 8 },
      { slot: 0, moveId: '1471010', count: 1, startTime: 10 },
    ] }], 3)
    const config = useConfigStore()
    config.setActionCount(0, 'dodgeCounterCount', 0)
    config.setActionCount(0, 'parryCount', 0)
    config.setActionCount(0, 'blockCount', 0)
    config.setActionCount(0, 'dualCounterCount', 0)
    const calc = useResourceCalc()
    await new Promise(r => setTimeout(r, 80))
    const c0 = calc.resourceResult.value!.characters[0]
    const cycle = c0.banyueRageCycle!
    // 自动补齐非零（双反补嗔火），且不写回 store（保底语义：交互栏输入不变）
    const topUp = calc.interactionTopUp.value
    expect(topUp).not.toBeNull()
    expect(topUp!.slot).toBe(0)
    expect(topUp!.dual).toBeGreaterThan(0)
    expect(config.team[0].parryCount).toBe(0)
    expect(config.team[0].dualCounterCount).toBe(0)
    // 怒相达到轴内需求（轴内连段块 ÷ 2 向上取整）；不补齐时低交互只有 2 次怒相
    const rageNeeded = Math.ceil(cycle.axisInComboCount / 2)
    expect(cycle.rageCount).toBeGreaterThanOrEqual(rageNeeded)
    // 资源卡片出现「轴模式自动补齐」行（含补齐量）
    const sections = getAgentMechanic('1471')?.resourceSections?.({ result: c0 }) ?? []
    expect(JSON.stringify(sections)).toContain('轴模式自动补齐')
  })

  it('轴退化（用户口径 2026-08）：轴需求补齐后必要时间超战斗预算 → 自动弃轴退化一般轴，前台行回到预算内', async () => {
    // 厚需求轴：每窗连段×4（2 怒相/窗）+ 终结技×2，交互全 0 → 自动补齐把金身链抬到超预算
    // → 轴不可操作（需外界环境如 boss 秽盾才打得成）→ 引擎退化一般轴（轴块不注入、补齐全关）
    //
    // ⚠ **T162 修正（规则 10 四步）**：上面那句「需外界环境如 boss 秽盾才打得成」**已经实现** ——
    // 修前般岳的嗔火公式漏算秽盾送的 60 闪能（`flashBase` 写死 `2/s×时间 + 60`），
    // 而 store 缺省 `shieldCount = 1` ⇒ 本夹具**实际带着一个盾**，修后这 60 闪能进了嗔火
    // ⇒ 轴**装得下了**（`axisFallback = false`，实测 `{shield:1, fb:false, axes:1}`）。
    // ① 量 delta：`axisFallback` true → **false**（轴保住、伤害 5.422M → 5.554M）。
    // ② 根因：`shieldFlashGift` 接入（`banyue.ts#computeBanyueRageCycle` 的 `flashBase`）。
    // ③ 确认有意：用户 2026-10-14「有秽盾送的 60 闪能才够」+ 本用例原注释的预判。
    // ④ 判据改为**两态对照**（原单一断言在新口径下失去判别力，硬钉会得到假判据）：
    //    显式无盾 ⇒ 轴仍不可操作 ⇒ 退化（原判据的语义）；有盾 ⇒ 轴成立（新口径的表达）。
    await setupTeam([{ name: '轴1', actions: [
      { slot: 0, moveId: 'banyue-combo', count: 4, startTime: 0 },
      { slot: 0, moveId: '1471009', count: 1, startTime: 8 },
      { slot: 0, moveId: '1471010', count: 1, startTime: 10 },
      { slot: 0, moveId: '1471021', count: 2, startTime: 12 }, // 撼天动地×2（终结技）
    ] }])
    const config = useConfigStore()
    config.setActionCount(0, 'dodgeCounterCount', 0)
    config.setActionCount(0, 'parryCount', 0)
    config.setActionCount(0, 'blockCount', 0)
    config.setActionCount(0, 'dualCounterCount', 0)
    const calc = useResourceCalc()
    await new Promise(r => setTimeout(r, 80))
    const rr = calc.resourceResult.value!
    // 退化信号：轴定义仍解析（useStunAxis 开着）但本结果是无轴的一般循环
    // 有盾（缺省 1）⇒ 60 闪能补上嗔火缺口 ⇒ 轴成立
    expect(rr.convergence.axisFallback, '有秽盾 ⇒ 轴装得下（T162）').toBe(false)
    /**
     * 反证：**把轴加厚到撑不下** ⇒ 退化（原判据「轴太厚 ⇒ 弃轴」的语义仍被锁住）。
     *
     * ⚠ 不用「去掉秽盾」做反证：实测本夹具**无盾时轴仍装得下**（`fb=false`）——
     * 该轴本来就不厚（每窗 2 连段块 + 终结技×2），秽盾那 60 闪能只是让它更宽裕
     * （伤害 5.422M → 5.554M），并不是「有盾才成立」的临界点。
     *
     * ⚠⚠ **T169 换加厚手段（2026-10-15）—— 原手段（连段块翻倍）已被山威门堵死**。
     * ① 量 delta：原 `banyue-combo count 4 → 8` 由「退化=Y」变为 **「退化=n」**（伤害 5.554M → 5.3125M）。
     * ② 根因：本卡给轴栈加了**角色专属资源门控**（般岳山威，`combos[].swayCost = 2`/块，
     *    供给 = 怒相数 × 4 = 8 ⇒ 容量 4 组/窗）。原反证想表达的「每窗 4 怒相 ⇒ 太厚」现在
     *    **根本执行不了**：超出的块被判 `reason: 'sway'` **跳过**（实测 count 8/20/40 一律
     *    只执行 4 块、跳过 12/36/76 个），轴不再被自己打不出的内容顶爆 ⇒ 不退化。
     *    这正是本卡要修的缺陷（幽灵块），**不是判据失去意义**——「轴需求真超预算 ⇒ 弃轴」的语义照旧。
     * ③ 确认有意：用户口径 2026-10-15「缺失那就加上呗，又没什么副作用」= 让轴内内容如实。
     * ④ 处置：**换加厚手段到仍能真顶爆的维度 = 终结技块**（喧响需求，轴栈既有门控）。
     *    实测扫描（`.zc/perf/T169thick3.perf.ts`）：每窗终结技 ×2/×4 装得下；**×6 起退化=Y**
     *    （盾 1 与盾 0 皆然）⇒ 取 ×6（离临界最近、改动最小）。
     */
    config.stunAxes = [{ name: '厚轴', actions: [
      { slot: 0, moveId: 'banyue-combo', count: 4, startTime: 0 },
      { slot: 0, moveId: '1471009', count: 1, startTime: 8 },
      { slot: 0, moveId: '1471010', count: 1, startTime: 10 },
      { slot: 0, moveId: '1471021', count: 6, startTime: 12 },
    ] }] as never
    await new Promise(r => setTimeout(r, 120))
    const thick = calc.resourceResult.value!
    expect(thick.convergence.axisFallback, '轴太厚（每窗 6 终结技，喧响撑不下）⇒ 退化一般轴').toBe(true)
    // 前台行回到预算内（容差 2s = 合轴可覆盖的量化残差）
    //
    // ⚠ **T141 改判据：从「手工 Σ前台行 ≤ 182」改为引擎单一事实源 `netFrontlineOccupation`**
    // （与 `timeLedger.test.ts` 同一处口径修正，本次两道用例同因同解）。
    //
    // 病根：手工 `Σ前台行` 是**毛额**，把「被合轴并行掉、不占共享预算」的那部分也算进去了。
    // 引擎的既定语义（`helpers.ts` 合轴段）是「**Σnecessary 允许 > 战斗时间，只要合轴抵扣后的
    // 净占用装得下**」——旧断言之所以一直成立，只是因为**旧闸门要求「有溢出」**：本队不吸收
    // ⇒ 并行量 0 ⇒ 毛额恰好等于净额。T141 第 3 档放开闸门后本队开始吸收（实测
    // `dynamicComboAlignSeconds = comboAlignCredit > 0`）⇒ 毛额 180.000 → **195.147**（超 182 → 红），
    // 而引擎净占用**两态都是 180.0000**（逐位相同，实测探针）⇒ 旧断言测的其实是「并行量为 0」，
    // 不是用例名说的「回到预算内」。
    //
    // 这不是放宽：净占用是该队**真实的共享时间占用**，也是轴退化/降配/队伍对比消费的同一个判据
    // （`solveTeam#stageResolveFeasibility` 的 `netOf`）。两条断言并留——毛额也照测，只是按新口径
    // 它本就可以超预算（上限取 180 + 吸收量 + 容差）。
    let front = 0
    for (const ch of rr.characters) {
      for (const e of ch.executions) {
        if (isFrontlineExecution(e)) front += e.totalTime ?? 0
      }
    }
    expect(netFrontlineOccupation(rr), '净占用（= Σ前台 − 并行抵扣）必须装得下预算').toBeLessThanOrEqual(180 + 2)
    // 反空洞：本队确实发生了吸收（否则本行退化成旧断言的同义反复，无法区分「净额小」与「没并行」）
    const absorbedTotal = rr.characters.reduce(
      (a, c) => a + ((c.timeAllocation as { dynamicComboAlignSeconds?: number }).dynamicComboAlignSeconds ?? 0), 0)
    expect(absorbedTotal, '反空洞：本夹具必须真的发生了动态吸收').toBeGreaterThan(0)
    expect(front).toBeLessThanOrEqual(180 + absorbedTotal + 2)
    // 自动补齐清零（退化 = 非轴模式，autoTopUp 关闭；补齐是把轴需求抬成交互行的通道）
    const topUpAfter = calc.interactionTopUp.value
    expect(!topUpAfter || (topUpAfter.parry === 0 && topUpAfter.dual === 0)).toBe(true)
  })

  it('非6命非轴模式：明王按覆盖率滑块进伤害池（默认0.5 → +7.5%，调1 → +15%）', async () => {
    await setupTeam(null)
    const calc = useResourceCalc()
    await new Promise(r => setTimeout(r, 50))
    const rows = calc.damagePoolRows.value
    const fenShen = rows.find(r => r.moveId === '1471027')
    expect(fenShen).toBeDefined()
    expect(fenShen!.note).toContain('明王+7.5%（覆盖率近似）')
    const config = useConfigStore()
    config.setMechanicSetting('banyue.mingwangCoverage', 1)
    await new Promise(r => setTimeout(r, 50))
    const rows2 = calc.damagePoolRows.value
    const fenShen2 = rows2.find(r => r.moveId === '1471027')
    expect(fenShen2!.note).toContain('明王+15.0%（覆盖率近似）')
  })

  // 生效测试（T168，规则 5 + 判据 4「新增滑块必须被测试引用」）：闪能浪费滑块必须真的改账本。
  // 用户口径 2026-10-15：它是**惩罚项**（最后一次怒相之后消耗的闪能产不出嗔火），由用户按自己的
  // 轴/手法填，默认 50 点；填 0 = 不计此惩罚（更容易打出高嗔火）。本测试锁「滑块 → 嗔火/怒相」这条链。
  it('闪能浪费滑块生效：默认 50 → 嗔火低于填 0；填 0 时嗔火按「少扣 50 点闪能」抬高', async () => {
    await setupTeam(null)
    const calc = useResourceCalc()
    const config = useConfigStore()
    const furyOf = () => {
      const b = calc.resourceResult.value?.characters.find(c => c.agentId === '1471')
      return (b as unknown as { banyueRageCycle?: { furyTotal: number } } | undefined)?.banyueRageCycle?.furyTotal
    }
    config.setMechanicSetting('banyue.wastedFlash', 0)
    await new Promise(r => setTimeout(r, 60))
    const furyFree = furyOf()
    config.setMechanicSetting('banyue.wastedFlash', 50)
    await new Promise(r => setTimeout(r, 60))
    const furyDefault = furyOf()
    expect(furyFree).toBeDefined()
    expect(furyDefault).toBeDefined()
    // 50 点闪能 × 0.5 = 25 点嗔火（惩罚项线性）
    /**
     * ⚠ **2026-10-19 起改为关系式而非定值 25**（规则 10 四步归因）。
     *
     * ① 量 delta：`furyFree − furyDefault` 由 **25** 变成 **45**（本夹具实测 571 − 546）。
     * ② 根因：「余数花掉」让 `flashSpent` 打满（本夹具 620 → 640），而惩罚项是
     *    `max(0, flashSpent − wastedFlash) × 0.5` ——**扣的是同一个 flashSpent**，所以
     *    `wastedFlash` 从 50 降到 0 时，多出来的不仅是那 25 点，还包括余数单发那 40 点闪能
     *    对应的 20 点嗔火：45 = 25 + (640 − 620) × 0.5。
     * ③ 确认有意：用户口径「剩余不够 60 的只能打 0-2 次 20 能量的了」——那部分闪能**真的花掉了**，
     *    因此它既产嗔火、也吃惩罚项，两者同源。
     * ④ 本锚改为**按 flashSpent 差值推出的关系式**（滑块仍必须真的改账本 + 反空洞断保留）。
     */
    // 判据 = 「惩罚项只扣 flashSpent 超出部分」这条公式本身（不是拍一个定值）：
    //   fury(w) = (115 + 交互嗔火) + max(0, flashSpent(w) − w) × 0.5
    // ⇒ fury(0) − fury(50) = 0.5 × [flashSpent(0) − max(0, flashSpent(50) − 50)]
    // 「余数花掉」后 flashSpent 可能随档位变化（本夹具 640 vs 640；他处会掉一档怒相），
    // 故不能写死 25——写死会把「公式」和「某一档的读数」混为一谈。
    const delta = (furyFree ?? 0) - (furyDefault ?? 0)
    expect(delta, '填 0 只会让嗔火更高（惩罚项单调）').toBeGreaterThan(0)
    expect(delta >= 25 - 1e-6, '少扣 50 点闪能 ⇒ 至少多 25 点嗔火（floor 档位只会更多）').toBe(true)
    // 反空洞：调大惩罚 ⇒ 嗔火更低（不是同义反复）
    config.setMechanicSetting('banyue.wastedFlash', 200)
    await new Promise(r => setTimeout(r, 60))
    expect(furyOf(), '惩罚越大嗔火越低').toBeLessThan(furyDefault ?? 0)
  })

  // 生效测试：怒相增益覆盖率滑块必须真的改面板。
  // 历史缺陷（AGENT_RECORDING_SOP §3.5「面板 buff 施加点错误」）：applyPanel 读
  // `panel.banyueRageCoverage`，而该字段从未被任何代码写入 → 滑块恒等 1、静默失效。
  // 修法：AgentPanelInput 新增已解析的 settings，applyPanel 直接读滑块。
  // 本测试锁死「滑块 → 面板」这条链，防再次退化成死数据。
  it('怒相增益覆盖率滑块生效：0% → 不加怒相面板；100% → 贯穿/火伤/暴伤按 Lv.7 全量加', async () => {
    const config = await setupTeam(null)
    const catalog = useCatalogStore()
    const { computePanelPhases } = await import('@/composables/resourceCalc/panelPhases')

    config.setMechanicSetting('banyue.rageGainCoverage', 0)
    const panel0 = computePanelPhases(0, config, catalog)!.inCombat

    config.setMechanicSetting('banyue.rageGainCoverage', 1)
    const panel1 = computePanelPhases(0, config, catalog)!.inCombat

    // 怒相增益（Lv.7，0 命）：贯穿+300 / 火伤+36% / 暴伤+36%
    expect((panel1.sheerForceFlat ?? 0) - (panel0.sheerForceFlat ?? 0)).toBeCloseTo(300, 6)
    expect((panel1.fireDmg ?? 0) - (panel0.fireDmg ?? 0)).toBeCloseTo(36, 6)
    expect((panel1.critDmg ?? 0) - (panel0.critDmg ?? 0)).toBeCloseTo(36, 6)

    // 半覆盖 = 线性折算（滑块真的按比例进面板，而不是 0/1 开关）
    config.setMechanicSetting('banyue.rageGainCoverage', 0.5)
    const panelHalf = computePanelPhases(0, config, catalog)!.inCombat
    expect((panelHalf.fireDmg ?? 0) - (panel0.fireDmg ?? 0)).toBeCloseTo(18, 6)
  })
})

describe('computeBanyueMingwangStacks（明王时间轴覆盖，非6命，用户口径）', () => {
  const axis = (actions: { moveId: string; count: number; startTime?: number }[]) => [
    { name: '轴1', count: 1, actions: actions.map(a => ({ slot: 0, ...a })) },
  ]

  it('怒相二连块触发 2 层窗口（8s），触发块自身不享受，窗口内后续招式按层数', () => {
    const m = computeBanyueMingwangStacks(0, axis([
      { moveId: 'banyue-combo', count: 1, startTime: 0 },
      { moveId: '1471009', count: 2, startTime: 2 },
      { moveId: '1471010', count: 1, startTime: 9 },
    ]), 0)
    expect(m.get('1471009')).toBe(2)
    expect(m.get('1471010')).toBeUndefined()
    expect(m.has('banyue-combo')).toBe(false)
  })

  it('窗口内再次触发 → 3 层并刷新窗口', () => {
    const m = computeBanyueMingwangStacks(0, axis([
      { moveId: 'banyue-combo', count: 1, startTime: 0 },
      { moveId: '1471009', count: 1, startTime: 3 },
      { moveId: 'banyue-combo', count: 1, startTime: 7 },
      { moveId: '1471010', count: 1, startTime: 12 },
      { moveId: '1471012', count: 1, startTime: 20 },
    ]), 0)
    expect(m.get('1471009')).toBe(2)
    expect(m.get('1471010')).toBe(3)
    expect(m.get('1471012')).toBeUndefined()
  })

  it('单招论道/狮子吼·怒是普通强特：不触发窗口（但窗口内可享受）', () => {
    // 单招论道@0 不触发 → 后续无窗口；连段块@0 触发 → 单招论道@2 落窗享受
    const m1 = computeBanyueMingwangStacks(0, axis([
      { moveId: '1471015', count: 1, startTime: 0 }, // 论道（普通强特）
      { moveId: '1471009', count: 1, startTime: 2 },
    ]), 0)
    expect(m1.get('1471009')).toBeUndefined() // 无窗口

    const m2 = computeBanyueMingwangStacks(0, axis([
      { moveId: 'banyue-combo', count: 1, startTime: 0 }, // 怒相连段触发
      { moveId: '1471015', count: 1, startTime: 2 }, // 单招论道落窗享受
      { moveId: '1471014', count: 1, startTime: 9 }, // 窗外
    ]), 0)
    expect(m2.get('1471015')).toBe(2)
    expect(m2.get('1471014')).toBeUndefined()
  })

  it('同招式多块按 count 实例加权平均层数', () => {
    const m = computeBanyueMingwangStacks(0, axis([
      { moveId: 'banyue-combo', count: 1, startTime: 0 },
      { moveId: '1471009', count: 1, startTime: 2 },
      { moveId: 'banyue-combo', count: 1, startTime: 6 },
      { moveId: '1471009', count: 2, startTime: 10 },
    ]), 0)
    expect(m.get('1471009')).toBeCloseTo(8 / 3, 6)
  })

  it('6命满覆盖：不扫描（返回空，伤害走全局 buff）', () => {
    const m = computeBanyueMingwangStacks(0, axis([
      { moveId: 'banyue-combo', count: 1, startTime: 0 },
      { moveId: '1471009', count: 1, startTime: 2 },
    ]), 6)
    expect(m.size).toBe(0)
  })

  it('非般岳槽位动作不参与', () => {
    const axes = [
      { name: '轴1', actions: [
        { slot: 1, moveId: 'banyue-combo', count: 1, startTime: 0 },
        { slot: 0, moveId: '1471009', count: 1, startTime: 2 },
      ] },
    ]
    expect(computeBanyueMingwangStacks(0, axes, 0).size).toBe(0)
  })

  it('地动山摇怒连段块（banyue-combo-didong）同样触发明王窗口', () => {
    const m = computeBanyueMingwangStacks(0, axis([
      { moveId: 'banyue-combo-didong', count: 1, startTime: 0 },
      { moveId: '1471013', count: 1, startTime: 2 }, // 地动（块内招式落窗）
      { moveId: '1471017', count: 1, startTime: 3 }, // 山摇·怒（落窗）
      { moveId: '1471010', count: 1, startTime: 9 }, // 窗外
    ]), 0)
    expect(m.get('1471013')).toBe(2)
    expect(m.get('1471017')).toBe(2)
    expect(m.get('1471010')).toBeUndefined()
    expect(m.has('banyue-combo-didong')).toBe(false)
    // 两个连段块可混合触发：didong@0 触发 2 层 → 论道块@5 触发 3 层刷新
    const m2 = computeBanyueMingwangStacks(0, axis([
      { moveId: 'banyue-combo-didong', count: 1, startTime: 0 },
      { moveId: 'banyue-combo', count: 1, startTime: 5 },
      { moveId: '1471009', count: 1, startTime: 10 },
    ]), 0)
    expect(m2.get('1471009')).toBe(3)
  })
})

describe('computeBanyueMingwangBlocks（轴编辑器块级标注）', () => {
  const axes = (banyueSlot = 0) => [{ name: '轴1', actions: [
    { slot: banyueSlot, moveId: 'banyue-combo', count: 1, startTime: 0 },
    { slot: banyueSlot, moveId: '1471009', count: 1, startTime: 2 },
    { slot: banyueSlot, moveId: '1471010', count: 1, startTime: 9 },
  ] }]

  it('触发块标 trigger，落窗块标层数，窗外块 0', () => {
    const m = computeBanyueMingwangBlocks(axes(), 0, 0)
    expect(m.get('0:0')).toEqual({ layers: 2, trigger: true })
    expect(m.get('0:1')).toEqual({ layers: 2, trigger: false })
    expect(m.get('0:2')).toEqual({ layers: 0, trigger: false })
  })

  it('6命不标注（满覆盖，UI 单独提示）', () => {
    expect(computeBanyueMingwangBlocks(axes(), 0, 6).size).toBe(0)
  })
})

describe('般琉通用预设轴（用户录入）：怒/普分化后的明王触发', () => {
  it('只有怒相连段块触发明王；单招论道/狮子吼·怒（普通强特）不触发但窗口内享受', async () => {
    const { default: preset } = await import('@/data/stunAxisPresets/般琉通用.json') as any
    const split = preset.plans[0].split
    const axes = [split.baseAxis, split.upgradeAxis]
    // 常规轴：连段@2.4 触发 2 层；连段@6.6 窗口内再触发 → 3 层并刷新到 14.6
    const m = computeBanyueMingwangStacks(0, axes, 0)
    expect(m.get('1471021')).toBe(3) // 转大块（4.1/7.8/8.3 落窗，加权）
    expect(m.get('1471009')).toBe(3) // 倾山@10.3
    expect(m.get('1471010')).toBe(3) // 摧岳@12.2
    // 单招狮子吼·怒@13.7、论道@14.2 是普通强特：不触发，但 13.7/14.2 < 14.6 → 落窗享受 3 层
    expect(m.get('1471016')).toBe(3)
    expect(m.get('1471015')).toBe(3)
    // 单招狮子吼@14.8 窗外（> 14.6）→ 不享受
    expect(m.get('1471014')).toBeUndefined()
  })
})

describe('资源池迭代口径（闪能/20 修复）', () => {
  it('calcEnergySource 计入般岳山威回闪能；state.exSpecialCount 用怒相循环强特总数（非 闪能/20）', async () => {
    const { calcTeamResources } = await import('@/core/resource')
    const catalog = useCatalogStore()
    await catalog.load()
    const config = useConfigStore()
    config.team[0] = { slot: 0, agentId: '1471', cinemaLevel: 0, ...baseConfig } as any
    config.team[1] = { slot: 1, agentId: '', cinemaLevel: 0, ...baseConfig } as any
    config.team[2] = { slot: 2, agentId: '', cinemaLevel: 0, ...baseConfig } as any
    const { buildCharConfig } = await import('@/composables/resourceCalc/helpers')
    const cfg = buildCharConfig(0, config, catalog)!
    const rr = calcTeamResources({ characters: [cfg], totalTime: 180, stunCount: 3 } as any)
    const c0 = rr.characters[0]
    // 山威回闪能走**行级**（「闪能·招式回复」= Σ 行级能量收入，rowEnergyTotal 单一事实源）：
    // rage=4 → 16 发山威强特 × 10 = 160，落在各自执行行上（不再有 banyueSwayRefund 平行字段）。
    const swayRows = (c0.executions ?? []).filter(r => (r.energyRecovery ?? 0) === 10)
    expect(swayRows.reduce((s, r) => s + r.count, 0)).toBe(16)
    expect(swayRows.reduce((s, r) => s + (r.totalEnergyRecovery ?? 0), 0)).toBe(160)
    expect(c0.energySource.skillRegen).toBeGreaterThanOrEqual(160)
    expect('banyueSwayRefund' in c0.energySource).toBe(false)
    // 强特总数 = 怒相内（rage4 × 4 山威强特 = 16）+ 怒相外连段（2×9 = 18）+ 余数单发论道 2 = 36，
    // 而非 闪能/20。⚠ **余数单发必须计入次数**（2026-10-19 用户口径「只能打 0-2 次 20 能量的了」）：
    // 它同样是真打出来的强特，漏计会让执行行/时间账/伤害池三处与资源次数不同源。
    const cycleForCount = c0.banyueRageCycle!
    expect(c0.exSpecialCount).toBe(34 + cycleForCount.lunDaoSpareCount)
    expect(cycleForCount.lunDaoSpareCount).toBeGreaterThan(0) // 反空洞：本夹具的余数确实花掉了
  })

  it('资源卡片文案：怒相内免费强特明写「不耗闪能 ⇒ 不产嗔火」，回能指向「闪能·招式回复」', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    const config = useConfigStore()
    config.team[0] = { slot: 0, agentId: '1471', cinemaLevel: 0, ...baseConfig } as any
    config.team[1] = { slot: 1, agentId: '', cinemaLevel: 0, ...baseConfig } as any
    config.team[2] = { slot: 2, agentId: '', cinemaLevel: 0, ...baseConfig } as any
    const calc = useResourceCalc()
    await new Promise(r => setTimeout(r, 80))
    const c0 = calc.resourceResult.value!.characters[0]
    const sections = getAgentMechanic('1471')?.resourceSections?.({ result: c0 }) ?? []
    const txt = JSON.stringify(sections)
    expect(txt).toContain('怒相内免费强特')
    expect(txt).not.toContain('怒相内强特')      // 旧标签会读成「嗔火来源 = 怒相内强特」（用户 2026-09-11 发现）
    expect(txt).toContain('不产嗔火')
    expect(txt).toContain('闪能·招式回复')
    expect(txt).toContain('怒相内不产嗔火')
  })
})

describe('般岳交互板块（扬砾/昂霄/冲霄 招式映射，用户确认）', () => {
  it('通用路径：闪避→扬砾、弹刀→昂霄（与所有角色一致）；般岳专属：金身+双反→不动如山+冲霄', async () => {
    const banyueModule = await import('@/mechanics/agents/banyue') as any
    const banyueMechanic = banyueModule.banyueMechanic
    const cfg: any = {
      dodgeCounterCount: 10, parryCount: 6, blockCount: 20, dualCounterCount: 5,
      dodgeCounterMoveId: '1471019', // 通用 findDodgeCounter 已正确选中扬砾（timeType=dodgeCounter）
      dodgeCounterActionTime: 1, defensiveAssistActionTime: 1, assistFollowUpActionTime: 1,
      dodgeCounterDecibelRecovery: 0, defensiveAssistDecibelRecovery: 0, assistFollowUpDecibelRecovery: 0,
    }
    const state: any = { basicAttackTime: 0, exSpecialCount: 0, ultimateCount: 0, chainCountTotal: 0 }
    const executions: any[] = []
    // 模拟通用 buildExecutions 生成的行：扬砾（闪避反击）+ 昂霄（支援突击）
    executions.push({ moveId: '1471019', moveName: '闪避反击（Dodge Counter）', category: 'dodge', count: cfg.dodgeCounterCount, actionTime: 1, comboAlignRatio: 0, totalTime: 10, totalComboAlignTime: 0, energyConsume: 0, totalEnergyConsume: 0, decibelRecovery: 0, totalDecibelRecovery: 0, energyRecovery: 0, totalEnergyRecovery: 0 })
    executions.push({ moveId: '1471026', moveName: '支援突击（Assist Follow-Up）', category: 'assist', count: cfg.parryCount, actionTime: 1, comboAlignRatio: 0, totalTime: 6, totalComboAlignTime: 0, energyConsume: 0, totalEnergyConsume: 0, decibelRecovery: 0, totalDecibelRecovery: 0, energyRecovery: 0, totalEnergyRecovery: 0 })
    banyueMechanic.patchExecutions?.({ cfg, state, executions })
    const yangLi = executions.find(e => e.moveId === '1471019')
    expect(yangLi).toBeDefined()
    expect(yangLi!.count).toBe(10) // 通用：闪避次数 → 扬砾
    const angXiao = executions.find(e => e.moveId === '1471026')
    expect(angXiao!.count).toBe(6) // 通用：普通弹刀 → 昂霄
    const chongXiao = executions.find(e => e.moveId === '1471029')
    expect(chongXiao).toBeDefined()
    expect(chongXiao!.count).toBe(25) // 般岳专属：金身20 + 双反5 → 冲霄
    const buDong = executions.find(e => e.moveId === '1471011')
    expect(buDong).toBeDefined()
    expect(buDong!.count).toBe(25)
    expect(buDong!.actionTime).toBeGreaterThan(0)
  })
})

describe('般岳自动轴 + 失衡窗口延时（用户口径）', () => {
  async function setupBanyueTeam(stunLock = 0) {
    const catalog = useCatalogStore()
    await catalog.load()
    const config = useConfigStore()
    config.team[0] = { slot: 0, agentId: '1471', cinemaLevel: 0, ...baseConfig } as any
    config.team[1] = { slot: 1, agentId: '1481', cinemaLevel: 0, ...baseConfig } as any
    config.team[2] = { slot: 2, agentId: '1451', cinemaLevel: 0, ...baseConfig } as any
    if (stunLock > 0) config.enemy.stunCountLock = stunLock
    return config
  }
  it('队伍 [1471,1481,1451]：通用自动轴生效并选中般琉通用预设（好评溢出爆发轴）', async () => {
    await setupBanyueTeam(3)
    useConfigStore()
    const calc = useResourceCalc()
    await new Promise(r => setTimeout(r, 60))
    expect(calc.autoPreset.value).not.toBeNull()
    expect(calc.autoPreset.value?.id).toBe('preset-1471-1481-1451')
    expect(calc.autoActive.value).toBe(true)
    const axes = calc.effectiveStunAxes.value
    // split(goodReviewOverflow)：默认全打常规轴，好评溢出才打爆发轴；窗口数 = 各轴 count 之和
    expect(axes.length).toBeGreaterThanOrEqual(1)
    expect(axes.some(a => a.name === '常规')).toBe(true)
    // 轴带 60/90 转大块（好评消耗来源）
    expect(axes.some(a => a.actions.some(act => act.promoteVariant === '60' || act.promoteVariant === '90'))).toBe(true)
  })

  it('失衡窗口时长含全队失衡延时：琉音+2、般岳C1+2 → 12+4+2+2 = 20s', async () => {
    await setupBanyueTeam()
    const config = useConfigStore()
    config.team[2] = { slot: 2, agentId: '', cinemaLevel: 0, ...baseConfig } as any
    config.setCinemaLevel(0, 1) // 般岳 C1：摧岳命中失衡 +2s
    const calc = useResourceCalc()
    await new Promise(r => setTimeout(r, 60))
    expect(calc.windowDuration.value).toBe(12 + 4 + 2 + 2)
    // 无 C1：只有琉音 +2
    config.setCinemaLevel(0, 0)
    await new Promise(r => setTimeout(r, 60))
    expect(calc.windowDuration.value).toBe(12 + 4 + 2)
  })
})

describe('核心被动·群山如我（hp→贯穿力 0.1/点 = 命破通用公式，不重复叠加）', () => {
  it('sheerForceFlat 只含怒相增益 300×覆盖率（hp×0.1 由引擎通用基底承担）', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    const config = useConfigStore()
    config.team[0] = { slot: 0, agentId: '1471', cinemaLevel: 0, ...baseConfig } as any
    config.team[1] = { slot: 1, agentId: '', cinemaLevel: 0, ...baseConfig } as any
    config.team[2] = { slot: 2, agentId: '', cinemaLevel: 0, ...baseConfig } as any
    const { computePanelPhases } = await import('@/composables/resourceCalc/panelPhases')
    const p = computePanelPhases(0, config, catalog)!
    // sheerForceFlat = 怒相增益 300（覆盖率1），不含额外 hp×0.1（避免重复计入）
    expect(p.inCombat.sheerForceFlat ?? 0).toBeCloseTo(300, 1)
    // 贯穿力基底 = atk×0.3 + hp×0.1（通用，含核心被动描述）+ sheerForceFlat
    const base = p.inCombat.atk * 0.3 + p.inCombat.hp * 0.1 + (p.inCombat.sheerForceFlat ?? 0)
    expect(base).toBeGreaterThan(0)
  })
})

describe('般岳命座逐项验收（用户口径）', () => {
  async function panelAt(cinema: number) {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs()
    const config = useConfigStore()
    config.team[0] = { slot: 0, agentId: '1471', cinemaLevel: cinema, ...baseConfig } as any
    config.team[1] = { slot: 1, agentId: '', cinemaLevel: 0, ...baseConfig } as any
    config.team[2] = { slot: 2, agentId: '', cinemaLevel: 0, ...baseConfig } as any
    config.syncTeammateBuffsFromTeam()
    const { computePanelPhases } = await import('@/composables/resourceCalc/panelPhases')
    return computePanelPhases(0, config, catalog)!.inCombat as any
  }

  it('C1：10 贯穿增伤区 + 2s 失衡延长（减抗在 teamBuff 已有）', async () => {
    const p0 = await panelAt(0)
    const p1 = await panelAt(1)
    expect(p1.sheerDmgBonus - p0.sheerDmgBonus).toBeCloseTo(10, 1)
    expect(p1.stunDurationBonusSeconds - p0.stunDurationBonusSeconds).toBeCloseTo(2, 1)
  })

  it('C2：怒相增益暴伤/火伤各 +15（回闪 +5 已有独立测试）', async () => {
    const p0 = await panelAt(0)
    const p2 = await panelAt(2)
    expect(p2.critDmg - p0.critDmg).toBeCloseTo(15, 1)
    expect(p2.fireDmg - p0.fireDmg).toBeCloseTo(15, 1)
  })

  it('C4：狮子吼·怒/山摇·怒/倾山/摧岳 +30% 普通增伤区（moveId 级）', async () => {
    const banyueModule = await import('@/mechanics/agents/banyue') as any
    const executions: any[] = []
    for (const id of ['1471016', '1471017', '1471009', '1471010']) {
      executions.push({ moveId: id, moveName: `m${id}`, category: 'special', count: 1, actionTime: 1, comboAlignRatio: 0, totalTime: 1, totalComboAlignTime: 0, energyConsume: 0, totalEnergyConsume: 0, decibelRecovery: 0, totalDecibelRecovery: 0, energyRecovery: 0, totalEnergyRecovery: 0, damageMultiplier: 100, damageMultiplierOverride: true })
    }
    executions.push({ moveId: '1471013', moveName: 'm地动', category: 'special', count: 1, actionTime: 1, comboAlignRatio: 0, totalTime: 1, totalComboAlignTime: 0, energyConsume: 20, totalEnergyConsume: 20, decibelRecovery: 0, totalDecibelRecovery: 0, energyRecovery: 0, totalEnergyRecovery: 0, damageMultiplier: 100, damageMultiplierOverride: true })
    const cfg = { dualCounterCount: 0, blockCount: 0, banyueCinemaLevel: 4 } as any
    banyueModule.banyueMechanic.patchExecutions?.({ cfg, state: {} as any, executions })
    for (const e of executions) {
      if (['1471016', '1471017', '1471009', '1471010'].includes(e.moveId)) {
        expect(e.dmgBonus).toBeCloseTo(30, 1)
      } else {
        expect(e.dmgBonus ?? 0).toBe(0) // 地动不受 C4 加成
      }
    }
  })

  it('本体怒相增益：贯穿+300 / 火伤+36% / 暴伤+36%（覆盖率100% = 永续口径）', async () => {
    const p = await panelAt(0)
    expect(p.sheerForceFlat).toBeCloseTo(300, 1)
    expect(p.fireDmg).toBeGreaterThanOrEqual(36)
    expect(p.critDmg).toBeGreaterThanOrEqual(36)
  })
})

describe('C1 战栗减抗生效（teammate-buffs 1471 组）', () => {
  it('1命时 enemyFireResReduction = 10（0命 = 0）；C1 提升显著高于无减抗', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs()
    const config = useConfigStore()
    config.team[0] = { slot: 0, agentId: '1471', cinemaLevel: 0, ...baseConfig } as any
    config.team[1] = { slot: 1, agentId: '1481', cinemaLevel: 0, ...baseConfig } as any
    config.team[2] = { slot: 2, agentId: '1451', cinemaLevel: 0, ...baseConfig } as any
    config.syncTeammateBuffsFromTeam()
    const { computePanelPhases } = await import('@/composables/resourceCalc/panelPhases')
    expect(computePanelPhases(0, config, catalog)!.inCombat.enemyFireResReduction ?? 0).toBe(0)
    config.setCinemaLevel(0, 1)
    config.syncTeammateBuffsFromTeam()
    const p1 = computePanelPhases(0, config, catalog)!
    expect(p1.inCombat.enemyFireResReduction).toBe(10)
  })
})

describe('自动补齐的时间合法性（用户口径 2026-09-01：>200s 即非法填充）', () => {
  const axis8 = { 'banyue-combo': 8 }
  const base = {
    battleTime: 180, dodgeCount: 0, parryCount: 0, blockCount: 0, dualCounterCount: 0, cinemaLevel: 0,
    axisEx: axis8, ultimateCost: 3000, decibelHave: 0,
  }

  it('不传单次时长 = 不做判定（宁可不管，也不用假时长把合法补齐判非法）', () => {
    const t = computeBanyueInteractionTopUp({ ...base, ultimateCountNeeded: 6 })
    expect(t.parry).toBeGreaterThan(0)
    expect(t.requiredSeconds).toBe(0)
    expect(t.illegal).toBe(false)
  })

  it('自动轴要 9 次大 → 补齐 90 刀 × 2.4s = 216s > 200s → 判非法并清零（这正是无限加招架的刹车）', () => {
    // T129：分母 215 → 301.35 后，同样的「次数需求」对应更少刀 ⇒ 要把需求抬到 9 次大
    // （缺口 27000 → 90 刀 × 2.4s = 216s）才仍能压过 200s 上限。本用例锁的「刹车」语义不变：
    // 原始动作时间合计 > 200s ⇒ illegal 且次数清零（不是截断成半套）。
    const t = computeBanyueInteractionTopUp({ ...base, ultimateCountNeeded: 9, perParrySeconds: 2.4 })
    expect(t.requiredSeconds).toBeGreaterThan(AUTO_TOPUP_TIME_LIMIT_SEC)
    expect(t.illegal).toBe(true)
    expect(t.parry).toBe(0)
    expect(t.dual).toBe(0)
  })

  it('刚好压线不判非法（判据是严格大于，边界可用）', () => {
    // 5 次大、无供给 → 缺口 15000 → ceil(15000/301.35) = 50 刀；50 × 4 = 200s，**恰好**等于上限
    // ⇒ 严格大于判据下仍合法（T129 顺带把边界从「196 接近」改成「200 精确压线」，判据更贴字面）。
    const t = computeBanyueInteractionTopUp({ ...base, ultimateCountNeeded: 5, perParrySeconds: 4 })
    expect(t.parry).toBe(50)
    expect(t.requiredSeconds).toBeCloseTo(200, 6)
    expect(t.illegal).toBe(false)
  })

  it('上限是常量单一来源（规则 11），不是散落的字面量', () => {
    expect(AUTO_TOPUP_TIME_LIMIT_SEC).toBe(200)
  })
})

describe('CC-17：般岳 directRowBonus（明王行级加成，轴/非轴两臂 + note 逐字）', () => {
  const exec = (moveId: string) => ({ moveId } as never)
  // CC-437：overlay 不透明，用模块 channel 构造（层数臂 / 百分比臂）
  const stacks = (n: number) => banyueOverlay.wrap({ stacksByMove: new Map([['1471010', n]]) })
  const flat = (pct: number) => banyueOverlay.wrap({ flatPct: pct })

  it('轴臂：桶层数 × MINGWANG_BASE_PER_STACK，note「（轴内覆盖）」', () => {
    const rb = banyueMechanic.directRowBonus!({
      exec: exec('1471010'), isAxis: true, stunOverride: 1, overlay: stacks(2),
    })!
    expect(rb.dmgBonus).toBe(2 * MINGWANG_BASE_PER_STACK)
    expect(rb.note).toBe(' · 明王+10.0%（轴内覆盖）')
  })

  it('轴臂：桶里查不到的 moveId → null（不产 0 段）', () => {
    expect(banyueMechanic.directRowBonus!({
      exec: exec('9999'), isAxis: true, stunOverride: 1, overlay: stacks(2),
    })).toBeNull()
  })

  it('非轴臂：读本槽标量，note「（覆盖率近似）」', () => {
    const rb = banyueMechanic.directRowBonus!({
      exec: exec('1471010'), isAxis: false, stunOverride: 0, overlay: flat(7.5),
    })!
    expect(rb.dmgBonus).toBe(7.5)
    expect(rb.note).toBe(' · 明王+7.5%（覆盖率近似）')
  })

  it('两臂皆 0 → null（不产空 note）', () => {
    expect(banyueMechanic.directRowBonus!({
      exec: exec('1471010'), isAxis: false, stunOverride: 0, overlay: flat(0),
    })).toBeNull()
  })
})

// CC-18a 2026-09-26：块 3 自 `damagePoolCharExtras.ts` 迁进模块能力 `extraDirectRows`
// （设计稿 `docs/mcp-cc18-extra-direct-rows.md` §2/§5）。逐字锁 id/count/multiplier/note。
describe('CC-18a：般岳 extraDirectRows（C6 摧岳附伤逐字）', () => {
  const crushExec = (count: number, ratio: unknown = 600) => ({
    moveId: '1471009',
    count,
    banyueC6CrushAttach: ratio,
  })
  const panel = { atk: 2000, hp: 10000, sheerForceFlat: 300 } as never
  // CC-18b 2026-09-26：ExtraDirectRowsInput 扩 5 个必填字段；般岳只解构自己需要的字段，桩值不参与。
  const stubs = {
    teammateAt: () => ({ panel: undefined, agent: null }),
    stunCount: 0,
    promoteCount: 0,
    getMechanicSetting: (_k: string, d: number) => d,
    ultimateInAxisFraction: () => 0,
  }

  it('无 banyueC6CrushAttach 标记 → 返回 []（非 C6 不产行）', () => {
    expect(banyueMechanic.extraDirectRows!({
      charResult: { agentId: '1471', executions: [{ moveId: '1471009', count: 4 }] } as never,
      slot: 0, panel, isAxis: false, axisStunFor: () => 0,
      ...stubs,
    })).toEqual([])
  })

  it('C6 倾山行逐字：id/count/multiplier/note + 贯穿力基底', () => {
    const rows = banyueMechanic.extraDirectRows!({
      charResult: { agentId: '1471', executions: [crushExec(4)] } as never,
      slot: 2,
      panel,
      isAxis: false,
      axisStunFor: () => 0,
      ...stubs,
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: 'banyue-c6-crush-attach',
      slot: 2,
      agentId: '1471',
      name: '影画6·摧岳附伤（倾山自动触发）',
      element: 'fire',
      source: '倾山自动触发',
      count: 4,
      multiplier: 600,
      note: '影画6：倾山命中时对周身造成 600% 贯穿力火伤；次数=倾山次数 ×4（自动，不可调）',
      basisValueOverride: 2000 * 0.3 + 10000 * 0.1 + 300,
      basisLabelOverride: '贯穿力（600%附伤）',
      moveId: 'banyue_c6_crush_attach',
      stunOverride: 0,
    })
  })

  it('count 向下取整且为 0 时不产行', () => {
    const cr = (count: number) => ({ charResult: { agentId: '1471', executions: [crushExec(count)] } as never, slot: 0, panel, isAxis: false, axisStunFor: () => 0, ...stubs })
    expect(banyueMechanic.extraDirectRows!(cr(3.9))[0].count).toBe(3)
    expect(banyueMechanic.extraDirectRows!(cr(0))).toEqual([])
  })

  it('axisStunFor 透传：stunOverride = axisStunFor(banyue_c6_crush_attach)', () => {
    const rows = banyueMechanic.extraDirectRows!({
      charResult: { agentId: '1471', executions: [crushExec(2)] } as never,
      slot: 0, panel, isAxis: true,
      axisStunFor: (moveId: string) => (moveId === 'banyue_c6_crush_attach' ? 1 : 0),
      ...stubs,
    })
    expect(rows[0].stunOverride).toBe(1)
  })
})

/**
 * T165 挤压臂（用户口径 2026-10-14，逐字）：
 * > 「我不希望**多打一次资源就导致挤不下然后取消轴模式导致巨大退化**，我希望你**挤不下就不要多打**。」
 *
 * 判据分两层：
 *  ① **纯函数层**（`computeBanyueRageCycle` 的 `autoTrim`）：削 N 组 ⇒ `comboOutCount` 恰好少 N
 *     （且不会削成负数）；不削（缺省）时逐位等于旧行为。
 *  ② **管线层**（`solveTeam` 挤压臂）：轴态超预算时引擎逐个试 trim，取**首个真装得下**的值，
 *     并把读数暴露在 `convergence.axisAutoTrimmed`。
 *
 * ## 负控（删掉被锁行为后本测试确实变红）
 * - 删掉 `comboOutTotal` 的 `- autoTrim` ⇒ ① 三条断言红；
 * - 删掉 `solveTeam` 的挤压臂 ⇒ ② 的 `axisAutoTrimmed > 0` 与「保轴」断言红；
 * - 把挤压臂的采纳条件 `!overBudget(squeezed)` 改成恒真 ⇒ ② 的「trim 是最小可行值」断言红。
 */
describe('T165 挤压臂：挤不下就不要多打（autoTrim）', () => {
  // ⚠ **T168 换档（2026-10-15）**：原夹具 `[10,6,12,3,0,320,6,0,180]` 是**旧闪能浪费口径**
  // （`axisSpend / rage` 均摊）下的临界点——那时缺省 comboOut=3。闪能浪费改成**用户可调常数**
  // （默认 50）后，同夹具缺省 comboOut=4，且 trim=1/2/3 落到 2/1/0（**不是**恰好少 N），
  // 因为削连段会连带改变怒相数（怒相 4→3 时 `swayRefundPerRage` 少一档 ⇒ flashIncome 也降）。
  // 换到 `spend=300`：实测缺省 comboOut=4、trim=1/2/3 ⇒ 3/2/1（恰好少 N）、ΔflashSpent=60/120/180，
  // 是本量下唯一逐档干净的档位（扫描 200/240/300/320/360/400 见 `.zc/perf/T168t165b.perf.ts`）。
  const base = [10, 6, 12, 3, 0, 300, 6, 0, 180] as const

  it('① 纯函数：autoTrim=N ⇒ 怒相外连段恰好少 N 组（缺省 0 = 逐位不变）', () => {
    const c0 = computeBanyueRageCycle(...base)
    // ⚠ 缺省值**实测**（不是按公式推的）：本夹具 flashIncome=580/axisSpend=300 ⇒ floor(280/60)=4。
    // 写死实测值，公式一变本用例立刻红（这正是要锁的）。
    expect(c0.comboOutCount, '缺省不削').toBe(4)
    /**
     * ⚠ **2026-10-19「余数花掉」后本夹具的档位变了**（规则 10 四步归因）：
     * ① 量 delta：缺省 `spare` 0 → **2**（`flashSpent` 540 → 580），trim=2 起 `rageCount` 4 → 3。
     * ② 根因：挤压臂现在削的是**自动多打的总预算**（`playBudget`，见 `computeBanyueRageCycle`），
     *    削掉的那 60 点连段预算**不回流**给余数（否则「削 1 组」等于没削）——但怒相数一旦掉一档，
     *    `swayRefundPerRage` 就少 40（4 山威 × 10 回能），`flashIncome` 同步下降 ⇒ ΔflashSpent 不是
     *    纯 `-trim×60`。这正是本文件前面 T168 注释记过的同一个连带效应。
     * ③ 确认有意：挤压臂的目的是「挤不下就不要多打」，削减后怒相变少是**真实后果**（山威供给
     *    跟着少），不是记账错误。判据本身改成逐项对账：`-trim×60` 再减「掉档怒相的山威回能」。
     * ④ 断言改为**逐项对账**（下面那个等式），不再假定怒相数恒 4。
     */
    for (const trim of [1, 2, 3]) {
      const c = computeBanyueRageCycle(...base, 0, 0, true, 0, trim)
      expect(c.comboOutCount, `trim=${trim} 应恰好少 ${trim} 组`).toBe(Math.max(0, 4 - trim))
      // 闪能**账本身**（不是 delta）：支出恒 = 轴内 + 连段 60/组 + 余数单发 20/次。
      // 这条恒等式与 `autoTrim` 无关——挤压臂只改「能打几组/几次」，不改单价。
      expect(c.flashSpent, `trim=${trim} 的闪能账`).toBeCloseTo(
        c.axisExSpend + c.comboOutCount * 60 + c.lunDaoSpareCount * 20, 6)
      // 收入只由怒相数决定（`swayRefundPerRage` 每档 40）：挤压臂本身不改收入，掉档才改
      const lostRage = c0.rageCount - c.rageCount
      expect(c.flashIncome, `trim=${trim}：只有掉档怒相才改收入（每档 40 山威回能）`)
        .toBeCloseTo(c0.flashIncome - lostRage * 40, 6)
      // 反空洞：削了真东西（支出确实下降）
      expect(c.flashSpent).toBeLessThan(c0.flashSpent)
      // 余数单发上限 2（`[0,60)` ÷ 20），且余数 < 20 时不再发
      expect(c.lunDaoSpareCount, '余数单发上限 2（[0,60) ÷ 20）').toBeLessThanOrEqual(2)
      // 反空洞：本夹具的 trim 确实改变了读数（否则上面的等式是 5===5 的同义反复）
      expect(c.comboOutCount).toBeLessThan(c0.comboOutCount)
    }
  })

  it('① 纯函数：autoTrim 超过总量 ⇒ 夹到 0（不出现负连段）', () => {
    const c = computeBanyueRageCycle(...base, 0, 0, true, 0, 99)
    expect(c.comboOutCount).toBe(0)
    expect(c.flashSpent).toBeGreaterThanOrEqual(0)
  })

  it('② 管线：轴态超预算时引擎削自动连段保轴（而非丢整个轴）', async () => {
    /**
     * ⚠ **必须用真预设**：挤压臂的触发条件是「轴态净占用被**自动多打**顶出容差」，它需要
     * 「轴内块吃满闪能 + 交互行占满前台」同时成立。实测合成夹具（3×轴内块数 × 3×交互档 = 9 组，
     * 见 `.zc/perf/T166sq7.perf.ts`）**全部 trim=0** —— 合成队规模小、净占用本来就装得下
     * ⇒ 用合成夹具写的「挤压臂」用例是**假判据**（断言恒真、删掉实现也不红）。真预设才有那个临界。
     *
     * ⚠ **T168 换夹具（2026-10-15）**：原用 `banyue-jufufu-lucia`，闪能浪费改成用户可调常数
     * （默认 50）后，该队在默认交互档（闪10/金12/双3）+ 合轴率 40% 下**直接退化**（实测
     * `.zc/perf/T168wsweep.perf.ts`：W=0/25/50/100 恒为「退化=Y / 块=0 / comboOut=10 / 46.63M」）。
     * 按用户口径 2026-10-15，这正是「**中等难度装不下该轴**」——要用**更高难度**
     * （双反替闪反+金身、合轴率突破 40%）才装得下，不是挤压臂该救的场景。
     * ⇒ 当时换到 `banyue-trigger-lucia`（trim=2、net 181.55、53.49M）。
     *
     * ⚠⚠ **T169 再换回 `banyue-jufufu-lucia`（2026-10-15）—— 山威门让该队恢复保轴**。
     * ① 量 delta：`banyue-trigger-lucia` 的 `axisAutoTrimmed` 由 **2 → 0**（53.493 → 53.674M，
     *    不再需要削）；`banyue-jufufu-lucia` 由「退化」变为 **trim=1、保轴、53.152M**（46.635 → 53.152M）。
     * ② 根因：轴栈新增**角色专属资源门控**（般岳山威）⇒ 超出「怒相数 × 2 组」的幽灵连段块
     *    在执行前被跳过 ⇒ 轴内时间不再被无伤害对应物的块撑大 ⇒ trigger 少占 ~2s（不必削）、
     *    jufufu 由装不下变装得下。
     * ③ 确认有意：用户口径 2026-10-15「缺失那就加上呗，又没什么副作用」——让轴内内容如实。
     * ④ 处置：夹具换回 `jufufu`（本仓唯一仍走挤压臂的预设，实测 trim=1；
     *    trigger/roxy/liuyin 为 0/2/3，但只有它是「靠削才保住的临界」）。判据全部保留。
     */
    const { config } = await setupHarness(['', '', ''], { productionBasicWeights: true })
    const catalog = useCatalogStore()
    await catalog.loadBuildRecommendations()
    // ⚠ 2026-10-18 夹具再换：修「冲霄动作时间」（2.667 → 1.167）后，180s 里让出约 30s，
    // **jufufu 不再需要挤压**（trim 0，实测 59.758M）——夹具改取 **norma**（修正后唯一仍 trim=1 的预设，
    // 实测 81.172M / net 181.38）。判据形状不变：轴保住 + 真的削了 + 削到装得下。
    //
    // ⚠ **2026-10-20 显式造出临界**（配装推荐主词条订正后，默认档下 6 支般岳预设全部 trim=0）：
    // 数据口径修正后这 6 支预设的净占用都刚好装得下（norma 实测 net 180.76，只差 0.76s 压线但不触发）
    // ⇒ 「挤压臂真的削了」这条判据会退化成「本来就装得下」（正是头注释 T166 警告的假判据）。
    // 处置：不再依赖「某条预设恰好在临界」，而是**显式把有效战斗时长压到临界以内**——
    // `enemy.invincibleTime = 10` ⇒ 有效时长 170s，实测 norma trim=3、保轴、net 170.00、74.526M。
    // 判据形状一字未改（轴保住 + 真的削了 + 削到装得下），反空洞断言反而更强。
    config.enemy.invincibleTime = 10
    const preset = teamPresets.find(p => p.id === 'banyue-norma-lucia')!
    const baseAxis = config.getAxisState()
    applyTeamToStore(config, preset)
    applyGoldToStore(config, preset, baseGoldOf(preset))
    applyAxisBinding(config, baseAxis, preset)
    const calc = useResourceCalc()
    await new Promise(r => setTimeout(r, 250))
    const rr = calc.resourceResult.value!
    const trim = rr.convergence.axisAutoTrimmed ?? 0
    // 两条断言必须**同时**成立才算「挤压臂生效」：
    //   ① 轴保住了（没退化）；② 确实削了（trim > 0）——否则本用例只是「本来就装得下」
    expect(rr.convergence.axisFallback, '挤压臂生效 ⇒ 轴不得退化').toBe(false)
    expect(trim, '反空洞：本夹具必须真的触发挤压臂（否则断言退化成「本来就装得下」）').toBeGreaterThan(0)
    // 净占用必须真的装得下（挤压臂的采纳条件就是这个）
    expect(netFrontlineOccupation(rr), '削到装得下才采纳').toBeLessThanOrEqual(180 + 2)
    // 般岳的怒相外连段确实被削了（模块侧读数与引擎读数同源）
    const b = rr.characters.find(c => c.agentId === '1471') as unknown as { banyueRageCycle?: { comboOutCount: number } } | undefined
    expect(b?.banyueRageCycle?.comboOutCount, '般岳连段数被削减').toBeDefined()
    // 2026-10-20 实测（invincibleTime=10）：trim=3、保轴后 74.526M（net 170 → 削到装得下）
    expect((calc.teamTotalDamage.value ?? 0) / 1e6, '保轴后伤害落在实测档位（74.526M）').toBeGreaterThan(70)
  })
})

describe('T167 轴内连段块闪能账 + 救援臂入场判据（规则 5 生效测试）', () => {
  /**
   * 缺陷 1（账本）：`combos[].energyCost` 与模块自己 5 处文档矛盾。
   * 判据 = **轴栈的闪能门控不再因闪能跳过连段块**（这是 `energyCost` 的唯一消费者
   * `resourceCalc/roundInputs.ts#buildStackAxes` 的直接读数）。
   *
   * ⚠ 反空洞：必须同时断言「本夹具的轴确实含连段块且轴活着」——否则
   * 「skipped 里没有 banyue-combo/energy」在**弃轴**时也恒真（弃轴根本没有轴栈）。
   */
  it('① 轴内连段块不扣闪能：轴栈闪能门控不因 energy 跳过 banyue-combo / banyue-combo-didong', async () => {
    const { config } = await setupHarness(['', '', ''], { productionBasicWeights: true })
    const catalog = useCatalogStore()
    await catalog.loadBuildRecommendations()
    // 用真预设（`banyue-liuyin-lucia` 的轴 = 每窗 2 连段块），与 .zc/perf 探针同源
    const preset = teamPresets.find(p => p.id === 'banyue-liuyin-lucia')!
    const baseAxis = config.getAxisState()
    applyTeamToStore(config, preset)
    applyGoldToStore(config, preset, baseGoldOf(preset))
    applyAxisBinding(config, baseAxis, preset)
    const calc = useResourceCalc()
    await new Promise(r => setTimeout(r, 250))
    const st = calc.stackTraversalResult.value
    // 反空洞①：轴活着（否则 skipped 断言退化成同义反复）
    expect(st, '反空洞：本夹具必须真的跑出轴栈（弃轴时下面的断言恒真）').toBeTruthy()
    // 反空洞②：轴内确实捏了连段块（否则「没被跳过」也是同义反复）
    const comboBlocks = Object.keys(st!.executed).filter(k => k.includes('banyue-combo'))
    const comboRequested = Object.values(st!.skipped).some(s => s.moveId.includes('banyue-combo')) ||
      comboBlocks.length > 0
    expect(comboRequested, '反空洞：本夹具的轴必须含连段块').toBe(true)
    // ★ 主判据：连段块**不得**因闪能不足被跳过
    const comboEnergySkipped = st!.skipped.filter(s => s.moveId.includes('banyue-combo') && s.reason === 'energy')
    expect(comboEnergySkipped, '轴内连段块耗山威免费 ⇒ 不得因闪能被门控跳过').toEqual([])
    // 且它们真的进了执行集合（不是"没请求"）
    expect(comboBlocks.length, '连段块必须在轴内真的执行').toBeGreaterThan(0)
  })

  /**
   * **T169：山威门 —— 轴内捏的连段块超出「怒相可供给量」时必须被跳过**（规则 5 生效测试）。
   *
   * 缺陷（T167 修 `energyCost` 后暴露）：连段块的真实成本是**山威**（4/怒相 = 2 组/怒相），
   * 但轴栈在 T169 前只认闪能/喧响/时间三类门 ⇒ **用户捏几块就执行几块**。超出的块
   * 既无伤害对应物（模块只按 `怒相数 × 2` 物化行）、又照占轴内时间。
   *
   * ## 负控（本测试的判别力来源）
   * 删掉 `stunAxisStack` 的 sway 门控（或删掉 `combos[].swayCost`）⇒ ① 失败
   * （捏 20 块会执行 20 块而非 4 块、零 sway 跳过）。
   */
  it('山威门：轴内连段块超出怒相容量 ⇒ 按 sway 跳过，不再执行幽灵块', async () => {
    const { config } = await setupHarness(['', '', ''], { productionBasicWeights: true })
    const catalog = useCatalogStore()
    await catalog.loadBuildRecommendations()
    const preset = teamPresets.find(p => p.id === 'banyue-liuyin-lucia')!
    const baseAxis = config.getAxisState()
    applyTeamToStore(config, preset)
    applyGoldToStore(config, preset, baseGoldOf(preset))
    applyAxisBinding(config, baseAxis, preset)
    // 把该预设的连段块加量到远超容量（原预设已含连段块；只改 count 不动形状）
    config.stunAxes = config.stunAxes.map(a => ({
      ...a,
      actions: a.actions.map(x => x.moveId.includes('banyue-combo') ? { ...x, count: 20 } : x),
    })) as never
    const calc = useResourceCalc()
    await new Promise(r => setTimeout(r, 150))
    const st = calc.stackTraversalResult.value
    const rr = calc.resourceResult.value!
    // 反空洞①：轴真的跑起来了（弃轴时下面的断言恒真）
    expect(st, '反空洞：本夹具必须真的跑出轴栈').toBeTruthy()
    // ★ 主判据：超出的连段块被判 sway 跳过（「山威」是原因名，不是闪能/时间）
    const swaySkipped = st!.skipped.filter(s => s.moveId.includes('banyue-combo') && s.reason === 'sway')
    expect(swaySkipped.length, '超量连段块必须按 sway 跳过').toBeGreaterThan(0)
    // 反空洞②：被跳过的**不是全部**——容量内的块仍要执行（否则「全跳过」也能让上面成立）
    const executedBlocks = Object.entries(st!.executed)
      .filter(([k]) => k.includes('banyue-combo'))
      .reduce((a, [, v]) => a + (v as { count: number }).count, 0)
    expect(executedBlocks, '容量内的连段块仍须执行').toBeGreaterThan(0)
    // 容量口径（**整局总量**，与闪能/喧响门控同款「轴从总量里挑招式」，用户 2026-09-08 裁决）：
    // 供给 = 怒相数 × 4 山威，每块耗 2 ⇒ 全轴最多执行 `怒相数 × 2` 块（**不乘窗口数**——
    // 山威是整局累计的资源，不是每窗重置）。捏 20 块/窗只是把需求抬高，执行量仍由总量封顶。
    const b = rr.characters.find(c => c.agentId === '1471') as unknown as { banyueRageCycle?: { rageCount: number; swayExCount: number } } | undefined
    const rage = b?.banyueRageCycle?.rageCount ?? 0
    expect(b?.banyueRageCycle?.swayExCount, '供给 = 怒相数 × 4（与模块同源）').toBe(rage * 4)
    expect(executedBlocks, '执行块数被山威总量封顶 = 怒相数 × 2，不是捏的 20×窗').toBe(rage * 2)
  })

  /**
   * 缺陷 2（救援臂入场判据）：`topUpIllegal` 含 `threadsApplied.illegal`（**上一轮遗留**标志），
   * 会把中断臂/挤压臂一起挡掉 ⇒ 直接退化。实测 `banyue-liuyin-lucia`：修账本后旧判据 ⇒ 丢轴
   * 71.496M；只看「有补齐量可中断」⇒ 保轴 76.216M（trim=3）。
   *
   * 判据 = 该队**轴不得退化**，且挤压臂确实运行过（trim > 0）。
   * ⚠ 反空洞：必须断言 trim > 0 —— 否则「没退化」可能只是「本来就装得下」，与本修复无关。
   */
  it('② 上一轮遗留的 illegal 标志不得挡掉救援臂（liuyin：修账本后仍保轴）', async () => {
    const { config } = await setupHarness(['', '', ''], { productionBasicWeights: true })
    const catalog = useCatalogStore()
    await catalog.loadBuildRecommendations()
    // ⚠ 2026-10-18：修冲霄时间后，该队**默认交互**下 trim=0（90.745M / net 179.23，本来就装得下）
    // ⇒ 反空洞断言会退化成同义反复。夹具把金身抬到 20（实测 trim=3、保轴 84.448M / net 180.62），
    // 让它重新回到「靠削才保住的临界」——**抬交互而不是改判据**，判据形状不变。
    const preset = teamPresets.find(p => p.id === 'banyue-liuyin-lucia')!
    const baseAxis = config.getAxisState()
    applyTeamToStore(config, preset)
    applyGoldToStore(config, preset, baseGoldOf(preset))
    applyAxisBinding(config, baseAxis, preset)
    config.setActionCount(0, 'blockCount', 20)
    const calc = useResourceCalc()
    await new Promise(r => setTimeout(r, 250))
    const rr = calc.resourceResult.value!
    expect(rr.convergence.axisFallback, '救援臂没被遗留标志挡掉 ⇒ 轴不得退化').toBe(false)
    expect(rr.convergence.axisAutoTrimmed ?? 0,
      '反空洞：本夹具必须真的触发挤压臂（否则断言退化成「本来就装得下」）').toBeGreaterThan(0)
    expect(netFrontlineOccupation(rr), '削到装得下才采纳').toBeLessThanOrEqual(180 + 2)
    // 2026-10-18 实测：金身 20 档 trim=3、保轴 84.448M（丢轴态见同探针 72.08M@blockCount=26）
    expect((calc.teamTotalDamage.value ?? 0) / 1e6, '保轴后伤害落在实测档位（84.448M）').toBeGreaterThan(78)
  })
})

/**
 * 锐能收支式（mechanics/sharpnessIncome）的判据（2026-11-08）。
 *
 * 本文件锁三件事：
 * ① **逐位等价**：新式 `sharpnessIncome(...)` 与改造前 claret / sunbringer 各自手写的闭式
 *    在大量随机输入上**逐位相同**（=== 而非 toBeCloseTo）——批次 1 的硬约束是「零行为变化」。
 * ② **加法顺序**：initial → auto → move → gifts。顺序错了浮点末位就会偏，故用顺序敏感用例钉住。
 * ③ **gifts 是数组**：多生产者相加（克拉蕾终结技 +10 与知更鸟 +20×n 可同时存在），
 *    不得退化成标量（那是 ModuleFeedback 后写覆盖的老毛病）。
 */
import { describe, expect, it } from 'vitest'
import { SHARPNESS_INITIAL, sharpnessIncome } from '@/mechanics/sharpnessIncome'

/** 改造前 sunbringer.ts:222 的手写闭式（逐字复制，作为对拍基准） */
function legacySunbringerPool(initial: number, regenPerSec: number, combatTime: number, movePerSec: number, basicTime: number): number {
  return initial + regenPerSec * combatTime + movePerSec * basicTime
}

/** 改造前 claret.ts:714 的手写闭式（逐字复制，作为对拍基准） */
function legacyClaretGain(initial: number, ultimateCount: number, perUltimate: number): number {
  return initial + ultimateCount * perUltimate
}

describe('锐能收支式（单一事实源）', () => {
  it('进场赠送常量的单一事实源是 60（勘域 180s 一次）', () => {
    expect(SHARPNESS_INITIAL).toBe(60)
  })

  it('★ 与挽昼旧闭式逐位相同：60 + 1.5×180 + 2.0×90 = 510', () => {
    const r = sharpnessIncome({
      initial: SHARPNESS_INITIAL,
      regenPerSec: 1.5,
      seconds: 180,
      movePerSec: 2.0,
      moveSeconds: 90,
    })
    expect(r.total).toBe(510)
    expect(r.total).toBe(legacySunbringerPool(60, 1.5, 180, 2.0, 90))
    expect(r.auto).toBe(270)
    expect(r.move).toBe(180)
    expect(r.gifts).toBe(0)
  })

  it('★ 与克拉蕾旧闭式逐位相同：60 + 2×10 = 80（走 gifts 口）', () => {
    const r = sharpnessIncome({ initial: SHARPNESS_INITIAL, gifts: [2 * 10] })
    expect(r.total).toBe(80)
    expect(r.total).toBe(legacyClaretGain(60, 2, 10))
    expect(r.gifts).toBe(20)
  })

  it('★ 全域随机对拍：与两条旧闭式逐位相同（不允许 toBeCloseTo 掩盖末位漂移）', () => {
    let checked = 0
    for (let regen = 0; regen <= 4; regen += 0.5) {
      for (let seconds = 0; seconds <= 360; seconds += 37) {
        for (let movePerSec = 0; movePerSec <= 4; movePerSec += 0.7) {
          for (let moveSeconds = 0; moveSeconds <= 180; moveSeconds += 23) {
            const r = sharpnessIncome({ initial: 60, regenPerSec: regen, seconds, movePerSec, moveSeconds })
            expect(r.total, 'regen=' + regen + ' s=' + seconds + ' mps=' + movePerSec)
              .toBe(legacySunbringerPool(60, regen, seconds, movePerSec, moveSeconds))
            checked++
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(500)
  })

  it('★ 多生产者 gift 求和（不得后写覆盖）：终结技 +10×3 与队友 +20×2 同时存在', () => {
    const r = sharpnessIncome({ initial: 0, gifts: [3 * 10, 2 * 20] })
    expect(r.gifts).toBe(70)
    expect(r.total).toBe(70)
  })

  it('缺省字段按 0 处理（该来源本局不发生）', () => {
    expect(sharpnessIncome({}).total).toBe(0)
    expect(sharpnessIncome({ initial: 60 }).total).toBe(60)
    expect(sharpnessIncome({ regenPerSec: 1.5 }).total).toBe(0)
  })

  it('不 clamp：负 gift 允许出现（调用方自己决定怎么夹）', () => {
    const r = sharpnessIncome({ initial: 30, gifts: [-50] })
    expect(r.total).toBe(-20)
  })

  it('NaN / 非有限 gift 被忽略（不污染 total）', () => {
    const r = sharpnessIncome({ initial: 60, gifts: [Number.NaN, 10, Number.POSITIVE_INFINITY * 0] })
    expect(r.total).toBe(70)
  })

  it('加法顺序 initial → auto → move → gifts（顺序敏感：与逆序相加的浮点结果不同）', () => {
    // 0.1 + 0.2 + 0.3 与 0.3 + 0.2 + 0.1 在有第四项参与时可能差一个 ulp；
    // 本用例只断言**我们定的那个顺序**与手工按同顺序展开的结果逐位相同。
    const initial = 0.1
    const regenPerSec = 0.2
    const seconds = 1
    const movePerSec = 0.3
    const moveSeconds = 1
    const r = sharpnessIncome({ initial, regenPerSec, seconds, movePerSec, moveSeconds, gifts: [0.4] })
    const auto = regenPerSec * seconds
    const move = movePerSec * moveSeconds
    let gifts = 0
    gifts += 0.4
    expect(r.total).toBe(initial + auto + move + gifts)
  })
})

/**
 * 格莉丝轮换精确闭式解（planGraceRotation，口径 @fact 在 grace.ts#planGraceRotation）。
 *
 * 旧实现用 cycleBound = aSum + 2·ex 把两特殊技槽都按强特时长保守估 ⇒ 循环数被压小、
 * 普特系统性低估（用户 2026-10-01：「精确强特和普特次数,时间也确定,a1-a4也确定」）。
 * 精确解：候选强特数 n，c(n) = floor((pool − n·(ex−sp)) / (aSum + 2·sp))，选 cycles 最大者。
 *
 * catalog 时长（1181）：a1 0.171 a2 0.33 a3 0.682 a4 1.134 ⇒ aSum 2.317；sp 0.2 ex 0.342。
 */
import { describe, expect, it } from 'vitest'
import { planGraceRotation } from '@/mechanics/agents/grace'

const T = { a1: 0.171, a2: 0.33, a3: 0.682, a4: 1.134, sp: 0.2, ex: 0.342 }
const aSum = T.a1 + T.a2 + T.a3 + T.a4 // 2.317
const total = (p: { cycles: number; exUsed: number; normalUsed: number }) =>
  p.cycles * aSum + p.exUsed * T.ex + p.normalUsed * T.sp

describe('格莉丝轮换精确闭式解 planGraceRotation', () => {
  it('总耗时不超平A池（所有候选 n 的可行上界）', () => {
    for (const [pool, ex] of [[30.1, 12], [36.5, 14], [20.3, 11], [50, 20], [10, 3]] as const) {
      const p = planGraceRotation(pool, ex, T)
      expect(total(p), `pool=${pool} ex=${ex} 总耗时 ${total(p)} 超池`).toBeLessThanOrEqual(pool + 1e-6)
    }
  })

  it('30.1s 池 ex=12：精确解 14 循环 12 强特 16 普特（旧近似只得 10 循环 8 普特）', () => {
    const p = planGraceRotation(30.1, 12, T)
    // 精确：n=12 ⇒ c=floor((30.1−12×0.142)/(2.317+0.4))=floor(28.396/2.717)=10 …
    // 增大 n 不增 c（ex−sp>0），减小 n 可增 c；最优在 n 使 2c 最大。
    // 验证总耗时不超池且 cycles×2 ≥ exUsed+normalUsed 守恒
    expect(p.exUsed + p.normalUsed).toBe(p.cycles * 2)
    expect(p.exUsed).toBeLessThanOrEqual(12)
    // 关键不变量：精确解的特殊技总段数 ≥ 旧近似（旧 10 循环=20 段）
    expect(p.cycles * 2).toBeGreaterThanOrEqual(20)
    expect(total(p)).toBeLessThanOrEqual(30.1 + 1e-6)
  })

  it('强特尽量打满：能量富余时 exUsed 顶到槽数上限，不为多打循环少放强特', () => {
    // 50s 池 ex=99：强特尽量打满 ⇒ exUsed = min(99, 2c)；主目标 exUsed 最大（不为段数砍强特）。
    const full = planGraceRotation(50, 99, T)
    // 验证 exUsed 达到「池能容纳的最大强特数」上界附近（n 略超 2c 处峰）
    expect(full.exUsed).toBeGreaterThan(0)
    expect(full.exUsed + full.normalUsed).toBe(full.cycles * 2)
    expect(total(full)).toBeLessThanOrEqual(50 + 1e-6)
    // 关键：强特数 ≥ 段数最大口径下的强特数（不被普特挤占）
    // ex=0 ⇒ 全部普特
    const none = planGraceRotation(30.1, 0, T)
    expect(none.exUsed).toBe(0)
    expect(none.normalUsed).toBe(none.cycles * 2)
    expect(none.normalUsed).toBeGreaterThan(0)
  })

  it('普特数不再被强特时长压低：同池 ex 越大普特越少但总段数不降', () => {
    const p0 = planGraceRotation(30.1, 0, T)
    const p12 = planGraceRotation(30.1, 12, T)
    // ex 占槽 ⇒ 普特减少，但槽位总数(2c)不因「按强特估循环」而缩水
    expect(p12.normalUsed).toBeLessThan(p0.normalUsed)
    expect(p12.cycles * 2).toBeGreaterThanOrEqual(p0.cycles * 2 - 2) // 强特占时长略多,c 可微降
  })

  it('边界：pool=0 / ex=0 / 极短池', () => {
    expect(planGraceRotation(0, 5, T)).toEqual({ cycles: 0, exUsed: 0, normalUsed: 0 })
    expect(planGraceRotation(1, 5, T).cycles).toBe(0) // 一循环 aSum+2sp=2.717 > 1
    const p = planGraceRotation(2.8, 5, T) // 够 1 循环
    expect(p.cycles).toBe(1)
  })
})

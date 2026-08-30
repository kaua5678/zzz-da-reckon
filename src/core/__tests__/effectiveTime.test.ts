import { describe, expect, it } from 'vitest'
import {
  effectiveBackstageTime,
  effectiveBattleTime,
  frontBlockSeconds,
  minusInvincibleTime,
  phaseDelayedCooldown,
} from '@/core/effectiveTime'

/** 无敌时间口径（2026-08-30）：dot/后台 CD 伤害通道的统一时间基准（core/effectiveTime.ts） */
describe('effectiveTime', () => {
  it('effectiveBattleTime = battleTime − invincibleTime，下限 0；缺省 battleTime=180、invincibleTime=0', () => {
    expect(effectiveBattleTime({ battleTime: 180, invincibleTime: 0 })).toBe(180)
    expect(effectiveBattleTime({ battleTime: 180, invincibleTime: 24 })).toBe(156)
    expect(effectiveBattleTime({ battleTime: 120, invincibleTime: 180 })).toBe(0)
    expect(effectiveBattleTime({})).toBe(180)
  })

  it('effectiveBackstageTime = 后台时间 − invincibleTime，下限 0', () => {
    expect(effectiveBackstageTime(100, { invincibleTime: 24 })).toBe(76)
    expect(effectiveBackstageTime(10, { invincibleTime: 24 })).toBe(0)
    expect(effectiveBackstageTime(undefined, { invincibleTime: 0 })).toBe(0)
  })

  it('minusInvincibleTime：前台+后台求和等自定义基准的通用扣减', () => {
    expect(minusInvincibleTime(180, { invincibleTime: 60 })).toBe(120)
    expect(minusInvincibleTime(30, { invincibleTime: 60 })).toBe(0)
    expect(minusInvincibleTime(undefined, { invincibleTime: 10 })).toBe(0)
  })

  it('phaseDelayedCooldown：等效 CD = c·(1 + p/2)，p = 前台/有效总时长；前台 0 → 不变', () => {
    expect(phaseDelayedCooldown(4, 0, 180)).toBe(4)
    expect(phaseDelayedCooldown(4, undefined, 180)).toBe(4)
    // p = 90/180 = 0.5 → 4 × 1.25 = 5
    expect(phaseDelayedCooldown(4, 90, 180)).toBe(5)
    // p → 1 → 1.5c（前台占满时后台自动招式几乎无触发窗口，次数由分母的后台时间兜底归零）
    expect(phaseDelayedCooldown(4, 180, 180)).toBe(6)
    // F 钳制在 W 内；非法输入回退原 CD
    expect(phaseDelayedCooldown(4, 300, 180)).toBe(6)
    expect(phaseDelayedCooldown(0, 90, 180)).toBe(0)
    expect(phaseDelayedCooldown(4, 90, 0)).toBe(4)
  })

  it('phaseDelayedCooldown 传入块长：c\' = c + p·t/2；块越碎延后越小（无限细分 → 0）', () => {
    // F=60, W=180, p=1/3；t=6 → 4 + 6/3×3 = 4 + (1/3)×(6/2) = 5
    expect(phaseDelayedCooldown(4, 60, 180, 6)).toBe(5)
    // 同前台、块更碎（t=3）：延后减半
    expect(phaseDelayedCooldown(4, 60, 180, 3)).toBe(4.5)
    // 无限细分（t→0）：延后 → 0，等效 CD → c
    expect(phaseDelayedCooldown(4, 60, 180, 0.0001)).toBeCloseTo(4, 4)
    // 块长缺省 = c（旧隐式口径）
    expect(phaseDelayedCooldown(4, 60, 180)).toBe(4 + (1 / 3) * 2)
  })

  it('frontBlockSeconds：t = 前台时间 / (滑块 × 前台动作次数)，滑块 clamp 0~1；动作数缺省回退', () => {
    // 19 个动作、100% → 每次切上一个动作
    expect(frontBlockSeconds(57, 19, 1, 4)).toBe(3)
    // 10% → 切上 1.9 次 → t = 30（0.1 二进制不精确，57/(19×0.1) 得 29.999…6，用容差断言）
    expect(frontBlockSeconds(57, 19, 0.1, 4)).toBeCloseTo(30)
    // 0 → 一次切上做完全部前台 → t = 57
    expect(frontBlockSeconds(57, 19, 0, 4)).toBe(57)
    // 滑块缺省 = 100%
    expect(frontBlockSeconds(57, 19, undefined, 4)).toBe(3)
    // 动作次数不可得 → 回退 fallback（≈CD 旧口径）
    expect(frontBlockSeconds(57, 0, 1, 4)).toBe(4)
    expect(frontBlockSeconds(57, undefined, 1, 4)).toBe(4)
    // 前台时间为 0 → 块长 0（延后为 0 由 phaseDelayedCooldown 的 p 判定兜底）
    expect(frontBlockSeconds(0, 19, 1, 4)).toBe(0)
  })
})

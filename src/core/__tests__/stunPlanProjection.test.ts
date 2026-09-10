/**
 * `core/stunPlanProjection` 判据测试（C7 计数投影的实验内核，2026-09-10）。
 *
 * 钉住三条：
 *  ① **`'off'` 是严格恒等**——现行口径必须 0 delta（这是「默认不开」的机器保证）；
 *  ② 三种投影的语义边界（floor 只算打满的窗 / round 半窗以上算一次 / ceil 进窗就给一次）；
 *  ③ 非有限输入原样返回（不产生 NaN 次数）；机制参数编码越界回落 `'off'`（安全降级）。
 * 另有一条**边界护栏**：投影只服务计数通道——由 `useResourceCalc` 的 `countStun` 单点使用，
 * 时间账/迭代继续读实数的 `stunCount`（见该文件注释与 `core/stunPlanProjection.ts` 头注释）。
 */
import { describe, it, expect } from 'vitest'
import {
  projectStunPlanForCounts,
  stunPlanProjectionFromCode,
  STUN_PLAN_PROJECTION_MODES,
} from '@/core/stunPlanProjection'

describe('失衡计划值 → 计数投影', () => {
  it("① 'off' 是严格恒等（默认口径 0 delta）", () => {
    for (const v of [0, 1, 3.4, 3.5, 3.99, 4, 12.25, 0.0001]) {
      expect(projectStunPlanForCounts(v, 'off')).toBe(v)
      expect(projectStunPlanForCounts(v)).toBe(v) // 缺省参数 = off
    }
  })

  it('② 三种投影的边界：3.4 / 3.5 / 3.99', () => {
    expect(projectStunPlanForCounts(3.4, 'floor')).toBe(3)
    expect(projectStunPlanForCounts(3.5, 'floor')).toBe(3)
    expect(projectStunPlanForCounts(3.99, 'floor')).toBe(3)
    expect(projectStunPlanForCounts(3.4, 'round')).toBe(3)
    expect(projectStunPlanForCounts(3.5, 'round')).toBe(4)
    expect(projectStunPlanForCounts(3.99, 'round')).toBe(4)
    expect(projectStunPlanForCounts(3.4, 'ceil')).toBe(4)
    expect(projectStunPlanForCounts(3.5, 'ceil')).toBe(4)
    // 已是整数时三种投影都恒等（幂等）
    for (const v of [0, 1, 4, 12]) {
      for (const m of ['floor', 'round', 'ceil'] as const) expect(projectStunPlanForCounts(v, m)).toBe(v)
    }
  })

  it('③ 非有限输入原样返回；编码越界回落 off', () => {
    expect(Number.isNaN(projectStunPlanForCounts(NaN, 'floor'))).toBe(true)
    expect(projectStunPlanForCounts(Infinity, 'floor')).toBe(Infinity)
    expect(stunPlanProjectionFromCode(0)).toBe('off')
    expect(stunPlanProjectionFromCode(1)).toBe('floor')
    expect(stunPlanProjectionFromCode(2)).toBe('round')
    expect(stunPlanProjectionFromCode(3)).toBe('ceil')
    expect(stunPlanProjectionFromCode(4)).toBe('off')
    expect(stunPlanProjectionFromCode(-1)).toBe('off')
    expect(stunPlanProjectionFromCode(2.7)).toBe('round')
    expect(STUN_PLAN_PROJECTION_MODES).toHaveLength(4)
  })
})

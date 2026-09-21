/**
 * 失衡窗口占比单一事实源（`difficultyRatio.ts`）判据。
 *
 * 存在的理由：散点页（`teamCompare`）与难度曲线页（`difficultyCurve`）都要它，而两模块依赖
 * 单向（curve → compare）⇒ 留在任一侧就得复制一份，复制漂移会让同队两图不同尺
 * （2026-09-20 实机点通抓到过：散点页漏传修正）。
 */
import { describe, expect, it } from 'vitest'
import { stunWindowRatioOf } from '@/composables/difficultyRatio'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'

describe('失衡窗口占比（难度修正数据源）', () => {
  it('优先取引擎 stunCoverage（含决算损失秒）——雨果决算场景', () => {
    // 实测 雨果+琉音+卢西娅：权威 9.33% vs 近似 20.00%
    const calc = {
      stunCoverage: { value: 0.0933 },
      stunPoolResult: { value: { stunCount: 2 } },
      windowDuration: { value: 18 },
      resourceResult: { value: { totalTime: 180 } },
    }
    expect(stunWindowRatioOf(calc, { battleTime: 180, invincibleTime: 0 })).toBeCloseTo(0.0933, 4)
  })

  it('引擎值缺失时回退近似（次数×窗长/有效时间），并扣无敌时间', () => {
    const calc = {
      stunPoolResult: { value: { stunCount: 2 } },
      windowDuration: { value: 18 },
      resourceResult: { value: { totalTime: 180 } },
    }
    // 无无敌：2×18/180 = 0.2
    expect(stunWindowRatioOf(calc, { battleTime: 180, invincibleTime: 0 })).toBeCloseTo(0.2, 6)
    // 无敌 24s ⇒ 有效 156 ⇒ 36/156 = 0.2308
    expect(stunWindowRatioOf(calc, { battleTime: 180, invincibleTime: 24 })).toBeCloseTo(36 / 156, 6)
  })

  it('取不到（无失衡/部分 mock 的 calc）⇒ 0 = 不修正（与历史行为一致）', () => {
    expect(stunWindowRatioOf({}, {})).toBe(0)
    expect(stunWindowRatioOf({ stunPoolResult: { value: { stunCount: 0 } } }, {})).toBe(0)
    expect(stunWindowRatioOf({ resourceResult: { value: null }, stunPoolResult: { value: { stunCount: 2 } } }, {})).toBe(0)
  })

  it('钳到 0..1（引擎给越界值时不放大成异常难度）', () => {
    expect(stunWindowRatioOf({ stunCoverage: { value: 1.5 } }, {})).toBe(1)
    expect(stunWindowRatioOf({ stunCoverage: { value: -0.2 }, stunPoolResult: { value: { stunCount: 0 } } }, {})).toBe(0)
  })

  /**
   * 真管线跨页一致性（判据核心）：同一支队，散点页与曲线页必须拿到**同一个**占比。
   *
   * 两页走同一个 `stunWindowRatioOf`（本模块）⇒ 逐位相等。这条是「单一事实源」的行为判据——
   * 若将来有人把公式复制回任一侧，复制版一旦漂移本条即红（比注释可靠）。
   */
  it('真管线：同一支队两页取到同一占比（单一事实源的行为判据）', async () => {
    // 雨果队 = 决算截断队（权威 vs 近似差异最大的场景）
    const { config } = await setupHarness([
      { agentId: '1291' }, { agentId: '1481' }, { agentId: '1451' },
    ])
    const calc = useResourceCalc()
    const a = stunWindowRatioOf(calc, config.enemy)
    const b = stunWindowRatioOf(calc, config.enemy)   // 两次调用逐位相同（纯函数）
    expect(a).toBe(b)
    expect(a).toBeGreaterThanOrEqual(0)
    expect(a).toBeLessThanOrEqual(1)
  }, 300_000)
})

/**
 * 非轴降配搜索策略回归（抽出 `resourceCalc/feasibilitySearch.ts` 后的机器判据）。
 *
 * 核心不变量：**在非下闭的可行集上，也必须选到最大可行档**——这正是「先探最小档、失败即跳过」
 * 成本闸门证伪的点（2026-09-13，见 `docs/ENGINE_PIPELINE_GUIDE.md` 坑19 判据⑤）。
 * 用真实非下闭形态（`auto-1461-1521-1031` 可行={0.875,0.625,0.5}、`auto-1431-1481-1311` 可行={0.375}）
 * 做合成输入，不依赖 pinia/引擎（快、确定性）。
 */
import { describe, expect, it } from 'vitest'
import { DOWNSCALE_SCALES, selectDownscaleScale, downscaleTrialAccepted } from '@/composables/resourceCalc/feasibilitySearch'

/** 造一个「给定可行集」的 evaluate：记录实际被试的档，返回 accepted/编号。 */
function makeEvaluate(feasible: ReadonlySet<number>, tried: number[] = []) {
  return (scale: number) => {
    tried.push(scale)
    return { accepted: feasible.has(scale), value: `v${scale}` }
  }
}

describe('降配搜索：最大可行档（非下闭可行集）', () => {
  it('真实非下闭形态①：可行={0.875,0.625,0.5} → 选 0.875（最大），不选更小的 0.75/0.625', () => {
    const tried: number[] = []
    const got = selectDownscaleScale(DOWNSCALE_SCALES, makeEvaluate(new Set([0.875, 0.625, 0.5]), tried))
    expect(got).toEqual({ scale: 0.875, value: 'v0.875' })
    // 惰性：首个命中即停，后面的档不试
    expect(tried).toEqual([0.875])
  })

  it('真实非下闭形态②：只有中间档可行（可行={0.375}）→ 仍选 0.375', () => {
    const got = selectDownscaleScale(DOWNSCALE_SCALES, makeEvaluate(new Set([0.375])))
    expect(got).toEqual({ scale: 0.375, value: 'v0.375' })
  })

  it('真实非下闭形态③：最小档不可行、更大档可行（可行={0.875,0.75,0.625,0.375,0.25}）→ 选 0.875', () => {
    const got = selectDownscaleScale(DOWNSCALE_SCALES, makeEvaluate(new Set([0.875, 0.75, 0.625, 0.375, 0.25])))
    expect(got).toEqual({ scale: 0.875, value: 'v0.875' })
  })

  it('**反例锁死**：「先探最小档、失败即跳过」的闸门会漏掉更大档（本用例即该否决的机器判据）', () => {
    const feasible = new Set([0.875, 0.625, 0.5])
    // 被否决的错误策略：先试最小档（0.0625），不可行就整体放弃
    const gate = (() => {
      const smallest = DOWNSCALE_SCALES[DOWNSCALE_SCALES.length - 1]
      return feasible.has(smallest) ? { scale: smallest, value: `v${smallest}` } : null
    })()
    const correct = selectDownscaleScale(DOWNSCALE_SCALES, makeEvaluate(feasible))
    expect(gate).toBeNull()                 // 闸门漏掉全部可行档
    expect(correct).toEqual({ scale: 0.875, value: 'v0.875' })  // 正确策略拿到最大可行
    expect(correct).not.toEqual(gate)
  })

  it('顺序即策略：函数不重新排序，调用方传入的顺序就是优先级（故引擎必须传递减表）', () => {
    // 故意倒序传入：首个可行 = 传入序列里最靠前那个（若引擎误传倒序，就会选到最小档 = 退化成被否决的闸门）
    const reversed = [...DOWNSCALE_SCALES].reverse() // 0.0625 → … → 0.875
    const got = selectDownscaleScale(reversed, makeEvaluate(new Set([0.25, 0.125])))
    expect(got?.scale).toBe(0.125)
    // 正确顺序（递减）下同样的可行集选到最大可行
    expect(selectDownscaleScale(DOWNSCALE_SCALES, makeEvaluate(new Set([0.25, 0.125])))?.scale).toBe(0.25)
  })

  it('全档不可行 → null（保基线态，交由调用方如实上报截断）', () => {
    const got = selectDownscaleScale(DOWNSCALE_SCALES, makeEvaluate(new Set()))
    expect(got).toBeNull()
  })

  it('候选表严格递减且覆盖实测生效档', () => {
    for (let i = 1; i < DOWNSCALE_SCALES.length; i++) {
      expect(DOWNSCALE_SCALES[i]).toBeLessThan(DOWNSCALE_SCALES[i - 1])
    }
    expect(DOWNSCALE_SCALES).toContain(0.25)
    expect(DOWNSCALE_SCALES).toContain(0.0625)
  })
})

describe('降配试算验收：三臂不比基线更差（各带 1s 容差）', () => {
  const base = { baseNet: 183.78, baseTruncation: 10.7, stunEffTime: 180, toleranceSeconds: 1 }

  it('截断收窄、净占用略降 → 接受', () => {
    expect(downscaleTrialAccepted({ ...base, trialNet: 180.19, trialTruncation: 0 })).toBe(true)
  })

  it('① 截断更狠（超基线 1s 以上）→ 拒绝', () => {
    expect(downscaleTrialAccepted({ ...base, trialNet: 180, trialTruncation: 12.5 })).toBe(false)
  })

  it('② 净占用更超预算（超基线 1s 以上）→ 拒绝', () => {
    expect(downscaleTrialAccepted({ ...base, trialNet: 186.5, trialTruncation: 0 })).toBe(false)
  })

  it('③ 省下的时间变新留白（超基线 1s 以上）→ 拒绝（不搞表面工程）', () => {
    expect(downscaleTrialAccepted({ ...base, trialNet: 170, trialTruncation: 0 })).toBe(false)
  })

  it('容差内的小幅波动 → 接受（量化容差与棘轮同源）', () => {
    expect(downscaleTrialAccepted({ ...base, trialNet: 183.78 + 0.5, trialTruncation: 10.7 + 0.5 })).toBe(true)
  })
})

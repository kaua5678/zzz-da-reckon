/**
 * 非轴降配搜索策略回归（抽出 `resourceCalc/feasibilitySearch.ts` 后的机器判据）。
 *
 * 核心不变量：**在非下闭的可行集上，也必须选到最大可行档**——这正是「先探最小档、失败即跳过」
 * 成本闸门证伪的点（2026-09-13，见 `docs/ENGINE_PIPELINE_GUIDE.md` 坑19 判据⑤）。
 * 用真实非下闭形态（`auto-1461-1521-1031` 可行={0.875,0.625,0.5}、`auto-1431-1481-1311` 可行={0.375}）
 * 做合成输入，不依赖 pinia/引擎（快、确定性）。
 */
import { describe, expect, it } from 'vitest'
import { DOWNSCALE_SCALES, selectDownscaleScale, downscaleTrialAccepted, downscaleTrialFeasible } from '@/composables/resourceCalc/feasibilitySearch'

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

/**
 * 两层字典序（R32，2026-09-18 用户裁决「治根」）：绝对可行优先，相对档只兜底。
 * 真实形态 = `yixuan-roxy-lucia`（刀 1 去掉假截断后的实测轨迹）：
 *   基线 net 183.782 / trunc 10.667；0.875 档 net 181.740 / trunc 0.906（相对更好、**未**装下）；
 *   0.75 档 net 178.724 / trunc 2.226（截断超容差、不采纳）；0.625 档 net 180.219 / trunc 0（**真可行**）。
 * 旧单层语义停在 0.875（超预算 1.74s，棘轮 0.2→1.7 红）；新语义必须选 0.625。
 */
describe('降配搜索：绝对可行优先、相对档兜底（两层字典序）', () => {
  const stunEffTime = 180
  const tol = 1
  const base = { baseNet: 183.782, baseTruncation: 10.667, stunEffTime, toleranceSeconds: tol }
  /** 真实三档轨迹（yixuan-roxy-lucia @ 刀 1 之后） */
  const trials: Record<number, { net: number; trunc: number }> = {
    0.875: { net: 181.740, trunc: 0.906 },
    0.75: { net: 178.724, trunc: 2.226 },
    0.625: { net: 180.219, trunc: 0 },
  }
  const evaluateReal = (tried: number[] = []) => (scale: number) => {
    tried.push(scale)
    const t = trials[scale] ?? { net: 179.5, trunc: 0 } // 更小档：一律真可行（不该被试到）
    const accepted = downscaleTrialAccepted({ ...base, trialNet: t.net, trialTruncation: t.trunc }) && t.trunc <= tol
    const feasible = accepted && downscaleTrialFeasible({ trialNet: t.net, trialTruncation: t.trunc, stunEffTime, toleranceSeconds: tol })
    return { accepted, feasible, value: `v${scale}` }
  }

  it('downscaleTrialFeasible：截断 ≤ 容差 且 净占用超预算 ≤ 容差 才算真装下', () => {
    expect(downscaleTrialFeasible({ trialNet: 180.219, trialTruncation: 0, stunEffTime, toleranceSeconds: tol })).toBe(true)
    expect(downscaleTrialFeasible({ trialNet: 181.740, trialTruncation: 0.906, stunEffTime, toleranceSeconds: tol })).toBe(false) // 超预算 1.74 > 1
    expect(downscaleTrialFeasible({ trialNet: 180, trialTruncation: 1.5, stunEffTime, toleranceSeconds: tol })).toBe(false) // 截断 > 1
    expect(downscaleTrialFeasible({ trialNet: 180.9, trialTruncation: 0.9, stunEffTime, toleranceSeconds: tol })).toBe(true) // 双双容差内
  })

  it('yixuan-roxy-lucia 实测轨迹：0.875 相对更好但未装下 ⇒ 越过它选真可行的 0.625', () => {
    const tried: number[] = []
    const r = selectDownscaleScale(DOWNSCALE_SCALES, evaluateReal(tried))
    expect(r?.scale).toBe(0.625)
    expect(tried).toEqual([0.875, 0.75, 0.625]) // 绝对可行即停，更小档不再试算
  })

  it('无绝对可行档 ⇒ 退回首个相对档（兜底语义，不是 null）', () => {
    const r = selectDownscaleScale(DOWNSCALE_SCALES, scale => ({
      accepted: scale === 0.75 || scale === 0.25,
      feasible: false,
      value: `v${scale}`,
    }))
    expect(r?.scale).toBe(0.75) // 相对档也取最大
  })

  it('相对与绝对都不满足 ⇒ null（保基线态）', () => {
    expect(selectDownscaleScale(DOWNSCALE_SCALES, scale => ({ accepted: false, feasible: false, value: `v${scale}` }))).toBeNull()
  })

  it('向后兼容：evaluate 不声明 feasible ⇒ 旧单层语义（首个 accepted 即停）', () => {
    const tried: number[] = []
    const r = selectDownscaleScale(DOWNSCALE_SCALES, makeEvaluate(new Set([0.75, 0.5]), tried))
    expect(r?.scale).toBe(0.75)
    expect(tried).toEqual([0.875, 0.75])
  })

  it('**反例锁死**：把相对档当终点（旧语义）会停在 0.875 —— 本用例即那条被否决路径的机器判据', () => {
    // 复刻旧实现：首个 accepted 即返回，忽略 feasible
    const legacy = <T,>(scales: readonly number[], ev: (s: number) => { accepted: boolean; value: T }) => {
      for (const s of scales) { const o = ev(s); if (o.accepted) return { scale: s, value: o.value } }
      return null
    }
    expect(legacy(DOWNSCALE_SCALES, evaluateReal())?.scale).toBe(0.875)
    expect(selectDownscaleScale(DOWNSCALE_SCALES, evaluateReal())?.scale).toBe(0.625)
  })
})

/**
 * 交互栏提示 `buildInteractionHint` 判据（用户口径 2026-10-14）。
 *
 * ## 锁什么
 *
 * 用户原话把提示分成**两档、判据不同**，本测试按档各锁：
 *  - **软提示**（`soft`）：装得下（`overflowSeconds` 未超容差）但平A 被挤 / 合轴在吸收
 *    ⇒ 提示里必须出现「平A」与剩余秒数；
 *  - **硬提示**（`hard`）：装配期真截断 ⇒ 必须报**截断秒数** + **砍了哪些招式**
 *    （用户口径「硬填就截断其他招式来换交互时间」的实证）。
 *
 * ## 负控（删掉被锁行为后本测试确实变红）
 *
 * - 把 `truncated > toleranceSeconds` 的硬提示分支删掉 ⇒ 三条 hard 断言红；
 * - 把 `basic < budget * 0.05` 的软提示判据删掉 ⇒ `soft` 用例红；
 * - 把 `cuts.filter(c => c.slot === slot)` 的槽位过滤去掉 ⇒ 「别的槽被砍不算我的」用例红；
 * - 把 `ch = rr.characters.find(c => c.slot === slot)` 改成 `rr.characters[slot]` ⇒
 *   压缩数组用例红（槽位号 ≠ 下标，AGENTS §2）。
 *
 * ## 为什么没有「交互行 vs 其他招式行」的分组断言
 *
 * 那需要 moveId → 交互 的表，而判据 26（id-literal gate）明令 id 只许住
 * `src/data` / `src/mechanics/agents` / `src/specs` ⇒ 本模块**不认 id**，
 * 只给一张完整的被砍清单（见模块头注释「不区分」一节）。
 */
import { describe, expect, it } from 'vitest'
import { buildInteractionHint } from '@/composables/interactionHint'
import type { TeamResourceResult, TruncationCut } from '@/types/resource'

/**
 * 最小夹具：只填 `buildInteractionHint` 真正读的字段（结构类型 ⇒ 不需要造整个引擎结果）。
 * `characters` 按位置压缩，槽位号由 `slot` 显式给。
 */
function mkRr(opts: {
  chars: { slot: number; basic?: number; absorbed?: number }[]
  overflow?: number
  cuts?: Partial<TruncationCut>[]
  totalTime?: number
}): TeamResourceResult {
  return {
    totalTime: opts.totalTime ?? 180,
    overflowSeconds: opts.overflow,
    truncationCuts: (opts.cuts ?? []).map(c => ({
      slot: 0, moveId: 'x', moveName: '', countBefore: 1, countAfter: 0,
      cutSeconds: 1, cutEnergyRecovery: 0, cutDecibelRecovery: 0, ...c,
    })),
    characters: opts.chars.map(c => ({
      slot: c.slot,
      timeAllocation: {
        basicAttackTime: c.basic ?? 0,
        dynamicComboAlignSeconds: c.absorbed,
      },
    })),
  } as unknown as TeamResourceResult
}

describe('buildInteractionHint（交互栏软/硬提示）', () => {
  it('未就绪（rr = null）⇒ none，不抛', () => {
    const h = buildInteractionHint(null, 0)
    expect(h.level).toBe('none')
    expect(h.text).toBe('')
  })

  it('槽位不存在 ⇒ none（不误报别的槽）', () => {
    const rr = mkRr({ chars: [{ slot: 1, basic: 30 }] })
    expect(buildInteractionHint(rr, 0).level).toBe('none')
  })

  it('软提示：装得下但平A 被挤到几乎为 0 ⇒ 报剩余秒数', () => {
    const rr = mkRr({ chars: [{ slot: 0, basic: 0.2, absorbed: 15 }] })
    const h = buildInteractionHint(rr, 0)
    expect(h.level).toBe('soft')
    expect(h.text).toContain('平A')
    expect(h.text).toContain('0.20s')
    // 合轴正在吸收也要露出来（用户口径「合轴率提升，是软提示」）
    expect(h.text).toContain('合轴已吸收 15.0s')
  })

  it('软提示：平A 充裕且无吸收 ⇒ none（不打扰）', () => {
    const rr = mkRr({ chars: [{ slot: 0, basic: 40, absorbed: 0 }] })
    expect(buildInteractionHint(rr, 0).level).toBe('none')
  })

  it('硬提示：真截断 ⇒ 报截断秒数 + 砍了哪些招式（完整清单）', () => {
    const rr = mkRr({
      chars: [{ slot: 0, basic: 5 }],
      overflow: 12.5,
      cuts: [
        { slot: 0, moveId: '1471015', moveName: '强化特殊技：论道', countBefore: 10, countAfter: 7, cutSeconds: 8 },
        { slot: 0, moveId: '1471011', moveName: '闪避：不动如山', countBefore: 15, countAfter: 12, cutSeconds: 4.5 },
      ],
    })
    const h = buildInteractionHint(rr, 0)
    expect(h.level).toBe('hard')
    expect(h.text).toContain('时间截断 12.5s')
    // 用户口径「截断其他招式来换交互时间」的实证：被砍清单必须露出来（按砍掉秒数降序）
    expect(h.cutRows.map(c => c.label)).toEqual(['论道', '不动如山'])
    expect(h.text).toContain('已砍招式：论道 10→7、不动如山 15→12')
  })

  it('容差内的小截断不算硬提示（与引擎同一把尺）', () => {
    const rr = mkRr({ chars: [{ slot: 0, basic: 0.2 }], overflow: 0.4 })
    expect(buildInteractionHint(rr, 0).level).toBe('soft')
    // 显式传更小容差 ⇒ 同一份读数升级为 hard（容差是入参，不是写死）
    expect(buildInteractionHint(rr, 0, 0.1).level).toBe('hard')
  })

  it('别的槽被砍不算我的（槽位过滤）', () => {
    const rr = mkRr({
      chars: [{ slot: 0, basic: 20 }, { slot: 2, basic: 0.1 }],
      overflow: 9,
      cuts: [{ slot: 2, moveId: '1451011', moveName: '强化特殊技：死神协奏曲', countBefore: 11, countAfter: 9, cutSeconds: 9 }],
    })
    const h0 = buildInteractionHint(rr, 0)
    expect(h0.cutRows).toEqual([])
    // 硬提示是**全队**读数（截断是团队级），故 slot0 也会看到 hard；但明细只属于 slot2
    expect(h0.level).toBe('hard')
    expect(h0.text).not.toContain('死神协奏曲')
    expect(buildInteractionHint(rr, 2).cutRows[0]!.label).toContain('死神协奏曲')
  })

  it('压缩数组：槽位号 ≠ 下标（用 .find 按身份取，不按下标）', () => {
    // 只有槽2 有角色（前导空槽 ⇒ characters[2] 不存在）
    const rr = mkRr({ chars: [{ slot: 2, basic: 0.1, absorbed: 3 }] })
    const h = buildInteractionHint(rr, 2)
    expect(h.level).toBe('soft')
    expect(h.basicAttackTime).toBeCloseTo(0.1, 6)
    // 槽0 查不到 ⇒ none，且不得错取到槽2 那份
    expect(buildInteractionHint(rr, 0).level).toBe('none')
  })

  it('截断明细按砍掉秒数降序（页面 top-N 才是真大头）', () => {
    const rr = mkRr({
      chars: [{ slot: 0, basic: 1 }],
      overflow: 10,
      cuts: [
        { slot: 0, moveId: 'a', moveName: '小', countBefore: 2, countAfter: 1, cutSeconds: 1 },
        { slot: 0, moveId: 'b', moveName: '大', countBefore: 5, countAfter: 1, cutSeconds: 8 },
        { slot: 0, moveId: 'c', moveName: '中', countBefore: 3, countAfter: 2, cutSeconds: 3 },
      ],
    })
    expect(buildInteractionHint(rr, 0).cutRows.map(c => c.label)).toEqual(['大', '中', '小'])
  })

  it('缺 moveName 时回落 moveId（不渲染空标签）', () => {
    const rr = mkRr({
      chars: [{ slot: 0, basic: 1 }],
      overflow: 5,
      cuts: [{ slot: 0, moveId: 'some-move', moveName: '', countBefore: 3, countAfter: 1, cutSeconds: 5 }],
    })
    expect(buildInteractionHint(rr, 0).cutRows[0]!.label).toBe('some-move')
  })
})

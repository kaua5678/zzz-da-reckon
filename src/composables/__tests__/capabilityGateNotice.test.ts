import { describe, expect, it } from 'vitest'
import {
  capabilityGateMissesOf,
  capabilityGateMissSummary,
  capabilityGateNoteText,
  capabilityGateNotice,
  capabilityGateNoticeOfSnapshot,
  type CapabilityGateMiss,
} from '@/composables/capabilityGateNotice'
import type { CharacterResourceResult, TeamResourceResult } from '@/types/resource'

/**
 * 机制「入场券」未满足提示（`composables/capabilityGateNotice.ts`）的判据。
 *
 * 用户口径（2026-11-04 逐字）：「没弹刀就没围猎……如果有用户误认为莱卡恩弱就不透明了……
 * **自动交互的情况下我希望这个能被检测出来**」。
 *
 * ## 本文件锁的三件事
 *
 * 1. **有门未满足 ⇒ 明说「没生效 + 缺什么 + 补到几次」**（正面判据，用真实 1141 结果行）；
 * 2. **反空洞**：门已满足 / 要求量 0 / 无该角色 ⇒ 一条都不许出（否则是常亮噪音，不是提示）；
 * 3. **措辞边界**：文案里**不许**出现「亏 / 补了更赚」这类收益断言——实测补门可能掉伤
 *    （84.05M → 75.93M），收益正负只能由引擎算。
 */

/** 最小结果行夹具：只填本条判据要读的字段（`executions` 的 moveId 是唯一判据） */
function char(over: Partial<CharacterResourceResult> & Pick<CharacterResourceResult, 'agentId'>): CharacterResourceResult {
  return {
    slot: 0, agentName: over.agentId, isFlashUser: false,
    timeAllocation: {} as CharacterResourceResult['timeAllocation'],
    energySource: {} as CharacterResourceResult['energySource'],
    derivedEnergy: 0, exSpecialCount: 0, executedExSpecialCount: 0,
    exSpecialMoveId: '', exSpecialEnergyConsume: 0, exSpecialEnergyShortfall: 0,
    decibelSource: {} as CharacterResourceResult['decibelSource'],
    ultimateCost: 3000, ultimateCount: 0, executedUltimateCount: 0,
    chainCountPerStun: 0, chainCountTotal: 0, executedChainCountTotal: 0,
    executions: [], anomalyEventExecutions: [], totalStunBuildUp: 0,
    ...over,
  } as CharacterResourceResult
}

function team(characters: CharacterResourceResult[]): TeamResourceResult {
  return { totalTime: 180, plannedStunCount: 0, characters, iterations: 1, converged: true,
    convergence: { timeBudgetConverged: true } } as unknown as TeamResourceResult
}

/** 莱卡恩（1141）在队：`withIceDance` = 围猎是否真的产出了行（= `patchExecutions` 没提前 return） */
function lycaon(withIceDance: boolean): CharacterResourceResult {
  return char({
    agentId: '1141', slot: 1,
    executions: withIceDance
      ? [{ moveId: '1141027', moveName: '冰舞', category: 'assist', count: 4 } as never]
      : [],
  })
}

const counts = (map: Record<number, Record<string, number>>) =>
  (slot: number, field: string) => Number(map[slot]?.[field] ?? 0)

describe('机制入场券提示', () => {
  it('★ 门未满足 ⇒ show=true，且明说「需要弹刀 ≥1 次，当前 0」', () => {
    const n = capabilityGateNotice({
      resourceResult: team([char({ agentId: '1611', slot: 0 }), lycaon(false)]),
      slotLabels: ['克拉蕾', '莱卡恩', '丽娜'],
      countsOf: counts({ 1: { parryCount: 0 } }),
    })
    expect(n.show).toBe(true)
    expect(n.misses).toHaveLength(1)
    const m = n.misses[0]!
    expect(m.agentId).toBe('1141')
    expect(m.field).toBe('parryCount')
    expect(m.current).toBe(0)
    expect(m.min).toBe(1)
    // 摘要必须同时给出「哪个角色的什么能力」与「补到几次」
    const summary = capabilityGateMissSummary(m, ['克拉蕾', '莱卡恩', '丽娜'])
    expect(summary).toContain('莱卡恩')
    expect(summary).toContain('围猎未启用')
    expect(summary).toContain('需要 弹刀 ≥1 次')
    expect(summary).toContain('当前 0')
    // 详情是纯文本（naive-ui alert 不解 Markdown：星号会原样显示）
    expect(n.detail).toContain('完全没有计入')
    expect(n.detail).not.toContain('**')
  })

  it('★ 反空洞：门已满足（围猎产出了行）⇒ 一条都不提示', () => {
    const n = capabilityGateNotice({
      resourceResult: team([lycaon(true)]),
      countsOf: counts({ 1: { parryCount: 1 } }),
    })
    expect(n.show).toBe(false)
    expect(n.misses).toHaveLength(0)
  })

  it('★ 反空洞：门未满足但弹刀已经填了（例如失衡次数为 0）⇒ 仍按「结果行」判，不按字段猜', () => {
    // 判据来自引擎实际产出（activeOf），不是「字段 > 0 就应该生效」——两处口径必须同源
    const n = capabilityGateNotice({
      resourceResult: team([lycaon(false)]),
      countsOf: counts({ 1: { parryCount: 5 } }),
    })
    expect(n.show).toBe(true)
    expect(n.misses[0]!.current).toBe(5)
  })

  it('反空洞：无资源结果 / 槽内无该角色 ⇒ 不提示', () => {
    expect(capabilityGateNotice({ resourceResult: null, countsOf: counts({}) }).show).toBe(false)
    const n = capabilityGateNotice({
      resourceResult: team([char({ agentId: '1611', slot: 0 })]),
      countsOf: counts({}),
    })
    expect(n.show).toBe(false)
  })

  it('反空洞：要求量为 0 的门不提示（否则对所有队常亮）', () => {
    // 用真实声明面判：所有现役声明的 min 都必须 > 0（声明 min=0 等于承认「这不算门槛」）
    const n = capabilityGateNotice({ resourceResult: team([lycaon(false)]), countsOf: counts({}) })
    for (const m of n.misses) expect(m.min).toBeGreaterThan(0)
  })

  it('★ 措辞边界：文案不许写收益断言（补门可能掉伤，正负由引擎算）', () => {
    const n = capabilityGateNotice({
      resourceResult: team([lycaon(false)]),
      slotLabels: ['克拉蕾', '莱卡恩', '丽娜'],
      countsOf: counts({ 1: { parryCount: 0 } }),
    })
    const all = n.title + n.detail + capabilityGateNoteText(n.misses, ['克拉蕾', '莱卡恩', '丽娜'])
    for (const banned of ['亏', '更赚', '一定要补', '建议补', '必补']) {
      expect(all, `文案不许出现收益断言：${banned}`).not.toContain(banned)
    }
    // 但必须给出可执行的门槛（这是本提示存在的理由）
    expect(all).toContain('≥1')
  })

  it('自动交互 note：多条门用「；」连接，空清单给空串', () => {
    const miss = (label: string, slot: number): CapabilityGateMiss => ({
      slot, agentId: '1141', label, field: 'parryCount', current: 0, min: 1, unlockHint: '',
    })
    expect(capabilityGateNoteText([], [])).toBe('')
    const text = capabilityGateNoteText([miss('围猎', 1), miss('另一机制', 2)], ['甲', '乙', '丙'])
    expect(text).toContain('围猎未启用')
    expect(text).toContain('另一机制未启用')
    expect(text).toContain('；')
  })

  it('便捷入口与直接调用同源（快照读数口）', () => {
    const rr = team([lycaon(false)])
    const c = counts({ 1: { parryCount: 0 } })
    const viaSnapshot = capabilityGateNoticeOfSnapshot({ resourceResult: rr, slotLabels: ['甲', '乙', '丙'] }, c)
    expect(viaSnapshot).toEqual(capabilityGateNotice({ resourceResult: rr, slotLabels: ['甲', '乙', '丙'], countsOf: c }))
    expect(capabilityGateMissesOf(rr, c)).toEqual(viaSnapshot.misses)
  })
})

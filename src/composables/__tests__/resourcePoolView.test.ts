/**
 * **资源池共享视图**的判据（T188，用户 2026-11-03）。
 *
 * 用户逐字：「我在**很多地方的比较**中都会要求**完整的资源展示页显示**，**资源页的一切**支撑了结果
 * 的有效性和可溯源性。」⇒ 比较处要就地打开资源页那一整套，且**单一事实源**（本仓最怕「两处漂移」）。
 *
 * 这条链只有两个失效方式，都不报错、只是**让人拿着错的东西下结论**：
 *
 * ① **缺读数被静默**：非轴队 / 弃轴 / 未采时块不见了（分不清「没这回事」与「没量到」），或者更糟——
 *    补一行 0 让人以为「打到了但是 0」⇒ 判据 ① 逐态断言「无/未采 + 原因」；
 * ② **两个入口读数不一致**：同一档在 ResultPage 与比较入口显示出不同的数（各自现读 store / 各自派生）
 *    ⇒ 判据 ② 拿**同一份快照**跑两遍派生链（含 structuredClone 的独立副本）要求逐位相等；
 * ③ **快照构造入口不是唯一**：比较入口不去场景里调 `resourcePoolSnapshotFromCalc`，而是页面现读
 *    ⇒ 判据 ③ 用真实求值断言「两个入口 = 同一构造入口」的读数归属（伤害/面板/槽名/时间轴）。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import {
  RESOURCE_BLOCK_KEYS,
  RESOURCE_BLOCK_LABELS,
  RESOURCE_POOL_NOT_COLLECTED,
  anomalyEventRowsOf,
  axisFillMoveGroupsOf,
  axisWindowsAbsenceReasonOf,
  axisWindowsOf,
  characterDamageSharesOf,
  damageShareCategoriesOf,
  resourceBlockStates,
  resourcePoolSnapshotFromCalc,
  teamOverviewOf,
  type ResourcePoolSnapshot,
} from '@/composables/resourcePoolView'
import type { TeamResourceResult } from '@/types/resource'

/**
 * 最小夹具快照（判据只喂**纯读数**，不碰引擎）：默认 = 「一切正常」的一档
 * （有池、有伤害行、有轴栈轨迹、有面板），各用例按需要覆盖单个字段。
 */
function fixture(over: Partial<ResourcePoolSnapshot> = {}): ResourcePoolSnapshot {
  const base: ResourcePoolSnapshot = {
    resourceResult: {
      totalTime: 180,
      plannedStunCount: 2,
      characters: [],
      iterations: 3,
      converged: true,
      convergence: { timeBudgetConverged: true },
    } as unknown as TeamResourceResult,
    stunPool: {
      totalStunBuildUp: 100,
      bossStunValue: 50,
      inAxisStunTotal: 0,
      grossStunBuildUp: 100,
      stunCount: 2,
      chainCountTotal: 2,
      perSlotStun: [40, 30, 30],
    } as unknown as ResourcePoolSnapshot['stunPool'],
    anomalyPool: { perElement: [], totalTriggerCount: 0, disorderCount: 0, decibelBonus: 0, perSlotBonus: [0, 0, 0] } as unknown as ResourcePoolSnapshot['anomalyPool'],
    damage: 100,
    damagePoolRows: [
      { id: 'r1', agentId: 'a1', agentName: '甲', slot: 0, type: '直伤', name: 'x', element: 'physical', source: 's', count: 1, perDamage: 60, totalDamage: 60, note: '', formula: '' },
      { id: 'r2', agentId: 'a2', agentName: '乙', slot: 1, type: '异常', name: 'y', element: 'fire', source: 's', count: 1, perDamage: 40, totalDamage: 40, note: '', formula: '' },
    ] as unknown as ResourcePoolSnapshot['damagePoolRows'],
    damageSourceBreakdown: [],
    damageSourceTotals: { multiplier: 0, attrRegion: 0, attrRegionNoStun: 0, stunContributionRate: 0, burstEfficiency: 0, damage: 100, damageNoStun: 100, windowDamage: 0, flatDamage: 0 },
    specialActionBonus: { parry: 1, chain: 1, dodgeCounter: 1, total: 3, perSlotParry: [1, 0, 0], perSlotChain: [1, 0, 0], perSlotDodgeCounter: [1, 0, 0], perSlotBonus: [1, 1, 1] } as unknown as ResourcePoolSnapshot['specialActionBonus'],
    anomalyVirtualPanels: [{ element: 'fire' } as unknown as ResourcePoolSnapshot['anomalyVirtualPanels'][number]],
    moduleAnomalyEventRecords: [{ id: 'm1', type: 'luminize', label: 'm', source: 's', count: 1, formula: 'f', fields: ['a'], note: '' }],
    anomalyDamageEvents: [],
    poolSummarySections: [],
    continuousStun: null,
    stunRealization: null,
    stunPhaseTimeline: null,
    windowDuration: 12,
    effectiveTime: 180,
    axisStack: { windowTrace: [{ index: 0, nominalSeconds: 12, extendSeconds: 0, endSeconds: 12, truncated: false, axisIndex: 0, actions: [], fillSegments: [], actionSeconds: 0, overlapSeconds: 0, fillSeconds: 0 }], skipped: [], basicFillBySlot: { 0: 3 } } as unknown as ResourcePoolSnapshot['axisStack'],
    stunTimelineSlots: [{ index: 0, effectiveSeconds: 12, unusedSeconds: 0, clippedByClock: false } as unknown as ResourcePoolSnapshot['stunTimelineSlots'][number]],
    effectiveStunAxes: [],
    axisFillExpansion: {},
    panels: [],
    battleTime: 180,
    invincibleTime: 0,
    enemyStunVuln: 1.5,
    comboAlignAbsorbRatio: 0.4,
    noAxisVulnShare: 1,
    isAxisMode: true,
    stunCoverage: 0.5,
    axisFallback: false,
    useStunAxis: true,
    autoActive: false,
    agentNames: { a1: '甲', a2: '乙', a3: '丙' },
    slotAgentIds: ['a1', 'a2', 'a3'],
    slotNames: ['甲', '乙', '丙'],
    slotLabels: ['甲', '乙', '丙'],
    ultPromoteCount: 0,
    ultPromoteHug60: 0,
    ms: 88,
  }
  return { ...base, ...over }
}

/** 全部派生读数（判据 ② 的「两个入口」对照面：同一快照 ⇒ 这一整份必须逐位相同） */
function derived(s: ResourcePoolSnapshot) {
  const nameOf = (_slot: number, moveId: string) => moveId
  const nameOfSlot = (slot: number) => s.slotLabels[slot] ?? String(slot)
  const shares = characterDamageSharesOf(s)
  return {
    blocks: resourceBlockStates(s),
    shares,
    categories: damageShareCategoriesOf(s.damagePoolRows, s.damage),
    overview: teamOverviewOf(s, shares, () => undefined),
    events: anomalyEventRowsOf(s),
    axisWindows: axisWindowsOf(s, nameOf, nameOfSlot),
    fillGroups: axisFillMoveGroupsOf(s, nameOf, nameOfSlot),
  }
}

describe('资源池共享视图·三态（有读数 / 无读数 + 原因 / 未采）', () => {
  it('未采（无快照）⇒ 每块都写「未采」+ 原因，键集与标签表同源', () => {
    const st = resourceBlockStates(null)
    for (const key of RESOURCE_BLOCK_KEYS) {
      expect(st[key].key).toBe(key)
      expect(st[key].label).toBe(RESOURCE_BLOCK_LABELS[key])
      expect(st[key].reason).toBe(RESOURCE_POOL_NOT_COLLECTED)
    }
    expect(Object.keys(st).sort()).toEqual([...RESOURCE_BLOCK_KEYS].sort())
  })

  it('有读数 ⇒ reason 恒为空串（页面走 v-if 画正文，不写「无」）', () => {
    const st = resourceBlockStates(fixture())
    for (const key of RESOURCE_BLOCK_KEYS) expect(st[key].reason, key).toBe('')
  })

  it('非轴队 ⇒ 轴窗块如实写「非轴队…」，其余块不受影响', () => {
    const s = fixture({ axisStack: null, isAxisMode: false, useStunAxis: false, autoActive: false })
    const st = resourceBlockStates(s)
    expect(st.axisWindows.reason).toContain('非轴队')
    expect(st.stunPool.reason).toBe('')
    expect(axisWindowsOf(s, () => 'x', () => 'y').hasTrace).toBe(false)
  })

  it('弃轴 ⇒ 原因说「弃轴」而不是「非轴队」（两种成因不同，用户口径要求能分辨）', () => {
    const s = fixture({ axisStack: null, axisFallback: true, useStunAxis: true })
    expect(resourceBlockStates(s).axisWindows.reason).toContain('弃轴')
    expect(axisWindowsAbsenceReasonOf(s)).toContain('弃轴')
    expect(axisWindowsAbsenceReasonOf(s)).not.toContain('非轴队')
  })

  it('轴开着、没被弃、但没排出窗口 ⇒ 「轴栈为空」（不补一行「平A」凑数）', () => {
    const s = fixture({ axisStack: { windowTrace: [], skipped: [], basicFillBySlot: {} } as unknown as ResourcePoolSnapshot['axisStack'] })
    expect(resourceBlockStates(s).axisWindows.reason).toContain('轴栈为空')
    expect(resourceBlockStates(s).axisWindows.reason).not.toContain('非轴队')
  })

  it('缺某一份池 / 无面板 / 无异常事件 / 无特殊动作 ⇒ 对应块写「无 + 原因」，其余块仍有读数', () => {
    const s = fixture({
      stunPool: null, anomalyPool: null, anomalyVirtualPanels: [], specialActionBonus: null,
      moduleAnomalyEventRecords: [], anomalyDamageEvents: [],
    })
    const st = resourceBlockStates(s)
    for (const key of ['stunPool', 'anomalyPool', 'virtualPanels', 'specialAction', 'anomalyEvents'] as const) {
      expect(st[key].reason, key).not.toBe('')
    }
    expect(st.timeSummary.reason).toBe('')
    expect(st.axisWindows.reason).toBe('')
  })
})

describe('资源池共享视图：同一快照喂两个入口 ⇒ 读数逐位相等', () => {
  it('★ 同一份快照（含 structuredClone 出来的独立副本）跑两遍派生链 ⇒ 深度相等', () => {
    const s = fixture()
    const a = derived(s)
    const b = derived(structuredClone(s))
    expect(b).toEqual(a)
    // 反空洞：这份夹具必须真的派生出东西（否则「相等」是在比两份空）
    expect(a.categories.length).toBeGreaterThan(0)
    expect(a.shares.length).toBeGreaterThan(0)
    expect(a.overview.length).toBe(3)
    expect(a.events.length).toBeGreaterThan(0)
    expect(a.axisWindows.hasTrace).toBe(true)
  })
})

describe('资源池共享视图：快照构造入口（唯一入口，真实求值）', () => {
  it('★ 同一现场调两次 ⇒ 同一档快照；读数归属正确（伤害/资源结果/槽名/面板/时间轴）', async () => {
    const { catalog, config } = await setupHarness([{ agentId: '1021' }, { agentId: '1481' }, { agentId: '1311' }])
    await catalog.loadBuildRecommendations()
    for (let i = 0; i < 3; i++) config.applyBuildRecommendationForSlot(i)
    const calc = useResourceCalc()
    const a = resourcePoolSnapshotFromCalc(calc, config, { ms: 1 })
    const b = resourcePoolSnapshotFromCalc(calc, config, { ms: 1 })
    expect(a, '有队伍就该有快照').toBeTruthy()
    expect(b).toEqual(a)
    if (!a) throw new Error('unreachable')
    // ① 读数归属：伤害 = 引擎队级总伤害（单一事实源，页面不得另算）
    expect(a.damage).toBe(calc.teamTotalDamage.value)
    expect(a.resourceResult).toBe(calc.resourceResult.value)
    expect(a.damagePoolRows).toBe(calc.damagePoolRows.value)
    // ② 槽位按**槽位号**取（槽位号 ≠ 下标：characters/panels 按位置压缩）
    expect(a.slotAgentIds).toEqual(config.team.map(c => c.agentId))
    expect(a.panels.length).toBe(3)
    // ③ 逐窗图三件输入随快照带出（出场景后照常可读）
    expect(a.stunTimelineSlots.length).toBe(calc.stunTimeline.value.slots.length)
    expect(a.windowDuration).toBe(calc.windowDuration.value)
    expect(a.effectiveTime).toBe(calc.stunEffectiveTime.value)
    // ④ 「完整 = 默认全含」：这一档必须有可渲染的资源块（否则共享视图在页面上就是一片空）
    const st = resourceBlockStates(a)
    expect(st.timeSummary.reason).toBe('')
    expect(derived(a).categories.length).toBeGreaterThan(0)
    expect(derived(a).overview.length).toBe(3)
  }, 300_000)
})

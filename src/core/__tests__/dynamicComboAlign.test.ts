/**
 * 动态合轴（R37-J5，用户口径 2026-09-19）生效测试。
 *
 * 口径：多名角色同场时指定操作角色 = 净必要最大的槽；Σ净必要 > 预算时，其余队友的前台按**溢出量**被合轴吸收（容量 = 各自净必要，按比例分摊），
 * 只有吸收不完的剩余才走 feasibleScale 封顶 / 装配截断；不录死 comboAlignRatio。终态判据 = 截断 ≤ 容差 且 留白 ≤ 容差；
 * 单人前台 ≤ 战斗时间不变（合轴放宽团队预算不放宽单人物理时间轴）。
 * 口径与落点：`core/resource/helpers.ts#calcTimeAllocation`「动态合轴」段；配套：贴顶槽账本折回（`core/resource.ts#runFoldLoop` 负溢出分支）、
 * 叶瞬光估计/行单源（`mechanics/agents/yeshuguang.ts#estimateExSpecialTime`）、外层 cycle 规范停点（`useResourceCalc#runOuterLoop`）。
 * 实测记录：docs/mcp-debt2-blade1-feasibility-v4.md §9–§16。
 */
import { describe, it, expect } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { buildTeamTimeSummary } from '@/composables/teamTimeSummary'
import { teamPresets } from '@/data/teamPresets'
import { TIME_BUDGET_TOLERANCE_SECONDS } from '@/core/resource'

/** 动态合轴之前（b0d5834，刀 1 + 重折后）的读数：进吸收的 5 支时间压力队 */
const BEFORE = {
  'auto-1431-1481-1491': { cut: 86.483, dmg: 87282755 },
  'auto-1431-1481-1341': { cut: 81.169, dmg: 89512176 },
  'auto-1431-1491-1341': { cut: 0, dmg: 91513832, scale: 0.0625 },
  'auto-1371-1481-1451': { cut: 0, dmg: 70937418, scale: 0.625 },
  'auto-1531-1571-1451': { cut: 0, dmg: 70933799, scale: 0.875 },
} as const

async function evalPreset(id: string) {
  const p = teamPresets.find(x => x.id === id)!
  const { catalog, config } = await setupHarness(['', '', ''])
  await catalog.loadBuildRecommendations()
  const calc = useResourceCalc()
  for (let i = 0; i < 3; i++) config.setAgent(i, p.team[i])
  config.applyTeamPreset(p.team as [string, string, string])
  const rr = calc.resourceResult.value!
  expect(rr, `${id} 无资源结果`).toBeTruthy()
  const t = buildTeamTimeSummary({ rr, battleTime: rr.totalTime, invincibleTime: config.enemy.invincibleTime ?? 0, nameOf: () => '' })
  const budget = rr.totalTime - (config.enemy.invincibleTime ?? 0)
  return {
    cut: rr.convergence?.timeTruncatedSeconds ?? 0,
    slack: t.slack,
    scale: rr.convergence?.interactionScale ?? 1,
    damage: calc.teamTotalDamage.value,
    budget,
    slots: rr.characters.map(ch => ({
      agentId: ch.agentId,
      necessary: ch.timeAllocation.necessaryTime,
      credit: ch.timeAllocation.comboAlignCredit ?? 0,
      dynamic: ch.timeAllocation.dynamicComboAlignSeconds ?? 0,
      frontline: ch.timeAllocation.frontlineTime,
    })),
  }
}

type Evaluated = Awaited<ReturnType<typeof evalPreset>>

/**
 * 吸收恒等式（口径「吸收多少由溢出决定、按容量比例分摊，不多不少」）：
 * 溢出 = Σ吸收前净必要 − 预算；吸收总量 = min(溢出, 队友容量)。用终态字段还原：吸收前净必要 = necessary − (credit − dynamic)
 * （feasibleScale=1 时精确；全额吸收时队友 necessary == credit，两支恒等式各在自己那支成立）。
 * 只钉「credit == 净必要」是全额那支的特例：2026-09-19 内层收敛专项里曾出现过 1431 落到 179.12（不贴顶）、溢出 90.71 < 容量 91.59 的
 * 部分吸收落点（63.77 + 26.94 = 90.71 精确成立），特例断言会误红——机制的定义性质是吸收量 == 溢出量，两种落点都必须过本恒等式。
 */
function expectAbsorbedEqualsOverflow(r: Evaluated, op: Evaluated['slots'][number]) {
  const netBefore = (s: Evaluated['slots'][number]) => s.necessary - (s.credit - s.dynamic)
  const absorbed = r.slots.reduce((sum, s) => sum + s.dynamic, 0)
  const capacity = r.slots.reduce((sum, s) => sum + (s === op ? 0 : netBefore(s)), 0)
  expect(op.dynamic, '操作角色不被吸收').toBe(0)
  expect(absorbed).toBeGreaterThan(0)
  if (absorbed < capacity - 1e-6) {
    const overflow = r.slots.reduce((sum, s) => sum + netBefore(s), 0) - r.budget
    expect(absorbed, '部分吸收：吸收总量 == 溢出量').toBeCloseTo(overflow, 3)
  } else {
    for (const s of r.slots) if (s !== op) expect(s.credit, `${s.agentId} 全额吸收：credit == 净必要`).toBeCloseTo(s.necessary, 3)
  }
  for (const s of r.slots) if (s !== op) expect(s.credit, `${s.agentId} credit ≤ 净必要`).toBeLessThanOrEqual(s.necessary + 1e-6)
}

describe('动态合轴 · 操作角色不动、队友前台按溢出量被合轴吸收', () => {
  it('① 1431 簇两队：截断从 86.5/81.2s 降到 ≤ 11 / 0，队友前台按溢出量被吸收（吸收总量 == min(溢出, 容量)），单人前台 ≤ 战斗时间', async () => {
    const a = await evalPreset('auto-1431-1481-1491')
    // 剩余 ≤ 11s = 叶瞬光单人 > 180s 的真剩余（操作角色 frontline 贴顶），不是合轴能解的
    expect(a.cut).toBeLessThan(11)
    expect(a.cut).toBeLessThan(BEFORE['auto-1431-1481-1491'].cut / 5)
    const op = a.slots.reduce((m, s) => (s.necessary > m.necessary ? s : m), a.slots[0])
    expect(op.agentId).toBe('1431')
    expect(op.frontline).toBeGreaterThan(a.budget - 1)
    for (const s of a.slots) {
      expect(s.frontline, `${s.agentId} 单人前台 ≤ 战斗时间`).toBeLessThanOrEqual(a.budget + 1e-6)
    }
    expectAbsorbedEqualsOverflow(a, op)
    expect(a.damage).toBeGreaterThan(BEFORE['auto-1431-1481-1491'].dmg * 1.3)

    const b = await evalPreset('auto-1431-1481-1341')
    expect(b.cut).toBeLessThanOrEqual(TIME_BUDGET_TOLERANCE_SECONDS)
    expectAbsorbedEqualsOverflow(b, b.slots.reduce((m, s) => (s.necessary > m.necessary ? s : m), b.slots[0]))
    expect(b.damage).toBeGreaterThan(BEFORE['auto-1431-1481-1341'].dmg * 1.3)
  }, 180_000)

  it('② 终态判据：5 支时间压力队 截断 ≤ 容差（唯一例外 = 单人 > 180 的 1431-1481-1491）且 留白 ≤ 1.5s；降配档不再被压到地板', async () => {
    for (const id of Object.keys(BEFORE) as (keyof typeof BEFORE)[]) {
      const r = await evalPreset(id)
      if (id !== 'auto-1431-1481-1491') expect(r.cut, `${id} 截断`).toBeLessThanOrEqual(TIME_BUDGET_TOLERANCE_SECONDS)
      // 留白：整数装包残余（实测 0 / 0 / 0.19 / 0.49 / 1.17）；1.5s 门只拦「机制失效」，具体值由 timeGolden 钉
      expect(Math.abs(r.slack), `${id} 留白/超预算`).toBeLessThanOrEqual(1.5)
      const before = BEFORE[id] as { scale?: number }
      if (before.scale !== undefined) expect(r.scale, `${id} 降配档应回升（此前 ${before.scale}）`).toBeGreaterThan(before.scale)
    }
  }, 300_000)

  it('③ 吸收只发生在溢出队：全库预设口径终态里带 dynamicComboAlignSeconds 的队 ≤ 20 支（实测 16），且 1431 簇两队在内；单人 sweep 永不吸收（无队友）', async () => {
    const presets = teamPresets.filter(p => Array.isArray(p.team) && p.team.length === 3)
    const absorbed: string[] = []
    for (const p of presets) {
      const r = await evalPreset(p.id)
      if (r.slots.some(s => s.dynamic > 0)) absorbed.push(p.id)
    }
    // 实测 16/105（时间压力终态 5 队 + 探路轮里 Σ净必要 > 预算、终态仍留有吸收的队）；> 20 = 触发条件写宽了
    expect(absorbed.length).toBeLessThanOrEqual(20)
    expect(absorbed.length).toBeGreaterThanOrEqual(5)
    expect(absorbed).toContain('auto-1431-1481-1491')
    expect(absorbed).toContain('auto-1431-1481-1341')
    const { config } = await setupHarness([{ agentId: '1431', cinemaLevel: 0 }])
    const calc = useResourceCalc()
    const rr = calc.resourceResult.value!
    expect(rr.characters.every(ch => !(ch.timeAllocation.dynamicComboAlignSeconds ?? 0))).toBe(true)
    expect(config.team[0]?.agentId).toBe('1431')
  }, 600_000)
})

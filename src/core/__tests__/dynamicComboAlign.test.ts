/**
 * 动态合轴（R37-J5，用户口径 2026-09-19）生效测试。
 *
 * 口径：多名角色同场时指定操作角色 = 净必要最大的槽；Σ净必要 > 预算时，其余队友的前台按**溢出量**被合轴吸收（容量 = 各自净必要，按比例分摊），
 * 只有吸收不完的剩余才走 feasibleScale 封顶 / 装配截断；不录死 comboAlignRatio。终态判据 = 截断 ≤ 容差 且 留白 ≤ 容差；
 * 单人前台 ≤ 战斗时间不变（合轴放宽团队预算不放宽单人物理时间轴）。
 * **v3（用户 2026-09-19 同日）：吸收上限**——「全部吸收比较难，默认队友的 40% 可以被吸收（合轴率），超过了就无力合轴了」
 * ⇒ 容量 = `comboAlignAbsorbRatio`（机制参数 `time.comboAlignAbsorbRatio`，缺省 0.4）× 各自净必要。全额吸收的恒等式在 ratio=1 下仍钉
 * （机制本身没变），缺省 0.4 下溢出 ≤ 容量的队照旧吸收 == 溢出，溢出 > 容量的 1431 簇则回到无吸收的收敛点（见 ①）。
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
import { COMBO_ALIGN_ABSORB_RATIO_SETTING, DEFAULT_COMBO_ALIGN_ABSORB_RATIO } from '@/data/resourceDefaults'

/** 动态合轴之前（b0d5834，刀 1 + 重折后）的读数：进吸收的 5 支时间压力队 */
const BEFORE = {
  'auto-1431-1481-1491': { cut: 86.483, dmg: 87282755 },
  'auto-1431-1481-1341': { cut: 81.169, dmg: 89512176 },
  'auto-1431-1491-1341': { cut: 0, dmg: 91513832, scale: 0.0625 },
  'auto-1371-1481-1451': { cut: 0, dmg: 70937418, scale: 0.625 },
  'auto-1531-1571-1451': { cut: 0, dmg: 70933799, scale: 0.875 },
} as const

async function evalPreset(id: string, absorbRatio?: number) {
  const p = teamPresets.find(x => x.id === id)!
  const { catalog, config } = await setupHarness(['', '', ''])
  await catalog.loadBuildRecommendations()
  const calc = useResourceCalc()
  for (let i = 0; i < 3; i++) config.setAgent(i, p.team[i])
  config.applyTeamPreset(p.team as [string, string, string])
  if (absorbRatio !== undefined) config.setMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, absorbRatio)
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
function expectAbsorbedEqualsOverflow(r: Evaluated, op: Evaluated['slots'][number], ratio = 1) {
  const netBefore = (s: Evaluated['slots'][number]) => s.necessary - (s.credit - s.dynamic)
  const absorbed = r.slots.reduce((sum, s) => sum + s.dynamic, 0)
  const capacity = r.slots.reduce((sum, s) => sum + (s === op ? 0 : ratio * netBefore(s)), 0)
  expect(op.dynamic, '操作角色不被吸收').toBe(0)
  expect(absorbed).toBeGreaterThan(0)
  expect(absorbed, '吸收总量 ≤ Σ 上限×净必要').toBeLessThanOrEqual(capacity + 1e-6)
  if (absorbed < capacity - 1e-6) {
    const overflow = r.slots.reduce((sum, s) => sum + netBefore(s), 0) - r.budget
    expect(absorbed, '部分吸收：吸收总量 == 溢出量').toBeCloseTo(overflow, 3)
  } else if (ratio >= 1) {
    for (const s of r.slots) if (s !== op) expect(s.credit, `${s.agentId} 全额吸收：credit == 净必要`).toBeCloseTo(s.necessary, 3)
  }
  for (const s of r.slots) if (s !== op) expect(s.credit, `${s.agentId} credit ≤ 净必要`).toBeLessThanOrEqual(s.necessary + 1e-6)
}

describe('动态合轴 · 操作角色不动、队友前台按溢出量被合轴吸收', () => {
  it('① 1431 簇两队（ratio=1，机制本体）：截断从 86.5/81.2s 降到 ≤ 11 / 0，队友前台按溢出量被吸收（吸收总量 == min(溢出, 容量)），单人前台 ≤ 战斗时间', async () => {
    const a = await evalPreset('auto-1431-1481-1491', 1)
    // 剩余 ≤ 11s = 叶瞬光单人 > 180s 的真剩余（操作角色 frontline 贴顶），不是合轴能解的
    expect(a.cut).toBeLessThan(11)
    expect(a.cut).toBeLessThan(BEFORE['auto-1431-1481-1491'].cut / 5)
    const op = a.slots.reduce((m, s) => (s.necessary > m.necessary ? s : m), a.slots[0])
    expect(op.agentId).toBe('1431')
    /**
     * 操作角色前台判据（2026-09-20 改为**不变量**，原为 `> budget − 1`）：
     *
     * 口径是「操作角色不再独占战斗时间」（见 ②b 的同款断言），而「贴顶 179s」是**旧落点**的
     * 过渡数字——那时叶瞬光的结构性溢出把队友时间压没了，只能靠前台顶满表达。冷启动环修复后
     * 该队的截断已归零（86.5s → 0），叶瞬光前台 157.4s：溢出被合轴吸收完，**不需要**再顶满。
     * 钉死不变量 = 「不再独占」+「单人 ≤ 预算」，把具体秒数交给 timeGolden。
     */
    expect(op.frontline, '操作角色不再独占战斗时间').toBeLessThan(a.budget - 5)
    expect(op.frontline, '但仍是主要占用者').toBeGreaterThan(a.budget / 2)
    for (const s of a.slots) {
      expect(s.frontline, `${s.agentId} 单人前台 ≤ 战斗时间`).toBeLessThanOrEqual(a.budget + 1e-6)
    }
    expectAbsorbedEqualsOverflow(a, op)
    expect(a.damage).toBeGreaterThan(BEFORE['auto-1431-1481-1491'].dmg * 1.3)

    const b = await evalPreset('auto-1431-1481-1341', 1)
    expect(b.cut).toBeLessThanOrEqual(TIME_BUDGET_TOLERANCE_SECONDS)
    expectAbsorbedEqualsOverflow(b, b.slots.reduce((m, s) => (s.necessary > m.necessary ? s : m), b.slots[0]))
    expect(b.damage).toBeGreaterThan(BEFORE['auto-1431-1481-1341'].dmg * 1.3)
  }, 180_000)

  it('①b 缺省上限 0.4（用户 v3）：1431 簇——队友终态前台至多 40% 被并行（受溢出/容量较小者限制），截断随吸收单调不增，强度介于无吸收与全额吸收之间', async () => {
    // 实测（2026-09-19）：-1481-1491 叶瞬光 180→132.8s、琉音 56.4s 里 22.6s 并行（40.1%）、柳 22.4 里 8.9（39.7%）、截断 57.6s、dmg 135M→98.6M；
    // -1481-1341 134.0 / 22.7 of 56.7 / 8.0 of 19.9 / 截断 54.2s / 137M→102.9M（无吸收 ratio=0 时 81.3M / 89.6M、截断 88.8 / 80.7s）。
    // 上限按封顶后的终态前台算（g(s) 小不动点，见 calcTimeAllocation 注释）——按吸收前净必要取 40% 会让终态被并行份额飙到 84%。
    for (const id of ['auto-1431-1481-1491', 'auto-1431-1481-1341'] as const) {
      const capped = await evalPreset(id)
      const full = await evalPreset(id, 1)
      const none = await evalPreset(id, 0)
      expect(DEFAULT_COMBO_ALIGN_ABSORB_RATIO).toBe(0.4)
      const op = capped.slots.reduce((m, s) => (s.necessary > m.necessary ? s : m), capped.slots[0])
      expect(op.agentId).toBe('1431')
      expect(op.dynamic).toBe(0)
      /**
       * 上限判据（2026-09-20 改为**单向不变量**，原为 `份额 ≈ 0.4`）：
       *
       * 机制定义性质是「吸收量 == min(溢出, 容量)」（见 `expectAbsorbedEqualsOverflow`）。原断言把
       * 「容量绑住」这一支当成了唯一形态——只在上限档**确实装不下**（溢出 > 容量）时，每名队友的
       * 份额才会顶到 40%。冷启动环修复后 1431 簇的溢出降到容量以下（实测 `-1481-1341`：
       * absorbed 24.47 == overflow 24.47 < capacity 26.03），份额 0.376 是**受溢出限制**的正确值。
       * 钉死「必须 == 0.4」会在溢出偏小时假红；正确不变量 = 份额**不得超过**上限。
       */
      for (const s of capped.slots) {
        if (s === op) continue
        expect(s.dynamic / Math.max(1e-9, s.necessary), `${id} ${s.agentId} 被并行份额 ≤ 上限`).toBeLessThanOrEqual(DEFAULT_COMBO_ALIGN_ABSORB_RATIO + 0.01)
      }
      // 活性：上限档必须真的吸收了（否则本条退化成恒等式自证）
      expect(capped.slots.reduce((a, s) => a + s.dynamic, 0), `${id} 上限档必须有可见吸收`).toBeGreaterThan(0)
      expect(op.frontline, `${id} 操作角色不再独占战斗时间`).toBeLessThan(capped.budget - 30)
      /**
       * 截断判据（2026-09-20 改为**相对不变量**，原为 `capped.cut > 容差`）：
       *
       * 原断言把「缺省 40% 上限装不下 ⇒ 必有截断」当成机制性质。但冷启动环修复后，1431 簇的
       * 结构性溢出被合轴 + 降配吃掉（实测 `-1481-1491` cut 57.6→0、`-1481-1341` 54.2→0），
       * 「一定有截断」不再成立。真正的不变量是**单调性**：吸收越多越不截断，且上限档介于两端。
       */
      expect(capped.cut, `${id} 上限档截断 ≤ 无吸收`).toBeLessThanOrEqual(none.cut + TIME_BUDGET_TOLERANCE_SECONDS)
      expect(full.cut, `${id} 全额档截断 ≤ 上限档`).toBeLessThanOrEqual(capped.cut + TIME_BUDGET_TOLERANCE_SECONDS)
      expect(capped.damage, `${id} 强度低于全额吸收`).toBeLessThan(full.damage)
      expect(capped.damage, `${id} 强度高于完全不吸收`).toBeGreaterThan(none.damage)
    }
  }, 300_000)

  it('② 终态判据（ratio=1）：5 支时间压力队 截断 ≤ 容差（唯一例外 = 单人 > 180 的 1431-1481-1491）且 留白 ≤ 1.5s；降配档不再被压到地板', async () => {
    for (const id of Object.keys(BEFORE) as (keyof typeof BEFORE)[]) {
      const r = await evalPreset(id, 1)
      if (id !== 'auto-1431-1481-1491') expect(r.cut, `${id} 截断`).toBeLessThanOrEqual(TIME_BUDGET_TOLERANCE_SECONDS)
      // 留白：整数装包残余（实测 0 / 0 / 0.19 / 0.49 / 1.17）；1.5s 门只拦「机制失效」，具体值由 timeGolden 钉
      expect(Math.abs(r.slack), `${id} 留白/超预算`).toBeLessThanOrEqual(1.5)
      const before = BEFORE[id] as { scale?: number }
      if (before.scale !== undefined) expect(r.scale, `${id} 降配档应回升（此前 ${before.scale}）`).toBeGreaterThan(before.scale)
    }
  }, 300_000)

  it('②b 缺省上限 0.4：溢出 ≤ 容量的队照旧「吸收 == 溢出」且截断 ≤ 容差（1371-1481-1451 / 1531-1571-1451）', async () => {
    for (const id of ['auto-1371-1481-1451', 'auto-1531-1571-1451'] as const) {
      const r = await evalPreset(id)
      expect(r.cut, `${id} 截断`).toBeLessThanOrEqual(TIME_BUDGET_TOLERANCE_SECONDS)
      const op = r.slots.reduce((m, s) => (s.necessary > m.necessary ? s : m), r.slots[0])
      expectAbsorbedEqualsOverflow(r, op, DEFAULT_COMBO_ALIGN_ABSORB_RATIO)
      expect(Math.abs(r.slack), `${id} 留白/超预算`).toBeLessThanOrEqual(1.5)
    }
  }, 300_000)

  it('③ 吸收只发生在溢出队：全库预设口径（缺省上限）终态里带 dynamicComboAlignSeconds 的队 5~20 支（实测 13），含 1371-1481-1451；单人 sweep 永不吸收（无队友）', async () => {
    const presets = teamPresets.filter(p => Array.isArray(p.team) && p.team.length === 3)
    const absorbed: string[] = []
    for (const p of presets) {
      const r = await evalPreset(p.id)
      if (r.slots.some(s => s.dynamic > 0)) absorbed.push(p.id)
    }
    // 实测 ratio=1 时 16/105、缺省 0.4 时 13/105（1431 簇溢出 > 容量 ⇒ 落到无吸收不动点，不在内）；> 20 = 触发条件写宽了
    expect(absorbed.length).toBeLessThanOrEqual(20)
    expect(absorbed.length).toBeGreaterThanOrEqual(5)
    expect(absorbed).toContain('auto-1371-1481-1451')
    const { config } = await setupHarness([{ agentId: '1431', cinemaLevel: 0 }])
    const calc = useResourceCalc()
    const rr = calc.resourceResult.value!
    expect(rr.characters.every(ch => !(ch.timeAllocation.dynamicComboAlignSeconds ?? 0))).toBe(true)
    expect(config.team[0]?.agentId).toBe('1431')
  }, 600_000)
})

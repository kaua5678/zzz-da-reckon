/**
 * 抽卡规划器（pullPlanner）纯逻辑测试：注入假 oracle，验证
 * - 购买窗口/阶梯/金数守恒
 * - 每期 3-Boss 不重叠 9 人约束（DFS 内层正确性）
 * - beam 保序性与预算钳制
 * - VCG 反事实差分 ≥0、禁用重规划生效
 * - 贬值内生（同一持有集在不同期分数不同，无折现参数）
 */
import { describe, expect, it } from 'vitest'
import {
  PURCHASE_LADDER,
  cardValuePer10kFilm,
  computeCardValuesVcg,
  nextPurchase,
  tierCost,
  pickPeriodAssignment,
  planPullStrategy,
  versionFilmGrants,
  type PlannerBossRoom,
  type PlannerCard,
  type PlannerOptions,
  type PlannerPeriod,
  type TeamOracle,
} from '@/composables/pullPlanner'
import { CINEMA_GOLD_FILM, WEAPON_GOLD_FILM } from '@/data/filmEconomy'

// ========== 假 oracle：伤害比由「队伍主C星级」决定，检验规划逻辑本身 ==========

const DAY = 86400000
function date(offsetDays: number): string {
  return new Date(Date.UTC(2026, 0, 1) + offsetDays * DAY).toISOString().slice(0, 10)
}

/**
 * 假 oracle：队伍分数 = 60000×伤害比。
 * 伤害比 = min(1, 强度×1000/HP)：强度由「队伍内编号最小的卡」决定（编号小 = 强 = 模拟主C上限）；
 * HP 参与贬值内生测试。**每房间有独立偏移**（bossId 末位数字 ×500），
 * 保证 3 房不重叠约束下持有 ≥4 张卡时总有叶子可达。
 * 注意测试期 HP 取 60000+ 量级：小 HP 会让所有队 ratio 封顶 1 → 分数无区分度。
 */
function fakeOracle(): TeamOracle {
  return {
    candidates(bossRoom: PlannerBossRoom, holdings: Record<string, number>) {
      const out: Array<{ team: [string, string, string]; score: number }> = []
      const held = Object.keys(holdings).filter(k => holdings[k] > 0).sort()
      const roomOffset = (Number(bossRoom.bossId.replace(/\D/g, '').slice(-1)) || 1) * 500
      for (let i = 0; i < held.length; i++) {
        for (let j = i + 1; j < held.length; j++) {
          for (let k = j + 1; k < held.length; k++) {
            const team = [held[i], held[j], held[k]] as [string, string, string]
            const ratio = Math.min(1, (1000 * (10 - Number(held[i].slice(1)))) / bossRoom.hp)
            out.push({ team, score: 60000 * ratio + roomOffset })
          }
        }
      }
      return out.sort((a, b) => b.score - a.score)
    },
  }
}

function bossRoom(hp: number, id = 'B1'): PlannerBossRoom {
  return { bossId: id, phaseId: `${id}-p`, bossName: `Boss${id}`, hp }
}

function period(dayOffset: number, hps: number[], id = `P${dayOffset}`): PlannerPeriod {
  return {
    id,
    label: id,
    date: date(dayOffset),
    bosses: hps.map((hp, i) => bossRoom(hp, `${id}-${i + 1}`)),
  }
}

/** windowEndDay 缺省 null = 窗口开放（旧用例不涉及关窗；关窗行为见文末「首 UP 窗口上界」组） */
function card(no: number, windowDay: number, initialTier = 0, windowEndDay: number | null = null): PlannerCard {
  return {
    agentId: `A${no}`, windowStart: date(windowDay), windowEnd: windowEndDay === null ? null : date(windowEndDay),
    ...(initialTier ? { initialTier: initialTier as never } : {}),
  }
}

function opts(over: Partial<PlannerOptions> = {}): PlannerOptions {
  return {
    cards: [],
    periods: [],
    startDate: date(0),
    initialBank: 0,
    filmPerVersion: 25000,
    // 测试夹具的期每 14 天一个、每期视为一个新版本（保持本文件旧用例「每期发一份」的前提；
    // 真实数据是约 3 期一个版本，见文末 versionFilmGrants 用例）
    versionStartDates: Array.from({ length: 12 }, (_, i) => date(i * 14)),
    beamWidth: 8,
    assignmentTopM: 10,
    oracle: fakeOracle(),
    ...over,
  }
}

describe('pullPlanner · 购买阶梯与窗口', () => {
  it('nextPurchase：窗口未开 = null；阶梯成本 = 本体15000/专武10000/满配；不跳档', () => {
    const c = card(1, 10)
    expect(nextPurchase(c, 0, date(9))).toBeNull() // 窗口未开
    expect(nextPurchase(c, 0, date(10))).toEqual({ tier: 1, cost: CINEMA_GOLD_FILM })
    expect(nextPurchase(c, 1, date(11))).toEqual({ tier: 2, cost: WEAPON_GOLD_FILM })
    expect(nextPurchase(c, 2, date(11))!.tier).toBe(3)
    expect(nextPurchase(c, 0, date(11))!.tier).toBe(1)
    expect(nextPurchase(c, 1, date(11))!.tier).toBe(2)
    expect(nextPurchase(c, 3, date(11))).toBeNull() // 满配后无下一档
    expect(tierCost(1)).toBe(15000)
    expect(tierCost(2)).toBe(10000)
    expect(tierCost(3)).toBe(15000 * 6 + 10000 * 4)
  })

  it('阶梯是数据：各档增量成本之和 = 本体 + 顶档影画 × 15000 + 顶档精炼 × 10000（任意阶梯内容都成立）', () => {
    const n = PURCHASE_LADDER.length
    const top = PURCHASE_LADDER[n - 1]
    let sum = 0
    for (let t = 1; t <= n; t++) sum += tierCost(t)
    expect(sum).toBe(CINEMA_GOLD_FILM * (1 + top.cinema) + WEAPON_GOLD_FILM * top.refine)
    expect(sum).toBe(155000) // 用户口径阶梯：满配累计 15.5 万（提案 §2.1）
    expect(nextPurchase(card(1, 0), n, date(0))).toBeNull()
    expect(() => tierCost(n + 1)).toThrow()
  })
})

describe('pullPlanner · 每期不重叠组队（内层 DFS）', () => {
  /** 假 oracle：每房间有专属候选池（房 i 用 teams[i % teams.length]），score 固定于候选上 */
  function roomOracle(teamsByRoom: Array<Array<{ team: [string, string, string]; score: number }>>): TeamOracle {
    return {
      candidates(b, _h) {
        void b; void _h
        const idx = Number(b.bossId.slice(-1)) - 1
        return teamsByRoom[Math.min(idx, teamsByRoom.length - 1)].map(c => ({ team: [...c.team] as [string, string, string], score: c.score }))
      },
    }
  }

  it('3 房间 9 人不重叠：跨房抢人时 DFS 找全局最优（60000+50000+45000）', () => {
    // 房1 候选：X1X2X3(60000) > X1X2Y1(50000) > Y2Y3Y4(45000) > Y2Y3Y5(44000)
    // 房2/房3 用同表：贪心会 3 房都想选 X1X2X3 → 只 1 房可得；DFS 让房1 拿 X1X2X3、
    // 房2 拿 X1X2Y1？不行（X1/X2 已用）——正确解 = 房1 X1X2X3 + 房2 X1X2Y1 仍冲突，
    // 实际最优 = 房1 X1X2X3(60000) + 房2 无 X 可用 → 下一可行 = Y2Y3Y4(45000) + 房3 Y2Y3Y5(44000)？
    // Y2Y3 也冲突 → 房3 只剩含 Y4/Y5 的组合。构造让全局最优清晰可验证：
    const T = (a: string, b: string, c: string, score: number) => ({ team: [a, b, c] as [string, string, string], score })
    const teams1 = [T('X1', 'X2', 'X3', 60000), T('X1', 'X2', 'Y1', 50000), T('Y2', 'Y3', 'Y4', 45000), T('Y2', 'Y3', 'Y5', 44000)]
    const teams2 = [T('Z1', 'Z2', 'Z3', 55000), T('Z1', 'Z2', 'Y1', 46000)]
    const teams3 = [T('W1', 'W2', 'W3', 52000), T('W1', 'W2', 'X1', 30000)]
    const oracle = roomOracle([teams1, teams2, teams3])
    const p = period(0, [100, 100, 100])
    const res = pickPeriodAssignment(oracle, p, {}, 10)
    expect(res.totalScore).toBe(60000 + 55000 + 52000)
    const allMembers = res.picks.flatMap(x => x.team)
    expect(new Set(allMembers).size).toBe(9) // 9 人互不重叠
  })

  it('重叠惩罚：房3 若与房1 抢主C，DFS 放弃高分重叠队换次优（不重叠 > 单房贪心）', () => {
    // 房1 唯一候选 X1X2X3(60000)；房3 最优 W1W2X1(58000) 与房1 抢 X1 → 只能选 W1W2X9(40000)
    const T = (a: string, b: string, c: string, score: number) => ({ team: [a, b, c] as [string, string, string], score })
    const oracle = roomOracle([
      [T('X1', 'X2', 'X3', 60000)],
      [T('Z1', 'Z2', 'Z3', 50000)],
      [T('W1', 'W2', 'X1', 58000), T('W1', 'W2', 'X9', 40000)],
    ])
    const res = pickPeriodAssignment(oracle, period(0, [1, 1, 1]), {}, 10)
    expect(res.totalScore).toBe(60000 + 50000 + 40000)
  })
})

describe('pullPlanner · beam 主流程不变量', () => {
  it('金数守恒：总花费 = 各期购买成本和；银行轨迹非负', () => {
    const res = planPullStrategy(opts({
      cards: [card(1, 0), card(2, 10), card(3, 20)],
      periods: [period(0, [80000, 80000, 80000]), period(14, [80000, 80000, 80000]), period(28, [80000, 80000, 80000])],
      initialBank: 30000,
      filmPerVersion: 25000,
    }))
    const spent = res.steps.flatMap(s => s.purchases).reduce((s, p) => s + p.cost, 0)
    expect(spent).toBe(res.totalSpent)
    for (const st of res.steps) {
      expect(st.bankAfter).toBeGreaterThanOrEqual(0)
      expect(st.bankBefore - st.purchases.reduce((s, p) => s + p.cost, 0)).toBe(st.bankAfter)
    }
    // 银行守恒：终态 = 初始 + 发薪 - 花费
    const grants = res.steps.reduce((s, st, i) => s + (i > 0 && st.date !== res.steps[i - 1].date ? 25000 : 0), 0)
    expect(res.finalBank).toBe(30000 + grants - res.totalSpent)
  })

  it('窗口唯一：实装前的卡不可购（首UP窗口前的期不会出现该卡购买）', () => {
    // 持有 4 张初始卡保证每期都能组队（分数可比较），A2 窗口第 20 天才开
    const res = planPullStrategy(opts({
      cards: [card(0, 20), card(3, 0, 2), card(4, 0, 2), card(5, 0, 2)],
      periods: [period(0, [80000]), period(14, [80000]), period(28, [80000])],
      initialBank: 50000,
    }))
    const beforeWindow = res.steps.filter(s => s.date < date(20))
    for (const st of beforeWindow) {
      expect(st.purchases.filter(p => p.agentId === 'A0')).toHaveLength(0)
    }
    expect(res.holdings['A0'] ?? 0).toBeGreaterThan(0) // 窗口开后买了它（唯一最强）
  })

  it('贬值内生：同一持有集对高血量 Boss 分数更低（无折现参数，数据驱动）', () => {
    const o = fakeOracle()
    const holdings = { A1: 2, A2: 2, A3: 2, A4: 2 } // ≥4 张才能组出 3 人队
    const lowHp = pickPeriodAssignment(o, period(0, [30000]), holdings, 10)
    const highHp = pickPeriodAssignment(o, period(0, [300000]), holdings, 10)
    expect(lowHp.totalScore).toBeGreaterThan(highHp.totalScore)
  })

  it('预算受限：买不起就不买（银行不足 → 跳过该档）', () => {
    const res = planPullStrategy(opts({
      cards: [card(1, 0)],
      periods: [period(0, [80000])],
      initialBank: 14000, // < 15000 本体
    }))
    expect(res.holdings['A1'] ?? 0).toBe(0)
    expect(res.finalBank).toBe(14000)
  })

  it('起点即持有（成型号/自选）：initialTier 进持有集且不重复购买', () => {
    const res = planPullStrategy(opts({
      cards: [card(1, 0, 2)],
      periods: [period(0, [80000]), period(14, [80000])],
      initialBank: 60000,
    }))
    expect(res.holdings['A1']).toBe(2) // 银行足够但满配是唯一后续档；6万可买满配
    const purchases = res.steps.flatMap(s => s.purchases).filter(p => p.agentId === 'A1')
    expect(purchases.every(p => p.tier === 3)).toBe(true)
  })
})

describe('pullPlanner · VCG 反事实价值', () => {
  it('禁用强卡重规划 → 总分下降；价值 = 差值且 ≥0；未抽且未持有的卡价值 0', () => {
    const o = opts({
      // A0 最强（编号 0）；9 张初始持有（3 房 × 3 人不重叠 = 至少 9 人，常驻 S + A 免费的成型号口径）；
      // A5 窗口太晚不抽
      cards: [card(0, 0), card(2, 5), card(3, 0, 2), card(4, 0, 2), card(5, 40), card(6, 0, 2), card(7, 0, 2), card(8, 0, 2), card(9, 0, 2), card(10, 0, 2), card(11, 0, 2)],
      periods: [period(0, [80000, 80000, 80000]), period(14, [80000, 80000, 80000])],
      initialBank: 20000,
      beamWidth: 8,
    })
    const base = planPullStrategy(o)
    const values = computeCardValuesVcg(o, base)
    const byId = new Map(values.map(v => [v.agentId, v]))
    expect(base.totalScore).toBeGreaterThan(0)
    // A0 是最强可购卡，禁用它必然掉分
    expect(byId.get('A0')!.value).toBeGreaterThan(0)
    expect(byId.get('A0')!.baselineTotal).toBeLessThan(base.totalScore)
    // A5 未持有未抽 → 价值 0
    expect(byId.get('A5')!.value).toBe(0)
    for (const v of values) expect(v.value).toBeGreaterThanOrEqual(0)
  })
})

/**
 * 零价值三态与成本分母（口径见 docs/proposals/pull-value-optimization.md §2.2b / §3.3）：
 * - 真·完全下位 → value 0 且 rawGap 恰为 0、不标不自洽（**有效结论**：建议不抽）；
 * - beam 近似导致禁购反而更高分 → rawGap < 0 且标 searchInconsistent（**搜索告警**，不是卡的属性）。
 * 两者都显示成 0，必须可区分；每万菲林的分母 = 实际增量投入，不是档位均价。
 */
describe('pullPlanner · 零价值三态与每万菲林分母', () => {
  /** 两期陷阱 oracle：A1 在 P0 值 10000，A2 在 P1 值 50000；预算只够买一张 */
  const trapOptions = (beamWidth: number) => opts({
    cards: [card(1, 0), card(2, 0)],
    periods: [period(0, [80000], 'P0'), period(14, [80000], 'P1')],
    initialBank: 15000,
    filmPerVersion: 0,
    beamWidth,
    oracle: {
      candidates: (b, h) => {
        const out = [{ team: ['f0', 'f1', 'f2'] as [string, string, string], score: 0 }]
        if (h.A1) out.push({ team: ['A1', 'f1', 'f2'] as [string, string, string], score: b.bossId.startsWith('P0') ? 10000 : 0 })
        if (h.A2) out.push({ team: ['A2', 'f1', 'f2'] as [string, string, string], score: b.bossId.startsWith('P0') ? 0 : 50000 })
        return out.sort((x, y) => y.score - x.score)
      },
    },
  })

  it('★ 搜索不自洽：窄 beam 下禁用反而更高分 → rawGap 为负并标 searchInconsistent，不冒充完全下位', () => {
    const narrow = planPullStrategy(trapOptions(1))
    const a = computeCardValuesVcg(trapOptions(1), narrow).find(v => v.agentId === 'A1')!
    expect(narrow.totalScore).toBe(10000)      // 窄 beam 只看到"先买 A1"的前缀
    expect(a.value).toBe(0)                    // 展示口径：下界 0
    expect(a.rawGap).toBe(-40000)              // 证据：未截断，禁购 A1 反而 50000
    expect(a.searchInconsistent).toBe(true)
    expect(cardValuePer10kFilm(a)).toBeNull()  // 不自洽 ⇒ 比值无意义（不是"0 分/万"）
    // 放宽 beam 后同一问题自洽 → 证明负差是搜索近似，不是这张卡的属性
    expect(planPullStrategy(trapOptions(8)).totalScore).toBe(50000)
  })

  it('★ 完全下位 = 真 0（且不标不自洽）：已持有但加入后最优收益不变', () => {
    const o = opts({
      cards: [card(1, 0, 1)], // 起点已持有本体；A1 永不入队
      periods: [period(0, [80000], 'P0'), period(14, [80000], 'P1')],
      initialBank: 0,
      filmPerVersion: 0,
      oracle: { candidates: () => [{ team: ['f0', 'f1', 'f2'] as [string, string, string], score: 100 }] },
    })
    const base = planPullStrategy(o)
    const v = computeCardValuesVcg(o, base)[0]
    expect(base.totalScore).toBe(200)          // 两期 × 100
    expect(v.value).toBe(0)
    expect(v.rawGap).toBe(0)                   // 精确 0：禁购不改变任何决策
    expect(v.searchInconsistent).toBe(false)   // ← 与上一条的本质区别
    expect(v.spentInPlan).toBe(0)              // 没为它花钱
    expect(cardValuePer10kFilm(v)).toBeNull()  // 分母 0 ⇒ 比值无定义
  })

  it('★ 每万菲林分母 = 实际增量投入（升档只算该档），不是满配累计或档位均价', () => {
    const o = opts({
      cards: [card(1, 0, 1)], // 起点已持有本体 → 升专武只花 10000
      periods: [period(0, [80000], 'P0')],
      initialBank: 10000,
      filmPerVersion: 0,
      oracle: {
        candidates: (_b, h) => [{
          team: ['A1', 'f1', 'f2'] as [string, string, string],
          score: (h.A1 ?? 0) >= 2 ? 6000 : 0,
        }],
      },
    })
    const base = planPullStrategy(o)
    const v = computeCardValuesVcg(o, base)[0]
    expect(base.totalSpent).toBe(WEAPON_GOLD_FILM) // 10000（不是满配 155000）
    expect(v.spentInPlan).toBe(10000)
    expect(v.value).toBe(6000)
    expect(v.searchInconsistent).toBe(false)
    // 6000/(10000/10000) = 6000；旧的档位均价口径会算成 6000/2.5 = 2400（低估 60%）
    expect(cardValuePer10kFilm(v)).toBeCloseTo(6000, 6)
  })

  it('未持有且未抽的卡：价值 0、未花钱、比值无定义（与"完全下位"同样显示 0 但成因不同）', () => {
    const o = trapOptions(8)
    const base = planPullStrategy(o)
    const values = computeCardValuesVcg(o, base)
    const notBought = values.find(v => v.agentId === 'A1')!
    // 宽 beam 下最优策略买 A2（50000），A1 从未被抽
    expect(notBought.tierInPlan).toBe(0)
    expect(notBought.value).toBe(0)
    expect(notBought.rawGap).toBe(0)
    expect(notBought.searchInconsistent).toBe(false)
    expect(notBought.spentInPlan).toBe(0)
    expect(cardValuePer10kFilm(notBought)).toBeNull()
  })
})

/**
 * 收入按版本日历发（提案 §5.6 收入轴；2026-09-29 arena-B）：
 * 旧实现按「期日期变化」发薪 ⇒ 真实数据每版本约 3 期 ⇒ 收入 ×3。
 */
describe('pullPlanner · 收入按版本日历发放（versionFilmGrants）', () => {
  const periodsAt = (...days: number[]) => days.map(d => period(d, [80000]))

  it('★ 一个版本 3 期只发一份：版本开始日 0 / 42，期 0,14,28,42,56 ⇒ 只有第 42 天那期发', () => {
    const g = versionFilmGrants(periodsAt(0, 14, 28, 42, 56), [date(0), date(42)], 25000, date(0))
    expect(g).toEqual([0, 0, 0, 25000, 0])
    // 旧口径（按日期变化）会是 [0, 25000, 25000, 25000, 25000] = 4 份
    expect(g.reduce((a, b) => a + b, 0)).toBe(25000)
  })

  it('两期之间跨过 2 个版本 ⇒ 本期发 2 份；同一天的第二期 ⇒ 0', () => {
    const g = versionFilmGrants(
      [period(0, [80000], 'Pa'), period(100, [80000], 'Pb'), period(100, [80000], 'Pc')],
      [date(0), date(42), date(84)], 25000, date(0),
    )
    expect(g).toEqual([0, 50000, 0])
  })

  it('首期上一边界 = 起点：起点在版本中段、首期跨过下一版本开始日 ⇒ 首期发一份', () => {
    const g = versionFilmGrants(periodsAt(50, 64), [date(0), date(42), date(45)], 25000, date(40))
    expect(g).toEqual([50000, 0]) // (40, 50] 内有 42 与 45 两个版本开始日
  })

  it('planPullStrategy 端到端：银行守恒按版本发放（3 期同版本 ⇒ 终态银行 = 起始银行，不再多发）', () => {
    const res = planPullStrategy(opts({
      cards: [],
      periods: periodsAt(2, 16, 30),
      versionStartDates: [date(0), date(42)],
      initialBank: 10000,
    }))
    expect(res.finalBank).toBe(10000) // 旧口径：10000 + 2×25000
  })
})

/** 首 UP 窗口上界（复刻不建模 ⇒ 关窗后买不到；2026-09-29 arena-B） */
describe('pullPlanner · 首 UP 窗口上界（windowEnd）', () => {
  it('nextPurchase：[windowStart, windowEnd) 内可买，windowEnd 当天起不可买（含升档）', () => {
    const c = card(1, 10, 0, 31)
    expect(nextPurchase(c, 0, date(30))).toEqual({ tier: 1, cost: CINEMA_GOLD_FILM })
    expect(nextPurchase(c, 0, date(31))).toBeNull()
    expect(nextPurchase(c, 1, date(31))).toBeNull() // 专武也随窗口关闭
    expect(nextPurchase(card(1, 10, 0, null), 0, date(999))).not.toBeNull() // null = 开放
  })

  it('★ 钱在关窗后才到 ⇒ 买不到；同一问题窗口开放时会买（旧实现的行为）', () => {
    const o = (windowEndDay: number | null) => opts({
      cards: [card(1, 0, 0, windowEndDay)],
      periods: [period(0, [80000]), period(14, [80000])],
      initialBank: 0,
      filmPerVersion: CINEMA_GOLD_FILM, // 第 14 天发一份，刚够本体
      oracle: { candidates: (_b, h) => [{ team: ['A1', 'f1', 'f2'] as [string, string, string], score: (h.A1 ?? 0) > 0 ? 1000 : 0 }] },
    })
    const closed = planPullStrategy(o(14))
    expect(closed.totalSpent).toBe(0)
    expect(closed.totalScore).toBe(0)
    const open = planPullStrategy(o(null))
    expect(open.totalSpent).toBe(CINEMA_GOLD_FILM)
    expect(open.totalScore).toBe(1000)
  })
})

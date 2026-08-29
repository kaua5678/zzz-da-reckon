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
  TIER_COSTS,
  computeCardValuesVcg,
  nextPurchase,
  pickPeriodAssignment,
  planPullStrategy,
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
 * 假 oracle：队伍分数 = 60000×伤害比 + 5000。
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
            out.push({ team, score: 60000 * ratio + 5000 + roomOffset })
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

function card(no: number, windowDay: number, initialTier = 0): PlannerCard {
  return { agentId: `A${no}`, windowStart: date(windowDay), ...(initialTier ? { initialTier: initialTier as never } : {}) }
}

function opts(over: Partial<PlannerOptions> = {}): PlannerOptions {
  return {
    cards: [],
    periods: [],
    startDate: date(0),
    initialBank: 0,
    filmPerVersion: 25000,
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
    expect(TIER_COSTS[1]).toBe(15000)
    expect(TIER_COSTS[2]).toBe(10000)
    expect(TIER_COSTS[3]).toBe(15000 * 6 + 10000 * 4)
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

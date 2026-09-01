/**
 * 抽取价值模型（core/acquisitionValue.ts）的护栏。
 *
 * 四层价值：
 * ① **交叉验证**：蒙特卡洛采样出来的期望抽数，必须等于 gachaCost.ts 解析算出来的期望
 *    （两套独立实现互证——采样错了或解析错了都会在这里对不上）；
 * ② 游戏规则本身：硬保底、歪→大保底、窗口过期、保底跨卡传递；
 * ③ 决策论性质：CRN 让 delta 稳定、有益卡 delta>0、阈值效用与期望分给出不同排序；
 * ④ 把两个「已知失真」量化成断言：边际之和≠总价值（互补/替代）、确定性价高估达标率。
 */
import { describe, expect, it } from 'vitest'
import { CHAR_POOL, WENGINE_POOL, expectedPullsToLimited } from '../gachaCost'
import {
  acquisitionValue,
  additivityGap,
  makeRng,
  runPaths,
  simulateOne,
  bestPolicy,
  comparePolicies,
  rankCards,
  summarize,
  type PullWorld,
  type ScoreOf,
} from '../acquisitionValue'

/** 预算充足的单卡世界：用来量「抽到它平均要多少抽」 */
const richWorld = (over: Partial<PullWorld> = {}): PullWorld => ({
  periods: 1,
  pullsPerPeriod: [100000],
  initialPulls: 0,
  initialPity: 0,
  initialGuaranteed: false,
  cards: [{ id: 'A', open: 0, close: 0 }],
  ...over,
})

const meanPulls = (world: PullWorld, id: string, paths = 4000) => {
  const r = runPaths(world, { order: world.cards.map(c => c.id) }, () => 0, { paths, seed: 7, pullsForCard: id })
  return r.pullsFor.reduce((s, v) => s + v, 0) / r.pullsFor.length
}

describe('随机数：种子固定 = 可复现（delta 靠 CRN，种子不稳一切白搭）', () => {
  it('同种子同序列，异种子异序列', () => {
    const a = [...Array(5)].map(makeRng(42))
    const b = [...Array(5)].map(makeRng(42))
    const c = [...Array(5)].map(makeRng(43))
    expect(a).toEqual(b)
    expect(a).not.toEqual(c)
    expect(a.every(v => v >= 0 && v < 1)).toBe(true)
  })
})

describe('交叉验证：采样期望 == gachaCost 解析期望（两套独立实现互证）', () => {
  it('角色池零状态：MC 93.8 ≈ 解析 93.75 抽', () => {
    expect(meanPulls(richWorld(), 'A')).toBeCloseTo(expectedPullsToLimited(CHAR_POOL, 0, false), -0.6)
  })

  it('大保底状态：MC ≈ 解析 62.5 抽（少掉歪那一半的重来成本）', () => {
    const w = richWorld({ initialGuaranteed: true })
    expect(meanPulls(w, 'A')).toBeCloseTo(expectedPullsToLimited(CHAR_POOL, 0, true), -0.6)
  })

  it('已垫 80 抽 + 大保底：MC ≈ 解析 9.6 抽（保底进度是资产的量化）', () => {
    const w = richWorld({ initialPity: 80, initialGuaranteed: true })
    expect(meanPulls(w, 'A')).toBeCloseTo(expectedPullsToLimited(CHAR_POOL, 80, true), -0.5)
  })

  it('音擎池（80 抽保底 / 75-25）：MC ≈ 解析 62.5 抽', () => {
    const w = richWorld({ cards: [{ id: 'A', open: 0, close: 0, pool: WENGINE_POOL }] })
    expect(meanPulls(w, 'A')).toBeCloseTo(expectedPullsToLimited(WENGINE_POOL, 0, false), -0.6)
  })
})

describe('游戏规则：硬保底 / 窗口 / 保底跨卡传递', () => {
  it('硬保底封顶：单卡花费不可能超过 2 次硬保底（90 歪 + 90 必中）', () => {
    const w = richWorld()
    for (let i = 0; i < 200; i++) {
      const p = simulateOne(w, { order: ['A'] }, makeRng(1000 + i))
      expect(p.pullsSpent.A).toBeLessThanOrEqual(2 * CHAR_POOL.hardPity)
    }
  })

  it('窗口关了就永久错过（复刻未建模）：预算不足 → 到手率显著小于 1', () => {
    const w = richWorld({ pullsPerPeriod: [30] })
    const got = [...Array(400)].filter((_, i) => simulateOne(w, { order: ['A'] }, makeRng(i)).acquiredAt.A != null).length
    expect(got / 400).toBeLessThan(0.5)
    expect(got).toBeGreaterThan(0)
  })

  it('保底跨卡传递：为过期的 A 垫的刀，让后来的 B 更便宜', () => {
    const world: PullWorld = {
      periods: 2, pullsPerPeriod: [60, 100000], initialPulls: 0, initialPity: 0, initialGuaranteed: false,
      cards: [{ id: 'A', open: 0, close: 0 }, { id: 'B', open: 1, close: 1 }],
    }
    // A 窗口只有第 0 期、只给 60 抽 → 多数路径 A 过期；此时 pity≈60 全部留给 B
    expect(meanPulls(world, 'B', 3000)).toBeLessThan(expectedPullsToLimited(CHAR_POOL, 0, false) - 15)
  })

  it('没预算就不动手：0 抽 → 没有任何卡到手、剩余预算为 0', () => {
    const w = richWorld({ pullsPerPeriod: [0] })
    const p = simulateOne(w, { order: ['A'] }, makeRng(5))
    expect(p.acquiredAt).toEqual({})
    expect(p.leftover).toBe(0)
  })
})

// 分数函数：A 单独 60000、B 单独 40000、AB 一起 140000（互补：合体远大于各自之和）
const complementScore: ScoreOf = (owned) => {
  const has = (id: string) => owned.includes(id)
  if (has('A') && has('B')) return 140000
  if (has('A')) return 60000
  if (has('B')) return 40000
  return 20000
}

describe('决策论性质：CRN / 三种读数 / 到手概率', () => {
  const world: PullWorld = {
    periods: 4, pullsPerPeriod: [40, 40, 40, 40], initialPulls: 60, initialPity: 0, initialGuaranteed: false,
    cards: [{ id: 'A', open: 0, close: 3 }, { id: 'B', open: 0, close: 3 }],
  }

  it('有益卡的 delta 为正，且三种读数同时给出（期望分 / 打穿概率 / 下尾）', () => {
    const v = acquisitionValue(world, { order: ['A', 'B'] }, complementScore, 'A', { paths: 1200, threshold: 100000 })
    expect(v.deltaMean).toBeGreaterThan(0)
    expect(v.deltaHitRate).toBeGreaterThan(0)
    expect(v.deltaCvar).toBeGreaterThanOrEqual(0)
    expect(v.acquireProb).toBeGreaterThan(0.3)
    expect(v.expectedPulls).toBeGreaterThan(20)
    expect(v.meanPer100Pulls).toBeGreaterThan(0)
  })

  it('CRN 对偶：换一批种子，delta 仍稳定（<8% 抖动）——否则排名靠噪声', () => {
    const opts = { paths: 1200, threshold: 100000 }
    const d1 = acquisitionValue(world, { order: ['A', 'B'] }, complementScore, 'A', { ...opts, seed: 111 }).deltaMean
    const d2 = acquisitionValue(world, { order: ['A', 'B'] }, complementScore, 'A', { ...opts, seed: 999 }).deltaMean
    expect(Math.abs(d1 - d2) / Math.abs(d1)).toBeLessThan(0.08)
  })

  it('summarize：CVaR 是下尾均值，必然 ≤ p10 ≤ 均值 ≤ p90', () => {
    const s = summarize(runPaths(world, { order: ['A', 'B'] }, complementScore, { paths: 800, threshold: 100000 }))
    expect(s.cvar05).toBeLessThanOrEqual(s.p10)
    expect(s.p10).toBeLessThanOrEqual(s.mean)
    expect(s.mean).toBeLessThanOrEqual(s.p90)
    expect(s.hitRate).toBeGreaterThanOrEqual(0)
    expect(s.hitRate).toBeLessThanOrEqual(1)
  })
})

describe('决策链比较：随机性下依然能判「哪条链更好」（CRN 配对）', () => {
  const world: PullWorld = {
    periods: 4, pullsPerPeriod: [40, 40, 40, 40], initialPulls: 40, initialPity: 0, initialGuaranteed: false,
    cards: [{ id: 'A', open: 0, close: 3 }, { id: 'B', open: 0, close: 3 }],
  }

  it('先抽强卡的链严格更优，且配对标准误远小于单边波动（差里没有运气）', () => {
    const cmp = comparePolicies(world, { order: ['A', 'B'] }, { order: ['B', 'A'] }, complementScore, { paths: 2000 })
    expect(cmp.deltaMean).toBeGreaterThan(0)
    expect(cmp.winRate).toBeGreaterThan(cmp.tieRate * 0 + 0.2)
    // 判「差是真的」的标尺：95% 区间不跨 0
    expect(cmp.deltaMean - 1.96 * cmp.stderr).toBeGreaterThan(0)
    // 配对法的意义：差的标准误 << 单条链自身的标准差
    const single = summarize(runPaths(world, { order: ['A', 'B'] }, complementScore, { paths: 2000 }))
    expect(cmp.stderr).toBeLessThan((single.p90 - single.p10) / 10)
  })

  it('同一条链跟自己比：差恒为 0、全平局（配对法的自洽性）', () => {
    const cmp = comparePolicies(world, { order: ['A', 'B'] }, { order: ['A', 'B'] }, complementScore, { paths: 500 })
    expect(cmp.deltaMean).toBe(0)
    expect(cmp.tieRate).toBe(1)
    expect(cmp.stderr).toBe(0)
  })
})

describe('把已知失真量化：边际之和 ≠ 总价值', () => {
  const world: PullWorld = {
    periods: 4, pullsPerPeriod: [60, 60, 60, 60], initialPulls: 120, initialPity: 0, initialGuaranteed: false,
    cards: [{ id: 'A', open: 0, close: 3 }, { id: 'B', open: 0, close: 3 }],
  }

  it('互补品：边际之和**高估**总价值（各自都把合体收益算了一遍）', () => {
    const gap = additivityGap(world, { order: ['A', 'B'] }, complementScore, { paths: 800 })
    expect(gap.ratio).toBeGreaterThan(1.2)
  })

  it('替代品：边际之和**低估**总价值（谁都说自己可有可无）', () => {
    // A/B 功能重叠：有任意一个就 100000，两个也还是 110000
    const substitute: ScoreOf = (owned) => {
      const n = ['A', 'B'].filter(id => owned.includes(id)).length
      return n === 0 ? 20000 : n === 1 ? 100000 : 110000
    }
    const gap = additivityGap(world, { order: ['A', 'B'] }, substitute, { paths: 800 })
    expect(gap.ratio).toBeLessThan(0.8)
  })
})

describe('把已知失真量化：确定性期望价会高估达标率（Jensen 间隙）', () => {
  it('预算刚好卡在期望价上时，确定性模型说 100% 到手，实际只有约一半', () => {
    // 预算 = 93.75 抽 ≈ 一张卡的期望价：确定性规划器会直接判定「买得起」
    const w = richWorld({ pullsPerPeriod: [Math.round(expectedPullsToLimited(CHAR_POOL, 0, false))] })
    const got = [...Array(2000)].filter((_, i) => simulateOne(w, { order: ['A'] }, makeRng(i)).acquiredAt.A != null).length
    const prob = got / 2000
    expect(prob).toBeLessThan(0.75) // 远不是确定性模型隐含的 1.0
    expect(prob).toBeGreaterThan(0.35)
  })
})
describe('价值的定义：两边都按最优打法（V* vs V*），于是价值天然 ≥ 0', () => {
  const tight: PullWorld = {
    periods: 3, pullsPerPeriod: [30, 30, 30], initialPulls: 20, initialPity: 0, initialGuaranteed: false,
    cards: [{ id: 'A', open: 0, close: 2 }, { id: 'B', open: 0, close: 2 }, { id: 'C', open: 0, close: 2 }],
  }
  // C 是「陷阱卡」：自己几乎不加分，还会吃掉预算
  const trapScore: ScoreOf = (owned) => {
    let s = 10000
    if (owned.includes('A')) s += 50000
    if (owned.includes('B')) s += 30000
    if (owned.includes('C')) s += 500
    return s
  }

  it('bestPolicy 会把强卡排前面（顺序不是给定的，是算出来的）', () => {
    const best = bestPolicy(tight, ['A', 'B', 'C'], trapScore, { paths: 600 })
    expect(best.order[0]).toBe('A')
    expect(best.order.indexOf('B')).toBeLessThan(best.order.indexOf('C'))
  })

  it('弱卡：价值 ≥ 0（排末位等价于不抽），但预算根本排不到它 → worthPulling=false', () => {
    const v = acquisitionValue(tight, { order: ['A', 'B', 'C'] }, trapScore, 'C', { paths: 600 })
    expect(v.deltaMean).toBeGreaterThanOrEqual(0) // 自由排序下多一张卡不可能变差
    // 最优策略要么直接不抽它，要么把它排末位（两者在本场景等价）
    expect(!v.bestOrder.includes('C') || v.bestOrder[v.bestOrder.length - 1] === 'C').toBe(true)
    expect(v.acquireProb).toBeLessThan(0.1) // 预算排不到
    expect(v.worthPulling).toBe(false)
  })

  it('强卡价值 > 0 且 worthPulling=true，最优链把它排在最前', () => {
    const v = acquisitionValue(tight, { order: ['A', 'B', 'C'] }, trapScore, 'A', { paths: 600 })
    expect(v.deltaMean).toBeGreaterThan(0)
    expect(v.worthPulling).toBe(true)
    expect(v.bestOrder[0]).toBe('A')
  })

  it('关掉 optimizePolicy = 评价「在既定计划里加减这张卡」，允许为负（排序惩罚）', () => {
    const v = acquisitionValue(tight, { order: ['C', 'A', 'B'] }, trapScore, 'C', { paths: 600, optimizePolicy: false })
    expect(v.deltaMean).toBeLessThan(0) // 把陷阱卡强行排第一 → 负价值，正是首版探针踩的坑
  })
})

describe('价值榜（rankCards）：排序 + 「这份榜能不能直接当预算分配」的判据', () => {
  const world: PullWorld = {
    periods: 3, pullsPerPeriod: [40, 40, 40], initialPulls: 40, initialPity: 0, initialGuaranteed: false,
    cards: [{ id: 'A', open: 0, close: 2 }, { id: 'B', open: 0, close: 2 }, { id: 'C', open: 0, close: 2 }],
  }
  const score: ScoreOf = (owned) => {
    let s = 10000
    if (owned.includes('A')) s += 50000
    if (owned.includes('B')) s += 30000
    if (owned.includes('C')) s += 500
    return s
  }

  it('按 Δ期望分降序，强卡在前，弱卡在后', () => {
    const rank = rankCards(world, ['C', 'B', 'A'], score, { paths: 600 })
    expect(rank.rows.map(r => r.cardId)).toEqual(['A', 'B', 'C'])
    expect(rank.rows[0].deltaMean).toBeGreaterThan(rank.rows[2].deltaMean)
  })

  it('附带最优链与加总比：比值远离 1 = 榜单不可直接当预算分配', () => {
    const rank = rankCards(world, ['A', 'B', 'C'], score, { paths: 600 })
    expect(rank.bestOrder[0]).toBe('A')
    expect(rank.bestOrder).toHaveLength(3)
    expect(rank.bestMean).toBeGreaterThan(0)
    expect(rank.additivityRatio).toBeGreaterThan(0)
  })
})

describe('窗口造成的真实机会成本：窗口靠前的弱卡会吃掉后面强卡的预算', () => {
  // A 弱卡窗口在最前，B 强卡窗口在最后；预算只够一张
  const world: PullWorld = {
    periods: 3, pullsPerPeriod: [50, 30, 30], initialPulls: 20, initialPity: 0, initialGuaranteed: false,
    cards: [{ id: 'A', open: 0, close: 0 }, { id: 'B', open: 2, close: 2 }],
  }
  const score: ScoreOf = (owned) => 10000 + (owned.includes('B') ? 60000 : 0) + (owned.includes('A') ? 3000 : 0)

  it('固定顺序（不许跳过）：加入弱卡使总价值下降 —— 负价值是真实的机会成本，不是 bug', () => {
    const v = acquisitionValue(world, { order: ['A', 'B'] }, score, 'A', { paths: 800, optimizePolicy: false })
    expect(v.deltaMean).toBeLessThan(0)
  })

  it('策略空间含「跳过」后价值回到 ≥ 0：最优打法就是放掉弱卡窗口、把钱留给强卡', () => {
    const v = acquisitionValue(world, { order: ['A', 'B'] }, score, 'A', { paths: 800 })
    expect(v.deltaMean).toBeGreaterThanOrEqual(0)
    expect(v.bestOrder).not.toContain('A') // 最优策略直接不抽 A
    expect(bestPolicy(world, ['A', 'B'], score, { paths: 800 }).order).toEqual(['B'])
  })
})

describe('目标决定最优链：刷分 / 打穿 / 保下限的答案可以不同', () => {
  // A：窗口长（好拿）但只加一点分，刚够过阈值；B：窗口短（难拿）但加很多分
  const world: PullWorld = {
    periods: 2, pullsPerPeriod: [50, 50], initialPulls: 0, initialPity: 0, initialGuaranteed: false,
    cards: [{ id: 'A', open: 0, close: 1 }, { id: 'B', open: 1, close: 1 }],
  }
  const score: ScoreOf = (owned) => 39000 + (owned.includes('A') ? 2000 : 0) + (owned.includes('B') ? 30000 : 0)
  const opts = { paths: 1500, threshold: 40000, searchPaths: 800 }

  it('以期望分为目标 → 抽 B（大分卡）', () => {
    expect(bestPolicy(world, ['A', 'B'], score, { ...opts, objective: 'mean' }).order).toEqual(['B'])
  })

  it('以打穿率为目标 → 抽 A（好拿、刚好过线的那张）', () => {
    expect(bestPolicy(world, ['A', 'B'], score, { ...opts, objective: 'hitRate' }).order).toEqual(['A'])
  })

  it('同一份榜单在两个目标下给出不同的第一名（所以「更好」必须先说目标）', () => {
    const byMean = rankCards(world, ['A', 'B'], score, { ...opts, objective: 'mean' })
    const byHit = rankCards(world, ['A', 'B'], score, { ...opts, objective: 'hitRate' })
    expect(byMean.bestOrder).not.toEqual(byHit.bestOrder)
  })
})

// ── 探针：把新旧两套口径放在同一场景上对比（不进常规断言，仅按需打印） ──
// 跑法：PROBE_PULL_VALUE=1 npx vitest run src/core/__tests__/acquisitionValue.test.ts
describe('探针：抽取价值实景对比', () => {
  // 场景：2 个版本 ≈ 6 期危局；每版免费 25000 菲林（PLANNER_FILM_PER_VERSION）→ 每期 ≈ 52 抽
  const perPeriod = Math.floor(25000 / 3 / 160)
  const cards = [
    { id: '主C', open: 0, close: 1 },
    { id: '专武', open: 0, close: 1, pool: WENGINE_POOL },
    { id: '下版辅助', open: 4, close: 5 },
  ]
  const order = ['主C', '专武', '下版辅助']
  const threshold = 100000
  // 合成分：主C 是地基，专武/辅助是乘数（互补）
  const score: ScoreOf = (owned) => {
    const has = (id: string) => owned.includes(id)
    let s = 30000
    if (has('主C')) s += 55000
    if (has('主C') && has('专武')) s += 25000
    if (has('主C') && has('下版辅助')) s += 30000
    if (has('下版辅助') && !has('主C')) s += 12000
    return s
  }
  const worldWith = (initialPulls: number): PullWorld => ({
    periods: 6, pullsPerPeriod: Array(6).fill(perPeriod), initialPulls,
    initialPity: 0, initialGuaranteed: false, cards,
  })
  /** 确定性期望价口径（现行 planner 的隐含假设）：买得起 = 一定到手 */
  const deterministic = (world: PullWorld) => {
    const cost = [expectedPullsToLimited(CHAR_POOL, 0, false), expectedPullsToLimited(WENGINE_POOL, 0, false), expectedPullsToLimited(CHAR_POOL, 0, false)]
    let budget = world.initialPulls
    const owned: string[] = []
    let total = 0
    let hits = 0
    for (let t = 0; t < world.periods; t++) {
      budget += world.pullsPerPeriod[t]
      for (let i = 0; i < order.length; i++) {
        const c = cards[i]
        if (owned.includes(order[i]) || c.open > t || c.close < t) continue
        if (budget >= cost[i]) { budget -= cost[i]; owned.push(order[i]) }
      }
      const s = score(owned, t)
      total += s
      if (s >= threshold) hits++
    }
    return { total, hitRate: hits / world.periods, owned: owned.join('+') || '无' }
  }

  it.runIf(process.env.PROBE_PULL_VALUE)('预算扫描：确定性口径的高估集中在预算边界附近', () => {
    console.log('\n=== 预算扫描（3 张卡的期望价合计 = 250 抽）===')
    console.log('起始抽数  总预算  确定性总分  概率期望分   高估   确定性打穿率  概率打穿率')
    for (const initial of [0, 60, 120, 180, 240, 300]) {
      const w = worldWith(initial)
      const det = deterministic(w)
      const prob = summarize(runPaths(w, { order }, score, { paths: 4000, seed: 20260831, threshold }))
      const over = (det.total / prob.mean - 1) * 100
      console.log(
        String(initial).padStart(8), String(initial + perPeriod * 6).padStart(8),
        Math.round(det.total).toString().padStart(11), Math.round(prob.mean).toString().padStart(11),
        (over.toFixed(1) + '%').padStart(7),
        ((det.hitRate * 100).toFixed(0) + '%').padStart(13), ((prob.hitRate * 100).toFixed(0) + '%').padStart(11),
      )
    }
  })

  it.runIf(process.env.PROBE_PULL_VALUE)('紧预算下的单卡价值（决策真正发生的地方）', () => {
    const w = worldWith(60)
    const opts = { paths: 6000, seed: 20260831, threshold }
    const base = summarize(runPaths(w, { order }, score, opts))
    console.log('\n=== 紧预算（起始 60 抽 + 每期 52 抽） ===')
    console.log('全序列期望总分', Math.round(base.mean), '| 打穿率', (base.hitRate * 100).toFixed(1) + '%',
      '| 下尾5%', Math.round(base.cvar05), '| p10', Math.round(base.p10), '| p90', Math.round(base.p90))
    console.log('\n卡        到手率  期望抽数   Δ期望分  Δ打穿率    Δ下尾   每100抽')
    for (const id of order) {
      const v = acquisitionValue(w, { order }, score, id, opts)
      console.log(
        id.padEnd(9), (v.acquireProb * 100).toFixed(0).padStart(5) + '%',
        v.expectedPulls.toFixed(0).padStart(8), Math.round(v.deltaMean).toString().padStart(10),
        ((v.deltaHitRate * 100).toFixed(1) + '%').padStart(8), Math.round(v.deltaCvar).toString().padStart(9),
        Math.round(v.meanPer100Pulls).toString().padStart(9),
      )
    }
    const gap = additivityGap(w, { order }, score, opts)
    console.log('\n边际之和', Math.round(gap.sumOfMarginals), 'vs 联合价值', Math.round(gap.jointValue),
      '→ 比值', gap.ratio.toFixed(2), '（>1 = 互补品被重复计价，榜单不能直接当预算分配）')
  })

  it.runIf(process.env.PROBE_PULL_VALUE)('保底进度是资产：同一张卡在不同起始状态下的价格与价值', () => {
    console.log('\n=== 起始保底状态 → 同一张卡的成本/到手率（起始 60 抽） ===')
    console.log('状态             期望抽数  到手率   Δ期望分')
    for (const [pity, guar, label] of [[0, false, '零进度 50/50'], [50, false, '垫50 50/50'], [0, true, '零进度 大保底'], [70, true, '垫70 大保底']] as const) {
      const w = { ...worldWith(60), initialPity: pity, initialGuaranteed: guar }
      const v = acquisitionValue(w, { order }, score, '主C', { paths: 4000, seed: 20260831, threshold })
      console.log(label.padEnd(16), v.expectedPulls.toFixed(0).padStart(8), ((v.acquireProb * 100).toFixed(0) + '%').padStart(7), Math.round(v.deltaMean).toString().padStart(10))
    }
  })
})
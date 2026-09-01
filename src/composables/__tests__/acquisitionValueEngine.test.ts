/**
 * 抽取价值 × 真引擎（composables/acquisitionValueEngine.ts）。
 *
 * 两段：
 * ① 纯函数段（常规跑）：卡 id 解析、持有集换算、记忆化确实生效（引擎求值次数与路径数无关
 *    ——这是整套设计能跑真引擎的前提，失守就意味着几千条路径 × 几十秒/次）；
 * ② 探针段（PROBE_PULL_VALUE=1 才跑）：真 Boss、真队伍求值、真候选池，
 *    打印「概率口径 vs 确定性口径」的实景对比。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { useCatalogStore } from '@/stores/catalog'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { setupHarness } from '@/test/harness'
import {
  buildPlannerPeriods,
  createEngineOracle,
  freePoolRepresentatives,
  plannerTestServerVersions,
} from '@/composables/pullPlannerEngine'
import { holdingsFrom, makeEngineScoreOf, parseCardId } from '@/composables/acquisitionValueEngine'
import {
  acquisitionValue,
  bestPolicy,
  comparePolicies,
  rankCards,
  runPaths,
  summarize,
  type PullWorld,
} from '@/core/acquisitionValue'
import { CHAR_POOL, WENGINE_POOL, expectedPullsToLimited } from '@/core/gachaCost'
import type { BossPresetFile } from '@/types/bossPreset'
import type { PlannerPeriod, TeamOracle } from '@/composables/pullPlanner'

const bossData = JSON.parse(readFileSync(new URL('../../../public/static/boss-presets.json', import.meta.url), 'utf8')) as BossPresetFile
const ALL_BOSSES = bossData.bosses

describe('卡 id ↔ 持有集换算（planner 阶梯 tier 语义）', () => {
  it('本体 = tier1，#w 专武 = tier2，同角色取最高档', () => {
    expect(parseCardId('1561')).toEqual({ agentId: '1561', tier: 1 })
    expect(parseCardId('1561#w')).toEqual({ agentId: '1561', tier: 2 })
    expect(holdingsFrom(['1561', '1561#w', '1451'])).toEqual({ 1561: 2, 1451: 1 })
  })

  it('没有本体的专武不生效（不跳档，与 nextPurchase 同口径）', () => {
    expect(holdingsFrom(['1561#w'])).toEqual({})
  })
})

describe('记忆化：引擎求值次数与蒙特卡洛路径数无关（真引擎可跑的前提）', () => {
  it('300 条路径 × 2 期，引擎只被问「不同持有集 × 期」那么多次', () => {
    // 假 oracle：不碰引擎，只数调用；真实性由探针段负责
    const fake: TeamOracle = {
      candidates: (_room, holdings) => [{
        team: ['1011', '1021', '1031'] as [string, string, string],
        score: 10000 + Object.keys(holdings).length * 20000,
      }],
    }
    const periods: PlannerPeriod[] = [0, 1].map(i => ({
      id: 'P' + i, label: 'P' + i, date: '2026-0' + (i + 1) + '-01',
      bosses: [{ bossId: 'b' + i, phaseId: 'ph' + i, bossName: 'B', hp: 1e6 }],
    }))
    const { scoreOf, engineCalls } = makeEngineScoreOf({ oracle: fake, periods })
    const world: PullWorld = {
      periods: 2, pullsPerPeriod: [100, 100], initialPulls: 0,
      initialPity: 0, initialGuaranteed: false,
      cards: [{ id: 'A', open: 0, close: 1 }, { id: 'B', open: 0, close: 1 }],
    }
    runPaths(world, { order: ['A', 'B'] }, scoreOf, { paths: 300 })
    // 持有集只可能是 {} / {A} / {A,B} → 最多 3 × 2 期 = 6 次
    expect(engineCalls()).toBeLessThanOrEqual(6)
  })
})

describe('探针：真引擎下的抽取价值', () => {
  it.runIf(process.env.PROBE_PULL_VALUE)('三张真卡 × 真 Boss：概率口径 vs 确定性口径', async () => {
    await setupHarness([{ agentId: '1011' }, { agentId: '1031' }, { agentId: '1131' }])
    const catalog = useCatalogStore()
    const calc = useResourceCalc()
    const allPeriods = buildPlannerPeriods(ALL_BOSSES, { testServerVersions: plannerTestServerVersions() })
    const periods = allPeriods.slice(-2) // 最近 2 期（引擎成本 = 持有集数 × 期数 × 候选队数）
    const all = catalog.displayAgents.map(a => a.id)
    // 每职业 2 名代表（= runPullPlanner 默认口径）。每职业 1 名会让池只剩 ~6 人，
    // 而一期 3 房要选 9 个不重叠的人 → DFS 必然无解、掉进逐房贪心兜底，
    // 分数与价值全部失真（首版探针就踩了这个坑，负价值就是这么来的）
    const free = freePoolRepresentatives(all, catalog, 2)
    // 三张卡沿用账本里跑过 VCG 的那三个角色，便于与现行确定性口径对照
    const WISH = [
      { id: '1561', name: '维琳娜' },
      { id: '1451', name: '卢西娅' },
      { id: '1531', name: '星徽·比利' },
    ]
    const engine = createEngineOracle({
      calc,
      bosses: ALL_BOSSES,
      periodViews: [],
      candidatePool: [...free, ...WISH.map(w => w.id)],
    })
    const { scoreOf, engineCalls, cacheSize, monotoneFixes } = makeEngineScoreOf({
      oracle: engine.oracle, periods, applyPeriodContext: engine.applyPeriodContext, topM: 6,
    })

    // 世界：3 期 ≈ 1 个版本，每期 52 抽（25000 菲林/版 ÷ 3 ÷ 160），起始 60 抽（紧预算档）
    const perPeriod = Math.floor(25000 / 3 / 160)
    const world: PullWorld = {
      periods: periods.length,
      pullsPerPeriod: Array(periods.length).fill(perPeriod),
      initialPulls: 60,
      initialPity: 0,
      initialGuaranteed: false,
      cards: WISH.map(w => ({ id: w.id, open: 0, close: periods.length - 1 })),
    }
    const order = WISH.map(w => w.id)
    const nameOf = (id: string) => WISH.find(w => w.id === id)?.name ?? id
    // 阈值 = 「满配到手时能打出的分」的 90%（用真引擎实测值定标，不用理论满分——
    // 探针的候选池是剪枝过的，理论满分打不到，硬套会让打穿率恒为 0）
    const fullScores = periods.map((_, t) => scoreOf(order.slice().sort(), t))
    const threshold = Math.min(...fullScores) * 0.9
    const opts = { paths: 3000, seed: 20260831, threshold }

    const base = summarize(runPaths(world, { order }, scoreOf, opts))
    console.log('\n=== 真引擎 · 期轴 ' + periods.map(p => p.label).join(' / ') + ' ===')
    console.log('全序列期望总分', Math.round(base.mean), '| 打穿率(≥50000/期)', (base.hitRate * 100).toFixed(1) + '%',
      '| 下尾5%', Math.round(base.cvar05), '| p10', Math.round(base.p10), '| p90', Math.round(base.p90))

    console.log('满配基准分/期', fullScores.map(Math.round).join(' / '), '| 打穿阈值', Math.round(threshold))
    console.log('\n卡              到手率  期望抽数    Δ期望分  Δ打穿率     Δ下尾   每100抽  值得抽')
    for (const id of order) {
      const v = acquisitionValue(world, { order }, scoreOf, id, opts)
      console.log(
        nameOf(id).padEnd(12), (v.acquireProb * 100).toFixed(0).padStart(6) + '%',
        v.expectedPulls.toFixed(0).padStart(8), Math.round(v.deltaMean).toString().padStart(11),
        ((v.deltaHitRate * 100).toFixed(1) + '%').padStart(8), Math.round(v.deltaCvar).toString().padStart(10),
        Math.round(v.meanPer100Pulls).toString().padStart(9), (v.worthPulling ? '  是' : '  否').padStart(7),
      )
    }
    const best = bestPolicy(world, order, scoreOf, opts)
    console.log('\n最优决策链（算出来的，不是给定的）:', best.order.map(nameOf).join(' → '), '期望总分', Math.round(best.mean))

    // 决策链比较：同一批运气下，两种优先级顺序谁更好
    const alt = [order[1], order[0], order[2]]
    const cmp = comparePolicies(world, { order: best.order }, { order: alt }, scoreOf, opts)
    console.log('\n=== 决策链比较（同一批随机数，只有顺序不同）===')
    console.log(best.order.map(nameOf).join('→'), 'vs', alt.map(nameOf).join('→'))
    console.log('配对差', Math.round(cmp.deltaMean), '± ' + Math.round(cmp.stderr * 1.96), '(95%)',
      '| 前者更优的世界线', (cmp.winRate * 100).toFixed(1) + '%',
      '| 同结果', (cmp.tieRate * 100).toFixed(1) + '%')

    // 确定性口径对照
    const detCost = expectedPullsToLimited(CHAR_POOL, 0, false)
    let budget = world.initialPulls
    const owned: string[] = []
    let detTotal = 0
    for (let t = 0; t < world.periods; t++) {
      budget += perPeriod
      for (const id of order) {
        if (!owned.includes(id) && budget >= detCost) { budget -= detCost; owned.push(id) }
      }
      detTotal += scoreOf([...owned].sort(), t)
    }
    console.log('\n=== 确定性期望价口径（现行 planner 的隐含假设）===')
    console.log('总分', Math.round(detTotal), '| 到手', owned.map(nameOf).join('+') || '无',
      '→ 相对概率口径高估', ((detTotal / base.mean - 1) * 100).toFixed(1) + '%')
    console.log('引擎求值', engineCalls(), '次 / 缓存', cacheSize(), '条（路径数 ' + opts.paths + ' 条对引擎成本零影响）；单调化修正', monotoneFixes(), '次 = 截断搜索失真次数')
    console.log('音擎档参考：专武期望', expectedPullsToLimited(WENGINE_POOL, 0, false).toFixed(1), '抽')

    expect(base.mean).toBeGreaterThan(0)
    expect(engineCalls()).toBeLessThanOrEqual(WISH.length ** 2 * periods.length)
  }, 600000)
})
// ── 价值榜（长轮）：PROBE_RANK=1 开启，参数走环境变量 ──
// 跑法（后台，可能几分钟）：
//   PROBE_RANK=1 PROBE_RANK_PERIODS=4 PROBE_RANK_CARDS=1561,1451,1531,1591 \
//   npx vitest run src/composables/__tests__/acquisitionValueEngine.test.ts
describe('探针：真引擎价值榜', () => {
  it.runIf(process.env.PROBE_RANK)('按给定预算/期数出榜，并写 .zc/pull-value-rank.json', async () => {
    const nPeriods = Number(process.env.PROBE_RANK_PERIODS ?? 4)
    const paths = Number(process.env.PROBE_RANK_PATHS ?? 1500)
    const perSpecialty = Number(process.env.PROBE_RANK_POOL ?? 2)
    const initialPulls = Number(process.env.PROBE_RANK_BANK ?? 60)
    const windowLen = Number(process.env.PROBE_RANK_WINDOW ?? 2)
    await setupHarness([{ agentId: '1011' }, { agentId: '1031' }, { agentId: '1131' }])
    const catalog = useCatalogStore()
    const calc = useResourceCalc()
    const allPeriods = buildPlannerPeriods(ALL_BOSSES, { testServerVersions: plannerTestServerVersions() })
    const periods = allPeriods.slice(-nPeriods)
    const all = catalog.displayAgents.map(a => a.id)
    const free = freePoolRepresentatives(all, catalog, perSpecialty)
    const cardIds = (process.env.PROBE_RANK_CARDS ?? '1561,1451,1531,1591').split(',').map(s => s.trim()).filter(Boolean)
    // Agent.name 是 LocalizedString（不是 string）——直接拼接会打出 [object Object]
    const nameOf = (id: string) => catalog.getAgent(id)?.name?.zhCN ?? id

    const engine = createEngineOracle({ calc, bosses: ALL_BOSSES, periodViews: [], candidatePool: [...free, ...cardIds] })
    const { scoreOf, engineCalls, cacheSize, monotoneFixes } = makeEngineScoreOf({
      oracle: engine.oracle, periods, applyPeriodContext: engine.applyPeriodContext, topM: 6,
    })
    // 窗口：按发布顺序错开（每张卡 UP windowLen 期）——现行 planner 的窗口无上界是已知近似，
    // 这里显式给上界，才能体现「错过就没了」的期权结构
    const perPeriod = Math.floor(25000 / 3 / 160)
    const world: PullWorld = {
      periods: periods.length,
      pullsPerPeriod: Array(periods.length).fill(perPeriod),
      initialPulls, initialPity: 0, initialGuaranteed: false,
      cards: cardIds.map((id, i) => {
        const open = cardIds.length > 1 ? Math.round(i * (periods.length - windowLen) / (cardIds.length - 1)) : 0
        return { id, open: Math.max(0, open), close: Math.min(periods.length - 1, open + windowLen - 1) }
      }),
    }
    const fullScores = periods.map((_, t) => scoreOf([...cardIds].sort(), t))
    const threshold = Math.min(...fullScores) * 0.9
    const opts = { paths, seed: 20260831, threshold, searchPaths: 500 }

    console.log('\n=== 场景 ===')
    console.log('期轴', periods.map(p => p.label + '(' + p.date + ')').join(' / '))
    console.log('预算 起始' + initialPulls + ' 抽 + 每期 ' + perPeriod + ' 抽（25000 菲林/版 ÷ 3 期）| 免费池 每职业' + perSpecialty + '名 → ' + free.length + ' 人 | 路径 ' + paths)
    console.log('卡与窗口', world.cards.map(c => nameOf(String(c.id)) + '[期' + c.open + '-' + c.close + ']').join(' '))
    console.log('满配基准分/期', fullScores.map(Math.round).join(' / '), '| 打穿阈值', Math.round(threshold))

    const rank = rankCards(world, cardIds, scoreOf, opts)
    console.log('\n=== 价值榜 ===')
    console.log('排名  卡              到手率  期望抽数    Δ期望分  Δ打穿率   每100抽  值得抽')
    rank.rows.forEach((v, i) => {
      console.log(
        String(i + 1).padStart(3), ' ', nameOf(v.cardId).padEnd(12),
        (v.acquireProb * 100).toFixed(0).padStart(6) + '%', v.expectedPulls.toFixed(0).padStart(8),
        Math.round(v.deltaMean).toString().padStart(11), ((v.deltaHitRate * 100).toFixed(1) + '%').padStart(8),
        Math.round(v.meanPer100Pulls).toString().padStart(9), (v.worthPulling ? '是' : '否').padStart(6),
      )
    })
    console.log('\n最优决策链（目标=期望分）', rank.bestOrder.map(nameOf).join(' → '), '| 期望总分', Math.round(rank.bestMean))
    const byHit = bestPolicy(world, cardIds, scoreOf, { ...opts, objective: 'hitRate' })
    console.log('最优决策链（目标=打穿率）', byHit.order.map(nameOf).join(' → '), '| 打穿率', (byHit.objectiveScore * 100).toFixed(1) + '%',
      byHit.order.join() === rank.bestOrder.join() ? '（与刷分目标一致）' : '← 与刷分目标不同：先说目标再谈「更好」')
    const dev = Math.abs(rank.additivityRatio - 1)
    console.log('边际之和 / 联合价值 =', rank.additivityRatio.toFixed(2),
      dev <= 0.15 ? '（接近可加，榜单可近似当预算分配）'
        : rank.additivityRatio > 1 ? '（>1 互补被重复计价：各卡都把合体收益算了一遍）'
          : '（<1 互相替代：单独禁哪张都有人顶上，边际值低估了「至少抽一张」的价值）')
    console.log('引擎求值', engineCalls(), '次 / 缓存', cacheSize(), '条 / 单调化修正', monotoneFixes(), '次')

    const artifact = {
      generatedAt: new Date().toISOString(),
      scenario: { periods: periods.map(p => ({ id: p.id, label: p.label, date: p.date })), initialPulls, perPeriod, perSpecialty, paths, windowLen, threshold },
      cards: world.cards.map(c => ({ ...c, name: nameOf(c.id) })),
      ranking: rank.rows.map(v => ({ ...v, name: nameOf(v.cardId) })),
      bestOrder: rank.bestOrder, bestMean: rank.bestMean, additivityRatio: rank.additivityRatio,
      engine: { calls: engineCalls(), cache: cacheSize(), monotoneFixes: monotoneFixes() },
    }
    mkdirSync(new URL('../../../.zc/', import.meta.url), { recursive: true })
    writeFileSync(new URL('../../../.zc/pull-value-rank.json', import.meta.url), JSON.stringify(artifact, null, 2))
    console.log('产物已写 .zc/pull-value-rank.json（gitignore，供下游消费）')

    expect(rank.rows).toHaveLength(cardIds.length)
    expect(rank.rows.every(r => r.deltaMean >= -1e-9)).toBe(true) // V* vs V* → 非负
  }, 3600000)
})
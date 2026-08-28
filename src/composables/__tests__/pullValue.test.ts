/**
 * 抽卡价值 · 危局兑现（pullValue）测试：
 * - fixture：配对差分 / 作者固定效应吸收 / 删失计 0 / 期中实装门槛 / 分层 / ROI / 四分位分级；
 * - 真实归档冒烟：房间排序、统计合理、分级非空、累计 = 逐期之和。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  computePullValue,
  MIN_PAIRS_FOR_GRADE,
  pvReleaseDateOf,
  pvTierOf,
  type PullValueInput,
  type PvRun,
} from '@/composables/pullValue'

// ========== fixture 构造 ==========

const SEASONS: PullValueInput['seasons'] = {
  // 真实赛季 69043：2026-08-13 ~ 08-27（希格莉德 2026-08-19 期中实装可上场）
  '69043': { start: '2026-08-13T20:00:00.000Z', end: '2026-08-27T19:59:00.000Z' },
  // 真实赛季 69042：2026-07-29 ~ 08-12
  '69042': { start: '2026-07-29T20:00:00.000Z', end: '2026-08-12T19:59:00.000Z' },
}
const ROOMS: PullValueInput['rooms'] = {
  '69043-1': { bossNameZh: 'Boss甲' },
  '69042-1': { bossNameZh: 'Boss乙' },
}

let runSeq = 0
function run(
  seasonId: string,
  author: string,
  score: number,
  team: string[],
  mode = 'Deadly Assault',
): PvRun {
  return { id: `r${runSeq++}`, seasonId, targetId: `${seasonId}-1`, mode, score, authorName: author, team: team.map(agentId => ({ agentId })) }
}

describe('pullValue · 配对差分与固定效应吸收', () => {
  it('同作者同房间 带卡 vs 不带卡 的最佳分差 = 卡边际；绝对分位差异（玩家技术）被差分吸收', () => {
    const res = computePullValue({
      runs: [
        // 高技术作者：带仪玄 60000 / 不带 50000
        run('69043', 'skilled', 60000, ['1371', '1021', '1031']),
        run('69043', 'skilled', 50000, ['1021', '1031', '1041']),
        // 低技术作者：带 30000 / 不带 20000
        run('69043', 'casual', 30000, ['1371', '1021', '1031']),
        run('69043', 'casual', 20000, ['1021', '1031', '1041']),
      ],
      seasons: SEASONS,
      rooms: ROOMS,
    })
    const yixuan = res.cards.find(c => c.agentId === '1371')!
    expect(yixuan.roomEffects).toHaveLength(1) // 房间轴 = 有投稿的房间（69042 无投稿不进轴）
    const roomA = yixuan.roomEffects.find(e => e.roomKey === '69043|69043-1')!
    expect(roomA.effect).toBe(10000)
    expect(roomA.pairs).toBe(2)
    expect(yixuan.cumulative).toBe(10000)
    expect(yixuan.observableRooms).toBe(1)
    expect(yixuan.roomsAppeared).toBe(1)
    // 作者技能差 3 万分（60000 vs 30000）不进入估计——效应与技能水平无关
  })

  it('跨作者取中位数（robust）：[20000, 10000, -5000] → 10000', () => {
    const res = computePullValue({
      runs: [
        run('69043', 'a1', 40000, ['1371', '1021', '1031']),
        run('69043', 'a1', 20000, ['1021', '1031', '1041']),
        run('69043', 'a2', 30000, ['1371', '1021', '1031']),
        run('69043', 'a2', 20000, ['1021', '1031', '1041']),
        run('69043', 'a3', 15000, ['1371', '1021', '1031']),
        run('69043', 'a3', 20000, ['1021', '1031', '1041']),
      ],
      seasons: SEASONS,
      rooms: ROOMS,
    })
    const yixuan = res.cards.find(c => c.agentId === '1371')!
    expect(yixuan.roomEffects.find(e => e.roomKey === '69043|69043-1')!.effect).toBe(10000)
  })

  it('分数上限删失：带/不带都打满 65000 → 边际计 0（顶部饱和如实呈现）', () => {
    const res = computePullValue({
      runs: [
        run('69043', 'a1', 65000, ['1371', '1021', '1031']),
        run('69043', 'a1', 65000, ['1021', '1031', '1041']),
      ],
      seasons: SEASONS,
      rooms: ROOMS,
    })
    const yixuan = res.cards.find(c => c.agentId === '1371')!
    expect(yixuan.cumulative).toBe(0)
  })

  it('顶分在场（frontier）：房间最高分队伍成员打标（含并列）', () => {
    const res = computePullValue({
      runs: [
        run('69043', 'a1', 65000, ['1371', '1021', '1031']),
        run('69043', 'a2', 65000, ['1251', '1021', '1031']),
        run('69043', 'a3', 30000, ['1261', '1021', '1031']),
      ],
      seasons: SEASONS,
      rooms: ROOMS,
    })
    const roomA = res.rooms.find(r => r.key === '69043|69043-1')!
    expect(roomA.maxScore).toBe(65000)
    expect(roomA.capCount).toBe(2)
    expect(res.cards.find(c => c.agentId === '1371')!.frontierRooms).toBe(1)
    expect(res.cards.find(c => c.agentId === '1251')!.frontierRooms).toBe(1)
    expect(res.cards.find(c => c.agentId === '1261')!.frontierRooms).toBe(0)
  })
})

describe('pullValue · 实装门槛（期中实装）与观测窗口', () => {
  it('卡实装日晚于某期结束日 → 该期不计（即使归档中有实装前异常出场）；期中实装算该期可用', () => {
    // 希格莉德 1591 实装 2026-08-19：
    // - 69043（08-13 ~ 08-27）：end ≥ 实装日 → 可用；
    // - 69042（07-29 ~ 08-12）：end < 实装日 → 不可用（放入一条异常数据验证被拒）
    const res = computePullValue({
      runs: [
        run('69043', 'a1', 60000, ['1591', '1021', '1031']),
        run('69043', 'a1', 40000, ['1021', '1031', '1041']),
        // 异常：实装前出场（数据错误防御）——不应计入
        run('69042', 'a1', 50000, ['1591', '1021', '1031']),
        run('69042', 'a1', 20000, ['1021', '1031', '1041']),
      ],
      seasons: SEASONS,
      rooms: ROOMS,
    })
    const sigrid = res.cards.find(c => c.agentId === '1591')!
    expect(sigrid.releaseDate).toBe('2026-08-19')
    expect(sigrid.firstRoomIndex).toBe(1) // 房间轴：69042(07-29) 在前 0、69043(08-13) 在后 1；后者 end ≥ 实装日
    const effectsByKey = new Map(sigrid.roomEffects.map(e => [e.roomKey, e]))
    expect(effectsByKey.get('69042|69042-1')!.effect).toBe(0)
    expect(effectsByKey.get('69042|69042-1')!.appeared).toBe(false)
    expect(effectsByKey.get('69043|69043-1')!.effect).toBe(20000)
    expect(sigrid.cumulative).toBe(20000)
    expect(sigrid.observableRooms).toBe(1)
    // 房间时间轴按开始日升序：69042 在前
    expect(res.rooms[0].key).toBe('69042|69042-1')
  })

  it('从未出场的限定 S 也列出（兑现 0）；无实装日期的 A 级从首次出场起观测', () => {
    const res = computePullValue({
      runs: [run('69043', 'a1', 30000, ['1031', '1021', '1041'])],
      seasons: SEASONS,
      rooms: ROOMS,
    })
    // 仪玄没出场但列出，累计 0、等级 null（无配对样本）
    const yixuan = res.cards.find(c => c.agentId === '1371')!
    expect(yixuan.cumulative).toBe(0)
    expect(yixuan.grade).toBeNull()
    expect(yixuan.roomsAppeared).toBe(0)
    // 妮可（A 级，无实装日期）从首次出场房间起算
    const nico = res.cards.find(c => c.agentId === '1031')!
    expect(nico.releaseDate).toBeNull()
    expect(nico.firstRoomIndex).toBeGreaterThanOrEqual(0)
    expect(nico.tier).toBe('aRank')
  })
})

describe('pullValue · 分层与 ROI', () => {
  it('tier：限定 / 常驻 / 赠送 / A 级特例（潘引壶）', () => {
    expect(pvTierOf('1371')).toBe('limited') // 仪玄 限定
    expect(pvTierOf('1021')).toBe('standard') // 猫又 常驻
    expect(pvTierOf('1551')).toBe('freeGift') // 佩洛伊斯 赠送
    expect(pvTierOf('1421')).toBe('aRank') // 潘引壶 A 级特例
    expect(pvTierOf('1031')).toBe('aRank') // 妮可 未收录
    expect(pvReleaseDateOf('1371')).toBe('2025-06-06')
  })

  it('ROI = 累计 / (CINEMA_GOLD_FILM/10000)；赠送卡 ROI = null', () => {
    const res = computePullValue({
      runs: [
        run('69043', 'a1', 60000, ['1371', '1021', '1031']),
        run('69043', 'a1', 45000, ['1021', '1031', '1041']),
        run('69043', 'a2', 50000, ['1551', '1021', '1031']),
        run('69043', 'a2', 40000, ['1021', '1031', '1041']),
      ],
      seasons: SEASONS,
      rooms: ROOMS,
    })
    const yixuan = res.cards.find(c => c.agentId === '1371')!
    expect(yixuan.cumulative).toBe(15000)
    expect(yixuan.roiPer10kFilm).toBeCloseTo(15000 / 1.5, 6) // 15000 菲林/金 → 每万菲林 1.5 万分位换算
    expect(res.cards.find(c => c.agentId === '1551')!.roiPer10kFilm).toBeNull()
  })
})

describe('pullValue · 四分位分级', () => {
  /** 生成一张卡在两房间的配对差分数据：N 作者 × (带卡 base+lift / 不带 base) */
  function pairedRuns(cardId: string, lift: number, nAuthors: number, seasonIds: string[] = ['69043', '69042']): PvRun[] {
    const out: PvRun[] = []
    for (let i = 0; i < nAuthors; i++) {
      for (const sid of seasonIds) {
        out.push(run(sid, `${cardId}-a${i}`, 30000 + lift, [cardId, '1021', '1031']))
        out.push(run(sid, `${cardId}-a${i}`, 30000, ['1021', '1031', '1041']))
      }
    }
    return out
  }

  it('限定池按累计四分位 → T0..T3；配对不足 → 样本不足(null)；非限定不参与', () => {
    // 8 张限定卡，lift 各不同（每卡 8 作者 × 2 房间 = 16 对 ≥ 阈值 10）
    const lifts: Array<[string, number]> = [
      ['1371', 20000], // 仪玄 最高
      ['1251', 15000],
      ['1261', 10000],
      ['1071', 5000],
      ['1171', 2000],
      ['1221', 1000],
      ['1161', 500],
      ['1191', 100], // 艾莲 最低
    ]
    const runs = lifts.flatMap(([id, lift]) => pairedRuns(id, lift, 8))
    // 配对不足的卡：仅 2 作者（4 对 < 10）
    runs.push(...pairedRuns('1481', 99000, 2))
    // 常驻 S 不参与分级（同样有充足配对）
    runs.push(...pairedRuns('1021', 99000, 8))

    const res = computePullValue({ runs, seasons: SEASONS, rooms: ROOMS })
    const byId = new Map(res.cards.map(c => [c.agentId, c]))
    expect(byId.get('1371')!.grade).toBe('T0')
    expect(byId.get('1191')!.grade).toBe('T3')
    expect(byId.get('1481')!.grade).toBeNull() // 配对 4 < MIN_PAIRS_FOR_GRADE
    expect(byId.get('1021')!.grade).toBeNull() // 常驻 S 不分级
    // 累计降序排列
    const limitedCums = res.cards.filter(c => c.tier === 'limited').map(c => c.cumulative)
    expect([...limitedCums].sort((a, b) => b - a)).toEqual(limitedCums)
    // 全部合格限定卡都有等级
    for (const c of res.cards) {
      if (c.tier === 'limited' && c.totalPairs >= MIN_PAIRS_FOR_GRADE) expect(c.grade).not.toBeNull()
    }
  })

  it('累计 = 逐期效应之和；场均按可观测期数摊平', () => {
    const runs = pairedRuns('1371', 6000, 5)
    const res = computePullValue({ runs, seasons: SEASONS, rooms: ROOMS })
    const yixuan = res.cards.find(c => c.agentId === '1371')!
    expect(yixuan.roomEffects.reduce((s, e) => s + e.effect, 0)).toBe(yixuan.cumulative)
    expect(yixuan.cumulative).toBe(12000) // 两房间 × 6000
    expect(yixuan.avgPerRoom).toBe(6000)
    expect(yixuan.recentAvg).toBe(6000) // 近 3 期（不足 3 期按实际 2 期）
  })
})

// ========== 真实归档冒烟 ==========

const REAL = JSON.parse(readFileSync(new URL('../../../public/static/run-archive.json', import.meta.url), 'utf8')) as PullValueInput & { totalRuns: number }

describe('pullValue · 真实归档冒烟（run-archive.json）', () => {
  const res = computePullValue({ runs: REAL.runs, seasons: REAL.seasons, rooms: REAL.rooms })

  it('窗口与房间轴：排序单调、日期非空、含普通与困难两种模式', () => {
    expect(res.window.runCount).toBe(REAL.totalRuns)
    expect(res.rooms.length).toBeGreaterThan(20)
    for (let i = 1; i < res.rooms.length; i++) {
      expect(res.rooms[i - 1].date.localeCompare(res.rooms[i].date)).toBeLessThanOrEqual(0)
    }
    for (const r of res.rooms) {
      expect(r.date).not.toBe('')
      expect(r.runCount).toBeGreaterThan(0)
      expect(r.authorCount).toBeGreaterThan(0)
    }
    expect(res.rooms.some(r => r.mode === 'adversity')).toBe(true)
    expect(res.rooms.some(r => r.mode === 'normal')).toBe(true)
  })

  it('判别力已知钉子：星徽·比利(1531) 累计兑现显著为正；A 级基线存在负边际（机会差）', () => {
    const billy = res.cards.find(c => c.agentId === '1531')!
    expect(billy.tier).toBe('limited')
    expect(billy.cumulative).toBeGreaterThan(30000)
    expect(billy.grade).toBe('T0')
    const nico = res.cards.find(c => c.agentId === '1031')!
    expect(nico.tier).toBe('aRank')
    expect(nico.cumulative).toBeLessThan(0)
  })

  it('一致性与分级覆盖：累计 = Σ逐期；合格限定卡全有等级；从未出场的限定 S 兑现 0', () => {
    for (const c of res.cards.slice(0, 5)) {
      expect(c.roomEffects.reduce((s, e) => s + e.effect, 0)).toBeCloseTo(c.cumulative, 6)
      expect(c.roomEffects).toHaveLength(res.rooms.length)
    }
    const qualified = res.cards.filter(c => (c.tier === 'limited' || c.tier === 'freeGift') && c.totalPairs >= MIN_PAIRS_FOR_GRADE)
    expect(qualified.length).toBeGreaterThanOrEqual(8)
    for (const c of qualified) expect(c.grade).not.toBeNull()
    const never = res.cards.filter(c => c.tier === 'limited' && c.roomsAppeared === 0)
    for (const c of never) {
      expect(c.cumulative).toBe(0)
      expect(c.grade).toBeNull()
    }
  })
})

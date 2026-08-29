/**
 * 角色分数增量（charIncrement）纯逻辑测试：
 * - 基底提取：强队阈值 / 金数窗 / 构成去重 / 每桶封顶 / Adversity 排除 / 无映射房间跳过
 * - 期结算：3 房不重叠 DFS + 跳过分支（数据不全的房 = 0 分）
 * - 增量语义：禁含卡队 → 账号分下降；卢西娅式「专拐被禁 → 被迫潘引壶」的替代差；
 *   不在任何队里的卡增量 0；实装前期 = null 不进累计
 */
import { describe, expect, it } from 'vitest'
import {
  assignRooms,
  computeAllCardTotals,
  computeCardIncrements,
  extractBaseTeams,
  incrementForCard,
  type BaseTeam,
  type IncPeriod,
  type IncRun,
  type RoomMeta,
} from '@/composables/charIncrement'

// ========== fixture 构造 ==========

function run(
  targetId: string,
  score: number,
  team: Array<[string, number, number]>, // [agentId, mindscape, phase]
  mode = 'Deadly Assault',
): IncRun {
  return {
    seasonId: targetId.split('-')[0],
    targetId,
    mode,
    score,
    team: team.map(([agentId, mindscape, phase]) => ({ agentId, mindscape, phase, weaponId: '' })),
  }
}

/** 限定 id：仪玄 1371 / 卢西娅 1451 / 潘引壶 1421（A 特例 0 金）/ 常驻 1021 / A 级 1031 */
const META: RoomMeta = {
  'P1-1': { bossId: 'B1', periodId: 'P1' },
  'P1-2': { bossId: 'B2', periodId: 'P1' },
  'P2-1': { bossId: 'B1', periodId: 'P2' },
}

function baseTeam(bossId: string, members: Array<[string, number, number]>, gold: number, bestScore: number): BaseTeam {
  return {
    bossId,
    members: members.map(([agentId, mindscape, phase]) => ({ agentId, mindscape, weaponId: null, phase })) as BaseTeam['members'],
    gold,
    bestScore,
  }
}

function period(rooms: Array<{ bossId: string; bossName: string; hp: number; scores: Array<{ team: BaseTeam; score: number }> }>): IncPeriod {
  return { id: 'P1', label: 'P1', date: '2026-08-01', rooms }
}

describe('charIncrement · 基底提取', () => {
  it('强队阈值 90% + 金数窗 [min, min+4]：弱队与高金队被剔除', () => {
    const runs = [
      // B1 桶：顶分 65000；强队线 = 58500
      run('P1-1', 65000, [['1371', 0, 1], ['1021', 0, 1], ['1031', 0, 1]]), // 1 金（仪玄本体）→ min
      run('P1-1', 64000, [['1371', 1, 1], ['1021', 0, 1], ['1031', 0, 1]]), // 2 金 ✓ 窗内
      run('P1-1', 60000, [['1371', 6, 1], ['1021', 0, 1], ['1031', 0, 1]]), // 7 金 ✗ 窗外（>1+4）
      run('P1-1', 50000, [['1021', 0, 1], ['1031', 0, 1], ['1121', 0, 1]]), // 0 金 ✓ 窗内但 < 90% 顶分 ✗
    ]
    const base = extractBaseTeams(runs, META)
    const b1 = base.get('P1|B1')!
    expect(b1).toHaveLength(2) // 1 金 + 2 金
    expect(b1.map(t => t.gold).sort()).toEqual([1, 2])
  })

  it('构成去重保留顶分 run；Adversity 排除；无映射房间跳过', () => {
    const runs = [
      run('P1-1', 60000, [['1371', 0, 1], ['1021', 0, 1], ['1031', 0, 1]]),
      run('P1-1', 62000, [['1371', 0, 1], ['1021', 0, 1], ['1031', 0, 1]]), // 同构成 → 保留这条
      run('P1-1', 65000, [['1021', 0, 1], ['1031', 0, 1], ['1121', 0, 1]], 'Deadly Assault: Adversity Mode'), // 困难 ✗
      run('P9-9', 65000, [['1371', 0, 1], ['1021', 0, 1], ['1031', 0, 1]]), // 无映射 ✗
    ]
    const base = extractBaseTeams(runs, META)
    const b1 = base.get('P1|B1')!
    expect(b1).toHaveLength(1)
    expect(b1[0].bestScore).toBe(62000)
  })

  it('每桶封顶 maxPerBoss（按 bestScore 降序取前 N）', () => {
    const runs = [1, 2, 3, 4].map(i =>
      run('P1-1', 60000 + i * 100, [['1371', i, 1], ['1021', 0, 1], ['1031', 0, 1]]),
    )
    const base = extractBaseTeams(runs, META, { maxPerBoss: 2 })
    expect(base.get('P1|B1')!).toHaveLength(2)
    expect(base.get('P1|B1')![0].bestScore).toBe(60400)
  })
})

describe('charIncrement · 期结算（不重叠 DFS）', () => {
  it('3 房 9 人不重叠取最优；跨房抢人时放弃高分重叠队', () => {
    const strong: BaseTeam = baseTeam('B1', [['1371', 0, 1], ['1021', 0, 1], ['1031', 0, 1]], 1, 65000)
    const alt: BaseTeam = baseTeam('B2', [['1451', 0, 1], ['1141', 0, 1], ['1181', 0, 1]], 1, 60000)
    const third: BaseTeam = baseTeam('B3', [['1251', 0, 1], ['1161', 0, 1], ['1261', 0, 1]], 1, 55000)
    const p = period([
      { bossId: 'B1', bossName: 'b1', hp: 100, scores: [{ team: strong, score: 60000 }] },
      { bossId: 'B2', bossName: 'b2', hp: 100, scores: [{ team: strong, score: 59000 }, { team: alt, score: 45000 }] },
      { bossId: 'B3', bossName: 'b3', hp: 100, scores: [{ team: third, score: 50000 }] },
    ])
    const res = assignRooms(p.rooms)
    // 房2 不能复用 strong（房1 已占 3 人）→ 退而求 alt(45000)
    expect(res.total).toBe(60000 + 45000 + 50000)
    expect(res.picks.every(x => x.team != null)).toBe(true)
  })

  it('跳过分支：某房全队被禁 → 该房 0 分（不阻塞其他房）', () => {
    const only: BaseTeam = baseTeam('B1', [['1371', 0, 1], ['1021', 0, 1], ['1031', 0, 1]], 1, 65000)
    const p = period([
      { bossId: 'B1', bossName: 'b1', hp: 100, scores: [{ team: only, score: 60000 }] },
      { bossId: 'B2', bossName: 'b2', hp: 100, scores: [{ team: only, score: 60000 }] },
    ])
    const res = assignRooms(p.rooms)
    expect(res.total).toBe(60000) // 只能选一房
    expect(res.picks.some(x => x.team == null)).toBe(true)
  })
})

describe('charIncrement · 单卡增量语义', () => {
  /** 卢西娅式场景：命破房（B1）两队——卢西娅队 65000 / 潘引壶队 55000；
   *  其他房（B2）与卢西娅无关。禁卢西娅 → B1 退潘引壶 → 账号分掉 10000 = 她的增量。 */
  const luciaTeam = baseTeam('B1', [['1371', 0, 1], ['1451', 0, 1], ['1031', 0, 1]], 2, 65000)
  const panhuTeam = baseTeam('B1', [['1371', 0, 1], ['1421', 0, 1], ['1031', 0, 1]], 1, 55000)
  const otherTeam = baseTeam('B2', [['1251', 0, 1], ['1161', 0, 1], ['1261', 0, 1]], 1, 60000)
  const p = period([
    { bossId: 'B1', bossName: '命破Boss', hp: 100, scores: [{ team: luciaTeam, score: 60000 }, { team: panhuTeam, score: 50000 }] },
    { bossId: 'B2', bossName: '其他Boss', hp: 100, scores: [{ team: otherTeam, score: 55000 }] },
  ])

  it('禁用专拐 → 被迫下位替代，增量 = 分差（卢西娅钉子）', () => {
    const inc = incrementForCard(p, '1451')
    expect(inc.accountScore).toBe(60000 + 55000)
    expect(inc.bannedScore).toBe(50000 + 55000)
    expect(inc.increment).toBe(10000)
    // 禁卡后 B1 房的替代队 = 潘引壶队（替代差可视化）
    const b1Banned = inc.bannedPicks[0]
    expect(b1Banned.team?.members.some(m => m.agentId === '1421')).toBe(true)
  })

  it('不在任何队里的卡增量 0；主C被禁（两队都以他为主C）→ 房间塌到 0', () => {
    expect(incrementForCard(p, '1581').increment).toBe(0) // 不在任何基底队
    const incMain = incrementForCard(p, '1371')
    // 卢队与潘队都含仪玄（命破主C不可替代）：禁他 → B1 房无队可用 → 0 分
    expect(incMain.bannedScore).toBe(55000) // 只剩 B2 房
    expect(incMain.increment).toBe(60000) // B1 房整房塌掉
  })

  it('卡「不可替代」时禁用 → 房间 0 分（跳过分支兜底）', () => {
    const solo = period([{ bossId: 'B1', bossName: 'b', hp: 100, scores: [{ team: luciaTeam, score: 60000 }] }])
    const inc = incrementForCard(solo, '1451')
    expect(inc.bannedScore).toBe(0)
    expect(inc.increment).toBe(60000)
  })
})

describe('charIncrement · 卡片增量曲线与排名', () => {
  const luciaTeam = baseTeam('B1', [['1371', 0, 1], ['1451', 0, 1], ['1031', 0, 1]], 2, 65000)
  const panhuTeam = baseTeam('B1', [['1371', 0, 1], ['1421', 0, 1], ['1031', 0, 1]], 1, 55000)
  const periods: IncPeriod[] = [
    {
      id: 'P1', label: 'P1', date: '2026-07-01',
      rooms: [{ bossId: 'B1', bossName: 'b', hp: 100, scores: [{ team: luciaTeam, score: 60000 }] }],
    },
    {
      id: 'P2', label: 'P2', date: '2026-08-01',
      rooms: [{ bossId: 'B1', bossName: 'b', hp: 100, scores: [{ team: luciaTeam, score: 58000 }, { team: panhuTeam, score: 50000 }] }],
    },
  ]

  it('实装前 = null 不进累计；累计 = Σ 实装后增量', () => {
    // 卢西娅 2025-12-17 实装 → 两期都在实装后
    const inc = computeCardIncrements(periods, '1451', '2025-12-17')
    expect(inc.perPeriod).toHaveLength(2)
    expect(inc.perPeriod.every(x => x != null)).toBe(true)
    expect(inc.total).toBe(60000 + 8000)
    // 假设一张 2026-07-15 实装的卡：P1 在实装前 → null
    const later = computeCardIncrements(periods, '1581', '2026-07-15')
    expect(later.perPeriod[0]).toBeNull()
    expect(later.perPeriod[1]).not.toBeNull()
    expect(later.total).toBe(computeCardIncrements([periods[1]], '1581', null).total)
  })

  it('全卡排名：按累计降序；未进任何队的卡累计 0', () => {
    const cards = [
      { agentId: '1451', releaseDate: '2025-12-17' },
      { agentId: '1371', releaseDate: '2025-06-06' },
      { agentId: '1581', releaseDate: '2026-07-29' }, // 不在任何队
    ]
    const rank = computeAllCardTotals(periods, cards)
    expect(rank[0].agentId).toBe('1371') // 主C两期都在队里，累计最高
    expect(rank.find(c => c.agentId === '1581')!.total).toBe(0)
    expect(rank[0].total).toBeGreaterThanOrEqual(rank[1].total)
  })
})

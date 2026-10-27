import { describe, expect, it } from 'vitest'
import { authorOf, queryArchiveRuns } from '@/composables/runArchiveFilter'
import { runLimitedGold } from '@/composables/limitedGold'

/**
 * 实战对比页筛选（用户 2026-10-26：「某个顶级玩家的所有战斗 / 某个角色的所有顶分战斗」）。
 *
 * 金数用真实限定额度控制（`runLimitedGold` 是唯一口径，测试不另算一份）：
 * - 1241（限定 S）M0 = 1 金；M2 = 3 金
 * - 1191（限定 S）+ 14152（限定 S 音擎）p1 = 2 金；再 M2 = 4 金
 * - 1041（常驻 S）M6 = 0 金；1421（A 级特例）M6 = 0 金
 */

interface Member { agentId: string; mindscape?: number; weaponId?: string; phase?: number }
interface Run {
  id: string
  seasonId: string
  targetId: string
  score: number
  bossKilled?: boolean
  authorName?: string
  team: Member[]
}

function run(id: string, authorName: string, team: Member[], room = 's1|t1', extra: Partial<Run> = {}): Run {
  const [seasonId, targetId] = room.split('|')
  return { id, seasonId, targetId, score: 65000, bossKilled: true, authorName, team, ...extra }
}

const ROOM1_LOW = run('r-low', '阿甲', [{ agentId: '1241', mindscape: 0 }]) // 1 金
const ROOM1_MID = run('r-mid', '阿乙', [{ agentId: '1191', mindscape: 0, weaponId: '14152', phase: 1 }]) // 2 金
const ROOM1_HIGH = run('r-high', '阿丙', [{ agentId: '1191', mindscape: 2, weaponId: '14152', phase: 1 }]) // 4 金
const ROOM2_LOW = run('r2-low', '阿甲', [{ agentId: '1041', mindscape: 6 }], 's1|t2') // 0 金（常驻 S 不计）
const ROOM2_HIGH = run('r2-high', '阿乙', [{ agentId: '1241', mindscape: 2 }], 's1|t2') // 3 金

const ALL = [ROOM1_LOW, ROOM1_MID, ROOM1_HIGH, ROOM2_LOW, ROOM2_HIGH]

describe('authorOf 投稿人归并', () => {
  it('去空白；空 / 纯空白归到「未署名」', () => {
    expect(authorOf({ authorName: '  Kodie ' })).toBe('Kodie')
    expect(authorOf({ authorName: '' })).toBe('（未署名）')
    expect(authorOf({ authorName: '   ' })).toBe('（未署名）')
    expect(authorOf({})).toBe('（未署名）')
  })
})

describe('顶分判定（lowGoldFrontier 单一实现）', () => {
  it('窗口 0 = 只认每房最低金：room1 只有 1 金的 r-low，room2 只有 0 金的 r2-low', () => {
    const q = queryArchiveRuns(ALL, { goldWindow: 0 })
    expect([...q.frontierIds].sort()).toEqual(['r-low', 'r2-low'])
    expect(q.frontierCount).toBe(2)
    expect(q.roomCount).toBe(2)
  })

  it('窗口 +1 放宽一金：room1 纳入 2 金的 r-mid，room2 不变（+1 后仍最低金独一份）', () => {
    const q = queryArchiveRuns(ALL, { goldWindow: 1 })
    expect([...q.frontierIds].sort()).toEqual(['r-low', 'r-mid', 'r2-low'])
  })

  it('killedOnly：未击杀的低金 run 不进顶分集合（但仍会出现在行里）', () => {
    const notKilled = run('r-nk', '阿丁', [{ agentId: '1241', mindscape: 0 }], 's1|t1', { bossKilled: false })
    // 同房同金并列 → 都算顶分；把 killed 关掉的那条排除后，r-low 仍是顶分
    const q = queryArchiveRuns([notKilled, ROOM1_LOW], { goldWindow: 0 })
    expect(q.frontierIds.has('r-nk')).toBe(false)
    expect(q.frontierIds.has('r-low')).toBe(true)
    expect(queryArchiveRuns([notKilled], { goldWindow: 0 }).frontierCount).toBe(0)
  })

  it('@fact 口径：顶分集合在玩家 / 角色筛选之前算（先收窄再求前沿会得出不同答案）', () => {
    // 阿乙 的 2 金 run 不是顶分；阿甲 的 1 金 run 是。按「先筛玩家再求顶分」会错误地把 r-mid 判成顶分。
    const q = queryArchiveRuns(ALL, { goldWindow: 0, player: '阿乙' })
    expect(q.frontierIds.has('r-low')).toBe(true)
    expect(q.frontierIds.has('r-mid')).toBe(false)
    expect(q.topPlayers.has('阿甲')).toBe(true)
    expect(q.topPlayers.has('阿乙')).toBe(false)
    // 选了玩家 = 看他的全部投稿（不是只看顶分）
    expect(q.rows.map((r) => r.id)).toEqual(['r-mid', 'r2-high'])
  })
})

describe('顶级玩家 = 至少有一条顶分战斗的投稿人', () => {
  it('窗口 0：顶级玩家 = 阿甲（room1 1 金 + room2 0 金）；阿乙 / 阿丙 不在', () => {
    const q = queryArchiveRuns(ALL, { goldWindow: 0 })
    expect([...q.topPlayers].sort()).toEqual(['阿甲'])
  })

  it('窗口 +1（「稍微宽松」旋钮）：阿乙 因 2 金的 r-mid 进入顶级玩家，阿丙（4 金）仍不在', () => {
    const q = queryArchiveRuns(ALL, { goldWindow: 1 })
    expect([...q.topPlayers].sort()).toEqual(['阿乙', '阿甲'])
  })

  it('topPlayersOnly：只留顶级玩家的投稿；没开时是全部', () => {
    const all = queryArchiveRuns(ALL, { goldWindow: 0 })
    expect(all.rows).toHaveLength(ALL.length)
    const onlyTop = queryArchiveRuns(ALL, { goldWindow: 0, topPlayersOnly: true })
    expect(onlyTop.rows.map((r) => r.id)).toEqual(['r-low', 'r2-low'])
  })

  it('选了具体玩家时 topPlayersOnly 不再收窄（用户点了一个人就要看他的全部）', () => {
    const q = queryArchiveRuns(ALL, { goldWindow: 0, player: '阿丙', topPlayersOnly: true })
    expect(q.rows.map((r) => r.id)).toEqual(['r-high'])
    expect(q.topPlayers.has('阿丙')).toBe(false)
  })

  it('选中玩家 + 只看顶分 = 只留他本人打到顶分的那几条', () => {
    expect(queryArchiveRuns(ALL, { goldWindow: 0, player: '阿甲', frontierOnly: true }).rows.map((r) => r.id)).toEqual([
      'r-low',
      'r2-low',
    ])
    expect(queryArchiveRuns(ALL, { goldWindow: 0, player: '阿乙', frontierOnly: true }).rows).toEqual([])
  })
})

describe('角色筛选（任一槽位，不是「主C」）', () => {
  it('队伍第二个槽位的角色也能筛到', () => {
    const twoSlots = run('r-2slot', '阿戊', [{ agentId: '1041', mindscape: 6 }, { agentId: '1241', mindscape: 0 }])
    const q = queryArchiveRuns([...ALL, twoSlots], { goldWindow: 0, agentId: '1241' })
    expect(q.rows.map((r) => r.id)).toEqual(['r-low', 'r2-high', 'r-2slot'])
  })

  it('角色 × 只看顶分 = 「某个角色的所有顶分战斗」', () => {
    const q = queryArchiveRuns(ALL, { goldWindow: 0, agentId: '1241', frontierOnly: true })
    expect(q.rows.map((r) => r.id)).toEqual(['r-low'])
  })

  it('角色筛选与玩家筛选可叠加', () => {
    const q = queryArchiveRuns(ALL, { goldWindow: 0, agentId: '1191', player: '阿丙' })
    expect(q.rows.map((r) => r.id)).toEqual(['r-high'])
  })

  it('同一队里重复角色只计一场', () => {
    const dup = run('r-dup', '阿己', [{ agentId: '1241', mindscape: 0 }, { agentId: '1241', mindscape: 0 }])
    const q = queryArchiveRuns([...ALL, dup], { goldWindow: 0 })
    const facet = q.agents.find((a) => a.agentId === '1241')
    // r-low + r2-high + r-dup = 3 场（dup 内部只算 1）
    expect(facet?.runs).toBe(3)
  })
})

describe('分面（下拉选项 + 选中后的摘要）', () => {
  it('玩家分面：场数 / 顶分数 / 最低金；按顶分数降序', () => {
    const q = queryArchiveRuns(ALL, { goldWindow: 0 })
    expect(q.players.map((p) => [p.name, p.runs, p.frontierRuns, p.minGold])).toEqual([
      ['阿甲', 2, 2, 0],
      ['阿乙', 2, 0, 2],
      ['阿丙', 1, 0, 4],
    ])
  })

  it('角色分面：场数 / 顶分数 / 最低金；按顶分数降序（1241 有 room1 顶分）', () => {
    const q = queryArchiveRuns(ALL, { goldWindow: 0 })
    expect(q.agents.map((a) => [a.agentId, a.runs, a.frontierRuns, a.minGold])).toEqual([
      ['1241', 2, 1, 1],
      ['1041', 1, 1, 0],
      ['1191', 2, 0, 2],
    ])
  })

  it('分面在候选范围上算，不随行筛选抖动（选玩家后其他人仍在下拉里）', () => {
    const base = queryArchiveRuns(ALL, { goldWindow: 0 })
    const filtered = queryArchiveRuns(ALL, { goldWindow: 0, player: '阿甲', frontierOnly: true })
    expect(filtered.players.map((p) => p.name)).toEqual(base.players.map((p) => p.name))
    expect(filtered.agents.map((a) => a.agentId)).toEqual(base.agents.map((a) => a.agentId))
  })

  it('顶分窗口不影响行数（只影响顶分判定）：同一份输入全量行恒等', () => {
    expect(queryArchiveRuns(ALL, { goldWindow: 0 }).rows).toHaveLength(5)
    expect(queryArchiveRuns(ALL, { goldWindow: 4 }).rows).toHaveLength(5)
  })
})

describe('金数口径单源', () => {
  it('分面最低金 = runLimitedGold 的结果（不另写公式）', () => {
    expect(runLimitedGold(ROOM1_MID.team)).toBe(2)
    expect(runLimitedGold(ROOM2_LOW.team)).toBe(0)
    const q = queryArchiveRuns(ALL, { goldWindow: 0 })
    expect(q.players.find((p) => p.name === '阿乙')?.minGold).toBe(2)
    expect(q.players.find((p) => p.name === '阿甲')?.minGold).toBe(0)
  })
})

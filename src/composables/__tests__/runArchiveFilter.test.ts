import { describe, expect, it } from 'vitest'
import { authorOf, EXPERT_RULE, lowGoldExpertAuthors, queryArchiveRuns } from '@/composables/runArchiveFilter'
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

describe('高手 = 给任意角色出过最低金（用户 2026-11-07）', () => {
  /**
   * 判据是**逐角色**的：同一房里每个角色各算各的最低金记录（不是整队最低金、也不是该房最低金）。
   * ALL 里的既有记录（runLimitedGold 实测）：1241@s1|t1 = 1 金（r-low 阿甲）、1191@s1|t1 = 2 金（r-mid 阿乙）、
   * 1041@s1|t2 = 0 金（r2-low 阿甲）、1241@s1|t2 = 3 金（r2-high 阿乙）；阿丙（r-high 4 金）不握任何记录。
   */
  const CHEAP_KILL = run('r-cheap-kill', '阿庚', [{ agentId: '1471', mindscape: 0 }], 's1|t1', { score: 50000 }) // 1 金，击杀
  const CHEAP_MISS = run('r-cheap-miss', '阿辛', [{ agentId: '1571', mindscape: 0 }], 's1|t2', {
    score: 50000,
    bossKilled: false,
  }) // 1 金，但没击杀
  // 1471 记录 = CHEAP_KILL 的 1 金；这条 3 金 ⇒ 不握记录（窗口 +2 才收）
  const PRICEY = run('r-pricey', '阿壬', [{ agentId: '1471', mindscape: 2 }], 's1|t1', { score: 60000 })

  it('默认只认记录本身（窗口 0）且只认击杀 run', () => {
    expect(EXPERT_RULE.goldWindow).toBe(0)
    expect(EXPERT_RULE.killedOnly).toBe(true)
    const experts = lowGoldExpertAuthors([...ALL, CHEAP_KILL, CHEAP_MISS, PRICEY])
    // 阿甲 / 阿乙 握既有记录；阿庚 握 1471@s1|t1 的记录（1 金）
    expect([...experts].sort()).toEqual(['阿乙', '阿庚', '阿甲'].sort())
    // 阿辛：1571@s1|t2 的 1 金唯一一条 = 记录，但他没击杀 ⇒ 不进名单
    expect(experts.has('阿辛')).toBe(false)
    // 阿壬：1471 的记录已被阿庚拿走（1 金），他 3 金远超 ⇒ 不是高手
    expect(experts.has('阿壬')).toBe(false)
    // 阿丙：1191@s1|t1 的记录是阿乙的 2 金，他 4 金 ⇒ 不是高手
    expect(experts.has('阿丙')).toBe(false)
  })

  it('逐角色，不是整队：整队 1 金最低，另一角色的记录持有者也算高手', () => {
    // s2|t1：阿子 整队 1 金（1241 M0）；阿丑 整队 4 金，但 1191 在该房的最便宜记录就是他
    const cheapTeam = run('r-cheap-team', '阿子', [{ agentId: '1241', mindscape: 0 }], 's2|t1')
    const otherChar = run('r-other-char', '阿丑', [{ agentId: '1191', mindscape: 3 }], 's2|t1') // 4 金
    const experts = lowGoldExpertAuthors([cheapTeam, otherChar])
    // 整队最低金口径只会收阿子；逐角色口径阿丑也握着 1191 的记录
    expect([...experts].sort()).toEqual(['阿丑', '阿子'].sort())
  })

  it('窗口 >0 = 放宽成「记录 + N 金内」（旧的宽松档，保留旋钮）', () => {
    const runs = [...ALL, CHEAP_KILL, PRICEY]
    expect(lowGoldExpertAuthors(runs, { goldWindow: 0 }).has('阿壬')).toBe(false)
    // 1471 记录 1 金，阿壬 3 金 ⇒ +2 才收
    expect(lowGoldExpertAuthors(runs, { goldWindow: 1 }).has('阿壬')).toBe(false)
    expect(lowGoldExpertAuthors(runs, { goldWindow: 2 }).has('阿壬')).toBe(true)
  })

  it('未击杀可显式放行（killedOnly: false）——缺省不这么做', () => {
    expect(lowGoldExpertAuthors([CHEAP_MISS]).size).toBe(0)
    expect(lowGoldExpertAuthors([CHEAP_MISS], { killedOnly: false }).has('阿辛')).toBe(true)
  })

  it('分面带 expert 标；expertsOnly 只留高手投稿（选了具体玩家时不收窄）', () => {
    const runs = [...ALL, CHEAP_KILL, PRICEY]
    const experts = lowGoldExpertAuthors(runs)
    const q = queryArchiveRuns(runs, { expertAuthors: experts })
    expect(q.players.find((p) => p.name === '阿庚')?.expert).toBe(true)
    expect(q.players.find((p) => p.name === '阿壬')?.expert).toBe(false)
    const only = queryArchiveRuns(runs, { expertAuthors: experts, expertsOnly: true })
    expect(only.rows.every((r) => experts.has(authorOf(r)))).toBe(true)
    expect(only.rows.map((r) => r.id)).not.toContain('r-pricey')
    // 点了一个高金非高手：仍看他的全部投稿（同 topPlayersOnly 的既有约定）
    expect(
      queryArchiveRuns(runs, { expertAuthors: experts, expertsOnly: true, player: '阿壬' }).rows.map((r) => r.id),
    ).toEqual(['r-pricey'])
  })

  it('补录行参与顶分判定：同房同分的低金补录 run 会被打上「顶」标（顶分是房间级定义，不是主集专属）', () => {
    // 主集只收「每队构成最低金」，但顶分定义是**房间级**的：同房另一支构成用更少金打满，也算该房顶分。
    const otherComp = run('r-other-comp', '阿子', [{ agentId: '1041', mindscape: 6 }], 's1|t1') // 0 金满分击杀
    const base = queryArchiveRuns(ALL, { goldWindow: 0 })
    const mixed = queryArchiveRuns([...ALL, otherComp], { goldWindow: 0 })
    expect(base.frontierIds.has('r-other-comp')).toBe(false)
    expect(mixed.frontierIds.has('r-other-comp')).toBe(true)
    // 最低金被拉低到 0 后，原先 1 金的 r-low 不再在窗口 0 内（这就是「定义用全」的可见后果）
    expect(mixed.frontierIds.has('r-low')).toBe(false)
  })

  it('没有高手名单（缺省）= 分面 expert 全 false、expertsOnly 不生效（不留静默收窄）', () => {
    const q = queryArchiveRuns(ALL, { expertsOnly: true })
    expect(q.rows).toHaveLength(ALL.length)
    expect(q.players.every((p) => !p.expert)).toBe(true)
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

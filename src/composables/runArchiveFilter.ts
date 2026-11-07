/**
 * 实战对比页（`views/RunArchivePage.vue`）的筛选 / 分面 —— 纯函数，单一实现。
 *
 * 用户口径：
 * - 2026-10-26：「想看某个顶级玩家（出过顶分，或稍微宽松的条件，但不能宽松很多）的所有战斗，
 *   或者某个角色的所有顶分战斗」——两件事共用同一套「顶分」定义，别在页面里各写一份。
 * - 2026-11-07：「实战对比是不是只收录了满分的，加个规则，如果投稿人打过至少一次极限最低金到+4
 *   这些较低的，可以认为他是高手，把他的所有数据都收进来，不止满分」——于是多了「高手」这一层。
 *
 * 四个概念（改之前先读）：
 * - **顶分战斗** = 该房（`seasonId × targetId`）内限定金数 ≤「该房最低金 + 窗口」的满分 run。
 *   前沿算法直接调 `limitedGold.ts#lowGoldFrontier`（与归档导入脚本、预设生成同一实现，规则 11）。
 *   ⚠ 这里的「该房最低金」是**房间级**口径（不分队伍构成），而主集是按（房间 × 构成）筛的子集 ⇒
 *   候选范围里一旦混进补录行，顶分集合会比只看主集时更大（实测窗口 0：101 → 170 条）。这是定义本身
 *   用全的结果，不是 bug；别为了「和以前一样」把补录行挡在顶分判定之外。
 * - **顶级玩家** = 至少有一条顶分战斗的投稿人。「稍微宽松」的唯一旋钮 = `goldWindow`（+1 ~ +4 金）。
 *   不按分数百分比 / 名次放宽：本数据集 65000 那一批才参与顶分判定，按分数放宽等于全放行。
 * - **高手** = 在某个（房间 × 角色）上握着**该角色的最低限定金记录**的人（用户 2026-11-07：「高手定义为给任意
 *   角色出过最低金就行」），判据 = `lowGoldExpertAuthors` + `EXPERT_RULE`（记录只从击杀 run 里取，
 *   `goldWindow` 缺省 0 = 只认记录本身），由归档导入脚本烘焙成 `run-archive-experts.json#authors`
 *   （页面不重算：判据要看**未入库**的低金投稿）。
 *   **逐角色**是关键：不是「整队最低金」（= 主集收录口径）、也不是「该房最低金」（会被 0 金常驻队一口吃掉）。
 *   关系（2026-11-07 实测，别凭直觉写包含关系）：
 *   - `顶级玩家（窗口 0） ⊂ 高手`（该房最低金的满分击杀人必然也握着自己队里某角色的记录）；
 *   - 但**放宽窗口后不成立**：+4 档的 635 位顶级玩家里有 313 位不在高手名单（他们打的是「该房最便宜那队的
 *     更高金配置」，例如给同一个队加金，而非任何角色的最低金）——两个开关是正交维度，别互相替代；
 *   - **入库作者 ⊄ 高手**：主集还收高金构成的最小金 run，那些作者可能没拿过任何角色记录。
 * - **顶分集合必须在玩家 / 角色筛选之前算**：先求顶分、再收窄行。反过来（先按玩家过滤再求顶分）
 *   得到的是「该玩家自己里最低金的」，不是「全服该房最低金」——看角色逻辑合不合理时两者结论不同。
 *
 * 页面契约：候选范围（期数 × Boss）由页面先过滤好再传进来；本模块只做「顶分判定 + 分面 + 行筛选」，
 * 不改金数口径（`runLimitedGold` 单一来源）、不改排序（页面自己排）。分面（玩家 / 角色下拉的计数）
 * 一律在候选范围上算、**不随行筛选变化**——否则选了玩家 A，玩家 B 的计数就跟着消失，下拉会自己抖动。
 *
 * @fact ui:实战对比/高手 口径: 高手 = 在某个（房间 × 角色）上握着该角色的最低限定金记录的人（逐角色，不是整队最低金、也不是该房最低金；记录只从**击杀** run 里取）；名单由归档导入脚本烘焙进 run-archive-experts.json#authors，页面只读不算 | 据 用户@2026-11-07「高手定义为给任意角色出过最低金就行」（同日先说过 +4 金版本，随即收窄成「最低金就行」） | 验 src/composables/__tests__/runArchiveFilter.test.ts | 锚 src/composables/runArchiveFilter.ts#lowGoldExpertAuthors | 信 确认 | ⟳复核: 下一期归档重跑后，确认「逐角色最低金 + 只认击杀」仍是用户要的口径（若嫌名单太窄则把 EXPERT_RULE.goldWindow 设 >0） | 到期 2027-01-31
 * @fact ui:实战对比/顶分与顶级玩家 口径: 顶分战斗 = 该房（赛季 × 关卡）内限定金数 ≤「该房最低金 + 顶分窗口」的满分 run（lowGoldFrontier 单一实现）；顶级玩家 = 至少有一条顶分战斗的投稿人，窗口 +N 金是「稍微宽松」的唯一旋钮（不按分数百分比放宽——数据集全员 65000，按分数放等于全放行）；顶分集合必须在玩家 / 角色筛选之前算，否则退化成「该玩家自己里最低金」 | 据 用户@2026-10-26「想看某个顶级玩家…的所有战斗，或者某个角色的所有顶分战斗」 | 验 src/composables/__tests__/runArchiveFilter.test.ts | 锚 src/composables/runArchiveFilter.ts#queryArchiveRuns | 信 确认 | ⟳复核: 下一期危局归档重跑后，确认「顶分 = 该房最低金 + 窗口」「顶级玩家 = 有顶分的投稿人」仍是用户要的口径（若用户改看「分数比例」则本条作废并改实现） | 到期 2026-12-31
 */
import { lowGoldFrontier, runLimitedGold, type LimitedGoldMember } from '@/composables/limitedGold'

/** 未署名投稿的归并名（空串 / 纯空白都归到这里，否则下拉里会出现一堆同名空选项）。 */
const UNNAMED_AUTHOR = '（未署名）'

/**
 * 高手判据的可调项（只在**导入脚本**消费，烘焙进 `run-archive-experts.json`；改这里要重跑
 * `scripts/import-zzz-run-archive.mjs`）：
 * - `goldWindow`：记录口径放宽几金。缺省 0 = **只认记录本身**（该角色在该房的最低金），
 *   正是用户 2026-11-07 的「出过最低金」；设 >0 就退化成「最低金 +N 内」，那是旧口径。
 * - `killedOnly`：记录只从**击杀** run 里取（低金没打死不算水平证据）。缺省 true。
 */
export const EXPERT_RULE = { goldWindow: 0, killedOnly: true } as const

/** 本模块消费的最小 run 结构（`ArchiveRun` 结构上兼容；测试可用轻量对象）。 */
interface ArchiveFilterRun {
  id: string
  seasonId: string
  targetId: string
  score: number
  bossKilled?: boolean
  authorName?: string
  team: ReadonlyArray<LimitedGoldMember>
}

/** 玩家分面（下拉选项 + 选中后的摘要行）：投稿人、投稿数、其中顶分数、该玩家最低限定金、是否高手。 */
export interface PlayerFacet {
  name: string
  runs: number
  frontierRuns: number
  minGold: number
  /** 是否在高手名单里（握着某个角色的最低金记录；数据集烘焙 = `run-archive-experts.json#authors`） */
  expert: boolean
}

/** 角色分面：队伍**任一槽位**出现过该角色的投稿统计（不是「主C」口径）。 */
export interface AgentFacet {
  agentId: string
  runs: number
  frontierRuns: number
  minGold: number
}

interface ArchiveQueryOptions {
  /** 顶分判定窗口（+N 金；缺省 0 = 只认该房最低金） */
  goldWindow?: number
  /**
   * 高手名单（数据集烘焙的 `run-archive-experts.json#authors`，作者名已按 {@link authorOf} 归一）。
   * 缺省空集 = 本范围没有高手信息：分面 `expert` 恒 false、`expertsOnly` 不生效。
   */
  expertAuthors?: ReadonlySet<string>
  /** 只看高手的投稿（顶级玩家 ⊂ 高手，但入库作者不都是高手——见文件头） */
  expertsOnly?: boolean
  /** 只看某个投稿人的**全部**投稿（含非顶分） */
  player?: string | null
  /** 只看包含该角色的队伍（任一槽位） */
  agentId?: string | null
  /** 只看顶级玩家的投稿（已选中具体 player 时不生效——用户明确点了一个人，要看他的全部） */
  topPlayersOnly?: boolean
  /** 只看顶分战斗 */
  frontierOnly?: boolean
}

interface ArchiveQueryResult<T> {
  rows: T[]
  /** 顶分战斗 id 集合（候选范围内）；页面用它给行打「顶」标 */
  frontierIds: ReadonlySet<string>
  /** 顶级玩家名集合（候选范围内的顶分投稿人） */
  topPlayers: ReadonlySet<string>
  players: PlayerFacet[]
  agents: AgentFacet[]
  /** 候选范围内的顶分条数 */
  frontierCount: number
  /** 候选范围覆盖的房间数（赛季 × 关卡） */
  roomCount: number
}

/** 投稿人（空 / 空白 → 未署名）。页面与分面共用，别在页面里再写一份 trim 规则。 */
export function authorOf(run: { authorName?: string }): string {
  const name = (run.authorName ?? '').trim()
  return name || UNNAMED_AUTHOR
}

/**
 * 低金高手（用户 2026-11-07：「高手定义为**给任意角色出过最低金**就行」）。
 *
 * **高手 = 在某个（房间 × 角色）上握着该角色的最低限定金记录的人。**
 * 「最低金」在这里是**逐角色**的：同一房里 A 角色 2 金、B 角色 5 金，各自算各自的最低，互不压制
 * （所以它不是「整队最低金」——那是归档主集的收录口径；也不是「该房最低金」——那会被 0 金常驻队一口吃掉）。
 * 记录只在**击杀** run 里取（`killedOnly`）：低金没打死 Boss 只说明投入便宜，不构成水平证据——
 * 这与本模块顶分判定的 killedOnly 口径一致。
 *
 * `goldWindow` 缺省 0 = 只认记录本身；设 >0 变成「最低金 +N 内的击杀者」，那是旧的宽松档。
 * 作者按 `authorOf` 归并（同一人多期投稿 = 一位高手）。
 *
 * 输入是**导入期的原始 run**（含未入库的低金投稿），所以本函数只由 `scripts/import-zzz-run-archive.mjs`
 * 调用并把结果烘焙进 `run-archive-experts.json#authors`；页面不重算（数据集看不全判据所需的低金投稿）。
 */
export function lowGoldExpertAuthors<T extends ArchiveFilterRun>(
  runs: readonly T[],
  opts: { goldWindow?: number; killedOnly?: boolean } = {},
): Set<string> {
  const window = Math.max(0, Math.round(opts.goldWindow ?? EXPERT_RULE.goldWindow))
  const killedOnly = opts.killedOnly ?? EXPERT_RULE.killedOnly
  // 逐（房间 × 角色）取该角色的最低限定金；同队并列的金数（整队一价）一起算记录
  const roomOf = (run: T) => `${run.seasonId}|${run.targetId}`
  const bestGold = new Map<string, number>()
  for (const run of runs) {
    if (killedOnly && run.bossKilled !== true) continue
    const gold = runLimitedGold(run.team)
    for (const member of run.team) {
      const key = `${roomOf(run)}#${member.agentId}`
      const cur = bestGold.get(key)
      if (cur === undefined || gold < cur) bestGold.set(key, gold)
    }
  }
  const experts = new Set<string>()
  for (const run of runs) {
    if (killedOnly && run.bossKilled !== true) continue
    const gold = runLimitedGold(run.team)
    const holds = run.team.some((member) => {
      const best = bestGold.get(`${roomOf(run)}#${member.agentId}`)
      return best !== undefined && gold <= best + window
    })
    if (holds) experts.add(authorOf(run))
  }
  return experts
}

/** 没有高手名单时的空集（避免每次查询新建 Set）；空集 = 「没有高手信息」而不是「没有高手」 */
const EMPTY_EXPERTS: ReadonlySet<string> = new Set<string>()

interface FrontierSets {
  frontierIds: Set<string>
  topPlayers: Set<string>
}

/** 候选范围 → 顶分集合 + 顶级玩家集合（窗口负数按 0 处理：顶分判定最严档 = 该房最低金）。 */
function frontierSets<T extends ArchiveFilterRun>(runs: readonly T[], goldWindow: number): FrontierSets {
  const window = Math.max(0, Math.round(goldWindow))
  const frontier = lowGoldFrontier([...runs], { killedOnly: true, goldWindow: window })
  return {
    frontierIds: new Set(frontier.map((r) => r.id)),
    topPlayers: new Set(frontier.map(authorOf)),
  }
}

/**
 * 候选范围 → 分面（玩家 / 角色 + 计数）。
 * 计数口径 = 候选范围内的全部投稿（不按行筛选收窄），frontierRuns = 其中属于顶分集合的条数。
 */
function buildFacets<T extends ArchiveFilterRun>(
  runs: readonly T[],
  frontierIds: ReadonlySet<string>,
  expertAuthors: ReadonlySet<string>,
): { players: PlayerFacet[]; agents: AgentFacet[]; frontierCount: number; roomCount: number } {
  const players = new Map<string, PlayerFacet>()
  const agents = new Map<string, AgentFacet>()
  const rooms = new Set<string>()
  let frontierCount = 0
  for (const run of runs) {
    rooms.add(`${run.seasonId}|${run.targetId}`)
    const isFrontier = frontierIds.has(run.id)
    if (isFrontier) frontierCount++
    const gold = runLimitedGold(run.team)

    const name = authorOf(run)
    const isExpert = expertAuthors.has(name)
    const player = players.get(name) ?? { name, runs: 0, frontierRuns: 0, minGold: gold, expert: isExpert }
    player.runs++
    if (isFrontier) player.frontierRuns++
    if (gold < player.minGold) player.minGold = gold
    players.set(name, player)

    // 同一队伍里重复角色（脏数据）只算一次，否则该角色的「场数」会虚高。
    const seen = new Set<string>()
    for (const member of run.team) {
      if (seen.has(member.agentId)) continue
      seen.add(member.agentId)
      const agent = agents.get(member.agentId) ?? { agentId: member.agentId, runs: 0, frontierRuns: 0, minGold: gold }
      agent.runs++
      if (isFrontier) agent.frontierRuns++
      if (gold < agent.minGold) agent.minGold = gold
      agents.set(member.agentId, agent)
    }
  }
  return {
    // 排序 = 顶分多的在前，其次高手、投稿多的；顶分玩家就是用户想先看到的那些人。
    players: [...players.values()].sort(
      (a, b) =>
        b.frontierRuns - a.frontierRuns ||
        Number(b.expert) - Number(a.expert) ||
        b.runs - a.runs ||
        a.name.localeCompare(b.name),
    ),
    agents: [...agents.values()].sort(
      (a, b) => b.frontierRuns - a.frontierRuns || b.runs - a.runs || a.agentId.localeCompare(b.agentId),
    ),
    frontierCount,
    roomCount: rooms.size,
  }
}

/**
 * 实战归档筛选入口（页面唯一调用点）。
 * @param runs 候选范围（页面已按 期数 / Boss 过滤；**不要在调用前按玩家 / 角色过滤**）
 * @param opts 见 {@link ArchiveQueryOptions}
 * @returns 行（保持入参顺序）、顶分 id 集合、顶级玩家集合、分面与计数
 */
export function queryArchiveRuns<T extends ArchiveFilterRun>(
  runs: readonly T[],
  opts: ArchiveQueryOptions = {},
): ArchiveQueryResult<T> {
  const { frontierIds, topPlayers } = frontierSets(runs, opts.goldWindow ?? 0)
  const expertAuthors = opts.expertAuthors ?? EMPTY_EXPERTS
  const player = (opts.player ?? '').trim()
  const agentId = (opts.agentId ?? '').trim()

  const rows = runs.filter((run) => {
    if (player && authorOf(run) !== player) return false
    if (agentId && !run.team.some((m) => m.agentId === agentId)) return false
    // 选了具体玩家就按玩家走（要看他的全部投稿）；只有没选玩家时「只看顶级玩家 / 只看高手」才收窄行。
    if (!player && opts.topPlayersOnly && !topPlayers.has(authorOf(run))) return false
    // 高手名单为空 = 本范围没有高手信息（旧快照 / 未烘焙）⇒ 这条不可用，不能把所有行都滤掉。
    if (!player && opts.expertsOnly && expertAuthors.size > 0 && !expertAuthors.has(authorOf(run))) return false
    if (opts.frontierOnly && !frontierIds.has(run.id)) return false
    return true
  })

  return { rows, frontierIds, topPlayers, ...buildFacets(runs, frontierIds, expertAuthors) }
}

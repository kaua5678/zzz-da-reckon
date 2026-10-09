#!/usr/bin/env node
/* 从 data/raw/zzz-run-archive 精炼出前端 run-archive.json（public/static/run-archive.json）。
 *
 * 前端 RunArchivePage.vue 懒加载 fetch('/static/run-archive.json')，不进首屏 bundle。
 *
 * ## 收录口径（用户裁决 2026-10-08）
 *
 * **只收「每个队伍最低限定金数的满分 run」**——即每（房间 × 队伍构成）里，用最少限定金
 * 打满 65000 的那一批。它们 = 该队在该 Boss 上「实际能打到的上界」，与计算器的理论理想值
 * 直接对照最合适（高金/低水平投稿只反映投入或操作，不反映角色上限）。
 *
 * 落成四步：
 *   ① 只收 `Deadly Assault*`（危局强袭，含 Adversity 困难；Shiyu Defense / Annihilation
 *      多波转火非打桩，排除）；
 *   ② 只收**满分** `score >= 65000`（单房上限 = 伤害分 60000 + 操作分 5000；实测满分 run 全部击杀）；
 *   ③ 按（seasonId × targetId × **队伍构成**）分桶（构成 = 成员 agentId 升序，与槽位顺序无关），
 *      桶内取**限定金数最低**的那一批（并列全留）；
 *   ④ 同（房间 × 构成 × 金数 × **精确配置**）只留 1 条（不同作者提交的完全同配同分 run =
 *      同一数据点，重复收录只会让列表变噪）。
 *
 * 金数口径**不在本脚本实现**：走 `src/composables/limitedGold.ts#runLimitedGold`（经
 * `scripts/lib/ts-modules.mjs` 用 vite ssrLoadModule 载入）——规则 11「跨文件常量只从单一来源
 * 引用」。历史上 `gen-auto-presets.mjs` 抄过一份分叉的金数实现（音擎精炼无条件计金），
 * 两处对同一份归档算出不同金数且都不报错；本脚本不再重蹈。
 *
 * ## 已知边界（下游会读到的形状）
 *
 * - **配对差分图（原 Chart 5）已下线**（用户 2026-10-08：价值要用计算器算，不用统计估）——
 *   本数据集只有满分 run，同作者「带卡 vs 不带卡」的分差恒为 0，那张图在本口径下没有信息量。
 * - `charIncrement`（角色兑现曲线）与本数据集兼容：它按「分数 ≥ 顶分×0.9 ∩ 金数窗」提基底队，
 *   在全员满分的本数据集上退化为「该房最低金 + 窗口内的队伍」，语义仍成立。
 * - `rooms` / `seasons` 索引只保留**有收录 run** 的房间与赛季（原实现保留 bootstrap 全量，
 *   含 42 个零危局投稿的防卫战房间）。
 */
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readJson, writeJson } from './lib/jsonio.mjs'
import { loadTsModule, closeTsModules } from './lib/ts-modules.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const rawDir = resolve(root, 'data/raw/zzz-run-archive')
const outFile = resolve(root, 'public/static/run-archive.json')

/** 支持的模式前缀：Deadly Assault 与 Deadly Assault: Adversity Mode（危局·困难异构）。 */
const MODE_PREFIX = 'Deadly Assault'
/** 单房满分（伤害分 60000 + 操作分 5000）。 */
const FULL_SCORE = 65000

/** 只留部署+对比所需字段（名字可由 runArchiveImport 的 agentId/weaponId 经 catalog 重建）。 */
function slimRun(run) {
  return {
    id: run.id,
    mode: run.mode,
    seasonId: run.seasonId,
    targetId: run.targetId,
    authorName: run.authorName,
    videoUrl: run.videoUrl,
    score: run.score,
    timeSeconds: run.timeSeconds,
    bossKilled: run.bossKilled,
    primaryAgentId: run.primaryAgentId,
    submittedAt: run.submittedAt,
    team: (run.team ?? []).map((m) => ({
      slot: m.slot,
      agentId: m.agentId,
      mindscape: m.mindscape,
      weaponId: m.weaponId,
      phase: m.phase,
    })),
  }
}

/** 房间键（期 × 关卡）。 */
const roomKeyOf = (run) => `${run.seasonId}|${run.targetId}`
/** 队伍构成键：成员 agentId 升序拼接（**与槽位顺序无关**——同 3 人换位 = 同队）。 */
const compKeyOf = (run) => (run.team ?? []).map((m) => String(m.agentId)).sort().join(',')
/** 精确配置键：构成 + 每个成员的命座/音擎/精炼（同构成同金数但加金分配不同 = 不同数据点）。 */
const configKeyOf = (run) =>
  (run.team ?? [])
    .map((m) => `${m.agentId}:${m.mindscape ?? 0}:${m.weaponId ?? ''}:${m.phase ?? 1}`)
    .sort()
    .join('|')

async function main() {
  const bootstrap = readJson(resolve(rawDir, 'bootstrap.json'))
  const runs = readJson(resolve(rawDir, 'runs.json'))
  const { runLimitedGold } = await loadTsModule(root, '/src/composables/limitedGold.ts')

  const da = runs.filter((r) => String(r.mode ?? '').startsWith(MODE_PREFIX))
  const full = da.filter((r) => Number(r.score) >= FULL_SCORE)

  // ① 每（房间 × 构成）取最低限定金
  const minGoldByComp = new Map()
  for (const r of full) {
    const key = `${roomKeyOf(r)}~${compKeyOf(r)}`
    const gold = runLimitedGold(r.team ?? [])
    const cur = minGoldByComp.get(key)
    if (cur === undefined || gold < cur) minGoldByComp.set(key, gold)
  }
  // ② 保留达到最低金的那一批（并列全留）
  const atMinGold = full.filter(
    (r) => runLimitedGold(r.team ?? []) === minGoldByComp.get(`${roomKeyOf(r)}~${compKeyOf(r)}`),
  )

  // ③ 同（房间 × 构成 × 金数 × 精确配置）去重：保留 id 最小者（确定性；同配同分 run 是同一数据点）
  const byConfig = new Map()
  for (const r of atMinGold) {
    const key = `${roomKeyOf(r)}~${compKeyOf(r)}~${runLimitedGold(r.team ?? [])}~${configKeyOf(r)}`
    const cur = byConfig.get(key)
    if (!cur || String(r.id) < String(cur.id)) byConfig.set(key, r)
  }
  const kept = [...byConfig.values()].map(slimRun)

  // 索引：只保留有收录 run 的房间/赛季
  const keptRooms = new Set(kept.map((r) => r.targetId))
  const keptSeasons = new Set(kept.map((r) => r.seasonId))
  const seasons = {}
  const rooms = {}
  for (const s of bootstrap.database.seasons ?? []) {
    if (keptSeasons.has(s.id)) seasons[s.id] = { start: s.start, end: s.end }
    for (const r of s.rooms ?? []) {
      if (!keptRooms.has(r.id)) continue
      rooms[r.id] = {
        seasonId: s.id,
        seasonStart: s.start,
        mode: s.mode,
        bossNameZh: r.bossNameZh ?? r.primaryEnemyZh ?? '',
        bossName: r.bossName ?? r.primaryEnemy ?? '',
      }
    }
  }

  const out = {
    generatedAt: new Date().toISOString(),
    source: 'data/raw/zzz-run-archive（zzz-run-archive.onrender.com 公开 API 快照）',
    note:
      '只收危局强袭（Deadly Assault*）每（房间 × 队伍构成）限定金数最低的满分（65000）run；' +
      '同（房间 × 构成 × 金数 × 精确配置）去重。配装缺口由计算器默认理想配装兜底。',
    totalRuns: kept.length,
    filter: {
      mode: MODE_PREFIX,
      minScore: FULL_SCORE,
      rule: 'per-room-composition-lowest-gold',
      rawRuns: runs.length,
      deadlyAssaultRuns: da.length,
      fullScoreRuns: full.length,
      atMinGoldRuns: atMinGold.length,
    },
    seasons,
    rooms,
    runs: kept,
  }
  writeJson(outFile, out)

  const groups = new Set(kept.map((r) => `${roomKeyOf(r)}~${compKeyOf(r)}`))
  const golds = kept.map((r) => runLimitedGold(r.team ?? []))
  console.log(
    `已生成 ${outFile}\n` +
      `  原始 ${runs.length} → 危局 ${da.length} → 满分 ${full.length} → 每队最低金 ${atMinGold.length} → 去重 ${kept.length} 条\n` +
      `  房间 ${Object.keys(rooms).length} / 赛季 ${Object.keys(seasons).length} / （房间×构成）组 ${groups.size}\n` +
      `  金数 min=${Math.min(...golds)} 中位=${golds.slice().sort((a, b) => a - b)[golds.length >> 1]} max=${Math.max(...golds)}`,
  )
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => closeTsModules())

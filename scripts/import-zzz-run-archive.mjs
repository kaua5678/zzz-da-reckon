#!/usr/bin/env node
/* 从 data/raw/zzz-run-archive 精炼出前端 run-archive.json（public/static/run-archive.json）。
 *
 * 前端 RunArchivePage.vue 懒加载 fetch('/static/run-archive.json')，不进首屏 bundle。
 * 精炼口径：
 *   - 只收 Deadly Assault / Deadly Assault: Adversity Mode（危局强袭，单 Boss 打桩）；
 *     Shiyu Defense / Annihilation Simulacrum（小怪/转火非打桩）排除。
 *   - 每条 run 只留部署+对比所需字段：去 bangboo/agentName/weaponName/targetLabel 等冗余
 *     （名字可由 runArchiveImport 的 agentId/weaponId 经 catalog 重建）。
 *   - rooms 携带 seasonStart（denormalize），供导入桥做期相位日期对齐（分期数决定血量/buff）。
 *   - 建按 targetId 去重的 room 索引 + 按 seasonId 的 seasons 索引。
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readJson, writeJson } from './lib/jsonio.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const rawDir = resolve(root, 'data/raw/zzz-run-archive')
const outFile = resolve(root, 'public/static/run-archive.json')

const PREFIX = 'Deadly Assault'

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
    team: (run.team ?? []).map((m) => ({ slot: m.slot, agentId: m.agentId, mindscape: m.mindscape, weaponId: m.weaponId, phase: m.phase })),
  }
}

function main() {
  const bootstrap = readJson(resolve(rawDir, 'bootstrap.json'))
  const runs = readJson(resolve(rawDir, 'runs.json'))

  const seasons = {}
  const rooms = {}
  for (const s of bootstrap.database.seasons ?? []) {
    seasons[s.id] = { start: s.start, end: s.end }
    for (const r of s.rooms ?? []) {
      rooms[r.id] = {
        seasonId: s.id,
        seasonStart: s.start,
        mode: s.mode,
        bossNameZh: r.bossNameZh ?? r.primaryEnemyZh ?? '',
        bossName: r.bossName ?? r.primaryEnemy ?? '',
      }
    }
  }

  const kept = []
  for (const run of runs) {
    if (!String(run.mode ?? '').startsWith(PREFIX)) continue
    kept.push(slimRun(run))
  }

  const out = {
    generatedAt: new Date().toISOString(),
    source: 'data/raw/zzz-run-archive（zzz-run-archive.onrender.com 公开 API 快照）',
    note: '仅危局强袭（Deadly Assault*），防卫战/歼灭排除；配装缺口由计算器默认理想配装兜底',
    totalRuns: kept.length,
    seasons,
    rooms,
    runs: kept,
  }
  writeJson(outFile, out)
  console.log(`已生成 ${outFile}：危局 ${kept.length} 条 / rooms ${Object.keys(rooms).length} / seasons ${Object.keys(seasons).length}`)
}

main()
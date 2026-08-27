#!/usr/bin/env node
/* 抓取 zzz-run-archive（危局/防卫战实战玩家投稿）全量 approved 提交快照。
 *
 * 端点（base = https://zzz-run-archive.onrender.com，无鉴权）：
 *   GET /api/bootstrap    — { database:{modes,seasons[].rooms[]}, submissions:{approved:[…]}, submissionsPartial, submissionCounts, revision }
 *   GET /api/submissions?status=approved&targetId=<room.id>&limit=200&cursor=<cursor>
 *                          — 按房间游标分页拉全量（room.id 即 targetId，见 bootstrap database）
 *
 * 产物（data/raw/zzz-run-archive/）：
 *   bootstrap.json — 原始 bootstrap（含 modes/seasons/rooms，是 Boss 名→期数/弱抗的匹配源）
 *   runs.json      — 全量 approved 提交（按 id 去重，紧凑写）
 *   manifest.json  — 抓取元数据 + 每房间条数 + 错误（pretty，人读）
 *
 * 幂等：整体覆盖重写。--dry-run 只概括不写；--limit 覆盖页大小；--max-targets 截断目标数（调试）。
 * 提交由玩家自报，命座/音擎字段存在误报可能，结果需带数据质量标注。
 */
import { mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeJson, writeJsonPretty } from './lib/jsonio.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = resolve(root, 'data/raw/zzz-run-archive')

function arg(name) {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const base = arg('--base') ?? 'https://zzz-run-archive.onrender.com'
const dryRun = process.argv.includes('--dry-run')
const limit = Math.max(1, Number(arg('--limit') ?? 200) || 200)
const maxTargetsRaw = arg('--max-targets')
const maxTargets = maxTargetsRaw ? Number(maxTargetsRaw) : Infinity

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function fetchJson(url, label, retries = 3) {
  let lastErr
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(45000) })
      if (!res.ok) throw new Error(`${label} HTTP ${res.status}: ${url}`)
      return await res.json()
    } catch (e) {
      lastErr = e
      if (attempt < retries) {
        await sleep(1000 * (attempt + 1))
        continue
      }
    }
  }
  throw lastErr
}

function normalizeRun(run) {
  // 保留归档原字段；仅做结构化归约（丢弃残缺对象）。
  if (!run || typeof run !== 'object' || !run.id) return null
  return run
}

async function fetchTarget(baseUrl, targetId, pageSize) {
  const runs = []
  let cursor = ''
  do {
    const q = new URLSearchParams({ status: 'approved', targetId, limit: String(pageSize) })
    if (cursor) q.set('cursor', cursor)
    const payload = await fetchJson(`${baseUrl}/api/submissions?${q.toString()}`, `submissions ${targetId}`)
    for (const r of payload.submissions || []) {
      const n = normalizeRun(r)
      if (n) runs.push(n)
    }
    cursor = payload.pagination?.nextCursor || ''
  } while (cursor)
  return runs
}

async function main() {
  const bootstrap = await fetchJson(`${base}/api/bootstrap`, 'bootstrap')
  const db = bootstrap?.database
  if (!db?.seasons || !Array.isArray(db.seasons)) {
    throw new Error('bootstrap 缺 database.seasons')
  }

  const rooms = []
  for (const s of db.seasons) {
    for (const r of s.rooms || []) {
      rooms.push({ id: r.id, mode: s.mode, seasonId: s.id })
    }
  }
  const targetIds = rooms.map((r) => r.id)
  const count = Math.min(targetIds.length, Number.isFinite(maxTargets) ? maxTargets : targetIds.length)

  const allRuns = []
  const byTarget = {}
  const errors = []
  let fetched = 0

  for (let i = 0; i < count; i++) {
    const targetId = targetIds[i]
    try {
      const runs = await fetchTarget(base, targetId, limit)
      const seen = new Map()
      for (const r of runs) seen.set(r.id, r)
      byTarget[targetId] = seen.size
      fetched += seen.size
      allRuns.push(...seen.values())
      console.log(`[${i + 1}/${count}] ${targetId}: ${seen.size} 条`)
    } catch (e) {
      errors.push({ targetId, error: String(e?.message ?? e) })
      console.error(`[${i + 1}/${count}] ${targetId}: FAIL ${e?.message ?? e}`)
    }
    // 对免费托管服务温和限速，避免冷启动连击 503
    await sleep(150)
  }

  const manifest = {
    fetchedAt: new Date().toISOString(),
    source: base,
    totalApproved: bootstrap?.submissionCounts?.approved ?? null,
    fetched,
    targetCount: Object.keys(byTarget).length,
    targetIds: targetIds.slice(0, count),
    targetCounts: byTarget,
    errors,
  }

  console.log(
    `\n汇总：目标房间 ${count}/${targetIds.length}，拉到 ${fetched} 条` +
      (manifest.totalApproved != null ? `（服务端 totalApproved=${manifest.totalApproved}）` : '')
  )

  if (dryRun) {
    console.log(JSON.stringify({ targetIds: targetIds.slice(0, count) }, null, 2))
    return
  }

  mkdirSync(outDir, { recursive: true })
  writeJson(resolve(outDir, 'bootstrap.json'), bootstrap)
  writeJson(resolve(outDir, 'runs.json'), allRuns)
  writeJsonPretty(resolve(outDir, 'manifest.json'), manifest)
  console.log(`写盘完成：${outDir}`)
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
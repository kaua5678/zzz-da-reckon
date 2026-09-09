#!/usr/bin/env node
/* Fetch full zh character JSON for nanoka agents（被动/影画/潜能/技能原文）。
 *
 * 用法：node scripts/fetch-nanoka-full-missing.mjs [<id>...] [--force] [--version <v>]
 *   - 不带 id：抓 data/raw/nanoka_missing/list.json 里「尚无存档」的角色（旧行为）
 *   - 带 id  ：只抓指定角色（重爬正式服数据用，如 1611 1621）
 *   - --force：存档已存在也重抓（默认跳过 = 幂等）
 *   - 版本：默认 manifest.zzz.live（正式服；available 里的带 hash 构建是测试服/预发布，
 *     名字与文案可能是占位 "..."——见 docs/DATA_FETCHING.md「版本 hash 是最容易踩的坑」）
 *
 * 输出：data/raw/nanoka_missing/full/<id>.json
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fetchJson } from './lib/http.mjs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const listPath = resolve(root, 'data/raw/nanoka_missing/list.json')
const outDir = resolve(root, 'data/raw/nanoka_missing/full')
const STATIC = 'https://static.nanoka.cc'

const force = process.argv.includes('--force')
const verIdx = process.argv.indexOf('--version')
const explicitVersion = verIdx >= 0 ? process.argv[verIdx + 1] : ''
const ids = process.argv.slice(2).filter(a => !a.startsWith('--') && a !== explicitVersion)

/** 正式服版本：manifest.zzz.live（测试服/预发布在 available 的带 hash 构建里） */
async function liveVersion() {
  if (explicitVersion) return explicitVersion
  const m = await fetchJson(`${STATIC}/manifest.json`, { timeoutMs: 20000 })
  return m.zzz?.live ?? m.zzz?.latest
}

const version = await liveVersion()
const baseUrl = `${STATIC}/zzz/${version}/zh/character/`
console.log(`nanoka 正式服版本: ${version}`)

const targets = ids.length ? ids : Object.keys(JSON.parse(readFileSync(listPath, 'utf8')))
mkdirSync(outDir, { recursive: true })

let ok = 0
let skipped = 0
let failed = 0
for (const id of targets) {
  const target = resolve(outDir, `${id}.json`)
  if (existsSync(target) && !force) {
    skipped++
    continue
  }
  const data = await fetchJson(`${baseUrl}${id}.json`, { retries: 1 })
  if (!data?.id) {
    failed++
    console.error(`FAIL ${id}: 空响应`)
    continue
  }
  writeFileSync(target, JSON.stringify(data, null, 2))
  ok++
  console.log(`OK ${id} ${data.name ?? ''}`)
}

console.log(`done ok=${ok} skipped=${skipped} failed=${failed} version=${version}`)
process.exit(failed === 0 ? 0 : 1)

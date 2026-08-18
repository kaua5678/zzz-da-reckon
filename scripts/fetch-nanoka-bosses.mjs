#!/usr/bin/env node
/* Fetch nanoka.cc boss API raw data for the boss selector.
 *
 * Endpoints (base = https://static.nanoka.cc/zzz/<version>):
 *   /boss.json            — 期数/关卡汇总（live_begin/live_end/zone_type）
 *   /en/boss/version.json — 游戏版本 → 期数 id 映射
 *   /zh/boss/<id>.json    — 期数详情（中文名：怪物/关卡/弱抗性/评分目标）
 *   /en/boss/<id>.json    — 期数详情（英文名）
 *   /zh/monster/<id>.json — 怪物本体（失衡伤害倍率/失衡持续时间/逐元素精确抗性）
 *
 * 详情里的怪物结构（mode.zone.<zoneKey>.layer_room.<roomKey>.monster_list.<k>）:
 *   id / name / image
 *   element  — 每元素 1=弱点 -1=抗性 0=中性（粗编码，怪物本体有精确值）
 *   stats    — hp / attack / defence / stun / attribute_infliction（异常条系数，危局=10→×1.1）
 *   monster_weakness — 关卡级弱点元素（中文名标签，随期数变，如异构 Boss 当期弱电/风）
 *   zone.<zoneKey>.monster_level — 怪物等级
 *
 * 怪物本体（monster/<id>.json，monster_info.*.stats）关键字段与换算:
 *   stun_damage_taken_ratio — 失衡伤害倍率 = (100 + ratio/100)/100（5000→1.5，2500→1.25）
 *   destroy_recover_rate    — 失衡持续时间 = 10000/rate（833→12s，666→15.02s）
 *   {el}_damage_res / _stun_res / _buildup_res — 逐元素万分比抗性（-2000 弱点 / 0 中性 / +2000~4000 抗性）
 *
 * 输出到 data/raw/bosses/（幂等：已存在则跳过，--force 重抓）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = resolve(root, 'data/raw/bosses')
const force = process.argv.includes('--force')

const STATIC = 'https://static.nanoka.cc'

/** 取当前最新 zzz 版本号（manifest.json） */
async function latestZzzVersion() {
  const res = await fetch(`${STATIC}/manifest.json`)
  if (!res.ok) throw new Error(`manifest HTTP ${res.status}`)
  const manifest = await res.json()
  return manifest.zzz?.latest
}

async function fetchJson(url, label, retries = 2) {
  let lastErr
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) })
      if (!res.ok) throw new Error(`${label} HTTP ${res.status}: ${url}`)
      return await res.json()
    } catch (e) {
      lastErr = e
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
        continue
      }
      throw lastErr
    }
  }
  throw lastErr
}

function save(rel, data) {
  const target = resolve(outDir, rel)
  writeFileSync(target, JSON.stringify(data, null, 2))
  console.log(`OK  ${rel}`)
}

const version = process.argv[2] ?? (await latestZzzVersion())
const base = `${STATIC}/zzz/${version}`
console.log(`nanoka boss API 版本: ${version}`)

mkdirSync(resolve(outDir, 'zh'), { recursive: true })
mkdirSync(resolve(outDir, 'en'), { recursive: true })

// 1. 期数汇总 + 版本映射
const summary = await fetchJson(`${base}/boss.json`, 'boss.json')
const versionMap = await fetchJson(`${base}/en/boss/version.json`, 'version.json').catch(() => ({}))
save('summary.json', summary)
save('version.json', versionMap)

// 2. 各期详情（zh + en，并行拉取）
const ids = Object.keys(summary)
const tasks = []
for (const id of ids) {
  for (const lang of ['zh', 'en']) {
    const target = resolve(outDir, lang, `${id}.json`)
    if (!force && existsSync(target)) continue
    tasks.push({ id, lang, target })
  }
}
let ok = ids.length * 2 - tasks.length
let failed = 0
const CONCURRENCY = 12
for (let i = 0; i < tasks.length; i += CONCURRENCY) {
  const batch = tasks.slice(i, i + CONCURRENCY)
  await Promise.all(
    batch.map(async ({ id, lang, target }) => {
      try {
        const data = await fetchJson(`${base}/${lang}/boss/${id}.json`, `${lang}/boss/${id}.json`)
        save(`${lang}/${id}.json`, data)
        ok++
      } catch (e) {
        failed++
        console.error(`FAIL ${lang}/${id}: ${e.message}`)
      }
    })
  )
}

// 3. 怪物详情（zh/monster/<id>.json）：失衡伤害倍率/失衡持续时间/逐元素精确抗性。
//    怪物 id 从已抓的期数详情里收集（mode.zone.*.layer_room.*.monster_list.*.id）。
mkdirSync(resolve(outDir, 'monster'), { recursive: true })
const monsterIds = new Set()
for (const id of ids) {
  const target = resolve(outDir, 'zh', `${id}.json`)
  if (!existsSync(target)) continue
  let detail
  try {
    detail = JSON.parse(readFileSync(target, 'utf8'))
  } catch {
    continue
  }
  for (const mode of detail.modes ?? []) {
    for (const zoneKey of Object.keys(mode.zone ?? {})) {
      const zone = mode.zone[zoneKey]
      const room = zone.layer_room?.[Object.keys(zone.layer_room ?? {})[0]]
      for (const k of Object.keys(room?.monster_list ?? {})) {
        monsterIds.add(String(room.monster_list[k].id))
      }
    }
  }
}
const monsterTasks = [...monsterIds]
  .filter(id => force || !existsSync(resolve(outDir, 'monster', `${id}.json`)))
for (let i = 0; i < monsterTasks.length; i += CONCURRENCY) {
  const batch = monsterTasks.slice(i, i + CONCURRENCY)
  await Promise.all(
    batch.map(async id => {
      try {
        const data = await fetchJson(`${base}/zh/monster/${id}.json`, `zh/monster/${id}.json`)
        save(`monster/${id}.json`, data)
        ok++
      } catch (e) {
        failed++
        console.error(`FAIL monster/${id}: ${e.message}`)
      }
    })
  )
}

console.log(`done ids=${ids.length} monsters=${monsterIds.size} ok=${ok} failed=${failed} version=${version}`)
console.log(`原始数据已保存到 data/raw/bosses/（下一步：node scripts/import-nanoka-bosses.mjs）`)
process.exit(failed === tasks.length + monsterTasks.length ? 1 : 0)

#!/usr/bin/env node
/**
 * hdiff：对照两个 nanoka 版本的角色 JSON，报出**影响 catalog 的字段差异**。
 *
 * ## 这是什么
 * nanoka 网站上端改版本号即可看版本对比（如
 * `https://zzz.nanoka.cc/character/1611?from=3.3.0%2B18716457`）。本脚本是它的**机器可读版本**：
 * 抓 `static.nanoka.cc/zzz/<版本>/zh/character/<id>.json` 两份，只报会进 catalog 的那些字段。
 *
 * ## 什么时候用它（用户口径 2026-09-12）
 * **只对新角色 / 新潜能激发**跑——老角色数值通常不变，不必全库扫一遍。
 * 新角色清单 = `manifest.json` 的 `zzz.new.character`。
 *
 * ## 用法
 *   node scripts/hdiff-agent.mjs <id> --from <旧版本> [--to <新版本>]
 *   node scripts/hdiff-agent.mjs 1621 --from 3.2
 *   node scripts/hdiff-agent.mjs 1621 --from 3.2 --to 3.3.2+18895034 --json
 *   node scripts/hdiff-agent.mjs --new          # 自动跑 manifest 的 zzz.new.character
 *
 * 省略 --to 时用 `manifest.zzz.latest`（测试服最新）。
 * 退出码：0 = 无差异（或仅无可比字段）；1 = 有差异；2 = 用法/网络错误。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { fetchJson } from './lib/http.mjs'
import { FIELD_RULES } from './lib/level60-rules.mjs'
import { writeJsonCompact } from './lib/jsonio.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const STATIC = 'https://static.nanoka.cc'
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

const args = process.argv.slice(2)
const argOf = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined }
const from = argOf('--from')
const to = argOf('--to')
const asJson = args.includes('--json')
/** 写入模式：把 --to 版本的原始 JSON 存进 data/raw/nanoka_missing/full/<id>.json（供审计/导入使用） */
const save = args.includes('--save')
const ids = args.filter(a => !a.startsWith('--') && a !== from && a !== to)

async function liveManifest() {
  const m = await fetchJson(`${STATIC}/manifest.json`, { timeoutMs: 20000 })
  return m?.zzz ?? {}
}

/** 会进 catalog level60 的字段：规则表覆盖的 + 直接透传的裸字段 */
const RAW_PASSTHROUGH = [
  ['impact', 'break_stun'],
  ['anomalyProficiency', 'element_abnormal_power'],
  ['anomalyMastery', 'element_mystery'],
  ['energyRegen', 'sp_recover'],
  ['energyMax', 'sp_bar_point'],
]

/** 某一版 raw 能算出的 level60 值 */
function level60Of(raw) {
  const out = {}
  for (const rule of FIELD_RULES) {
    const v = rule.expected(raw)
    if (v !== undefined) out[rule.field] = v
  }
  for (const [field, rawKey] of RAW_PASSTHROUGH) {
    const v = raw?.stats?.[rawKey]
    if (typeof v === 'number') out[field] = field === 'energyRegen' ? Math.round(v) / 100 : v
  }
  return out
}

const zzz = await liveManifest()
const toVersion = to ?? zzz.latest
if (!from) { console.error('用法：node scripts/hdiff-agent.mjs <id> --from <旧版本> [--to <新版本>] [--save] [--json]\n       node scripts/hdiff-agent.mjs --new --from <旧版本>'); process.exit(2) }

let targets = ids
if (args.includes('--new')) {
  targets = (zzz.new?.character ?? []).map(String)
  console.log(`manifest zzz.new.character = [${targets.join(', ')}]`)
}
if (targets.length === 0) { console.error('未指定角色 id（也不要 --new）'); process.exit(2) }

console.log(`hdiff: ${from} → ${toVersion}\n`)
let totalDiffs = 0

for (const id of targets) {
  /** 该版本可能根本没有这个角色（如 1631/1641 是 3.3 新角色，3.2 里不存在）→ 不是错误，是「新增」 */
  const grab = async (version, id) => {
    try {
      return await fetchJson(`${STATIC}/zzz/${encodeURIComponent(version)}/zh/character/${id}.json`, { timeoutMs: 25000 })
    } catch (e) {
      if (/Unexpected end of JSON|HTTP 40[34]/.test(String(e.message ?? e))) return null
      throw e
    }
  }
  let a, b
  try {
    a = await grab(from, id)
    b = await grab(toVersion, id)
  } catch (e) {
    console.log(`  ${id}: 抓取失败 — ${e.message}`)
    continue
  }
  if (!a && !b) { console.log(`  ${id}: 两个版本都没有该角色`); continue }
  if (!a) { console.log(`  ${id} ${b?.name ?? ''}: 【新增角色】${from} 无此角色，${toVersion} 有（直接按新版录即可）`); continue }
  if (!b) { console.log(`  ${id} ${a?.name ?? ''}: ⚠ ${toVersion} 无此角色（可能被移除或版本回退）`); continue }
  const la = level60Of(a), lb = level60Of(b)
  const keys = [...new Set([...Object.keys(la), ...Object.keys(lb)])]
  const diffs = []
  for (const k of keys) {
    const va = la[k], vb = lb[k]
    if (va === undefined || vb === undefined) continue
    if (Math.abs(num(va) - num(vb)) > 1e-9) diffs.push({ field: k, from: va, to: vb })
  }
  // 突破加成性质变化（如 DEF+28.8% → 暴击+14.4%）也要单独提示：它改变的是"口径"不是数值
  const aa = Object.values(a?.extra_level?.['6']?.extra ?? {}).map(e => `${e.prop}`).sort().join(',')
  const ab = Object.values(b?.extra_level?.['6']?.extra ?? {}).map(e => `${e.prop}`).sort().join(',')
  const ascChanged = aa !== ab

  const name = b?.name ?? a?.name ?? ''
  if (diffs.length === 0 && !ascChanged) {
    console.log(`  ${id} ${name}: 无差异`)
    continue
  }
  totalDiffs += diffs.length
  console.log(`  ${id} ${name}:`)
  for (const d of diffs) console.log(`    ${d.field.padEnd(21)} ${String(d.from).padStart(11)} → ${String(d.to).padStart(11)}`)
  if (ascChanged) {
    console.log(`    ⚠ 突破加成性质变了：${aa} → ${ab}`)
    console.log(`      （旧：${JSON.stringify(a?.extra_level?.['6']?.extra)}）`)
    console.log(`      （新：${JSON.stringify(b?.extra_level?.['6']?.extra)}）`)
  }
  if (save) {
    const p = join(root, 'data/raw/nanoka_missing/full', `${id}.json`)
    writeJsonCompact(p, b)
    console.log(`    → 已存档 ${toVersion} 到 data/raw/nanoka_missing/full/${id}.json`)
  }
}

if (asJson) console.log(JSON.stringify({ from, to: toVersion, totalDiffs }, null, 2))
console.log(`\n共 ${totalDiffs} 处字段差异${save ? '' : '（加 --save 可把新版存档进 full/ 供审计脚本使用）'}`)
process.exit(totalDiffs > 0 ? 1 : 0)

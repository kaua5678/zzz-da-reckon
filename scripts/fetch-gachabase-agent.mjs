#!/usr/bin/env node
/**
 * gachabase 角色数据爬取 —— 第二数据源，用于交叉验证 catalog 倍率行（nanoka 缺能量等列）。
 *
 * 用法：node scripts/fetch-gachabase-agent.mjs <agentId> <slug> [lang]
 *   例：node scripts/fetch-gachabase-agent.mjs 1401 alice
 *   slug = gachabase URL 里的英文小写名（https://zzz.gachabase.net/agents/1401/alice/beta?lang=chs）
 *
 * 页面为 SSR，内嵌原始数据 `skill_data:[{id:..., damage_multiplier_base:...}]`（键无引号的 JS 对象字面量）。
 * 字段口径（×10000 或 ×100 后 = catalog Lv12 值，已用爱丽丝验证）：
 *   damage_multiplier_base+step×11 → /100   = rows[damage].values[0]（Lv12 = base + 11×step）
 *   daze_multiplier_base+step×11   → /100   = rows[daze].values[0]
 *   energy_gain_base               → /10000 = rows[energy_recovery].values[0]（不随等级成长）
 *   individual_decibel_gain_base   → /10000 = rows[decibel_recovery].values[0]
 *   anomaly_buildup                → /100   = rows[anomaly_buildup].values[0]（异常积蓄）
 *   ether_purify                   → /100   = rows[ether_purify].values[0]（秽息消耗；**同时是 actionTime 的来源**）
 *   gash_buildup                   → /100   = rows[gash_buildup].values[0]（残痕积累；base 网表的独立列）
 *   sharpness_gain_base            → /10000 = rows[sharpness_gain].values[0]（锐能回复；锐能专属资源）
 *   adrenaline_base                → /10000 = rows[adrenaline].values[0]（肾上腺素通道，当前无人消费）
 *   sp_consume                     → 原值    = 专属资源消耗（能量以外，如锐能 60）
 *
 * ⚠️ 历史坑（2026-09-11）：本脚本的 FIELD 正则只列了 10 个字段，页面里的
 * `gash_buildup` / `sharpness_gain_base` / `adrenaline_base` **静默丢失**，于是
 * 「克拉蕾锐能只长在血锻四式」「残痕积累 ≠ 秽息消耗」这两件事在 catalog 里完全查不到。
 * 现在改为**通用扁平字段抓取**：`{id:…,damage_multiplier_base:…}` 对象内的所有
 * `key:number` 都收，正则不再需要维护字段白名单——新增列不会再丢。
 *
 * 输出：data/raw/gachabase/<agentId>.json（归一化后的 skill_data），供比对/补录用。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const [agentId, slug, lang = 'chs'] = process.argv.slice(2)
if (!agentId || !slug) {
  console.error('用法: node scripts/fetch-gachabase-agent.mjs <agentId> <slug> [lang]')
  process.exit(1)
}

const url = `https://zzz.gachabase.net/agents/${agentId}/${slug}/beta?lang=${lang}`

/**
 * 取页面 HTML。**先试内置 fetch，失败回落 curl**（2026-09-11 实测：同 URL curl 稳定 200，
 * undici 对这批 ~400KB SSR 页偶发 `fetch failed`/超时——批量补齐 60 角色缓存时约 1/3 失败，
 * 回落 curl 后一次过）。
 */
async function loadHtml(target) {
  try {
    const res = await fetch(target)
    if (res.ok) return await res.text()
    console.error(`内置 fetch HTTP ${res.status}，回落 curl`)
  } catch (err) {
    console.error(`内置 fetch 失败（${err?.cause?.code ?? err?.name ?? 'unknown'}），回落 curl`)
  }
  return execFileSync('curl', ['-sL', '--max-time', '60', target], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}

const html = await loadHtml(url)

// 提取内嵌 skill_data 数组（键无引号；对象间以 ,{id: 分隔）。
// skill_data 对象以「{id:N,damage_multiplier_base:」开头、字段全扁平（唯一内层数组
// attack_data:[..] 不含 {}），故从起点取到下一个 "}" 即完整对象。
// 字段抓取用通用 `key:number`（不再白名单）——补列不会静默丢失（见文件头历史坑）。
const FIELD = /([a-z_0-9]+):(-?[\d.]+)/g
const rows = []
for (const start of html.matchAll(/\{id:(\d+),damage_multiplier_base:/g)) {
  const end = html.indexOf('}', start.index)
  if (end < 0) continue
  const obj = html.slice(start.index, end + 1)
  const fields = {}
  for (const f of obj.matchAll(FIELD)) fields[f[1]] = Number(f[2])
  const attackData = obj.match(/attack_data:\[([\d.]*)\]/)
  rows.push({
    ...fields,
    id: Number(start[1]),
    ...(attackData ? { attack_data: attackData[1].split(',').filter(Boolean).map(Number) } : {}),
  })
}
if (!rows.length) {
  console.error('FAIL: 页面中未找到 skill_data 对象')
  process.exit(1)
}
const nonZero = (k) => rows.filter(r => (r[k] ?? 0) > 0).length
console.log(
  `字段覆盖：${rows.length} 条 · gash_buildup 非零 ${nonZero('gash_buildup')} · `
  + `sharpness_gain_base 非零 ${nonZero('sharpness_gain_base')} · `
  + `adrenaline_base 非零 ${nonZero('adrenaline_base')} · `
  + `字段并集 ${[...new Set(rows.flatMap(r => Object.keys(r)))].filter(k => k !== 'id' && k !== 'attack_data').length} 个`,
)

const outDir = resolve(root, 'data', 'raw', 'gachabase')
mkdirSync(outDir, { recursive: true })
const outPath = resolve(outDir, `${agentId}.json`)
writeFileSync(outPath, `${JSON.stringify({ source: url, fetchedAt: new Date().toISOString(), skill_data: rows }, null, 2)}\n`)
console.log(`OK ${rows.length} 条 → ${outPath}`)

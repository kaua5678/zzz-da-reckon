#!/usr/bin/env node
/**
 * gachabase 字段覆盖审计（2026-09-11 立，起因：`sharpness_gain` / `gash_buildup` 静默丢失）。
 *
 * 背景：`fetch-gachabase-agent.mjs` 曾用**字段白名单正则**抓页面内嵌 skill_data，
 * 于是页面新增/未列入的列（`gash_buildup`、`sharpness_gain_base`、`adrenaline_base`）
 * 在 `data/raw/gachabase/<id>.json` 里根本不存在，进而**永远进不了 catalog**——
 * 「克拉蕾锐能只长在血锻四式」这种机制的原始数据在仓库里查不到，只能靠人肉翻网页。
 *
 * 本脚本回答一个问题：**页面上的每一列，我们都导入了吗 / 都消费了吗？**
 *   ① 列覆盖：对每个有缓存的角色，列出页面字段 ∩（catalog 行 id ∪ 已知非行字段），
 *      标出「未导入」的字段名与受影响招数条数；
 *   ② 语义消费：`etherPurify` 是 actionTime 的来源、`sharpness_gain` 等新行有没有消费端；
 *   ③ 退出码：有「未导入」字段即 exit 1（机器护栏，CI 可挂）。
 *
 * 用法：
 *   node scripts/audit-gachabase-fields.mjs            # 全部角色（有缓存才算列覆盖）
 *   node scripts/audit-gachabase-fields.mjs 1611       # 只看某角色
 *   node scripts/audit-gachabase-fields.mjs --list     # 只列「哪些角色还没有 gachabase 缓存」
 *
 * 补缓存：`node scripts/fetch-gachabase-agent.mjs <agentId> <slug>`（slug = 页面 URL 小写名）。
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const only = process.argv[2] && !process.argv[2].startsWith('--') ? String(process.argv[2]) : null
const listOnly = process.argv.includes('--list')

const catalog = JSON.parse(readFileSync(resolve(root, 'public/static/catalog.json'), 'utf8'))
const gbDir = resolve(root, 'data', 'raw', 'gachabase')

/**
 * 已知**不是** catalog 行的页面字段，以及它们去哪了 / 为什么可以不在 catalog：
 * key → { sink: 落点, consumed: 是否有消费端 }
 */
const KNOWN_SINKS = {
  id: { sink: 'move id 本体', consumed: true },
  attack_data: { sink: 'rows[attack_data_N]（导入脚本按 kind=special 落行）', consumed: true },
  damage_multiplier_base: { sink: 'rows[damage].values[0]', consumed: true },
  damage_multiplier_step: { sink: 'rows[damage] 等级成长', consumed: true },
  daze_multiplier_base: { sink: 'rows[daze].values[0]', consumed: true },
  daze_multiplier_step: { sink: 'rows[daze] 等级成长', consumed: true },
  energy_gain_base: { sink: 'rows[energy_recovery].values[0]', consumed: true },
  energy_gain_step: { sink: '（游戏不随等级成长）', consumed: true },
  individual_decibel_gain_base: { sink: 'rows[decibel_recovery].values[0]', consumed: true },
  individual_decibel_gain_step: { sink: '（游戏不随等级成长）', consumed: true },
  anomaly_buildup: { sink: 'rows[anomaly_buildup].values[0]', consumed: true },
  ether_purify: { sink: 'rows[ether_purify].values[0] + move.actionTime = ether_purify/100', consumed: true },
  sp_consume: { sink: 'findExSpecial costType=resource 的成本（如锐能 60）', consumed: true },
}

/** 期望成为 catalog 行、但历史上被白名单漏掉的字段 → 目标行 id */
const EXPECTED_ROWS = {
  gash_buildup: 'gash_buildup',
  sharpness_gain_base: 'sharpness_gain',
  // gachabase 英文名 adrenaline = 游戏「闪能」（命破专属能量）→ 落 flash_energy_recovery（单一通道名）
  adrenaline_base: 'flash_energy_recovery',
}

const agents = catalog.agents.filter(a => !a.isTeammateOnly)
const cached = existsSync(gbDir) ? readdirSync(gbDir).filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, '')) : []
const missingCache = agents.filter(a => !cached.includes(String(a.id))).map(a => `${a.id} ${a.name.zhCN}`)

if (listOnly) {
  console.log(`有 gachabase 缓存：${cached.length} / 角色表 ${agents.length}`)
  console.log(`缺缓存（${missingCache.length}）：`)
  for (const m of missingCache) console.log('  -', m)
  console.log('\n补缓存：node scripts/fetch-gachabase-agent.mjs <agentId> <slug>')
  process.exit(0)
}

const targets = only ? agents.filter(a => String(a.id) === only) : agents
let unimportedFields = 0
let checkedAgents = 0
let totalGapRows = 0

for (const agent of targets) {
  const id = String(agent.id)
  const file = resolve(gbDir, `${id}.json`)
  if (!existsSync(file)) continue
  checkedAgents++
  const gb = JSON.parse(readFileSync(file, 'utf8'))
  const rowsById = new Map(gb.skill_data.map(r => [String(r.id), r]))

  // 该角色 catalog 里已有的 row.id 集合
  const skill = (catalog.agentSkills ?? []).find(s => String(s.agentId) === id)
  const rowIds = new Set()
  for (const cat of skill?.categories ?? []) {
    for (const m of cat.moves) for (const r of m.rows ?? []) rowIds.add(String(r.id))
  }

  const fields = [...new Set(gb.skill_data.flatMap(r => Object.keys(r)))].filter(f => f !== 'id' && f !== 'attack_data')
  // `X_step` 是 `X_base` 的等级成长（同一列）：若 `X_base` 已报缺口，`X_step` 不重复计入
  const rowOf = (f) => {
    const base = f.endsWith('_step') ? `${f.slice(0, -'_step'.length)}_base` : f
    return EXPECTED_ROWS[f] ?? EXPECTED_ROWS[base] ?? f
  }
  const stepOnly = new Set(
    fields.filter(f => f.endsWith('_step') && fields.includes(`${f.slice(0, -'_step'.length)}_base`))
      .filter(f => !EXPECTED_ROWS[f]),
  )
  const gaps = []
  for (const f of fields) {
    if (KNOWN_SINKS[f] || stepOnly.has(f)) continue
    const targetRow = rowOf(f)
    if (rowIds.has(targetRow)) continue
    const nz = gb.skill_data.filter(r => (r[f] ?? 0) > 0).length
    gaps.push({ field: f, targetRow, nonzeroMoves: nz })
  }
  if (!gaps.length) {
    console.log(`ok ${id} ${agent.name.zhCN}：页面字段 ${fields.length} 个全部有落点`)
    continue
  }
  // 真缺口 = 该列在本角色上有非零数据却没进 catalog（数据静默丢失）
  // 信息项 = 该列本角色全为 0（角色没有这条通道，不建行是对的）
  const realGaps = gaps.filter(g => g.nonzeroMoves > 0)
  if (realGaps.length) unimportedFields += realGaps.length
  const zeroOnly = gaps.filter(g => g.nonzeroMoves === 0)
  if (!realGaps.length) {
    console.log(`ok ${id} ${agent.name.zhCN}：无非零字段丢失（${zeroOnly.map(g => g.field).join('/')} 全 0，不建行）`)
    continue
  }
  console.log(`\n✗ ${id} ${agent.name.zhCN}：${realGaps.length} 个**非零**字段未导入`)
  for (const g of realGaps) {
    totalGapRows += g.nonzeroMoves
    console.log(`   · ${g.field}（非零招式 ${g.nonzeroMoves} 条）→ 目标行 rows[${g.targetRow}] 不存在`)
  }
  if (id === '1611') {
    const sample = [...rowsById.values()].slice(0, 3)
    console.log('   样例：', sample.map(r => `${r.id}: gash=${(r.gash_buildup ?? 0) / 100} sharp=${(r.sharpness_gain_base ?? 0) / 10000}`).join(' | '))
  }
}

console.log(
  `\n审计小结：检查 ${checkedAgents} 个有缓存角色，未导入字段 ${unimportedFields} 处（涉及非零招式 ${totalGapRows} 条）；`
  + `角色表共 ${agents.length}，缺 gachabase 缓存 ${missingCache.length}（--list 查看）`,
)
if (unimportedFields > 0) {
  console.log('处置：补进 import/导入路径（不要手改 catalog），或在本脚本 KNOWN_SINKS 里登记落点。')
  process.exit(1)
}

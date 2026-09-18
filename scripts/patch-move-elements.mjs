#!/usr/bin/env node
/* 按原文（nanoka full JSON）重刷 catalog 的**招式伤害属性**（move.damageElement + 属性行）。
 *
 * 背景（2026-09-18 round 23，用户 2026-09-17 裁决②）：
 * 旧导入器把**角色元素铺满每一招**，非本属性的段白吃本属性伤害加成/抗性、异常积蓄也照给。
 * 用户裁决原话：「需要明确，不属于自身属性的伤害不难积累，比如格里斯的平a前几段物理不能给积蓄」。
 *
 * ⚠ 规则 2：数值唯一事实源 = catalog.json，但**改数值走脚本重跑，不手改 JSON 本体**。
 *    本脚本就是那个「重跑」入口（同族先例：`sync-move-zh-names.mjs` / `patch-move-action-time.mjs`）。
 *
 * ⚠ 解析口径的单一事实源 = `scripts/lib/move-elements.mjs`（头注释记了三条已实测的错路：
 *    按 skill_list 的 id 直查 / 按名字整招铺给所有段 / 只认 skill_list）。
 *
 * 用法：
 *   node scripts/patch-move-elements.mjs            # dry-run，打印 delta 表 + 分类统计
 *   node scripts/patch-move-elements.mjs --write    # 落盘
 *   node scripts/patch-move-elements.mjs --agent 1011   # 只看/只改某角色
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeJsonCompact } from './lib/jsonio.mjs'
import { ELEMENT_ROW_KINDS, resolveMoveElements } from './lib/move-elements.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const catalogPath = resolve(root, 'public/static/catalog.json')
const fullDir = resolve(root, 'data/raw/nanoka_missing/full')

const write = process.argv.includes('--write')
const onlyIdx = process.argv.indexOf('--agent')
const only = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : null

const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))
const agents = new Map((catalog.agents ?? []).map(a => [String(a.id), a]))
const skills = new Map((catalog.agentSkills ?? []).map(a => [String(a.agentId), a]))

/** 该 move 上承载属性的行（伤害行 + 异常积蓄行；与导入器 buildMove 一致） */
function elementRows(move) {
  return (move.rows ?? []).filter(r => ELEMENT_ROW_KINDS.has(r.kind))
}

const changes = []
const bySource = {}
let scannedMoves = 0
let scannedAgents = 0

for (const file of readdirSync(fullDir).sort()) {
  if (!file.endsWith('.json')) continue
  const id = file.slice(0, -5)
  if (only && id !== only) continue
  const sk = skills.get(id)
  const ag = agents.get(id)
  if (!sk || !ag) continue
  if (!existsSync(resolve(fullDir, file))) continue
  const full = JSON.parse(readFileSync(resolve(fullDir, file), 'utf8'))
  const moveIds = (sk.categories ?? []).flatMap(c => (c.moves ?? []).map(m => String(m.id)))
  const resolved = resolveMoveElements(full, moveIds)
  scannedAgents++
  let agentChanges = 0
  for (const cat of sk.categories ?? []) {
    for (const move of cat.moves ?? []) {
      const r = resolved.get(String(move.id))
      if (!r) continue
      scannedMoves++
      bySource[r.source] = (bySource[r.source] ?? 0) + 1
      const rows = elementRows(move)
      const rowEls = new Set(rows.map(x => x.damageElement).filter(Boolean))
      const moveChanged = move.damageElement !== r.element
      const rowsChanged = rows.length > 0 && [...rowEls].some(e => e !== r.element)
      if (!moveChanged && !rowsChanged) continue
      changes.push({
        agentId: id, agentName: ag.name?.zhCN ?? id, moveId: String(move.id), moveName: move.name?.zhCN ?? '',
        from: move.damageElement, to: r.element, source: r.source, detail: r.detail ?? '',
        rows: rows.length,
      })
      agentChanges++
    }
  }
  if (agentChanges) console.log(`  ${id} ${ag.name?.zhCN ?? ''}: ${agentChanges}`)
}

console.log(`\n扫 ${scannedAgents} 角色 / ${scannedMoves} 招`)
console.log('解析来源分布:', bySource)
console.log(`待改 ${changes.length} 招`)

const bySrc = {}
for (const c of changes) bySrc[c.source] = (bySrc[c.source] ?? 0) + 1
console.log('改动来源分布:', bySrc)
console.log('\n--- delta 明细（前 40 条）---')
for (const c of changes.slice(0, 40)) {
  console.log(`  ${c.agentId} ${c.agentName} ${c.moveId} ${c.moveName}: ${c.from} → ${c.to} [${c.source}${c.detail ? ' ' + c.detail : ''}] rows=${c.rows}`)
}
if (changes.length > 40) console.log(`  … 另 ${changes.length - 40} 条`)

if (!write) {
  console.log('\n(dry-run；加 --write 落盘)')
  process.exit(0)
}

// ---- 落盘：move.damageElement + 属性行（伤害行/积蓄行）----
let applied = 0
for (const c of changes) {
  const sk = skills.get(c.agentId)
  for (const cat of sk.categories ?? []) {
    for (const move of cat.moves ?? []) {
      if (String(move.id) !== c.moveId) continue
      if (move.damageElement !== c.to) { move.damageElement = c.to; applied++ }
      for (const row of elementRows(move)) {
        if (row.damageElement !== c.to) { row.damageElement = c.to; applied++ }
      }
    }
  }
}
writeJsonCompact(catalogPath, catalog)
console.log(`\n已写入 catalog.json：${changes.length} 招 / ${applied} 处字段`)

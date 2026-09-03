#!/usr/bin/env node
/* 【一次性 v12 重导入】按 nanoka v12（3.2.12+18601660）技能表更新 catalog 中已存在角色的
 * 倍率行（1611 克拉蕾 / 1621 洛克茜，id 空间以 v12 为准）。
 *
 * 背景：catalog 里这两个角色的旧行由已下线的旧导入路径写入（nanoka_<id>_skills_lv12.json 旧快照）；
 * v12 中 1611 数值重平衡（毁伤 1232→1625.6、葬血强袭 1711.2→626.3、新增 1611029/1611030、删除 1611015），
 * 1621 整套重建（move 结构/名字/id 全部重排）。
 *
 * 用法：node scripts/import-nanoka-v12.mjs <id> [--write]
 *  - 按 v12 技能表重建该角色 agentSkills.categories（id/name/rows/energyCost/actionTime 全量，match 靠 id）
 *  - 1611 特殊：所有行 damageBasis='def'（锐化伤害，SHARPEN_DAMAGE_PROFILE 消费），攻击属性 electric
 *  - 技能名 zh 来自 data/raw/nanoka_missing/full/<id>.json skill_list（v12 快照）
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeJsonCompact } from './lib/jsonio.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const agentId = process.argv[2]
const write = process.argv.includes('--write')
if (!agentId) {
  console.error('用法: node scripts/import-nanoka-v12.mjs <id> [--write]')
  process.exit(1)
}

const skillsRaw = JSON.parse(readFileSync(resolve(root, `data/raw/nanoka_${agentId}_skills_lv12.json`), 'utf8'))
const full = JSON.parse(readFileSync(resolve(root, `data/raw/nanoka_missing/full/${agentId}.json`), 'utf8'))
const catalog = JSON.parse(readFileSync(resolve(root, 'public/static/catalog.json'), 'utf8'))

/* 从 v12 full JSON 的 description 结构建 id→中文名（param Skill:id ↔ description 条目名；
 * 与 skill_list 的 id 空间不同，不能互相查找——v12 里 1611013 = 毁伤参数，但 skill_list 1611013 = 快速支援）。 */
const zhNames = {}
for (const catKey of ['basic', 'dodge', 'special', 'chain', 'assist']) {
  const col = full.skill?.[catKey]?.description
  if (!Array.isArray(col)) continue
  for (const entry of col) {
    const entryName = String(entry?.name ?? '').replace(/<[^>]*>/g, '').trim()
    const params = Array.isArray(entry?.param) ? entry.param : []
    for (const p of params) {
      const ids = p?.param ? Object.keys(p.param) : []
      for (const moveId of ids) {
        if (!zhNames[moveId]) zhNames[moveId] = entryName
      }
    }
  }
}
// 兜底：参数名（如「上挑伤害倍率」）作为同一 skill 的段标注，只有一处的 skill 不加
for (const catKey of ['basic', 'dodge', 'special', 'chain', 'assist']) {
  const col = full.skill?.[catKey]?.description
  if (!Array.isArray(col)) continue
  for (const entry of col) {
    const entryName = String(entry?.name ?? '').replace(/<[^>]*>/g, '').trim()
    const params = Array.isArray(entry?.param) ? entry.param : []
    if (params.length === 1) continue
    const idsOfParam = []
    for (const p of params) {
      if (p?.param) for (const id of Object.keys(p.param)) {
        idsOfParam.push([id, String(p.name ?? '').replace(/<[^>]*>/g, '').trim()])
      }
    }
    const idCount = new Map()
    for (const [id] of idsOfParam) idCount.set(id, (idCount.get(id) ?? 0) + 1)
    for (const [id, pname] of idsOfParam) {
      if ((idCount.get(id) ?? 0) === 1 && (zhNames[id] ?? '') === entryName) zhNames[id] = `${entryName}·${pname}`
    }
  }
}

const CATEGORY_MAP = { basic: 'basic', dodge: 'dodge', special: 'special', chain: 'chain', ultimate: 'chain', assist: 'assist' }
const ELEMENT_BY_ID = { 0: 'physical', 203: 'electric', 1001: 'fire', 1002: 'ice', 1003: 'ether', 1004: 'physical', 1005: 'wind', 1006: 'physical' }

function num(v) { return Number.isFinite(v) ? v : 0 }
function actionTime(skill) {
  const ether = num(skill.ether_purify)
  const name = skill.name || ''
  let t = ether > 0 ? ether / 100 : 0
  if (/Dodge Counter/.test(name)) t -= 1.5
  else if (/Defensive Assist/.test(name)) t -= 2.5
  else if (/Ultimate/.test(name)) t -= 5
  return t > 0 ? Math.round(t * 1000) / 1000 : (ether > 0 ? 0.001 : 0)
}
function moveRow(rowId, kind, value, extra = {}) {
  return { id: rowId, label: { zhCN: rowId, en: rowId }, kind, values: [Math.round(value * 1000) / 1000], ...extra }
}

const isSharp = agentId === '1611' // 锐化伤害：def 基底
const categories = []
const catOrder = ['basic', 'dodge', 'special', 'chain', 'assist']
for (const catId of catOrder) {
  const moves = skillsRaw.skills.filter(s => CATEGORY_MAP[s.category] === catId)
  if (moves.length === 0) continue
  categories.push({
    id: catId,
    name: { zhCN: catId, en: catId },
    moves: moves.map(skill => {
      const rows = []
      if (num(skill.damage) > 0) rows.push(moveRow('damage', 'damageMultiplier', skill.damage, { ...(isSharp ? { damageBasis: 'def' } : {}), damageElement: isSharp ? 'electric' : undefined }))
      if (num(skill.daze) > 0) rows.push(moveRow('daze', 'dazeMultiplier', skill.daze))
      if (num(skill.energy_recovery) > 0) rows.push(moveRow('energy_recovery', 'energy', skill.energy_recovery))
      if (num(skill.flash_energy_recovery) > 0) rows.push(moveRow('flash_energy_recovery', 'flashEnergy', skill.flash_energy_recovery))
      if (num(skill.decibel_recovery) > 0) rows.push(moveRow('decibel_recovery', 'decibel', skill.decibel_recovery))
      if (num(skill.anomaly_buildup) > 0) rows.push(moveRow('anomaly_buildup', 'anomaly', skill.anomaly_buildup, { damageElement: isSharp ? 'electric' : undefined }))
      for (let i = 0; i < (skill.attack_data || []).length; i++) {
        if (num(skill.attack_data[i]) > 0) rows.push(moveRow(`attack_data_${i}`, 'special', skill.attack_data[i]))
      }
      if (num(skill.ether_purify) > 0) rows.push(moveRow('ether_purify', 'etherPurify', skill.ether_purify))
      return {
        id: String(skill.id),
        name: {
          zhCN: zhNames[String(skill.id)] || skill.name || String(skill.id),
          en: skill.name || String(skill.id),
        },
        damageElement: isSharp ? 'electric' : (skill.category === 'assist' ? 'physical' : 'electric'),
        skillType: CATEGORY_MAP[skill.category] || skill.category,
        rows,
        timeType: /Ultimate/.test(skill.name || '') ? 'ultimate' : 'normal',
        actionTime: actionTime(skill),
        ...(skill.energy_cost && Object.keys(skill.energy_cost).length ? { energyCost: skill.energy_cost } : {}),
      }
    }),
  })
}

const entry = catalog.agentSkills.find(s => s.agentId === agentId)
if (!entry) {
  console.error(`catalog 无 ${agentId} 条目`)
  process.exit(1)
}
const oldIds = entry.categories.flatMap(c => c.moves.map(m => m.id))
entry.categories = categories
const newIds = categories.flatMap(c => c.moves.map(m => m.id))

console.log(`${agentId}: ${oldIds.length} → ${newIds.length} 行`)
console.log('  删除:', oldIds.filter(id => !newIds.includes(id)).join(',') || '无')
console.log('  新增:', newIds.filter(id => !oldIds.includes(id)).join(',') || '无')
console.log('  变化行:', newIds.filter(id => oldIds.includes(id)).length, '(数值以 v12 为准)')

if (write) {
  writeJsonCompact(resolve(root, 'public/static/catalog.json'), catalog)
  console.log('已写入 catalog.json（紧凑）')
} else {
  console.log('dry-run（--write 生效）')
}

#!/usr/bin/env node
/* Audit the 30 newly added agents against their local raw nanoka data.
 * Reports any mismatch between catalog.json and data/raw/nanoka_missing/.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const rawDir = resolve(root, 'data/raw/nanoka_missing')
const fullDir = resolve(rawDir, 'full')
const list = JSON.parse(readFileSync(resolve(rawDir, 'list.json'), 'utf8'))
const catalog = JSON.parse(readFileSync(resolve(root, 'public/static/catalog.json'), 'utf8'))

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

function close(a, b, tolerance = 1e-6) {
  return Math.abs(num(a) - num(b)) <= tolerance
}

function level60(stats) {
  const base = stats.base_stats || {}
  const lv = stats.level_progression?.['6'] || {}
  const extra = stats.extra_stats_lvl60 || {}
  const flat = (name) => num(extra[name]?.value)
  return {
    hpBase: num(base.hp_base_lvl1) + num(base.hp_growth_per_level) * 59 + num(lv.hp) + flat('Base HP'),
    atkBase: num(base.atk_base_lvl1) + num(base.atk_growth_per_level) * 59 + num(lv.atk) + flat('Base ATK'),
    defBase: num(base.def_base_lvl1) + num(base.def_growth_per_level) * 59 + num(lv.def) + flat('Base DEF'),
    critRate: Math.round(num(base.crit_rate_base) * 100 * 100) / 100,
    critDmg: Math.round(num(base.crit_dmg_base) * 100 * 100) / 100,
    impact: num(base.impact_base),
    anomalyProficiency: num(base.anomaly_proficiency_base),
    anomalyMastery: num(base.anomaly_mastery_base),
    energyRegen: Math.round((num(base.energy_auto_recover) * 100 + flat('Base Energy Regen') / 100) * 100) / 100,
    flashEnergyRegen: Math.round((num(base.flash_energy_auto_recover) * 100 + flat('Base Adrenaline') / 100) * 100) / 100,
    energyMax: num(base.energy_max) || 120,
    flashEnergyMax: num(base.flash_energy_max) || 0,
    penRatio: Math.round(num(base.penetration_rate_base) * 100 * 100) / 100,
  }
}

function actionTime(skill) {
  const ether = num(skill.ether_purify)
  const name = skill.name || ''
  let t = ether > 0 ? ether / 100 : 0
  if (/Dodge Counter/.test(name)) t -= 1.5
  else if (/Defensive Assist/.test(name)) t -= 2.5
  else if (/Ultimate/.test(name)) t -= 5
  return t > 0 ? Math.round(t * 1000) / 1000 : (ether > 0 ? 0.001 : 0)
}

const issues = []
let checks = 0

for (const id of Object.keys(list)) {
  const skillsRawPath = resolve(rawDir, `${id}_skills.json`)
  const statsRawPath = resolve(rawDir, `${id}_stats.json`)
  const fullPath = resolve(fullDir, `${id}.json`)
  if (!existsSync(skillsRawPath) || !existsSync(statsRawPath) || !existsSync(fullPath)) {
    issues.push(`${id}: missing raw files`)
    continue
  }
  const skillsRaw = JSON.parse(readFileSync(skillsRawPath, 'utf8'))
  const statsRaw = JSON.parse(readFileSync(statsRawPath, 'utf8'))
  const full = JSON.parse(readFileSync(fullPath, 'utf8'))
  const agent = catalog.agents.find(a => a.id === id)
  const skillsEntry = catalog.agentSkills.find(s => s.agentId === id)
  if (!agent || !skillsEntry) {
    issues.push(`${id}: missing catalog agent or skills table`)
    continue
  }

  const expectedL60 = level60(statsRaw)
  const actualL60 = agent.level60 || {}
  for (const key of Object.keys(expectedL60)) {
    checks++
    if (!close(actualL60[key], expectedL60[key], 0.01)) {
      issues.push(`${id}: level60.${key} expected ${expectedL60[key]}, got ${actualL60[key]}`)
    }
  }

  const rawById = new Map(skillsRaw.skills.map(s => [s.id, s]))
  const catalogMoves = skillsEntry.categories.flatMap(cat => cat.moves)
  checks++
  if (catalogMoves.length !== skillsRaw.skills.length) {
    issues.push(`${id}: move count expected ${skillsRaw.skills.length}, got ${catalogMoves.length}`)
  }

  for (const move of catalogMoves) {
    const raw = rawById.get(move.id)
    if (!raw) {
      issues.push(`${id}: move ${move.id} missing from raw`)
      continue
    }
    const row = id => move.rows.find(r => r.id === id)
    const compare = (kind, rawValue) => {
      checks++
      const r = row(kind)
      const got = r?.values?.[0] ?? 0
      if (!close(got, rawValue)) {
        issues.push(`${id}: move ${move.id} row ${kind} expected ${rawValue}, got ${got}`)
      }
    }
    compare('damage', raw.damage)
    compare('daze', raw.daze)
    compare('energy_recovery', raw.energy_recovery)
    compare('flash_energy_recovery', raw.flash_energy_recovery)
    compare('decibel_recovery', raw.decibel_recovery)
    compare('anomaly_buildup', raw.anomaly_buildup)
    compare('ether_purify', raw.ether_purify)
    checks++
    if (!close(move.actionTime ?? 0, actionTime(raw))) {
      issues.push(`${id}: move ${move.id} actionTime expected ${actionTime(raw)}, got ${move.actionTime}`)
    }
    checks++
    const rawCost = JSON.stringify(raw.energy_cost || {})
    const gotCost = JSON.stringify(move.energyCost || {})
    if (rawCost !== gotCost) {
      issues.push(`${id}: move ${move.id} energyCost expected ${rawCost}, got ${gotCost}`)
    }
  }

  const nameMap = {}
  for (const [moveId, info] of Object.entries(full.skill_list ?? {})) {
    const zh = String(info?.name ?? '').replace(/<[^>]*>/g, '').trim()
    if (zh) nameMap[moveId] = zh
  }
  checks++
  const missingZh = catalogMoves.filter(m => !/[\u3400-\u9fff]/.test(m.name?.zhCN ?? '')).length
  if (missingZh > 0) {
    issues.push(`${id}: ${missingZh} moves still lack zhCN names`)
  }
}

const report = [
  '# 30 个新角色录入审计',
  '',
  `> 由 \`scripts/audit-nanoka-missing.mjs\` 生成，检查项 ${checks} 条。`,
  '',
  issues.length ? '## 发现的不一致' : '## 未发现不一致',
  '',
  ...(issues.length ? issues.map(i => `- ${i}`) : ['全部 catalog 数值与本地 nanoka raw 一致。']),
  '',
]
writeFileSync(resolve(rawDir, 'AUDIT.md'), report.join('\n'))
console.log(`audit ${Object.keys(list).length} agents, ${checks} checks, ${issues.length} issues`)
process.exit(issues.length === 0 ? 0 : 1)

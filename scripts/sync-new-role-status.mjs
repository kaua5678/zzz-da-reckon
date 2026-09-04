#!/usr/bin/env node
/* Sync the 30 newly added agents into character-mechanics.json and
 * character-constellations.json as not_described_not_implemented placeholders.
 * Existing entries are left untouched so implemented data is never clobbered.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { writeJsonCompact } from './lib/jsonio.mjs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const fullDir = resolve(root, 'data/raw/nanoka_missing/full')
const list = JSON.parse(readFileSync(resolve(root, 'data/raw/nanoka_missing/list.json'), 'utf8'))
const mechanicsPath = resolve(root, 'public/static/character-mechanics.json')
const constellationsPath = resolve(root, 'public/static/character-constellations.json')
const mechanics = JSON.parse(readFileSync(mechanicsPath, 'utf8'))
const constellations = JSON.parse(readFileSync(constellationsPath, 'utf8'))

function plain(value) {
  return String(value ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function first(value) {
  return Array.isArray(value) ? (value[0] ?? '') : value
}

function isGenericSkillLevelCinema(desc) {
  return plain(desc).includes('技能等级+2')
}

let synced = 0
for (const id of Object.keys(list)) {
  const fullPath = resolve(fullDir, `${id}.json`)
  if (!existsSync(fullPath)) continue
  const data = JSON.parse(readFileSync(fullPath, 'utf8'))
  const meta = list[id] || {}
  const name = { zhCN: data.name || meta.zh || id, en: data.code_name || meta.en || id }

  if (!constellations.characters[id]) {
    const talentEntries = Object.entries(data.talent ?? {})
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([level, t]) => ({
        cinema: Number(level),
        status: 'not_described_not_implemented',
        implemented: [],
        pending: [
          `影画${level} ${t.name ?? ''}：${plain(t.desc ?? '')}`,
          '待人工核对后补实现，勿直接默认省略。',
        ],
      }))
    for (const cinema of talentEntries) {
      const talent = data.talent?.[String(cinema.cinema)]
      if (isGenericSkillLevelCinema(talent?.desc)) {
        cinema.status = 'implemented_generic_skill_level'
        cinema.implemented = ['通用技能等级+2，通过 skillLevelBonus / skillLevelCoef 接入伤害与失衡倍率。']
        cinema.pending = []
      }
    }
    constellations.characters[id] = { name, cinemas: talentEntries }
  }

  if (!mechanics.characters[id]) {
    const passiveLevels = Object.values(data.passive?.level ?? {}).sort((a, b) => a.level - b.level)
    const maxPassive = passiveLevels[passiveLevels.length - 1] ?? null
    const coreName = maxPassive ? first(maxPassive.name?.[0]) : '核心被动'
    const extraName = maxPassive ? first(maxPassive.name?.[1]) : '额外能力'
    const coreDesc = maxPassive ? plain(maxPassive.desc?.[0]) : ''
    const extraDesc = maxPassive ? plain(maxPassive.desc?.[1]) : ''
    const mechanicsList = []
    if (coreDesc) {
      mechanicsList.push({
        id: `core_passive_${id}`,
        name: coreName,
        status: 'not_described_not_implemented',
        implementation: 'not_described_not_implemented',
        implementedParts: [],
        pendingParts: [coreDesc],
        pending: [coreDesc],
        codePaths: [],
      })
    }
    if (extraDesc) {
      mechanicsList.push({
        id: `additional_ability_${id}`,
        name: extraName,
        status: 'not_described_not_implemented',
        implementation: 'not_described_not_implemented',
        implementedParts: [],
        pendingParts: [extraDesc],
        pending: [extraDesc],
        codePaths: [],
      })
    }
    const potentialEntries = Object.entries(data.potential_detail ?? {})
      .map(([, p]) => {
        const desc = plain(p.desc ?? '')
        if (!desc) return ''
        const level = p.level_show_name ?? p.level ?? ''
        return `潜能${level ? `（${level}）` : ''} ${p.name ?? ''}：${desc}`
      })
      .filter(Boolean)
    if (potentialEntries.length) {
      mechanicsList.push({
        id: `potential_${id}`,
        name: '潜能觉醒',
        status: 'not_described_not_implemented',
        implementation: 'not_described_not_implemented',
        implementedParts: [],
        pendingParts: potentialEntries,
        pending: potentialEntries,
        codePaths: [],
      })
    }
    const cinemaImplementation = Object.entries(data.talent ?? {})
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([level, t]) => ({
        cinema: Number(level),
        status: 'not_described_not_implemented',
        implemented: [],
        pending: [`影画${level} ${t.name ?? ''}：${plain(t.desc ?? '')}`],
      }))
    for (const cinema of cinemaImplementation) {
      const talent = data.talent?.[String(cinema.cinema)]
      if (isGenericSkillLevelCinema(talent?.desc)) {
        cinema.status = 'implemented_generic_skill_level'
        cinema.implemented = ['通用技能等级+2，通过 skillLevelBonus / skillLevelCoef 接入伤害与失衡倍率。']
        cinema.pending = []
      }
    }
    // 单一事实源：核心被动/额外能力的录入占位已在 mechanicsList（core_passive_<id> /
    // additional_ability_<id>）承载，不再另写顶层 corePassive/additionalAbility 重复字段
    // （历史上顶层占位从不回填，与 mechanics[] 漂移且被状态表漏读——2026-09-04 归一）。
    mechanics.characters[id] = {
      name,
      specialResources: [],
      mechanics: mechanicsList,
      cinemaImplementation,
    }
    synced++
  }
}

// Keep status/implementation in sync for placeholder entries; never overwrite
// existing implemented parts.
for (const id of Object.keys(list)) {
  const entry = mechanics.characters[id]
  if (!entry) continue
  for (const item of entry.mechanics ?? []) {
    if (!item.status) item.status = item.implementation ?? 'not_described_not_implemented'
    if (!item.implementation) item.implementation = item.status
    if (!item.pending) item.pending = item.pendingParts ?? []
  }
}

// Upgrade standard C3/C5 entries already created in a previous run.
for (const id of Object.keys(list)) {
  const fullPath = resolve(fullDir, `${id}.json`)
  if (!existsSync(fullPath)) continue
  const data = JSON.parse(readFileSync(fullPath, 'utf8'))
  const constEntry = constellations.characters[id]
  for (const cinema of constEntry?.cinemas ?? []) {
    const talent = data.talent?.[String(cinema.cinema)]
    if (cinema.status === 'not_described_not_implemented' && isGenericSkillLevelCinema(talent?.desc)) {
      cinema.status = 'implemented_generic_skill_level'
      cinema.implemented = ['通用技能等级+2，通过 skillLevelBonus / skillLevelCoef 接入伤害与失衡倍率。']
      cinema.pending = []
    }
  }
  const mechEntry = mechanics.characters[id]
  for (const cinema of mechEntry?.cinemaImplementation ?? []) {
    const talent = data.talent?.[String(cinema.cinema)]
    if (cinema.status === 'not_described_not_implemented' && isGenericSkillLevelCinema(talent?.desc)) {
      cinema.status = 'implemented_generic_skill_level'
      cinema.implemented = ['通用技能等级+2，通过 skillLevelBonus / skillLevelCoef 接入伤害与失衡倍率。']
      cinema.pending = []
    }
  }
}

writeJsonCompact(mechanicsPath, mechanics)
writeJsonCompact(constellationsPath, constellations)
console.log(`synced ${synced} new agents into status files`)

#!/usr/bin/env node
/* Enrich the 30 newly added agents with full zh JSON data:
 * - Chinese move names from skill_list -> catalog.agentSkills
 * - core passive / additional ability / cinema / potential text -> spec notes
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const catalogPath = resolve(root, 'public/static/catalog.json')
const fullDir = resolve(root, 'data/raw/nanoka_missing/full')
const specsDir = resolve(root, 'src/specs/agents')
const list = JSON.parse(readFileSync(resolve(root, 'data/raw/nanoka_missing/list.json'), 'utf8'))
const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))

function plain(value) {
  return String(value ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function first(value) {
  return Array.isArray(value) ? (value[0] ?? '') : value
}

let enriched = 0
for (const id of Object.keys(list)) {
  const fullPath = resolve(fullDir, `${id}.json`)
  if (!existsSync(fullPath)) {
    console.warn(`skip ${id}: full json missing`)
    continue
  }
  const data = JSON.parse(readFileSync(fullPath, 'utf8'))

  const nameMap = {}
  for (const [moveId, info] of Object.entries(data.skill_list ?? {})) {
    const zh = plain(info?.name)
    if (zh) nameMap[moveId] = zh
  }
  // skill_list 只覆盖正式命名段；param 重复段用 skill.description 的名称兜底。
  for (const category of Object.values(data.skill ?? {})) {
    if (typeof category !== 'object' || !category) continue
    for (const entry of category.description ?? []) {
      const fallbackName = plain(entry?.name)
      if (!fallbackName) continue
      for (const paramEntry of entry.param ?? []) {
        for (const moveId of Object.keys(paramEntry.param ?? {})) {
          if (!(moveId in nameMap)) nameMap[moveId] = fallbackName
        }
      }
    }
  }
  const skillsEntry = catalog.agentSkills.find(s => s.agentId === id)
  if (skillsEntry) {
    for (const category of skillsEntry.categories ?? []) {
      for (const move of category.moves ?? []) {
        if (nameMap[move.id]) move.name.zhCN = nameMap[move.id]
      }
    }
  }

  const agent = catalog.agents.find(a => a.id === id)
  if (agent) {
    const buffPassiveLevels = Object.values(data.passive?.level ?? {}).sort((a, b) => a.level - b.level)
    const maxPassive = buffPassiveLevels[buffPassiveLevels.length - 1] ?? null
    const coreName = maxPassive ? first(maxPassive.name?.[0]) || '核心被动' : '核心被动'
    const extraName = maxPassive ? first(maxPassive.name?.[1]) || '额外能力' : '额外能力'
    const coreDesc = maxPassive ? plain(maxPassive.desc?.[0]) : ''
    const extraDesc = maxPassive ? plain(maxPassive.desc?.[1]) : ''
    const currentBuffs = agent.combatBuffs ?? { corePassive: null, additionalAbility: null, cinemaBuffs: [] }
    if (!currentBuffs.corePassive && coreDesc) {
      currentBuffs.corePassive = {
        scope: 'inCombat',
        name: { zhCN: coreName, en: data.name || id },
        description: { zhCN: coreDesc, en: coreDesc },
        effects: [],
      }
    }
    if (!currentBuffs.additionalAbility && extraDesc) {
      currentBuffs.additionalAbility = {
        scope: 'inCombat',
        name: { zhCN: extraName, en: extraName },
        description: { zhCN: extraDesc, en: extraDesc },
        effects: [],
      }
    }
    if (!currentBuffs.cinemaBuffs?.length) {
      currentBuffs.cinemaBuffs = Object.entries(data.talent ?? {})
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([level, t]) => ({
          cinemaLevel: Number(level),
          cinemaName: { zhCN: t.name ?? '', en: t.name ?? '' },
          description: { zhCN: plain(t.desc ?? ''), en: plain(t.desc ?? '') },
          buff: {
            scope: 'inCombat',
            name: { zhCN: `影画${level} · ${t.name ?? ''}`, en: `Cinema ${level} · ${t.name ?? ''}` },
            description: { zhCN: plain(t.desc ?? ''), en: plain(t.desc ?? '') },
            effects: [],
          },
        }))
    }
    agent.combatBuffs = currentBuffs
  }

  const passiveLevels = Object.values(data.passive?.level ?? {}).sort((a, b) => a.level - b.level)
  const passiveNote = passiveLevels.length
    ? '核心被动/额外能力（文本，Lv.1-7）：\n' + passiveLevels.map(p => {
        const coreName = first(p.name?.[0]) || '核心被动'
        const extraName = first(p.name?.[1]) || '额外能力'
        const core = `${coreName} Lv.${p.level}：${plain(p.desc?.[0])}`
        const extra = `${extraName}：${plain(p.desc?.[1])}`
        return `${core}\n${extra}`
      }).join('\n')
    : ''
  const talentNote = Object.entries(data.talent ?? {})
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([level, t]) => `影画${level} ${t.name ?? ''}：${plain(t.desc ?? '')}`)
    .join('\n')
  const potentialNote = Object.entries(data.potential_detail ?? {})
    .map(([, p]) => {
      const desc = plain(p.desc ?? '')
      if (!desc) return ''
      const level = p.level_show_name ?? p.level ?? ''
      return `潜能${level ? `（${level}）` : ''} ${p.name ?? ''}：${desc}`
    })
    .filter(Boolean)
    .join('\n')

  const specPath = resolve(specsDir, `${id}.json`)
  if (!existsSync(specPath)) {
    console.warn(`skip ${id}: spec json missing`)
    continue
  }
  const spec = JSON.parse(readFileSync(specPath, 'utf8'))
  const marker = '机制文本来源：nanoka full zh JSON'
  if (!spec.notes.some(n => n.includes(marker))) {
    spec.notes.push(marker)
    if (passiveNote) spec.notes.push(passiveNote)
    if (talentNote) spec.notes.push(`影画机制文本：\n${talentNote}`)
    if (potentialNote) spec.notes.push(`潜能觉醒文本：\n${potentialNote}`)
    spec.notes.push('以上仅录入原始机制文本，尚未按 spec attributeConversions/resources/events 实现，待人工核对后补充。')
    writeFileSync(specPath, JSON.stringify(spec, null, 2))
  }
  enriched++
}

writeFileSync(catalogPath, JSON.stringify(catalog, null, 2))
console.log(`enriched ${enriched} agents, move zhCN names updated`)

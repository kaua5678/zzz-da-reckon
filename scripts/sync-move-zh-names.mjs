#!/usr/bin/env node
/* 用完整 JSON description 的 param 映射重刷中文招式名。
 * 背景：skill_list 在分段招式上只给代表招式名，可能把 #1-#5 错配成不同技能；
 * description 的 entry.name 才是该 param 段实际归属的招式名。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { writeJsonCompact } from './lib/jsonio.mjs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const fullDir = resolve(root, 'data/raw/nanoka_missing/full')
const catalogPath = resolve(root, 'public/static/catalog.json')
const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))

function plain(value) {
  return String(value ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

let changed = 0
let checked = 0
let skipped = 0
const remainingEnglish = []
const perAgent = []
const previewAgentId = process.argv.find(arg => arg.startsWith('--preview='))?.slice('--preview='.length)
const previewRows = []

function auditCatalog() {
  const issues = []
  for (const agent of catalog.agentSkills ?? []) {
    const groups = new Map()
    for (const category of agent.categories ?? []) {
      for (const move of category.moves ?? []) {
        const enBase = String(move.name?.en ?? '').replace(/\s+#\d+$/, '')
        const zhBase = String(move.name?.zhCN ?? '').replace(/\s+#\d+$/, '')
        if (!enBase || !zhBase) continue
        if (zhBase === enBase) {
          issues.push({ agent: agent.agentId, move: move.id, en: move.name?.en, zh: move.name?.zhCN, issue: 'unlocalized' })
        }
        if (!groups.has(enBase)) groups.set(enBase, new Set())
        groups.get(enBase).add(zhBase)
      }
    }
    for (const [enBase, zhBases] of groups) {
      if (zhBases.size > 1) {
        issues.push({ agent: agent.agentId, enBase, zhBases: [...zhBases], issue: 'base-mismatch' })
      }
    }
  }
  console.log(JSON.stringify(issues, null, 2))
  console.log(`audit issues ${issues.length}`)
}

if (process.argv.includes('--audit')) {
  auditCatalog()
  process.exit(0)
}

function splitSegmentSuffix(en) {
  const match = String(en ?? '').match(/\s+#\d+$/)
  return match ? match[0].trim() : ''
}

function cleanSourceName(value) {
  return String(value ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^(\(Test\d+\))+/, '')
    .trim()
}

function loadRawForAgent(agent) {
  const ids = [agent.agentId]
  const firstMoveId = agent.categories?.[0]?.moves?.[0]?.id
  if (firstMoveId && /^\d{4}/.test(firstMoveId)) {
    ids.push(firstMoveId.slice(0, 4))
  }
  for (const id of ids) {
    const candidates = [
      resolve(fullDir, `${id}.json`),
      resolve(root, 'data/raw', `nanoka_${id}_zh.json`),
    ]
    for (const path of candidates) {
      if (existsSync(path)) {
        return JSON.parse(readFileSync(path, 'utf8'))
      }
    }
  }
  return null
}

for (const agent of catalog.agentSkills ?? []) {
  const id = agent.agentId
  const data = loadRawForAgent(agent)
  if (!data) {
    skipped++
    continue
  }

  const descMap = new Map()
  for (const category of Object.values(data.skill ?? {})) {
    if (typeof category !== 'object' || !category) continue
    for (const entry of category.description ?? []) {
      const name = plain(entry?.name)
      if (!name) continue
      for (const paramEntry of entry.param ?? []) {
        for (const moveId of Object.keys(paramEntry.param ?? {})) {
          if (!descMap.has(moveId)) descMap.set(moveId, name)
        }
      }
    }
  }

  const skillListMap = new Map()
  for (const [moveId, info] of Object.entries(data.skill_list ?? {})) {
    const name = plain(info?.name)
    if (name) skillListMap.set(moveId, name)
  }

  let agentChanged = 0
  for (const category of agent.categories ?? []) {
    for (const move of category.moves ?? []) {
      checked++
      const baseName = cleanSourceName(descMap.get(move.id) ?? skillListMap.get(move.id) ?? '')
      const oldName = move.name?.zhCN ?? ''
      const segmentSuffix = splitSegmentSuffix(move.name?.en)
      const hasOwnSuffix = segmentSuffix && new RegExp(`#\\d+$`).test(baseName)
      const looksInternal = /_Title$|^Skill_/.test(baseName) || /^[A-Za-z0-9_]+$/.test(baseName)
      const keepOldLabel = oldName.includes('倍率') && !baseName.includes('倍率')
      const finalBase = looksInternal || keepOldLabel || !baseName ? oldName : baseName
      const newName = finalBase ? (hasOwnSuffix ? finalBase : `${finalBase}${segmentSuffix && !finalBase.includes(segmentSuffix) ? ` ${segmentSuffix}` : ''}`) : oldName
      if (newName && newName !== move.name?.zhCN) {
        move.name = { ...(move.name ?? {}), zhCN: newName }
        changed++
        agentChanged++
      }
      if (previewAgentId === id) {
        previewRows.push({ id: move.id, en: move.name?.en, oldZh: oldName, newZh: newName, fromDesc: descMap.has(move.id) })
      }
      if (newName && /^[A-Za-z]/.test(newName)) {
        remainingEnglish.push({ agent: id, move: move.id, en: move.name?.en, zh: newName })
      }
    }
  }
  perAgent.push({ id, changed: agentChanged })
}

if (process.argv.includes('--write')) {
  writeJsonCompact(catalogPath, catalog)
}

if (previewAgentId) {
  console.log(JSON.stringify(previewRows, null, 2))
}
console.log(`agents processed ${perAgent.length}, skipped ${skipped}, moves checked ${checked}, changed ${changed}${process.argv.includes('--write') ? ', written' : ' (dry run)'}`)
console.log(JSON.stringify(perAgent))
if (remainingEnglish.length) {
  console.log(`remaining english names ${remainingEnglish.length}:`)
  console.log(JSON.stringify(remainingEnglish.slice(0, 80), null, 2))
}

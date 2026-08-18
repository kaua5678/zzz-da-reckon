import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
let failed = 0
let checks = 0

function load(relativePath) {
  return JSON.parse(readFileSync(join(root, relativePath), 'utf8'))
}

function check(name, condition, detail = '') {
  checks++
  if (condition) {
    console.log(`  ok ${name}`)
  } else {
    failed++
    console.log(`  FAIL ${name}${detail ? ` - ${detail}` : ''}`)
  }
}

const catalog = load('public/static/catalog.json')
const agents = catalog.agents ?? []
const skills = catalog.agentSkills ?? []

check('catalog has agents and skills', agents.length > 0 && skills.length > 0)
check('agent/skill tables match in count', agents.length === skills.length)
check('agent ids are unique', new Set(agents.map(a => a.id)).size === agents.length)
check('skill agent ids are unique', new Set(skills.map(s => s.agentId)).size === skills.length)

const skillIds = new Set(skills.map(s => s.agentId))
check('every agent has a skills table', agents.every(a => skillIds.has(a.id)))

for (const key of ['wEngines', 'driveDiscSets', 'bosses']) {
  const rows = catalog[key] ?? []
  check(`${key} is a non-empty array`, Array.isArray(rows) && rows.length > 0)
  check(`${key} ids are unique`, new Set(rows.map(r => r.id)).size === rows.length)
}

const allowedStatuses = new Set([
  'implemented',
  'implemented_generic_skill_level',
  'implemented_approximation',
  'implemented_expected_value',
  'implemented_state_machine',
  'implemented_state_machine_approximation',
  'partially_implemented',
  'not_described_not_implemented',
])

for (const file of ['character-mechanics.json', 'character-constellations.json']) {
  const data = load(`public/static/${file}`)
  const unknown = []

  const walk = (value) => {
    if (!value || typeof value !== 'object') return
    if (typeof value.status === 'string' && !allowedStatuses.has(value.status)) {
      unknown.push(value.status)
    }
    for (const child of Object.values(value)) walk(child)
  }
  walk(data)

  check(`${file} parses and uses known status values`, unknown.length === 0, unknown.join(', '))
}

const teammateBuffs = load('public/static/teammate-buffs.json')
const buffRows = Array.isArray(teammateBuffs) ? teammateBuffs : (teammateBuffs.buffs ?? teammateBuffs.characters ?? [])
check('teammate buffs data is present', buffRows.length > 0)

// ===== 数据管道坑校验（替代 md 散文，机器强制） =====

// 1. faction 非空：额外能力 sameFactionAsSelf 依赖；由 scripts/import-factions.mjs 从 nanoka camp 录入。
const emptyFaction = agents.filter(a => !a.faction || String(a.faction).trim() === '').map(a => a.id)
check('every agent has non-empty faction', emptyFaction.length === 0, `缺失 faction: ${emptyFaction.join(', ')} → node scripts/import-factions.mjs --write`)

// 2. attack_data 导入完整性：nanoka 有非零 attack_data 的 move，catalog 也要有 attack_data_0 行。
//    老/slug 角色曾用旧脚本导入、漏 attack_data；新角色用 import-nanoka-missing.mjs 会导。
function buildNanokaAttackDataMoves() {
  const set = new Set()
  const scanSkillsJson = (path) => {
    try {
      const data = JSON.parse(readFileSync(path, 'utf8'))
      for (const s of data.skills ?? []) {
        if ((s.attack_data ?? []).some(v => v > 0)) set.add(String(s.id))
      }
    } catch { /* 忽略损坏文件 */ }
  }
  const rawDir = join(root, 'data/raw/nanoka_missing')
  if (existsSync(rawDir)) {
    for (const f of readdirSync(rawDir)) if (f.endsWith('_skills.json')) scanSkillsJson(join(rawDir, f))
  }
  const auditDir = join(root, 'data/raw/audit')
  if (existsSync(auditDir)) {
    for (const f of readdirSync(auditDir)) {
      if (!f.endsWith('.json')) continue
      try {
        const data = JSON.parse(readFileSync(join(auditDir, f), 'utf8'))
        for (const cat of Object.values(data.skill ?? {})) {
          for (const desc of cat.description ?? []) {
            for (const pe of desc.param ?? []) {
              for (const [moveId, v] of Object.entries(pe.param ?? {})) {
                if ((v?.attack_data ?? []).some(x => x > 0)) set.add(String(moveId))
              }
            }
          }
        }
      } catch { /* 忽略损坏文件 */ }
    }
  }
  return set
}

const nanokaAttackDataMoves = buildNanokaAttackDataMoves()
const missingAttackData = []
for (const s of skills) {
  for (const cat of s.categories ?? []) {
    for (const m of cat.moves ?? []) {
      if (nanokaAttackDataMoves.has(m.id) && !m.rows.some(r => String(r.id).startsWith('attack_data_'))) {
        missingAttackData.push(`${s.agentId}:${m.id}`)
      }
    }
  }
}
check('attack_data imported for moves that nanoka provides', missingAttackData.length === 0, `缺 attack_data: ${missingAttackData.join(', ')} → node scripts/import-attack-data.mjs <nanokaId> --write`)

console.log(failed === 0 ? `\n${checks} data checks passed` : `\n${failed} data check(s) failed`)
process.exit(failed === 0 ? 0 : 1)

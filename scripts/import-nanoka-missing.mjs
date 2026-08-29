#!/usr/bin/env node
/* Import missing nanoka characters into catalog.json + spec skeletons.
 * Raw data: data/raw/nanoka_missing/<id>_skills.json / <id>_stats.json
 * Existing aliases (e.g. nicole=1031) are skipped via teammate_nanoka_map.json.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { writeJsonCompact } from './lib/jsonio.mjs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const catalogPath = resolve(root, 'public/static/catalog.json')
const rawDir = resolve(root, 'data/raw/nanoka_missing')
const specsDir = resolve(root, 'src/specs/agents')

const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))
// 别名表（nicole=1031 等）：原抓取器仓库外置文件，收编到 data/raw/nanoka_missing/ 下；
// 缺失时按空表处理（60 角色已全部导入，该脚本仅用于补录未来新角色）
const mapPath = resolve(rawDir, 'teammate_nanoka_map.json')
const aliasMap = existsSync(mapPath) ? JSON.parse(readFileSync(mapPath, 'utf8')) : []
const aliasedIds = new Set(aliasMap.map(x => x.nanoka_id))
const existingIds = new Set(catalog.agents.map(a => a.id))

const list = JSON.parse(readFileSync(resolve(rawDir, 'list.json'), 'utf8'))
const missing = Object.keys(list).filter(id => !existingIds.has(id) && !aliasedIds.has(id))

const ELEMENT_MAP = {
  Physical: 'physical', Fire: 'fire', Ice: 'ice', Electric: 'electric',
  Ether: 'ether', Wind: 'wind', Lumiflux: 'lumiflux', Frost: 'ice',
  'Auric Ink': 'ether', 'Auric Ink DMG': 'ether',
}
const SPECIALTY_MAP = {
  Attack: 'attack', Stun: 'stun', Anomaly: 'anomaly', Support: 'support',
  Defense: 'defense', Rupture: 'rupture', Sharpen: 'sharpen', Edgeguard: 'edgeguard',
}
const CATEGORY_MAP = {
  basic: 'basic', dodge: 'dodge', special: 'special', chain: 'chain', assist: 'assist',
}

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
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
  const buildup = num(skill.anomaly_buildup)
  const name = skill.name || ''
  const bonus = /Dodge Counter/.test(name) ? 150 : /Defensive Assist/.test(name) ? 250 : /Ultimate/.test(name) ? 500 : 0
  // 秽盾语义 = 动作时间×100 + 类型加成（闪反+150/弹刀+250/终结+500）。
  // 加成缺失时秽盾即裸时间、与积蓄相等：真实时间 = 积蓄/100（佩洛伊斯凯旋坦途、叶瞬光大招等）；
  // 无积蓄时 = 秽盾/100（招架支援#3 的秽盾本就是裸时间，被 -2.5 会错钳成 0.001）。
  // 特例：佩洛伊斯其余三个大招秽盾 = 积蓄 + 350.01，公式推不出，
  // 由 scripts/patch-move-action-time.mjs 显式覆盖为用户核对值。
  if (bonus > 0 && ether > 0) {
    if (buildup > 0 && Math.abs(ether - buildup) <= 2) return Math.round(buildup / 100 * 10000) / 10000
    if (buildup <= 0 && ether <= bonus) return Math.round(ether / 100 * 1000) / 1000
  }
  let t = ether > 0 ? ether / 100 : 0
  if (/Dodge Counter/.test(name)) t -= 1.5
  else if (/Defensive Assist/.test(name)) t -= 2.5
  else if (/Ultimate/.test(name)) t -= 5
  return t > 0 ? Math.round(t * 1000) / 1000 : (buildup > 0 ? Math.round(buildup / 100 * 10000) / 10000 : (ether > 0 ? 0.001 : 0))
}

function moveRow(id, kind, values, extra = {}) {
  const row = { id, kind, values: Array.isArray(values) ? values : [values] }
  if (extra.damageBasis) row.damageBasis = extra.damageBasis
  if (extra.damageElement) row.damageElement = extra.damageElement
  return row
}

function buildMove(skill, element) {
  const rows = []
  if (num(skill.damage) > 0) rows.push(moveRow('damage', 'damageMultiplier', skill.damage, { damageBasis: 'atk', damageElement: element }))
  if (num(skill.daze) > 0) rows.push(moveRow('daze', 'daze', skill.daze, { damageBasis: 'atk' }))
  if (num(skill.energy_recovery) > 0) rows.push(moveRow('energy_recovery', 'energy', skill.energy_recovery))
  if (num(skill.flash_energy_recovery) > 0) rows.push(moveRow('flash_energy_recovery', 'flashEnergy', skill.flash_energy_recovery))
  if (num(skill.decibel_recovery) > 0) rows.push(moveRow('decibel_recovery', 'decibel', skill.decibel_recovery))
  if (num(skill.anomaly_buildup) > 0) rows.push(moveRow('anomaly_buildup', 'anomaly', skill.anomaly_buildup, { damageElement: element }))
  for (let i = 0; i < (skill.attack_data || []).length; i++) {
    rows.push(moveRow(`attack_data_${i}`, 'special', skill.attack_data[i]))
  }
  if (num(skill.ether_purify) > 0) rows.push(moveRow('ether_purify', 'etherPurify', skill.ether_purify))
  return {
    id: skill.id,
    name: { zhCN: skill.name, en: skill.name },
    damageElement: element,
    skillType: CATEGORY_MAP[skill.category] || skill.category,
    rows,
    timeType: /Ultimate/.test(skill.name || '') ? 'ultimate' : 'normal',
    actionTime: actionTime(skill),
    ...(skill.energy_cost && Object.keys(skill.energy_cost).length ? { energyCost: skill.energy_cost } : {}),
  }
}

const addedAgents = []
const addedSkills = []

for (const id of missing) {
  const skillsFile = resolve(rawDir, `${id}_skills.json`)
  const statsFile = resolve(rawDir, `${id}_stats.json`)
  if (!existsSync(skillsFile) || !existsSync(statsFile)) {
    console.warn('missing raw for', id)
    continue
  }
  const skills = JSON.parse(readFileSync(skillsFile, 'utf8'))
  const stats = JSON.parse(readFileSync(statsFile, 'utf8'))
  const info = stats.character_info || {}
  const meta = list[id] || {}
  const element = ELEMENT_MAP[info.element_type] || ELEMENT_MAP[meta.element] || 'physical'
  const specialty = SPECIALTY_MAP[info.weapon_type] || 'attack'
  const zh = meta.zh || info.name_cn || skills.name_en

  const agent = {
    id,
    name: { zhCN: zh, en: info.name_en || skills.name_en },
    rarity: num(info.rarity) >= 4 ? 'S' : 'A',
    attribute: element,
    specialty,
    attackTypes: [],
    faction: '',
    images: {},
    level60: level60(stats),
    combatBuffs: { corePassive: null, additionalAbility: null, cinemaBuffs: [] },
    coreSkill: { name: { zhCN: '核心技能', en: 'Core Skill' }, defaultLevel: 'max', levels: [] },
    damageElement: element,
    sources: [`https://zzz.nanoka.cc/character/${id}`],
    hidden: false,
  }

  const categories = []
  const byCat = new Map()
  for (const s of skills.skills || []) {
    const cat = CATEGORY_MAP[s.category] || s.category
    if (!byCat.has(cat)) byCat.set(cat, [])
    byCat.get(cat).push(buildMove(s, element))
  }
  for (const [cat, moves] of byCat) {
    categories.push({ id: cat, name: { zhCN: cat, en: cat }, levelRange: { min: 1, max: 12, default: 12 }, moves })
  }
  catalog.agents.push(agent)
  catalog.agentSkills.push({ id, agentId: id, name: { zhCN: zh, en: info.name_en || skills.name_en }, categories })
  addedAgents.push(id)
  addedSkills.push(id)

  const specPath = resolve(specsDir, `${id}.json`)
  if (!existsSync(specPath)) {
    writeFileSync(specPath, JSON.stringify({
      schemaVersion: 1,
      id: `agent:${id}`,
      name: zh,
      agentIds: [id],
      status: 'not_described_not_implemented',
      attributeConversions: [],
      resources: [],
      rowFusions: [],
      events: [],
      verifications: [],
      stateMachines: [],
      notes: [
        `来源：nanoka.cc 3.2.1（${info.name_en || ''}）。`,
        '基础属性与技能倍率由脚本自动导入；核心被动/额外能力/命座/专属资源等机制未实现，等待用户核对后补充。',
        `动作时间按「秽盾 = 时间×100 + 类型加成」推算（一般 /100、闪反 -1.5、弹刀 -2.5、终结 -5）；加成缺失时（秽盾≈积蓄）按积蓄/100 还原，招架支援#3 型无积蓄按秽盾/100。个别角色第三种偏移（如佩洛伊斯 +350）公式推不出，需 scripts/patch-move-action-time.mjs 用户核对值覆盖。`,
      ],
    }, null, 2))
  }
}

writeJsonCompact(catalogPath, catalog)
console.log('added agents', addedAgents.length, addedAgents.join(','))
console.log('added skills', addedSkills.length)

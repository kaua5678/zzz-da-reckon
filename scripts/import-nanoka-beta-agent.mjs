#!/usr/bin/env node
/* 录入 nanoka 测试服（beta 带 hash 构建）新角色的 catalog 骨架（agents + agentSkills）。
 *
 * 与 import-nanoka-missing.mjs 的区别：那个吃已退役爬虫的 <id>_skills/_stats.json，
 * 本脚本直接从 full/<id>.json 的 skill.<cat>.description[].param（倍率参数，param 空间 = moveId）
 * 与 stats/level/extra_level（基础属性）推导，双源对账证据在 data/raw/gachabase/<id>.json。
 *
 * 口径（2026-09-12 用 1621/1591/1551/1541 校准）：
 * - Lv12 倍率 = (main + growth×11)/100（damage/stun_ratio）；energy = sp_recovery/10000；
 *   decibel = fever_recovery/10000；anomaly = attribute_infliction/100（gachabase anomaly_buildup 无成长列）；
 *   attack_data_i = 原值/10000；ether_purify = 原值/100（import-nanoka-missing 的爬虫刻度）
 * - level60：hp/def = base + growth/10000×59 + level['6']；atk 再 + extra_level['6']['12101'].value；
 *   energyRegen = sp_recover/100；energyMax = sp_bar_point
 * - **同一 moveId 会出现在多个展示 param 行**（伤害倍率/失衡倍率行各带一份完整参数）——取首次出现，勿累加
 * - moveId 空间 = param/gachabase id ≠ skill_list id（SOP §0.5 陷阱）
 *
 * 用法：node scripts/import-nanoka-beta-agent.mjs <id>... [--version <v>] [--write]
 *   版本默认 manifest.zzz.live；beta 角色必须显式 --version（如 '3.3.2+18895034'）。
 *   同时把 id 补进 data/raw/nanoka_missing/list.json（sync-new-role-status 的占位入口）。
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeJsonCompact } from './lib/jsonio.mjs'
import { fetchJson } from './lib/http.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const verIdx = args.indexOf('--version')
const version = verIdx >= 0 ? args[verIdx + 1] : ''
const write = args.includes('--write')
const force = args.includes('--force')
const ids = args.filter((a, i) => !a.startsWith('--') && i !== verIdx && a !== version)
if (ids.length === 0 || !version) {
  console.error("用法: node scripts/import-nanoka-beta-agent.mjs <id>... --version '3.3.2+18895034' [--write]")
  process.exit(1)
}

const catalogPath = resolve(root, 'public/static/catalog.json')
const listPath = resolve(root, 'data/raw/nanoka_missing/list.json')
const fullDir = resolve(root, 'data/raw/nanoka_missing/full')
const STATIC = 'https://static.nanoka.cc'

const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))
const list = JSON.parse(readFileSync(listPath, 'utf8'))
const existingIds = new Set(catalog.agents.map(a => a.id))

const ELEMENT_KEYWORDS = [
  ['物理', 'physical'], ['火', 'fire'], ['冰', 'ice'], ['电', 'electric'],
  ['以太', 'ether'], ['风', 'wind'], ['烈霜', 'ice'],
]
const SPECIALTY_KEYWORDS = [
  ['强攻', 'attack'], ['击破', 'stun'], ['异常', 'anomaly'],
  ['支援', 'support'], ['防护', 'defense'], ['命破', 'rupture'], ['锐化', 'sharpen'],
]

function num(v) { return typeof v === 'number' && Number.isFinite(v) ? v : 0 }
function stripPrefix(s) { return String(s ?? '').replace(/^\(Test\d+\)/, '').trim() }
function pick(dict, keywords) {
  const values = Object.values(dict ?? {}).map(String)
  for (const [kw, key] of keywords) if (values.some(v => v.includes(kw))) return key
  return ''
}

/** 逐 moveId 收集参数（首次出现为准）+ 中/英文名（import-v12 的 entry/param 命名逻辑） */
function collectMoves(full) {
  const moves = new Map()
  for (const cat of ['basic', 'dodge', 'special', 'chain', 'assist']) {
    for (const entry of full.skill?.[cat]?.description ?? []) {
      const entryName = stripPrefix(entry?.name)
      const params = Array.isArray(entry?.param) ? entry.param : []
      const idsOfParam = []
      for (const p of params) {
        for (const [moveId, pv] of Object.entries(p?.param ?? {})) {
          idsOfParam.push([moveId, stripPrefix(p?.name)])
          if (!moves.has(moveId)) {
            moves.set(moveId, { moveId, cat, entryName, paramName: stripPrefix(p?.name), pv })
          }
        }
      }
      // 兜底：同 entry 多段时用「招式名·参数名」区分只出现一次的 id
      if (params.length > 1) {
        const idCount = new Map()
        for (const [id] of idsOfParam) idCount.set(id, (idCount.get(id) ?? 0) + 1)
        for (const [id, pname] of idsOfParam) {
          const m = moves.get(id)
          if (m && idCount.get(id) === 1 && pname) m.entryName = `${m.entryName}·${pname}`
        }
      }
    }
  }
  return moves
}

function enNamesOf(fullEn) {
  const names = new Map()
  for (const cat of ['basic', 'dodge', 'special', 'chain', 'assist']) {
    for (const entry of fullEn.skill?.[cat]?.description ?? []) {
      const entryName = stripPrefix(entry?.name)
      for (const p of Array.isArray(entry?.param) ? entry.param : []) {
        for (const moveId of Object.keys(p?.param ?? {})) {
          if (!names.has(moveId)) names.set(moveId, entryName)
        }
      }
    }
  }
  return names
}

/** 秽盾口径 = import-nanoka-missing.actionTime（输入为爬虫刻度 ether=raw/100、buildup=raw/100）：
 *  秽盾 = 动作时间×100 + 类型加成（闪反+1.5/弹刀+2.5/终结+5）→ 按中文名识别类型折减 */
function actionTime(etherRaw, zhName) {
  const ether = etherRaw / 100
  let t = ether > 0 ? ether / 100 : 0
  if (/闪避反击/.test(zhName)) t -= 1.5
  else if (/招架支援/.test(zhName)) t -= 2.5
  // 「终结技：入场」是入场动作不是喧响终结，不吃 -5 加成折减
  else if (/(终极技|终结技)/.test(zhName) && !/入场/.test(zhName)) t -= 5
  // actionTimeSanity 全库口径：秽盾 ≤ 类型加成（beta 数据终结技常见）→ 未含加成，时间 = ether/100，禁止钳位 0.001
  if (t <= 0) t = ether > 0 ? ether / 100 : 0
  return Math.round(t * 1000) / 1000
}

const added = []
for (const id of ids) {
  if (existingIds.has(id) && !force) { console.log(`skip ${id}（catalog 已存在，--force 覆盖）`); continue }
  if (existingIds.has(id)) {
    catalog.agents = catalog.agents.filter(a => a.id !== id)
    catalog.agentSkills = catalog.agentSkills.filter(s => s.agentId !== id)
  }
  const zhPath = resolve(fullDir, `${id}.json`)
  const enPath = resolve(fullDir, `${id}_en.json`)
  if (!existsSync(zhPath)) { console.error(`缺 ${zhPath}`); process.exit(1) }
  if (!existsSync(enPath)) {
    mkdirSync(fullDir, { recursive: true })
    const en = await fetchJson(`${STATIC}/zzz/${version}/en/character/${id}.json`, { retries: 1 })
    if (!en?.id) { console.error(`FAIL en ${id}`); process.exit(1) }
    const { writeFileSync } = await import('node:fs')
    writeFileSync(enPath, JSON.stringify(en, null, 2))
  }
  const full = JSON.parse(readFileSync(zhPath, 'utf8'))
  const fullEn = JSON.parse(readFileSync(enPath, 'utf8'))
  const st = full.stats
  const lv6 = full.level?.['6'] ?? {}
  const ex6 = full.extra_level?.['6']?.extra ?? {}
  const element = pick(full.element_type, ELEMENT_KEYWORDS)
  const specialty = pick(full.weapon_type, SPECIALTY_KEYWORDS)
  const zh = stripPrefix(full.name)
  const en = stripPrefix(fullEn.name) || stripPrefix(full.code_name)
  const faction = Object.values(full.camp ?? {}).map(String)[0] ?? ''

  const level60 = {
    hpBase: Math.round((num(st.hp_max) + num(st.hp_growth) / 10000 * 59 + num(lv6.hp_max)) * 10000) / 10000,
    atkBase: Math.round((num(st.attack) + num(st.attack_growth) / 10000 * 59 + num(lv6.attack) + num(ex6['12101']?.value)) * 10000) / 10000,
    defBase: Math.round((num(st.defence) + num(st.defence_growth) / 10000 * 59 + num(lv6.defence)) * 10000) / 10000,
    critRate: Math.round(num(st.crit)) / 100,
    critDmg: Math.round(num(st.crit_damage)) / 100,
    impact: num(st.break_stun),
    anomalyProficiency: num(st.element_abnormal_power),
    anomalyMastery: num(st.element_mystery),
    energyRegen: Math.round(num(st.sp_recover)) / 100,
    energyMax: num(st.sp_bar_point) || 120,
    penRatio: 0,
  }

  const moves = collectMoves(full)
  const enNames = enNamesOf(fullEn)
  const byCat = new Map()
  for (const m of moves.values()) {
    const pv = m.pv
    const damage = (num(pv.damage_percentage) + num(pv.damage_percentage_growth) * 11) / 100
    const daze = (num(pv.stun_ratio) + num(pv.stun_ratio_growth) * 11) / 100
    const energy = num(pv.sp_recovery) / 10000
    const decibel = num(pv.fever_recovery) / 10000
    const anomaly = num(pv.attribute_infliction) / 100
    const ether = num(pv.ether_purify)
    const rows = []
    if (damage > 0) rows.push({ id: 'damage', kind: 'damageMultiplier', values: [Math.round(damage * 1000) / 1000], damageBasis: 'atk', damageElement: element })
    if (daze > 0) rows.push({ id: 'daze', kind: 'dazeMultiplier', values: [Math.round(daze * 1000) / 1000] })
    if (energy > 0) rows.push({ id: 'energy_recovery', kind: 'energy', values: [Math.round(energy * 10000) / 10000] })
    if (decibel > 0) rows.push({ id: 'decibel_recovery', kind: 'decibel', values: [Math.round(decibel * 10000) / 10000] })
    if (anomaly > 0) rows.push({ id: 'anomaly_buildup', kind: 'anomaly', values: [Math.round(anomaly * 1000) / 1000], damageElement: element })
    for (let i = 0; i < (pv.attack_data ?? []).length; i++) {
      const v = num(pv.attack_data[i]) / 10000
      if (v > 0) rows.push({ id: `attack_data_${i}`, kind: 'special', values: [Math.round(v * 10000) / 10000] })
    }
    if (ether > 0) rows.push({ id: 'ether_purify', kind: 'etherPurify', values: [Math.round(ether / 100 * 1000) / 1000] })
    const isUltimate = (/(终极技|终结技)/.test(m.entryName) || /Ultimate/.test(enNames.get(m.moveId) ?? '')) && !/入场/.test(m.entryName)
    const isExSpecial = /强化特殊技/.test(m.entryName) || /EX Special/.test(enNames.get(m.moveId) ?? '')
    const move = {
      id: m.moveId,
      name: { zhCN: m.entryName, en: enNames.get(m.moveId) ?? m.entryName },
      damageElement: element,
      skillType: m.cat,
      rows,
      timeType: isUltimate ? 'ultimate' : 'normal',
      actionTime: actionTime(ether, m.entryName),
    }
    // 强化特殊技能量消耗：beta 数据双源均无 energy_cost（nanoka param/gachabase 皆缺）
    // → 按全库最常见值 60 兜底 [猜测·低]，spec notes 标注待正式服复核
    if (isExSpecial && damage > 0) move.energyCost = { 'Energy Cost': '60' }
    if (!byCat.has(m.cat)) byCat.set(m.cat, [])
    byCat.get(m.cat).push(move)
  }
  const categories = [...byCat.entries()].map(([cat, catMoves]) => ({
    id: cat,
    name: { zhCN: cat, en: cat },
    levelRange: { min: 1, max: 12, default: 12 },
    moves: catMoves.sort((a, b) => a.id.localeCompare(b.id)),
  }))

  catalog.agents.push({
    id,
    name: { zhCN: zh, en },
    rarity: num(full.rarity) >= 4 ? 'S' : 'A',
    attribute: element,
    specialty,
    attackTypes: [],
    faction,
    images: {},
    level60,
    combatBuffs: { corePassive: null, additionalAbility: null, cinemaBuffs: [] },
    coreSkill: { name: { zhCN: '核心技能', en: 'Core Skill' }, defaultLevel: 'max', levels: [] },
    damageElement: element,
    sources: [`https://zzz.nanoka.cc/character/${id}`],
    hidden: false,
  })
  catalog.agentSkills.push({ id, agentId: id, name: { zhCN: zh, en }, categories })
  list[id] = {
    zh,
    en,
    rank: num(full.rarity),
    type: Number(Object.keys(full.weapon_type ?? {})[0] ?? 0),
    element: Number(Object.keys(full.element_type ?? {})[0] ?? 0),
  }
  added.push(id)
  console.log(`build ${id} ${zh}(${en}) ${element}/${specialty} moves=${[...byCat.values()].reduce((s, a) => s + a.length, 0)}`)
}

if (write) {
  writeJsonCompact(catalogPath, catalog)
  // list.json 保持既有 pretty 格式（历史文件 2 空格缩进，紧凑化会造成整文件 churn）
  const { writeFileSync } = await import('node:fs')
  writeFileSync(listPath, JSON.stringify(list, null, 2) + '\n')
  console.log('已写入 catalog.json（紧凑）+ list.json（pretty）:', added.join(','))
} else {
  console.log('dry-run（--write 生效）:', added.join(','))
}

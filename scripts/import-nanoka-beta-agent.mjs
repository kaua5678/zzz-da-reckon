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
 * - 能量消耗：独立展示 param 行（name 含「能量消耗」，desc=「N点」文本），归属=前一个带 id 的 param 行 moveId
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
// 暴击映射口径的单一事实源（规则 11）：与审计/修复脚本共用同一张规则表，
// 保证「下次重导」不会再漏掉突破加成 —— 改口径只需改 lib/level60-rules.mjs 一处。
import { FIELD_RULES } from './lib/level60-rules.mjs'
// 招式派生值（Lv12 倍率 / 耗能 / 动作时间）的单一事实源：与热更增量同步脚本共用同一份口径
import { actionTime, collectMoveRows, num, remapMoveId, stripPrefix } from './lib/nanoka-move-rows.mjs'

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
  // 锋御 = sharpen 的官方中文名（1611 克拉蕾与 1601 挽昼的 weapon_type 都是 {"7":"锋御"}；
  // 2026-10-24 随 1601 收词——缺它则 Test1 包 specialty 落空串，validate:data Specialty 枚举红）
  ['锋御', 'sharpen'],
]

/** 取规则表中某字段的 `expected(raw)` 求值器（找不到就大声失败，不静默回落） */
function ruleOf(field) {
  const rule = FIELD_RULES.find((r) => r.field === field)
  if (!rule?.expected) throw new Error(`level60 规则表缺少字段 ${field}（检查 scripts/lib/level60-rules.mjs）`)
  return rule.expected
}
function pick(dict, keywords) {
  const values = Object.values(dict ?? {}).map(String)
  for (const [kw, key] of keywords) if (values.some(v => v.includes(kw))) return key
  return ''
}

/** 英文招式名（import-v12 的 entry/param 命名逻辑；只在导入器用，增量同步不动名字） */
function enNamesOf(fullEn, selfId) {  const names = new Map()
  for (const cat of ['basic', 'dodge', 'special', 'chain', 'assist']) {
    for (const entry of fullEn.skill?.[cat]?.description ?? []) {
      const entryName = stripPrefix(entry?.name)
      for (const p of Array.isArray(entry?.param) ? entry.param : []) {
        for (const rawId of Object.keys(p?.param ?? {})) {
          const moveId = remapMoveId(rawId, selfId)
          if (!names.has(moveId)) names.set(moveId, entryName)
        }
      }
    }
  }
  return names
}

const added = []
for (const id of ids) {
  if (existingIds.has(id) && !force) { console.log(`skip ${id}（catalog 已存在，--force 覆盖）`); continue }
  // --force 重导时保住**手工裁决字段**：`basicBenchmarkMoveId` 是 catalog 里唯一不来自 nanoka 的
  // 角色字段（平A基准段，2026-10 为 1631/1641 等显式钉过），整条删了重建会静默退回「第 3 段」启发式。
  const previousAgent = existingIds.has(id) ? catalog.agents.find(a => a.id === id) : undefined
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
    // 暴击走规则表（单一事实源 = lib/level60-rules.mjs），不在此重抄公式。
    // ⚠ 历史 bug（2026-09-12 修）：原本只写裸 `st.crit`/`st.crit_damage`，漏掉满级突破加成
    // （20101/21101）→ 20 个角色被落成了全库通用裸基值 5/50，而 1481/1571/1241/1461 经另一条
    // 路径入库的却是含加成的 19.4/78.8（同一 catalog 两套口径）。因「大家都一样」肉眼看不出来。
    // 口径：level60 = **满级满突破面板**（core/panel#calcBasePanel 直接读，别处无补偿通道）。
    critRate: ruleOf('critRate')(full),
    critDmg: ruleOf('critDmg')(full),
    impact: ruleOf('impact')(full),
    // ⚠ 映射方向（2026-09-12 实证订正，勿照字面联想）：
    // **异常精通 = element_mystery，异常掌控 = element_abnormal_power**——与字段名直觉相反。
    // 证据三条：① 47 个角色里 42 个按此方向匹配；② 全部异常主C 的精通都落在较大那个值上
    // （1091 星见雅 148 / 1331 薇薇安 118 / 1501 爱芮 116），符合「精通是累计值、掌控是百分比基底」；
    // ③ extra_level 里 `31201` 的 name 就是「异常精通」、`31401` 是「异常掌控」，可交叉验证。
    // 旧代码两行写反（精通←abnormal_power），实测 1621 洛克茜被落成了 精通110/掌控63（反的）。
    // ⚠ 2026-10-17：改走规则表——原实现漏了 31201/31401 满级突破（1641 掌控 116+36=152 被落成 116，
    // 连「灼蚀暴击率 = 30 + 0.7×(掌控-155)」的阈值判定都会翻转）。同 critRate 那条事故同类。
    anomalyProficiency: ruleOf('anomalyProficiency')(full),
    anomalyMastery: ruleOf('anomalyMastery')(full),
    energyRegen: ruleOf('energyRegen')(full),
    energyMax: num(st.sp_bar_point) || 120,
    penRatio: 0,
  }

  const moves = collectMoveRows(full, id)
  const enNames = enNamesOf(fullEn, id)
  const byCat = new Map()
  for (const m of moves.values()) {
    // 派生值来自 lib/nanoka-move-rows.mjs（与热更增量同步脚本同源；刻度口径见该文件头）
    const { damage, daze, energy, decibel, anomaly, ether } = m
    const rows = []
    if (damage > 0) rows.push({ id: 'damage', kind: 'damageMultiplier', values: [Math.round(damage * 1000) / 1000], damageBasis: 'atk', damageElement: element })
    if (daze > 0) rows.push({ id: 'daze', kind: 'dazeMultiplier', values: [Math.round(daze * 1000) / 1000] })
    if (energy > 0) rows.push({ id: 'energy_recovery', kind: 'energy', values: [Math.round(energy * 10000) / 10000] })
    if (decibel > 0) rows.push({ id: 'decibel_recovery', kind: 'decibel', values: [Math.round(decibel * 10000) / 10000] })
    if (anomaly > 0) rows.push({ id: 'anomaly_buildup', kind: 'anomaly', values: [Math.round(anomaly * 1000) / 1000], damageElement: element })
    for (let i = 0; i < m.attackData.length; i++) {
      const v = m.attackData[i] / 10000
      if (v > 0) rows.push({ id: `attack_data_${i}`, kind: 'special', values: [Math.round(v * 10000) / 10000] })
    }
    if (ether > 0) rows.push({ id: 'ether_purify', kind: 'etherPurify', values: [Math.round(ether / 100 * 1000) / 1000] })
    const isUltimate = (/(终极技|终结技)/.test(m.entryName) || /Ultimate/.test(enNames.get(m.moveId) ?? '')) && !/入场/.test(m.entryName)
    const move = {
      id: m.moveId,
      name: { zhCN: m.entryName, en: enNames.get(m.moveId) ?? m.entryName },
      damageElement: element,
      skillType: m.cat,
      rows,
      timeType: isUltimate ? 'ultimate' : 'normal',
      actionTime: actionTime(ether, m.entryName),
    }
    // 能量消耗：从「能量消耗」展示 param 行的 desc 文本提取（lib/nanoka-move-rows，2026-09-12 补）；
    // 无耗能行的招式不写 energyCost（此前「强特 60 兜底」猜测作废）
    if (m.energyCost) move.energyCost = { 'Energy Cost': String(m.energyCost) }
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
    ...(previousAgent?.basicBenchmarkMoveId ? { basicBenchmarkMoveId: previousAgent.basicBenchmarkMoveId } : {}),
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

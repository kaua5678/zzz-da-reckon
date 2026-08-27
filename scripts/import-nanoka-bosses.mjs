#!/usr/bin/env node
/* 把 data/raw/bosses/ 的 nanoka boss API 原始数据整理成 Boss 预设（public/static/boss-presets.json）。
 *
 * 产物结构（供 BossSelectCard.vue 使用）:
 *   bosses[]: {
 *     id            nanoka 怪物 id（如 40009）
 *     catalogId     catalog.json bosses 数组对应 id（存在时）
 *     name          中文名（zh 详情）
 *     nameEn        英文名（en 详情）
 *     aliases       catalog 别名
 *     icon          本地图标路径（catalog images.icon，可能为空）
 *     iconSource    图标来源 URL（catalog images.source）
 *     isCriticalAssault 是否危局强袭战异构 Boss（zone_type=1002）
 *     phases[]: 该 Boss 出现过的所有期数（新的在前）
 *       phaseId   期数 id（如 690471）
 *       zoneKey   关卡 key（如 69047201）
 *       version   版本号（version.json 匹配，如 3.2）
 *       label     期数标签（版本 · 开始日期）
 *       modeType  'critical_assault'(1002) | 'defense'(1001)
 *       stageName 关卡中文名 / stageNum
 *       level     怪物等级
 *       hp / stunValue / defense
 *       bossAnomalyCoeff  异常条系数 = 1 + attribute_infliction/100（危局=1.1）
 *       damageResistances / stunResistances / anomalyResistances
 *                   元素抗性（%）：弱点 0 / 中性 20 / 抗性 40
 *       weakness / resistance  弱点/抗性元素中文标签
 *       goals     s/a/b 评分目标
 *   }
 *
 * 抗性口径：以 element 字段（1=弱点 -1=抗性 0=中性）为主，
 * 再用 monster_weakness 标签做并集修正（element 全 0 但 weakness 列了元素的 Boss，
 * 如 异构·焚昼余火 电/风 弱，按弱点处理）。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { writeJsonCompact } from './lib/jsonio.mjs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const rawDir = resolve(root, 'data/raw/bosses')
const outFile = resolve(root, 'public/static/boss-presets.json')

const summary = JSON.parse(readFileSync(resolve(rawDir, 'summary.json'), 'utf8'))
const versionMap = JSON.parse(readFileSync(resolve(rawDir, 'version.json'), 'utf8'))
const catalog = JSON.parse(readFileSync(resolve(root, 'public/static/catalog.json'), 'utf8'))

const ELEMENT_KEYS = ['physical', 'fire', 'ice', 'electric', 'ether', 'wind']
const WEAKNESS_ZH_TO_KEY = {
  物理: 'physical', 物理属性: 'physical',
  火属性: 'fire', 火: 'fire',
  冰属性: 'ice', 冰: 'ice',
  电属性: 'electric', 电: 'electric',
  以太: 'ether', 以太属性: 'ether',
  风属性: 'wind', 风: 'wind',
}
const KEY_TO_ZH = {
  physical: '物理', fire: '火', ice: '冰',
  electric: '电', ether: '以太', wind: '风',
}

/**
 * 怪物本体精确抗性 → 游戏绝对值口径（%）。
 * monster API 的 *_res 是万分比绝对值，直接除 100：
 * 弱点 -20 / 中性 0 / 抗性 +20 或 +40（各怪不同）。
 * 引擎公式 multiplier = 1 - res/100（弱点 -20 → ×1.2，中性 0 → ×1.0，抗性 40 → ×0.6）。
 */
function toCalcRes(resValue) {
  return resValue / 100
}

/** 读怪物本体数据（zh/monster/<id>.json）：失衡倍率/失衡时间/精确三表抗性 */
function loadMonster(monsterId) {
  let j
  try {
    j = JSON.parse(readFileSync(resolve(rawDir, 'monster', `${monsterId}.json`), 'utf8'))
  } catch {
    return null
  }
  const mi = j.monster_info?.[Object.keys(j.monster_info ?? {})[0]]
  if (!mi?.stats) return null
  const s = mi.stats
  const resOf = suffix => Object.fromEntries(ELEMENT_KEYS.map(el => [el, toCalcRes(s[`${el}${suffix}`] ?? 0)]))
  return {
    name: j.name,
    /** 失衡伤害倍率 = (100 + stun_damage_taken_ratio/100)/100（5000→1.5，2500→1.25） */
    stunVuln: Number.isFinite(s.stun_damage_taken_ratio)
      ? Math.round(((100 + s.stun_damage_taken_ratio / 100) / 100) * 1000) / 1000
      : 1.5,
    /** 失衡持续时间 = 10000 / destroy_recover_rate（833→12s，666→15s） */
    stunTime: Number.isFinite(s.destroy_recover_rate) && s.destroy_recover_rate > 0
      ? Math.round((1e4 / s.destroy_recover_rate) * 100) / 100
      : 12,
    damage: resOf('_damage_res'),
    stun: resOf('_stun_res'),
    anomaly: resOf('_buildup_res'),
  }
}
const monsterCache = new Map()
function getMonster(monsterId) {
  if (!monsterCache.has(monsterId)) monsterCache.set(monsterId, loadMonster(monsterId))
  return monsterCache.get(monsterId)
}

function load(lang, id) {
  return JSON.parse(readFileSync(resolve(rawDir, lang, `${id}.json`), 'utf8'))
}

/** id 前缀匹配 version.json（3.1 → [69042,69043,69044]，详情文件为 690421 等） */
function versionOf(zoneId) {
  for (const [ver, ids] of Object.entries(versionMap)) {
    if (ids.some(prefix => String(zoneId).startsWith(String(prefix)))) return ver
  }
  return VERSION_FALLBACK.test(zoneId) ? '3.2' : ''
}

/**
 * 关卡抗性三表：怪物本体精确值（计算器口径）为基值，
 * 再用关卡 monster_weakness 标签做并集修正（关卡级弱点，如异构 Boss 当期弱电/风）。
 */
function buildResistances(monster, monsterWeakness) {
  const tables = { damage: {}, stun: {}, anomaly: {} }
  const weaknessKeys = new Set()
  const resistanceKeys = new Set()
  if (monster) {
    for (const key of ELEMENT_KEYS) {
      const d = monster.damage[key]
      const s = monster.stun[key]
      const a = monster.anomaly[key]
      tables.damage[key] = d
      tables.stun[key] = s
      tables.anomaly[key] = a
      if (d === -20) weaknessKeys.add(key)
      if (d > 0) resistanceKeys.add(key)
    }
  } else {
    for (const key of ELEMENT_KEYS) {
      for (const t of Object.values(tables)) t[key] = 0
    }
  }
  for (const label of Object.values(monsterWeakness ?? {})) {
    const key = WEAKNESS_ZH_TO_KEY[label]
    if (!key) continue
    for (const t of Object.values(tables)) {
      if (t[key] === 0) t[key] = -20 // 并集：关卡标签里的弱点按弱点处理（游戏绝对值）
    }
    weaknessKeys.add(key)
    resistanceKeys.delete(key)
  }
  return {
    damage: tables.damage,
    stun: tables.stun,
    anomaly: tables.anomaly,
    weakness: [...weaknessKeys].map(k => KEY_TO_ZH[k]),
    resistance: [...resistanceKeys].map(k => KEY_TO_ZH[k]),
  }
}

/** catalog bosses 显式映射：nanoka 怪物 id → catalog boss id（危局强袭战阵容）。
 *  null = 无 catalog 条目但属于危局异构 Boss（保留为独立预设）。 */
/**
 * 预设收录范围 = 危局强袭战全部 Boss（用户口径：普通/困难都是危局，防卫战不做）。
 * 困难 = 异构/改写变体；普通 = 当期 3 个常规 Boss。一期 = 1 困难 + 3 普通。
 */
const CATALOG_MONSTER_MAP = {
  '30007': 'boss.notorious_dead_end_butcher', // 死路屠夫（试炼版）并入恶名版
  '300072': 'boss.notorious_dead_end_butcher',
  '30009': 'boss.unknown_corruption_complex',
  '30021': 'boss.notorious_pompey',           // 庞培（试炼版）并入恶名版
  '300211': 'boss.notorious_pompey',
  '30033': null,                              // 秽息司祭（普通）
  '30034': 'boss.miasma_fiend_named',
  '30042': null,                              // 魇缚者·叶释渊（普通）
  '30052': null,                              // 熔狱行赭（普通）
  '40000': null,                              // 太初梦魇·「始主」（普通）
  '40003': null,                              // 改写·涤罪清道夫（危局异构·困难）
  '40005': 'boss.scorched_horizon_phaethon',
  '40006': null,                              // 基塔布鲁（普通）
  '40008': 'boss.girtablullu_stagnant_aberrant',
  '40009': 'boss.integrated_girtablullu',
  '40010': null,                              // 库萨里库（普通）
  '40011': null,                              // 异构·焚昼余火（危局异构·困难）
  '30041': null,                              // 彷徨猎手（2.x 防卫战 Boss，用户确认收录）
}
const catalogById = new Map(catalog.bosses.map(b => [b.id, b]))

/**
 * 手动维护的 Boss 默认值（数据源没有的结构化字段，按需手填；应用时随预设一起加载）。
 * - battleTime：危局强袭战固定 180s（全 Boss 一致）
 * - shieldCount（秽盾触发次数）：计算器不算时间轴/秽盾削减，只算"秽盾打破奖励
 *   60 能量 + 闪能"的触发次数（resource/helpers.ts shieldBreakGift = shieldCount*60）。
 *   名可名有秽盾 → 填 1（不是血量值 3000）；其余 0
 * - energyShield（能量盾触发次数）：同上口径，暂无数据，默认 0
 * 无敌时间/快支不在此列：无敌时间是招式机制只能手填；快支是角色侧与 Boss 无关。
 */
const BOSS_DEFAULTS = {
  '30034': { battleTime: 180, shieldCount: 1, energyShield: 0 }, // 秽息妖鬼·名可名（有秽盾，破一次）
}
function bossDefaults(monsterId) {
  return { battleTime: 180, shieldCount: 0, energyShield: 0, ...(BOSS_DEFAULTS[monsterId] ?? {}) }
}

/** version.json 未收录的 3.2 期数兜底（690451/690461/690471） */
const VERSION_FALLBACK = /^6904[567]/

/** 汇总所有期数详情里的怪物出现记录 */
const monsterPhases = new Map() // monsterId -> { en, zh, phases[] }
const caWeaknessSets = new Map() // monsterId -> 危局期数 weakness 标签列表（用于交集）
for (const zoneId of Object.keys(summary)) {
  let zh, en
  try { zh = load('zh', zoneId) } catch { continue }
  try { en = load('en', zoneId) } catch { continue }
  const info = summary[zoneId]
  for (const mode of zh.modes ?? []) {
    for (const zoneKey of Object.keys(mode.zone ?? {})) {
      const zone = mode.zone[zoneKey]
      const room = zone.layer_room?.[Object.keys(zone.layer_room)[0]]
      if (!room?.monster_list) continue
      for (const k of Object.keys(room.monster_list)) {
        const mo = room.monster_list[k]
        const moEn = (en.modes ?? [])
          .flatMap(m => Object.values(m.zone ?? {}))
          .flatMap(z => Object.values(z.layer_room ?? {}))
          .flatMap(r => Object.values(r.monster_list ?? {}))
          .find(e => e.id === mo.id)
        const entry = monsterPhases.get(String(mo.id)) ?? { id: String(mo.id), name: mo.name, nameEn: moEn?.name ?? mo.name, phases: [] }
        const begin = info.live_begin ?? info.begin ?? ''
        const modeType = mode.zone_type === 1002 ? 'critical_assault' : 'defense'
        if (modeType === 'critical_assault') {
          const labels = Object.values(room.monster_weakness ?? {})
          if (labels.length) {
            const list = caWeaknessSets.get(String(mo.id)) ?? []
            list.push(new Set(labels))
            caWeaknessSets.set(String(mo.id), list)
          }
        }
        entry.phases.push({
          phaseId: zoneId,
          zoneKey,
          version: versionOf(zoneId),
          label: [versionOf(zoneId), (begin || '').slice(0, 10)].filter(Boolean).join(' · '),
          begin,
          modeType,
          stageName: zone.name ?? mo.name,
          stageNum: zone.stage_num ?? 1,
          level: zone.monster_level ?? 70,
          hp: Math.round(mo.stats?.hp ?? 0),
          stunValue: Math.round((mo.stats?.stun ?? 0) * 100) / 100,
          defense: Math.round(mo.stats?.defence ?? 953),
          bossAnomalyCoeff: 1 + (mo.stats?.attribute_infliction ?? 0) / 100,
          goals: { s: zone.s_rank_goal, a: zone.a_rank_goal, b: zone.b_rank_goal },
          /** 原始关卡弱点标签（构建抗性后剔除） */
          rawWeakness: { ...(room.monster_weakness ?? {}) },
        })
        monsterPhases.set(String(mo.id), entry)
      }
    }
  }
}

/**
 * 危局弱点固定规则：同一怪物在危局强袭战所有期数里「都出现」的弱点才是真弱点。
 * 测试服期数可能带错数据（如 690471 异构·焚昼余火 弱电+风 是错的，与 690451 弱电
 * 取交集后只剩电）。防卫战期数保持当期标签（随期数变是正常的）。
 */
const caWeaknessIntersection = new Map() // monsterId -> Set<label>
for (const [monsterId, lists] of caWeaknessSets) {
  if (lists.length === 0) continue
  const inter = new Set(lists[0])
  for (const list of lists.slice(1)) {
    for (const label of inter) {
      if (!list.has(label)) inter.delete(label)
    }
  }
  caWeaknessIntersection.set(monsterId, inter)
}

/** 构建 phase 抗性：危局期数用交集弱点，其余用当期标签 */
function fillPhaseResistances(entry, phase) {
  const monster = getMonster(entry.id)
  let weaknessSource = phase.rawWeakness
  if (phase.modeType === 'critical_assault' && caWeaknessIntersection.has(entry.id)) {
    weaknessSource = Object.fromEntries([...caWeaknessIntersection.get(entry.id)].map(l => [l, l]))
  }
  const res = buildResistances(monster, weaknessSource)
  phase.damageResistances = res.damage
  phase.stunResistances = res.stun
  phase.anomalyResistances = res.anomaly
  phase.weakness = res.weakness
  phase.resistance = res.resistance
  delete phase.rawWeakness
}
for (const entry of monsterPhases.values()) {
  for (const phase of entry.phases) fillPhaseResistances(entry, phase)
}

// 期数新的在前（按开始日期倒序，缺日期回退 phaseId）
for (const entry of monsterPhases.values()) {
  entry.phases.sort((a, b) => (b.begin || b.phaseId).localeCompare(a.begin || a.phaseId))
}

/** 组装预设：同一 catalog boss 的多个怪物变体（如 死路屠夫/恶名·死路屠夫）合并期数 */
const presets = new Map() // catalogId | 'nanoka:<monsterId>' -> preset
const matchedCatalog = new Set()
for (const [monsterId, catalogId] of Object.entries(CATALOG_MONSTER_MAP)) {
  const entry = monsterPhases.get(monsterId)
  if (!entry) {
    console.warn(`WARN 怪物 ${monsterId} 无 nanoka 数据`)
    continue
  }
  const key = catalogId ?? `nanoka:${monsterId}`
  let preset = presets.get(key)
  if (!preset) {
    const cat = catalogId ? catalogById.get(catalogId) : undefined
    if (cat) matchedCatalog.add(catalogId)
    const mon = getMonster(monsterId)
    preset = {
      id: entry.id,
      catalogId,
      name: cat?.name?.zhCN ?? entry.name,
      nameEn: entry.nameEn,
      aliases: cat?.aliases ?? [],
      icon: cat?.images?.icon ?? null,
      iconSource: cat?.images?.source ?? null,
      isCriticalAssault: entry.phases.some(p => p.modeType === 'critical_assault'),
      /** 怪物本体固有属性（不随期数变） */
      monster: mon
        ? { stunVuln: mon.stunVuln, stunTime: mon.stunTime, name: mon.name }
        : { stunVuln: 1.5, stunTime: 12, name: entry.name },
      /** 应用时随预设加载的默认值（手动维护，见 BOSS_DEFAULTS） */
      defaults: bossDefaults(monsterId),
      phases: [],
    }
    presets.set(key, preset)
  } else {
    // 变体合并：主名保留 catalog 名，英文名取恶名变体
    preset.nameEn = entry.nameEn
    preset.isCriticalAssault ||= entry.phases.some(p => p.modeType === 'critical_assault')
  }
  for (const p of entry.phases) {
    if (!preset.phases.some(q => q.phaseId === p.phaseId && q.zoneKey === p.zoneKey)) {
      preset.phases.push(p)
    }
  }
}

// 期数新的在前（合并后再排一次）
for (const preset of presets.values()) {
  preset.phases.sort((a, b) => (b.begin || b.phaseId).localeCompare(a.begin || a.phaseId))
}

const bosses = [...presets.values()]

// catalog 里有但 nanoka 怪物映射没覆盖的（提示）
for (const b of catalog.bosses) {
  if (!matchedCatalog.has(b.id)) console.warn(`WARN catalog boss ${b.id} (${b.name?.zhCN}) 未纳入 nanoka 怪物映射`)
}

// ========== 期视图（Boss 选择 UI：按期数 + 普通/困难分组 + 当期 buff） ==========

const buffParser = await import('./phase-buff-parser.mjs')

/** 预设 phase 索引：phaseId|zoneKey → { preset, phase }（取交集修正后的数据） */
const presetPhaseByKey = new Map()
for (const preset of presets.values()) {
  for (const phase of preset.phases) {
    presetPhaseByKey.set(`${phase.phaseId}|${phase.zoneKey}`, { preset, phase })
  }
}

function monsterBrief(monsterId, zone, room, modeType, layerBuffs) {
  const mo = room.monster_list?.[Object.keys(room.monster_list ?? {})[0]]
  if (!mo) return null
  /** 关卡固有 buff（layer_buff）：当期对 Boss 生效的规则，含数值效果时一并展示 */
  const bossBuffs = []
  for (const lb of Object.values(layerBuffs ?? {})) {
    const parsed = buffParser.parsePhaseBuff(lb.title ?? '', lb.desc ?? '')
    bossBuffs.push(parsed)
  }
  const key = `${zone.phaseId}|${zone.zoneKey}`
  const presetHit = presetPhaseByKey.get(key)
  if (presetHit && presetHit.phase.modeType === modeType) {
    const { preset, phase } = presetHit
    return {
      presetId: preset.id,
      monsterId: String(mo.id),
      zoneKey: phase.zoneKey,
      name: preset.name,
      weakness: phase.weakness,
      resistance: phase.resistance,
      hp: phase.hp,
      stunValue: phase.stunValue,
      defense: phase.defense,
      level: phase.level,
      bossAnomalyCoeff: phase.bossAnomalyCoeff,
      bossBuffs,
    }
  }
  // 非预设怪物（普通模式）：当期标签口径
  const res = buildResistances(getMonster(String(mo.id)), room.monster_weakness)
  return {
    monsterId: String(mo.id),
    zoneKey: zone.zoneKey,
    name: mo.name,
    weakness: res.weakness,
    resistance: res.resistance,
    hp: Math.round(mo.stats?.hp ?? 0),
    stunValue: Math.round((mo.stats?.stun ?? 0) * 100) / 100,
    defense: Math.round(mo.stats?.defence ?? 953),
    level: zone.monster_level ?? 70,
    bossBuffs,
  }
}

const phaseViews = []
for (const zoneId of Object.keys(summary)) {
  let zh
  try { zh = load('zh', zoneId) } catch { continue }
  const caMode = (zh.modes ?? []).find(m => m.zone_type === 1002)
  if (!caMode) continue // 只收含危局（困难）的期数
  const defMode = (zh.modes ?? []).find(m => m.zone_type === 1001)
  const info = summary[zoneId]

  const caZones = Object.keys(caMode.zone ?? {}).map(k => ({ key: k, zone: caMode.zone[k] }))
  const caZone = caZones[0]
  const caRoom = caZone ? caZone.zone.layer_room?.[Object.keys(caZone.zone.layer_room ?? {})[0]] : null
  const criticalAssault = caRoom
    ? monsterBrief(undefined, { phaseId: zoneId, zoneKey: caZone.key, monster_level: caZone.zone.monster_level }, caRoom, 'critical_assault', caZone.zone.layer_buff)
    : null

  const defense = []
  for (const k of Object.keys(defMode?.zone ?? {})) {
    const zone = defMode.zone[k]
    const room = zone.layer_room?.[Object.keys(zone.layer_room ?? {})[0]]
    if (!room) continue
    const brief = monsterBrief(undefined, { phaseId: zoneId, zoneKey: k, monster_level: zone.monster_level }, room, 'defense', zone.layer_buff)
    if (brief) defense.push({ ...brief, stageName: zone.name ?? '', stageNum: zone.stage_num ?? 1 })
  }

  // 当期危局 buff 牌（selectable_buff）
  const buffs = []
  for (const b of Object.values(caZone?.zone.selectable_buff ?? {})) {
    const parsed = buffParser.parsePhaseBuff(b.title ?? '', b.desc ?? '')
    buffs.push(parsed)
  }

  const begin = info.live_begin ?? info.begin ?? ''
  phaseViews.push({
    phaseId: zoneId,
    version: versionOf(zoneId),
    label: [versionOf(zoneId), (begin || '').slice(0, 10)].filter(Boolean).join(' · '),
    begin,
    end: info.live_end ?? info.end ?? '',
    criticalAssault,
    defense,
    buffs,
  })
}
phaseViews.sort((a, b) => (b.begin || b.phaseId).localeCompare(a.begin || a.phaseId))

const out = {
  generatedAt: new Date().toISOString(),
  source: 'https://static.nanoka.cc boss API (scripts/fetch-nanoka-bosses.mjs)',
  note: '元素抗性口径（游戏绝对值%）：弱点 -20 / 中性 0 / 抗性 +20~+40；bossAnomalyCoeff = 1 + attribute_infliction/100；buff 解析见 scripts/phase-buff-parser.mjs',
  bosses,
  phaseViews,
}
writeJsonCompact(outFile, out)
console.log(`已生成 ${outFile}（${bosses.length} 个 Boss 预设，${phaseViews.length} 个期视图）`)

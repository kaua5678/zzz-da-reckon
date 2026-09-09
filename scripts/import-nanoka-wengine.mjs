#!/usr/bin/env node
/**
 * 从 nanoka 导入音擎到 catalog.json（幂等：已存在则更新）。
 *
 * 用法：node scripts/import-nanoka-wengine.mjs <id> [<id>...] [--force]   （不带参数 = 补录全部缺失）
 *   --force：data/raw 存档已存在也重抓（重爬正式服数据用）
 *
 * 数据来源（版本取 manifest.zzz.live = 正式服；带 hash 的构建是测试服/预发布）：
 *   https://static.nanoka.cc/zzz/<版本>/zh/weapon/<id>.json（+ en）→ data/raw/nanoka_wengine_<id>_{zh,en}.json
 *
 * 通用推导（nanoka 只有 1 级基础词条 base_property / rand_property 与被动文本 talents）：
 *   - level60.atkBase：base_property.value → {24:356, 28:416, 32:475, 40:594, 42:624, 46:684, 48:713, 50:743}
 *     （×≈14.86 同构；24/28 为锋御基础防御力主词条，baseStat='def'）
 *   - level60.advancedStat：rand_property 词条类型 + value/40（百分比格式）；异常精通等固定值按稀有度
 *     {B:60, A:75, S:90}
 *   - 被动 buff（effect）为人工建模（MANUAL_EFFECTS，stat/modificationValues 按精炼 1..5），
 *     无法映射到面板的段（减伤/回能点数/防御力附伤等）保留在 description，不进 effects。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { writeJsonCompact } from './lib/jsonio.mjs'
import { fetchJson } from './lib/http.mjs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const rawDir = resolve(root, 'data/raw')
const catalogPath = resolve(root, 'public/static/catalog.json')
const STATIC = 'https://static.nanoka.cc'
/** --force：raw 存档已存在也重抓（重爬正式服数据用；默认跳过 = 幂等） */
const force = process.argv.includes('--force')

const RARITY_MAP = { 2: 'B', 3: 'A', 4: 'S' }
const SPECIALTY_MAP = {
  强攻: 'attack', 击破: 'stun', 异常: 'anomaly', 支援: 'support',
  防护: 'defense', 命破: 'rupture', 锋御: 'sharpen',
}
/** base_property.value → 60 级主词条数值（×≈14.86 同构；24/28/29 = 锋御基础防御力主词条，baseStat='def'）
 *  29 由正式服 14161 猩红渴望反推（nanoka weapon.json atk=431；29×14.86≈431） */
const BASE_TO_ATK = { 24: 356, 28: 416, 29: 431, 32: 475, 40: 594, 42: 624, 46: 684, 48: 713, 50: 743 }
/** rand_property 词条名 → catalog advancedStat.stat（词条类型一致） */
const RAND_STAT = {
  冲击力: 'impact', 攻击力: 'atkPct', 防御力: 'defPct', 生命值: 'hpPct',
  暴击率: 'critRate', 暴击伤害: 'critDmg', 穿透率: 'penRatio',
  异常精通: 'anomalyProficiency', 异常掌控: 'anomalyMastery', 能量自动回复: 'energyRegen',
}
/** 固定值词条（nanoka 是 1 级值，×2.5 到 60 级）：按稀有度的标准大词条 */
const FLAT_STANDARD = { anomalyProficiency: { B: 60, A: 75, S: 90 } }
const ADV_MODE = {
  atkPct: 'pct', defPct: 'pct', hpPct: 'pct', impact: 'pct',
  anomalyMastery: 'pct', energyRegen: 'pct',
  critRate: 'flat', critDmg: 'flat', penRatio: 'flat', anomalyProficiency: 'flat',
}

function plain(value) {
  return String(value ?? '')
    .replace(/<color[^>]*>/g, '')
    .replace(/<\/color>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 精炼 1..5 等差插值（t1 → t5） */
function lin(a, b) {
  const out = []
  for (let i = 0; i < 5; i++) {
    const v = a + ((b - a) * i) / 4
    out.push(Math.round(v * 100000) / 100000)
  }
  return out
}

/** 便捷构造：fixed / stacked 两条常用形态 */
const cov = { default: 1, min: 0, max: 1, step: 0.1 }
function fixed(id, stat, a, b, extra = {}) {
  return { id, type: 'fixed', target: { kind: 'default' }, stat, mode: 'pct', value: a, modificationValues: { value: lin(a, b) }, coverage: cov, ...extra }
}
function stacked(id, stat, a, b, maxStacks, extra = {}) {
  return { id, type: 'stacked', target: { kind: 'default' }, stat, mode: 'pct', valuePerStack: a, maxStacks, defaultStacks: maxStacks, modificationValues: { valuePerStack: lin(a, b) }, coverage: cov, ...extra }
}

/**
 * 被动 buff 人工建模（stat/modificationValues 按精炼 1..5）。
 * 未建模的段（减伤/回能点数/防御力附伤/秽息等）只保留在 description。
 */
const MANUAL_EFFECTS = {
  '12011': { // 电磁暴-贰式：异常积蓄时精通提升
    effects: [fixed('nanoka_12011_ap', 'anomalyProficiency', 25, 40, { mode: 'flat' })],
    desc: '累积属性异常积蓄值时，装备者的异常精通提升25/28.75/32.5/36.25/40点，持续10秒，20秒内最多触发一次（默认满覆盖）。',
  },
  '12015': { // 灰烬-钴蓝：接战攻击提升
    effects: [fixed('nanoka_12015_atk', 'atkPct', 7.2, 11.5)],
    desc: '成为接战状态下的当前操作角色时，装备者的攻击力提升7.2%/8.275%/9.35%/10.425%/11.5%，持续10秒，20秒内最多触发一次（默认满覆盖）。',
  },
  '13005': { // 人为刀俎：能量→冲击力
    effects: [stacked('nanoka_13005_impact', 'impactPct', 2, 3.2, 8)],
    desc: '每拥有10点能量值，装备者的冲击力提升2%/2.3%/2.6%/2.9%/3.2%，最多叠加8层，持续8秒，每层单独结算（默认满能量满层）。',
  },
  '13010': { // 兔能环：生命 + 有盾攻击
    effects: [
      fixed('nanoka_13010_hp', 'hpPct', 8, 12.8),
      fixed('nanoka_13010_atk', 'atkPct', 10, 16),
    ],
    desc: '生命值上限提升8%/9.2%/10.4%/11.6%/12.8%；拥有护盾时，装备者的攻击力提升10%/11.5%/13%/14.5%/16%（默认有盾满覆盖）。',
  },
  '13011': { // 春日融融：受击能量效率（减伤未建模）
    effects: [fixed('nanoka_13011_energy', 'energyGainEfficiency', 10, 16)],
    desc: '受到的伤害降低7.5%/9%/10.5%/12%（减伤未建模）；受到敌方攻击时，装备者的能量获得效率提升10%/11.5%/13%/14.5%/16%，持续12秒（默认满覆盖）。',
  },
  '13016': { // 光影刻刀：全队减伤/秽息（未建模）
    effects: [],
    desc: '队伍中角色生命值大于等于50%时，受到的伤害降低7.5%/9%/10.5%/12%，受到的秽息浸染值降低10%/11.5%/13%/14.5%/16%，该效果全队唯一（减伤/秽息未建模）。',
  },
  '13017': { // 喵运当头：防御提升
    effects: [fixed('nanoka_13017_def', 'defPct', 16, 24)],
    desc: '防御力提升8%/9%/10%/11%/12%；释放强化特殊技时防御力额外提升8%/9%/10%/11%/12%，持续40秒（合并为 16%/18%/20%/22%/24%，默认满覆盖）。',
  },
  '13018': { // 咚哒回声：异常敌人增伤（乱流回能未建模）
    effects: [fixed('nanoka_13018_dmg', 'dmgBonus', 11.5, 18.4)],
    desc: '触发乱流时为自身回复2/2.3/2.6/2.9/3.2点能量（未建模）；攻击处于属性异常状态下的敌人时，造成的伤害提升11.5%/13.225%/14.95%/16.675%/18.4%（默认满覆盖）。',
  },
  '13020': { // 炎炙沸釜：支援突击后失衡+增伤
    effects: [
      fixed('nanoka_13020_stun', 'stunBuildUpBonus', 7.2, 11.5),
      fixed('nanoka_13020_dmg', 'dmgBonus', 7.2, 11.5),
    ],
    desc: '发动支援突击时，装备者对目标造成的失衡值提升7.2%/8.275%/9.35%/10.425%/11.5%，造成的伤害提升相同数值，持续30秒（默认满覆盖）。',
  },
  '13021': { // 血髓秘匣：超暴击率增伤
    effects: [fixed('nanoka_13021_dmg', 'dmgBonus', 24, 40)],
    desc: '装备者暴击率大于100%时，每超出1%暴击率，造成的伤害提升0.48%/0.56%/0.64%/0.72%/0.8%，至多提升24%/28%/32%/36%/40%（默认满溢出值）。',
  },
  '13112': { // 比格气缸：减伤 + 防御力附伤（未建模）
    effects: [],
    desc: '受到的伤害降低7.5%/9%/10.5%/12%（减伤未建模）；受到敌方攻击后，下一次攻击命中敌人时额外造成装备者600%/690%/780%/870%/960%防御力的伤害且必定暴击（防御力附伤未建模）。',
  },
  '13127': { // 维序者-特化型：有盾回能 + 积蓄效率
    effects: [
      fixed('nanoka_13127_regen', 'energyRegenBonusFlat', 0.4, 0.64, { mode: 'flat' }),
      fixed('nanoka_13127_buildup', 'anomalyBuildUpEfficiency', 36, 55),
    ],
    desc: '拥有护盾时，装备者的能量自动回复提升0.4/0.46/0.52/0.58/0.64点/秒（默认有盾满覆盖）；强化特殊技和支援突击累积的属性异常积蓄值提升36%/40.75%/45.5%/50.25%/55%。',
  },
  '13135': { // 裁纸刀：追加攻击后物理伤+失衡
    effects: [
      fixed('nanoka_13135_phys', 'physicalDmg', 15, 24),
      fixed('nanoka_13135_stun', 'stunBuildUpBonus', 10, 16),
    ],
    desc: '发动追加攻击时，装备者造成的物理伤害提升15%/17.25%/19.5%/21.75%/24%，造成的失衡值提升10%/11.5%/13%/14.5%/16%，持续10秒（默认满覆盖）。',
  },
  '14003': { // 左轮转子：充能失衡（满层）
    effects: [fixed('nanoka_14003_stun', 'stunBuildUpBonus', 24, 38.4)],
    desc: '每3秒为装备者提供1层充能效果，最多叠加6层；发动强化特殊技时消耗所有充能，每层充能效果使招式造成的失衡值提升4%/4.6%/5.2%/5.8%/6.4%（默认满6层 = 24%/27.6%/31.2%/34.8%/38.4%）。',
  },
  '14154': { // 朔月裁霜（普罗米娅专武）
    requirement: { specialty: 'anomaly', label: { zhCN: '对于冰属性【异常】角色，能够触发以下效果' } },
    effects: [
      stacked('nanoka_14154_ice', 'iceDmg', 20, 32, 2),
      fixed('nanoka_14154_release', 'anomalyReleaseDmgBonus', 35, 50),
    ],
    desc: '冰属性的装备者发动特殊技/强化特殊技时，自身造成的冰属性伤害提升20%/23%/26%/29%/32%，持续40秒，最多叠加2层（默认满2层）；拥有2层效果时，造成的异放伤害额外提升35%/38.5%/42%/45.5%/50%。',
  },
  '14159': { // 骁骑礼赞（希格莉德专武）
    effects: [
      stacked('nanoka_14159_crit', 'critDmg', 32, 51.2, 2),
      fixed('nanoka_14159_iceRes', 'enemyIceResReduction', 20, 32),
    ],
    desc: '装备者的普通攻击和强化特殊技的重击命中敌人时获得1层兵锋，暴击伤害提升32%/36.8%/41.6%/46.4%/51.2%，持续25秒，最多叠加2层（默认满2层）；拥有2层兵锋时获得彻骨：造成的伤害无视目标20%/23%/26%/29%/32%冰属性伤害抗性。',
  },
  '14161': { // 猩红渴望（克拉蕾专武）：正式服 3.2 数值（旧测试服为 12%→20% 叠层口径，已废）
    effects: [
      fixed('nanoka_14161_crit', 'critRate', 25, 35),
      fixed('nanoka_14161_electric', 'electricDmg', 15, 25),
      fixed('nanoka_14161_sharp', 'electricSharpDmg', 10, 16),
    ],
    desc: '装备者暴击率提升25%/27.5%/30%/32.5%/35%；电属性伤害提升15%/17.5%/20%/22.5%/25%；装备者发动[强化特殊技]或触发[毁伤]时，造成的电属性锐化伤害提升10%/11.5%/13%/14.5%/16%，持续40秒，重复触发时刷新持续时间（默认满覆盖）。',
  },
  '14162': { // 绯月银棺（洛克茜专武）：正式服 3.2 数值（旧测试服口径已废）
    effects: [
      fixed('nanoka_14162_crit', 'critRate', 24, 32),
      fixed('nanoka_14162_windRes', 'enemyWindResReduction', 15, 24),
      fixed('nanoka_14162_stun', 'stunBuildUpBonus', 16, 25.6),
    ],
    teamEffects: [fixed('nanoka_14162_team_dmg', 'dmgBonus', 20, 32)],
    desc: '装备者暴击率提升24%/26%/28%/30%/32%；造成的伤害无视目标15%/17.3%/19.5%/21.8%/24%风属性伤害抗性；装备者发动[强化特殊技]造成风属性伤害时，造成的失衡值提升16%/18.4%/20.8%/23.2%/25.6%，全队其他角色造成的伤害提升20%/23%/26%/29%/32%，持续50秒，重复触发时刷新持续时间，伤害提升效果全队唯一（默认满覆盖）。',
  },
}

/** 60 级面板推导 */
function buildLevel60(zh) {
  const base = zh.base_property?.value ?? 46
  const rand = zh.rand_property ?? {}
  const stat = RAND_STAT[rand.name] ?? 'atkPct'
  const isPercent = String(rand.format ?? '').includes('%')
  const value = isPercent
    ? Math.round((rand.value / 40) * 1000) / 1000
    : (FLAT_STANDARD[stat]?.[RARITY_MAP[zh.rarity]] ?? Math.round((rand.value * 2.5) * 1000) / 1000)
  return {
    atkBase: BASE_TO_ATK[base] ?? 684,
    advancedStat: { stat, value, mode: ADV_MODE[stat] ?? 'pct' },
    ...(zh.base_property?.name === '基础防御力' ? { baseStat: 'def' } : {}),
  }
}

/** 正式服版本（manifest.zzz.live）；带 hash 的 available 构建是测试服/预发布，名字可能是占位 "..." */
let resolvedVersion = ''
async function latestZzzVersion() {
  if (resolvedVersion) return resolvedVersion
  const m = await fetchJson(`${STATIC}/manifest.json`, { timeoutMs: 20000 })
  resolvedVersion = m.zzz?.live ?? m.zzz?.latest
  return resolvedVersion
}

async function fetchRaw(id, lang, retries = 4) {
  const target = resolve(rawDir, `nanoka_wengine_${id}_${lang}.json`)
  if (existsSync(target) && !force) return JSON.parse(readFileSync(target, 'utf8'))
  const ver = await latestZzzVersion()
  const url = `${STATIC}/zzz/${ver}/${lang}/weapon/${id}.json`
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const data = await fetchJson(url, { retries: 0 })
      writeFileSync(target, JSON.stringify(data, null, 2))
      console.log(`OK  data/raw/nanoka_wengine_${id}_${lang}.json (${ver})`)
      return data
    } catch (e) {
      if (attempt < retries - 1) await new Promise(r => setTimeout(r, 2000 * (attempt + 1)))
      else throw e
    }
  }
  throw new Error(`fetch failed ${url}`)
}

function buildEntry(id, zh, en) {
  const manual = MANUAL_EFFECTS[id] ?? { effects: [], desc: '' }
  const specialty = SPECIALTY_MAP[Object.values(zh.weapon_type ?? {})[0]] ?? ''
  const ownerId = String(zh.code_name ?? '').match(/Weapon_[SA]_(\d+)/)?.[1] ?? ''
  const talentDesc = Object.values(zh.talents ?? {}).find(t => t?.desc)?.desc ?? zh.desc2 ?? ''
  return {
    id: String(id),
    name: { zhCN: zh.name, en: en.name ?? zh.name },
    rarity: RARITY_MAP[zh.rarity] ?? 'S',
    specialty,
    level60: buildLevel60(zh),
    modification: { minLevel: 1, maxLevel: 5, defaultLevel: 1 },
    effect: {
      name: { zhCN: Object.values(zh.talents ?? {})[0]?.name ?? zh.name },
      ...(manual.requirement ? { requirement: manual.requirement } : {}),
      description: { zhCN: manual.desc || plain(talentDesc) },
      selfBuff: {
        scope: 'inCombat',
        name: { zhCN: `${zh.name}（自身）` },
        description: { zhCN: manual.desc || plain(talentDesc) },
        effects: manual.effects,
        appliesToOutOfCombatPanel: false,
      },
      teamBuff: manual.teamEffects?.length
        ? { scope: 'inCombat', effects: manual.teamEffects, appliesToOutOfCombatPanel: false }
        : null,
    },
    sources: [`${STATIC}/zzz/${resolvedVersion}/zh/weapon/${id}.json`],
    verification: {
      level60Stats: 'nanoka-base-derived',
      effectText: 'nanoka-source-checked',
      effectBuff: 'user-modeled',
    },
    ...(ownerId ? { ownerAgentId: ownerId } : {}),
  }
}

// ========== 主流程 ==========
const ALL_MISSING = ['12011', '12015', '13005', '13010', '13011', '13016', '13017', '13018', '13020', '13021', '13112', '13127', '13135', '14003', '14154', '14159']
let ids = process.argv.slice(2).filter(a => !a.startsWith('--'))
if (ids.length === 0) {
  // 无参数：对比 catalog 自动补录 nanoka 有但 catalog 缺的（含上述清单）
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))
  const have = new Set(catalog.wEngines.map(w => w.id))
  ids = ALL_MISSING.filter(id => !have.has(id))
  if (ids.length === 0) {
    console.log('无缺失音擎（已全部录入）')
    process.exit(0)
  }
  console.log('自动补录缺失:', ids.join(', '))
}
const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))
await latestZzzVersion() // 解析正式服版本（sources 出处用；raw 已存在时 fetchRaw 不会自己解析）
for (const id of ids) {
  const [zh, en] = await Promise.all([fetchRaw(id, 'zh'), fetchRaw(id, 'en')])
  const entry = buildEntry(id, zh, en)
  const idx = catalog.wEngines.findIndex(w => w.id === String(id))
  if (idx >= 0) {
    catalog.wEngines[idx] = { ...catalog.wEngines[idx], ...entry }
    console.log(`UPD  ${id} ${entry.name.zhCN}`)
  } else {
    catalog.wEngines.push(entry)
    console.log(`ADD  ${id} ${entry.name.zhCN} (${entry.rarity} ${entry.specialty})`)
  }
}
writeJsonCompact(catalogPath, catalog)
console.log('written', catalogPath)

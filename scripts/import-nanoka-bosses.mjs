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
 *     bodySize    敌方体型 small/medium/large（手动维护，见 BOSS_BODY_SIZES；未录入时无此字段）
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
  // 按 monster_id 精确取本体变体（勿用首 key：multi-variant 怪物如 秽息司祭 首 key 是 MusicActivity 变体，血量/stun 全错）
  const mi = j.monster_info?.[String(j.monster_id)] ?? j.monster_info?.[Object.keys(j.monster_info ?? {})[0]]
  if (!mi?.stats) return null
  const s = mi.stats
  const resOf = suffix => Object.fromEntries(ELEMENT_KEYS.map(el => [el, toCalcRes(s[`${el}${suffix}`] ?? 0)]))
  return {
    name: j.name,
    /** 1 级基础血量（monster_info.stats.hp），用于反推版本系数 = mo.stats.hp / (baseHp × 247.95) */
    baseHp: Number.isFinite(s.hp) ? s.hp : 0,
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
  '30024': null,                              // 牲鬼·布林格（普通，1.x）
  '300082': null,                             // 自律强袭单位·「提丰·破坏者型」（普通，1.x）
  '300121': null,                             // 恶名·冥宁芙（普通）
  '30033': null,                              // 秽息司祭（普通）
  '30034': 'boss.miasma_fiend_named',
  '30038': null,                              // 「亵渎者」（普通）
  '30042': null,                              // 魇缚者·叶释渊（普通）
  '30052': null,                              // 熔狱行赭（普通）
  '40000': null,                              // 太初梦魇·「始主」（普通）
  '40001': null,                              // 叛律孤歌·薇斯珀（普通）
  '40002': null,                              // 猎血清道夫（普通）
  '40003': null,                              // 复写体·猎血清道夫（危局异构·困难）
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
 * - invincibleTime：Boss 无敌不可攻击时间（秒；招式机制决定的转阶段/入场动画，用户核对值）。
 *   用于 DoT 有效时间扣减（effectiveTime = battleTime − invincibleTime）与时间预算提示。
 * - parryTotal：默认弹刀总次数（主C/击破位按「保底4失衡反推 + 剩余给主C」运行时拆分，
 *   见 src/core/parrySplit.ts + useResourceCalc 反推线程；应用 Boss 时自动勾选「保底4失衡」）。
 *   口径：只记「正常弹刀」（轻弹刀 + 支援突击 + 喧响 215）；「不带支援突击的弹刀」
 *   （只有轻弹刀倍率行 + 喧响 215、无支援突击行）用 parryNoFollowUpTotal 单独记、
 *   全部归击破位（非用户可调）；「x弹刀」（两人同时招架同一攻击，基塔布鲁 1 次）——
 *   xParryTotal 单独记：支援突击/喧响都算两人的（双方 parryCount 各 +x），前台时间只计
 *   一份（非主弹窗位的 x 行时间豁免，cfg.parryTimeFreeCount），2026-09-02 用户口径。
 * - decibelGift：喧响赠礼（boss 机制赠送，叠加在角色进场喧响 initialDecibelGift 之上）。
 * 快支不在此列：快支是角色侧与 Boss 无关。
 */
const BOSS_DEFAULTS = {
  '30009': { battleTime: 180, shieldCount: 0, energyShield: 0, decibelGift: { slot: 1, amount: 6000 } }, // 未知复合侵蚀体（送 6000 喧响给 1 号位）
  '30021': { battleTime: 180, shieldCount: 0, energyShield: 0, invincibleTime: 7, parryTotal: 8 }, // 恶名·庞培（无敌 7s / 正常弹刀 8——据归档 72db6dc3 实战低金仪玄琉音卢西娅 179s 弹刀 8 达 4 失衡）
  '30033': { battleTime: 180, shieldCount: 1, energyShield: 0, invincibleTime: 4, parryNoFollowUpTotal: 15 }, // 秽息司祭（无敌 4s / 秽盾 1 / 无突击弹刀 15）
  '30034': { battleTime: 180, shieldCount: 1, energyShield: 0, invincibleTime: 28 },       // 秽息妖鬼·名可名（无敌 28s / 秽盾 1）
  '30038': { battleTime: 180, shieldCount: 1, energyShield: 0, invincibleTime: 29, parryNoFollowUpTotal: 2, parryDecibelOnlyTotal: 4, stunGiftRatio: 0.3 }, // 「亵渎者」（无敌 29s / 秽盾 1 / 无突击弹刀 2 / 只喧响弹刀 4 / 白送 30% 失衡上限）
  '30041': { battleTime: 180, shieldCount: 1, energyShield: 0, invincibleTime: 2, parryTotal: 1 }, // 彷徨猎手（无敌 2s / 秽盾 1 / 正常弹刀 1）
  '30042': { battleTime: 180, shieldCount: 1, energyShield: 0, invincibleTime: 24, parryTotal: 13 }, // 魇缚者·叶释渊（无敌 24s / 秽盾 1 / 弹刀 13）
  '40000': { battleTime: 180, shieldCount: 2, energyShield: 0, invincibleTime: 6, parryTotal: 1, parryNoFollowUpTotal: 3 }, // 太初梦魇（无敌 6s / 秽盾 2 / 正常弹刀 1 / 无突击弹刀 3）
  '40001': { battleTime: 180, shieldCount: 0, energyShield: 0, invincibleTime: 15, parryTotal: 2, parryNoFollowUpTotal: 7 }, // 薇斯珀（无敌 15s / 正常弹刀 2 / 无突击弹刀 7）
  '40002': { battleTime: 180, shieldCount: 0, energyShield: 1, invincibleTime: 7, parryNoFollowUpTotal: 6 }, // 猎血清道夫（无敌 7s / 能量盾 1 / 无突击弹刀 3+3）
  '40003': { battleTime: 180, shieldCount: 0, energyShield: 0, invincibleTime: 7, parryNoFollowUpTotal: 6 }, // 复写体·猎血清道夫（困难；无敌 7s / 无能量盾 / 无突击弹刀 6）
  '40005': { battleTime: 180, shieldCount: 0, energyShield: 0, invincibleTime: 8, parryTotal: 2, parryNoFollowUpTotal: 4 }, // 焚昼余火·法厄同（无敌 4+4=8s 待确认 / 正常弹刀 2 / 无突击弹刀 4）
  '40006': { battleTime: 180, shieldCount: 0, energyShield: 1, parryTotal: 1, parryNoFollowUpTotal: 2, xParryTotal: 1 }, // 基塔布鲁（能量盾 1 / 无突击弹刀 2 / x弹刀 1：两人同时招架——支援突击/喧响算两人的、前台时间只计一份，2026-09-02 用户口径）
  '40008': { battleTime: 180, shieldCount: 0, energyShield: 2, parryTotal: 1, parryNoFollowUpTotal: 2 }, // 基塔布鲁·滞变畸兽（能量盾 2 / 正常弹刀 1 / 无突击弹刀 2；x弹刀同族待核）
  '300121': { battleTime: 180, shieldCount: 0, energyShield: 0, invincibleTime: 24 },      // 恶名·冥宁芙（无敌 24s）
}
function bossDefaults(monsterId) {
  return { battleTime: 180, shieldCount: 0, energyShield: 0, ...(BOSS_DEFAULTS[monsterId] ?? {}) }
}

/**
 * Boss 敌方体型（small/medium/large，手动维护）——影响体型相关招式倍率（艾莲霜锋剑气 / 苍角风团
 * 小0/中3/大6 段）。2026-09-05 用户逐个手录；未录入的 boss 选中时默认中型（TeamComparePage）。
 * TeamCompare 选中 boss 时自动写入敌方体型（TeamComparePage watcher），艾莲/苍角经 cfg.bodySize 消费。
 */
const BOSS_BODY_SIZES = {
  '30007': 'large',  // 恶名·死路屠夫
  '30009': 'large',  // 未知复合侵蚀体
  '30021': 'large',  // 恶名·庞培
  '30024': 'large',  // 牲鬼·布林格
  '30033': 'large',  // 秽息司祭
  '30034': 'small',  // 秽息妖鬼·名可名
  '30038': 'medium', // 「亵渎者」
  '30041': 'medium', // 彷徨猎手
  '30042': 'small',  // 魇缚者·叶释渊
  '30052': 'large',  // 熔狱行赭
  '40000': 'small',  // 太初梦魇·「始主」
  '40001': 'small',  // 叛律孤歌·薇斯珀
  '40002': 'medium', // 猎血清道夫
  '40003': 'large',  // 复写体·猎血清道夫
  '40005': 'large',  // 焚昼余火·法厄同（异变能量体）
  '40006': 'large',  // 基塔布鲁
  '40008': 'large',  // 基塔布鲁·滞变畸兽
  '40009': 'large',  // 异构·基塔布鲁
  '40010': 'large',  // 库萨里库
  '40011': 'large',  // 异构·焚昼余火
  '300082': 'large', // 自律强袭单位·「提丰·破坏者型」
  '300121': 'medium', // 恶名·冥宁芙
}

// @fact data:bossBodySize 口径: 22个TeamCompare可选boss的敌方体型为用户手录(2026-09-05)，覆盖表 BOSS_BODY_SIZES 随导入产物落 boss-presets.json 的 bodySize 字段；TeamCompare 选中 boss 自动写入敌方体型(未录 boss 默认中型)，艾莲霜锋剑气/苍角风团经 cfg.bodySize 消费 | 据 用户@2026-09-05 | 验 src/composables/__tests__/bossPresetsData.test.ts | 锚 scripts/import-nanoka-bosses.mjs#BOSS_BODY_SIZES | 信 确认

/** version.json 未收录的 3.2 期数兜底（690451/690461/690471） */
const VERSION_FALLBACK = /^6904[567]/

/**
 * 危局总血量 = nanoka 原始单管血量（mo.stats.hp）× 管数（等效加强系数）。
 * mo.stats.hp 已含「4 号血量成长曲线 70 级终值(×247.95) × 版本系数」：
 *   复写体·猎血清道夫 690441 = 64248 × 247.95 × 2.95 ≈ 46,994,360（163.moe 记 3.1v3 困难系数 295%）。
 * 管数 = 分数曲线「所需伤害」列总和 ÷ 10：
 *   普通（29 管）87.4 / 10 = 8.74；困难（异构 24 管）158 / 10 = 15.8。
 * 用户口径（2026-08 核实）：普通危局 8.74、困难危局 15.8；困难曾误记 12（测试期数据有误，已按 nanoka 网站总量反推修正）。
 */
const HP_BARS_BY_MODE = {
  critical_assault: 15.8, // 困难危局（异构，24 管）
  defense: 8.74,          // 普通危局（29 管）
}

/** 4 号血量成长曲线 70 级成长值（1 级 = 1 → 70 级 = 247.95）。版本系数 = mo.stats.hp / (baseHp × 247.95)。 */
const HP_CURVE4_LV70 = 247.95

/** 血量版本系数（%）：mo.stats.hp / (1 级基础血量 × 247.95)，round 到 1 位小数；无基础血量时 null。 */
function hpVersionCoeffOf(monsterId, zoneHp) {
  const baseHp = getMonster(monsterId)?.baseHp ?? 0
  if (!baseHp || !zoneHp) return null
  return Math.round((zoneHp / (baseHp * HP_CURVE4_LV70)) * 1000) / 10
}

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
        // 测试期期数（无 live_begin）用空 begin：info.begin 是测试服发布日（如 3.2 三期的 2026-07-30 占位），
        // 非正式上线日，混入会打乱时间轴（3.2 被排到 3.1 之前）。下游按 begin||phaseId 排序、空 begin 跳过匹配，均安全。
        const begin = info.live_begin ?? ''
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
          /** 源怪物 id（合并预设用其区分试炼版/恶名版，如 30007 vs 300072；血量系数按各源怪物基础血量反推） */
          monsterId: String(mo.id),
          /** 源怪物名（合并预设的试炼版/恶名版区分显示用，如 死路屠夫 vs 恶名·死路屠夫） */
          monsterName: mo.name ?? entry.name,
          stageName: zone.name ?? mo.name,
          stageNum: zone.stage_num ?? 1,
          level: zone.monster_level ?? 70,
          hp: Math.round((mo.stats?.hp ?? 0) * HP_BARS_BY_MODE[modeType]),
          /** 血量版本系数（%）：mo.stats.hp / (1级基础血量 × 4号曲线 70级 247.95)；如 叶释渊 69025 = 180 */
          hpVersionCoeff: hpVersionCoeffOf(entry.id, mo.stats?.hp),
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
      /** 敌方体型（手动维护，见 BOSS_BODY_SIZES；未录入时缺省） */
      ...(BOSS_BODY_SIZES[entry.id] ? { bodySize: BOSS_BODY_SIZES[entry.id] } : {}),
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
    hp: Math.round((mo.stats?.hp ?? 0) * HP_BARS_BY_MODE[modeType]),
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
  const defMode = (zh.modes ?? []).find(m => m.zone_type === 1001)
  const info = summary[zoneId]

  const caZones = Object.keys(caMode?.zone ?? {}).map(k => ({ key: k, zone: caMode.zone[k] }))
  const caZone = caZones[0]
  const caRoom = caZone ? caZone.zone.layer_room?.[Object.keys(caZone.zone.layer_room ?? {})[0]] : null
  const criticalAssault = caRoom
    ? monsterBrief(undefined, { phaseId: zoneId, zoneKey: caZone.key, monster_level: caZone.zone.monster_level }, caRoom, 'critical_assault', caZone.zone.layer_buff)
    : null

  const defZones = Object.keys(defMode?.zone ?? {}).map(k => ({ key: k, zone: defMode.zone[k] }))
  const defense = []
  for (const z of defZones) {
    const room = z.zone.layer_room?.[Object.keys(z.zone.layer_room ?? {})[0]]
    if (!room) continue
    const brief = monsterBrief(undefined, { phaseId: zoneId, zoneKey: z.key, monster_level: z.zone.monster_level }, room, 'defense', z.zone.layer_buff)
    if (brief) defense.push({ ...brief, stageName: z.zone.name ?? '', stageNum: z.zone.stage_num ?? 1 })
  }

  // 当期危局 buff 牌（selectable_buff）：困难 zone 优先，无困难（1.4–3.0）取首个普通 zone
  const buffZone = caZone ?? defZones[0]
  const buffs = []
  for (const b of Object.values(buffZone?.zone.selectable_buff ?? {})) {
    const parsed = buffParser.parsePhaseBuff(b.title ?? '', b.desc ?? '')
    buffs.push(parsed)
  }

  // 测试期期数（无 live_begin）空 begin；info.begin 是测试服占位日，混入会打乱时间轴
  const begin = info.live_begin ?? ''
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
  note: '元素抗性口径（游戏绝对值%）：弱点 -20 / 中性 0 / 抗性 +20~+40；bossAnomalyCoeff = 1 + attribute_infliction/100；hp = 危局总血量 = 单管血量(mo.stats.hp，已含 4 号曲线 70 级×版本系数) × 管数（普通 8.74 / 困难 15.8）；buff 解析见 scripts/phase-buff-parser.mjs',
  bosses,
  phaseViews,
}
writeJsonCompact(outFile, out)
console.log(`已生成 ${outFile}（${bosses.length} 个 Boss 预设，${phaseViews.length} 个期视图）`)

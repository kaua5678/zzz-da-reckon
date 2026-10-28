#!/usr/bin/env node
/**
 * 人工配装条目（`build-recommendations.json` 的 `metadata.curated`）落盘脚本 ——
 * 挽昼(1601) / 知更鸟(1661) / 诺姆(1571) / 洛克茜(1621)。
 *
 * ## 为什么要有这个脚本（而不是改 sync 脚本或手改 JSON）
 *
 * 这四条不是 nanoka 爬取的「官方给新手的默认配置」，是用户按实战定的：
 *   · 挽昼 1601 —— 站点 `fairy_recommend` 是**空的**（测试服占位包，raw 里 `{}`）；
 *   · 知更鸟 1661 —— 站点给的是「生命×3 + 云岿」，套装合用但**没配专武**、副词条也只写生命；
 *   · 诺姆 1571 / 洛克茜 1621（两人都是[击破]）—— 站点给的是通用默认盘（4pc 山大王 / 摇摆爵士）；
 *     用户 2026-10-28 要求两人换成 3.4 新盘 34400v1（击破位带 = 全队锐化伤害 +8%）。
 *
 * 用户原话（2026-10-26）：「nanoka优先级肯定低于我，他是爬取的官方推荐给新手的默认配置而已。
 * 武器你也配上专武，没歧义。」
 *
 * 所以要落盘的是「人工条目」，并且**在数据里留痕**（`metadata.curated`）：
 * `src/data/__tests__/buildRecMainStatRule.test.ts` 的 ② 「与站点规则逐槽一致」对人工条目豁免
 * （站点根本没有这条数据，比不出来），但 ①「该槽合法词条」照旧全量强制 —— 人工条目也不许写出
 * 游戏里刷不出来的盘。
 *
 * ## 口径（用户逐条裁决）
 *
 * ### 挽昼 1601 / 知更鸟 1661（2026-10-26）
 *
 * | 项 | 挽昼 1601 | 知更鸟 1661 |
 * |---|---|---|
 * | 4 件套 | 34300v1（最新锋御套：暴击+12%、火锐化无视16%防御） | 33700 雪兔梦游仙境（防护 4pc 全队+18%伤害） |
 * | 2 件套 | 34200 荆棘玫瑰（防御+16%；与 34300v1 的 2pc 同值，任取其一） | 33100 云岿如我（生命+10%。**用户裁决**：「鸟二件套用生命可以降低词条压力」） |
 * | 主词条 | 4 暴击率 / 5 **火属性伤害** / 6 防御力 | 4/5/6 全部生命值 |
 * | 副词条 | 引擎默认分配（暴击率→防御力→暴击伤害，见下） | 引擎默认分配（生命→防御→攻击） |
 * | 音擎 | 14160v1（音擎 14160 v1，锋御·防御副属性） | 14166v1（知更鸟专属音擎 v1） |
 *
 * ### 诺姆 1571 / 洛克茜 1621（2026-10-28，只换 4 件套）
 *
 * | 项 | 诺姆 1571 | 洛克茜 1621 |
 * |---|---|---|
 * | 4 件套 | `34400v1`（3.4 新盘：2pc 回能 +20%；4pc 装备者暴击率≥50% ⇒ 自身暴伤+30%、攻击失衡值+5%，**装备者为[击破]时全队锐化伤害 +8%**、25s、全队唯一） | 同左 |
 * | 2 件套 | 31000 啄木鸟电音（暴击率+8%）—— 站点原推荐，**不动** | 33400 月光骑士颂（回能+20%）—— 站点原推荐，**不动** |
 * | 备选 2 件套 | 33200 山大王（原 4 件套降到备选：2pc 失衡值+6%） | 31600 摇摆爵士（原 4 件套降到备选：2pc 回能+20%，与 33400 同值） |
 * | 主词条 / 副词条 / 音擎 | 全部沿用站点条目（4 暴击率 / 5 火属性伤害 / 6 回能；专武 14157 首席跟班） | 全部沿用站点条目（4 暴击率 / 5 穿透率 / 6 回能；专武 14162 绯月银棺） |
 *
 * 用户原话（2026-10-28）：「洛克茜带 3 个 2 件套都是回能的，你改一下，现在的 4 件套摇摆是错的。
 * 诺姆带山大王没问题。新的驱动盘四件套给击破带，可以加锐化伤害。诺姆和洛克茜和锋御角色组队时
 * 就带这个 4 件套。」+「这俩人都是击破……带谁都得配置最新能拐锐化的盘子四件套」。
 *   ⇒ 口径落点解释：**推荐配装是按角色存的**（队伍预设禁止写配装字段，见 `scripts/validate-data.mjs`
 *     的黑名单），所以「和锋御组队时」「带谁都」只能表达为两人条目都换成 34400v1；
 *     代价是**不带锋御的队会小幅变低**（下表实测），这是用户明知的取舍。
 *   ⇒ 「诺姆带山大王没问题」「洛克茜的 2 件套都是回能」都保留：山大王 / 摇摆爵士降到**备选**
 *     行（备选只做展示，不下发引擎），2 件套字段不动。
 *
 * ### 为什么 2 件套不动（引擎实测，队伤口径 1e6 计）
 *
 * | 队 | 站点原样 | 新 4pc + 站点 2pc | 新 4pc + 原 4pc 降到 2pc |
 * |---|---|---|---|
 * | 挽昼+诺姆+知更鸟 | 72.163M | **76.512M**（+6.0%） | 74.811M |
 * | 11号+诺姆+丽娜（无锋御） | 54.202M | 51.658M（−4.7%） | 49.738M |
 * | 挽昼+洛克茜+知更鸟 | 78.764M | **80.436M**（+2.1%） | 80.436M |
 *
 * ⇒ 山大王当 2pc（失衡值+6%）在引擎里**低于**啄木鸟（暴击率+8%）：自动副词条本就把暴击填到近百
 *   （实测局内 99.4%），4pc 的 ≥50% 门槛早已满足，多出的 6% 失衡补不回丢掉的 8% 暴击。
 *   ⇒ 洛克茜两列同值：摇摆爵士 / 月光骑士颂的 2pc 都是回能+20%（游戏里同值）。
 *
 * ### 挽昼 5 号位为什么是火伤而不是防御（用户问「应该比防御厉害吧？」——实测是）
 *
 * 同一套其余配装下（引擎实测，队伤口径 1601+1571+1661）：
 *   5 号位防御 → 局外 DEF 3271、火伤 22%、27.248M
 *   5 号位火伤 → 局外 DEF 2845、火伤 52%、**27.906M**（+2.4%）
 * 锋御伤害 = 防御力基底 × 增伤 × 锐暴。**白值 = 角色本体 + 音擎**（不是只看本体）：
 *   挽昼本体 DEF 441.11 + 14160v1 的 446（该音擎 baseStat: def，白值记在防御）⇒ 887.11。
 *   48% 防御主词条约 +426 防御；乘进伤害基底后仍小于 30% 火伤乘区（22% → 52%）的增益。
 *
 * ### 副词条：用户 2026-10-26 词条约束（已进引擎，不靠本脚本填数）
 *
 * 「你的词条不能太极端了，最高的两个加起来最好不超过 35，最高词条之前写过不超过 20 比较合理」
 *   ⇒ `core/substatOptimizer.ts` 的 `SUBSTAT_TOP2_STEP_CAP`(35) + `statCap`(20)；
 *   ⇒ 挽昼落成 **暴击率 19 步 / 防御力 16 步 / 暴击伤害 4 步**（19+16=35，暴击 **199.6%** 贴顶 200%）。
 *     为什么不是贪心填满 20 步：暴伤副词条经核心被动「初始暴伤 ×0.35 = 初始暴击」会**再涨暴击**，
 *     空洞读数的 20 步实测落到 202.0%（越过锐暴封顶的 2% 白给），少 1 步给防御反而多 0.8% 队伤。
 *
 * 用法：node scripts/patch-curated-loadout.mjs [--dry]
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeJsonCompact } from './lib/jsonio.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const recsPath = resolve(root, 'public/static/build-recommendations.json')
const catalogPath = resolve(root, 'public/static/catalog.json')
const recs = JSON.parse(readFileSync(recsPath, 'utf8'))
const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))

/** 词条 id → 展示块（name 用中文：UI 直接渲染；格式固定值词条单独覆盖） */
const STATS = {
  11102: { prop: '11102', name: '生命值', icon: 'UI/Sprite/A1DynamicLoad/IconAttribute/UnPacker/Role/IconHp.png', format: '{0:0.#%}' },
  13102: { prop: '13102', name: '防御力', icon: 'UI/Sprite/A1DynamicLoad/IconAttribute/UnPacker/Role/IconDef.png', format: '{0:0.#%}' },
  20103: { prop: '20103', name: '暴击率', icon: 'UI/Sprite/A1DynamicLoad/IconAttribute/UnPacker/Role/IconCrit.png', format: '{0:0.#%}' },
  21103: { prop: '21103', name: '暴击伤害', icon: 'UI/Sprite/A1DynamicLoad/IconAttribute/UnPacker/Role/IconCritDam.png', format: '{0:0.#%}' },
  31603: { prop: '31603', name: '火属性伤害加成', icon: 'UI/Sprite/A1DynamicLoad/IconGeneralBuff/Packer/IconFire.png', format: '{0:0.#%}' },
}

/** 套装块：名字与文案照抄 catalog / raw（单一事实源，不在这里手写游戏文本） */
function discSetOf(id) {
  const set = catalog.driveDiscSets.find(s => s.id === id)
  if (!set) throw new Error(`catalog 缺驱动盘套装 ${id}`)
  const eq = JSON.parse(readFileSync(resolve(root, 'data/raw/nanoka_equipment_3.4.1+19836465.json'), 'utf8'))
  const liveEq = JSON.parse(readFileSync(resolve(root, 'data/raw/nanoka_equipment.json'), 'utf8'))
  // catalog 的 v1 占位 id 带后缀（34300v1），raw 键是无后缀的正式 id（34300），见 docs/DATA_FETCHING.md
  const rawKey = id.replace(/v\d+$/, '')
  const raw = eq[rawKey]?.zh ?? liveEq[rawKey]?.zh ?? eq[id]?.zh ?? liveEq[id]?.zh
  const strip = (x) => String(x ?? '').replace(/<color[^>]*>/g, '').replace(/<\/color>/g, '').replace(/\s+/g, ' ').trim()
  // 测试服 raw 的名字常是占位键（`EquipmentSuit_34300_name`，见 docs/DATA_FETCHING.md
  // 「名字允许是占位」）⇒ 回落 catalog 名（catalog 里是「驱动盘套装 34300 v1」），不把占位键显示给用户。
  const placeholder = (n) => !n || /^(EquipmentSuit_|Item_|Suit_)/.test(n)
  const rawName = strip(raw?.name).replace(/\s+$/, '')
  // 英文文案照旧带上（既有条目都带 desc2_en/desc4_en；丢掉会让 UI 切英文时空白）
  const rawEn = eq[rawKey]?.en ?? liveEq[rawKey]?.en
  const enName = strip(rawEn?.name)
  return {
    id,
    name_en: placeholder(enName) ? '' : enName,
    name_zh: placeholder(rawName) ? (set.name.zhCN ?? id) : rawName,
    desc2_en: strip(rawEn?.desc2),
    desc4_en: strip(rawEn?.desc4),
    desc2_zh: strip(raw?.desc2),
    desc4_zh: strip(raw?.desc4),
  }
}

/** 音擎块：数值全从 catalog 取（id / 稀有度 / 白值 / 副属性），不手抄 */
function wengineOf(id) {
  const w = catalog.wEngines.find(x => x.id === id)
  if (!w) throw new Error(`catalog 缺音擎 ${id}`)
  const SUB = { defPct: 'DEF', hpPct: 'HP', critRate: 'CRIT Rate', critDmg: 'CRIT DMG', atkPct: 'ATK', energyRegen: 'Energy Regen', impact: 'Impact', penRatio: 'PEN Ratio', anomalyProficiency: 'Anomaly Proficiency', anomalyMastery: 'Anomaly Mastery' }
  return {
    nanoka_wengine_id: id,
    rank: w.rarity ?? 'S',
    name_en: w.name?.en ?? w.name?.zhCN ?? id,
    name_zh: w.name?.zhCN ?? id,
    icon: (w.images?.icon ?? '').split('/').pop()?.replace(/\.[a-z]+$/, '') || `Weapon_${w.rarity ?? 'S'}_${id}`,
    atk: w.level60?.atkBase ?? 0,
    sub_stat: SUB[w.level60?.advancedStat?.stat] ?? w.level60?.advancedStat?.stat ?? '-',
    desc: w.effect?.description?.zhCN ?? '',
    catalog_wengine_id: id,
  }
}

const PATCH = {
  1601: {
    name: { zhCN: '挽昼', en: 'Sunbringer' },
    strategy: [
      '人工条目（用户 2026-10-26 裁决，非 nanoka 站点数据）：站点 fairy_recommend 对本角色为空。',
      '4件套 34300v1（锋御）锐暴 +12% 暴击、火锐化无视 16% 防御；2件套 34200 防御 +16%（与 4pc 的 2 件效果同值）。',
      '主词条 4 暴击率 / 5 火属性伤害 / 6 防御力；副词条 暴击率 19 / 防御力 16 / 暴击伤害 4（单项 ≤20、最高两项 ≤35）⇒ 局内暴击 199.6% 贴顶 200%。',
    ],
    drive_disc_sets: { four_piece: discSetOf('34300v1'), two_piece: discSetOf('34200') },
    main_stats: { '4': STATS[20103], '5': STATS[31603], '6': STATS[13102] },
    substats: [
      { ...STATS[20103], priority: 1 },
      { ...STATS[13102], priority: 2 },
      { ...STATS[21103], priority: 3 },
    ],
    wengine: wengineOf('14160v1'),
  },
  1661: {
    name: { zhCN: '知更鸟', en: 'Robin' },
    strategy: [
      '人工条目（用户 2026-10-26 裁决）：4件套 雪兔梦游仙境（防护 4pc 全队伤害 +18%）。',
      '2件套 云岿如我（生命 +10%）——用户裁决「鸟二件套用生命可以降低词条压力」：实测 4pc 雪兔(2pc 生命+10%) + 2pc 生命 ⇒ 局外 HP 26994，离场守护转模已顶上限（每 1000 HP +80、上限 800）⇒ **零生命副词条即可**。',
      '主词条 4/5/6 全部生命值；副词条 生命/防御（拐力不看自身伤害，生命只做转模门槛余量）。',
    ],
    drive_disc_sets: { four_piece: discSetOf('33700'), two_piece: discSetOf('33100') },
    main_stats: { '4': STATS[11102], '5': STATS[11102], '6': STATS[11102] },
    substats: [
      { ...STATS[11102], priority: 1 },
      { ...STATS[13102], priority: 2 },
    ],
    wengine: wengineOf('14166v1'),
  },
  // 2026-10-28：两个[击破]换 3.4 新盘 34400v1（击破位带 = 全队锐化伤害 +8%）。
  // 函数式 patch = 只覆盖要改的字段，主词条/副词条/音擎/2 件套全部沿用站点条目（不手抄）。
  // 注意 `drive_disc_sets` 是整块替换 ⇒ 必须把 prev 的 two_piece 一起带上。
  1571: (prev) => ({
    strategy: [
      '人工条目（用户 2026-10-28 裁决）：只换 4 件套 —— 34400v1（3.4 新盘，击破位带 = 全队锐化伤害 +8%）。',
      '2 件套 31000 啄木鸟电音、主词条（4 暴击率 / 5 火伤 / 6 回能）、副词条、专武 14157 首席跟班全部沿用站点条目。',
      '备选 2 件套 = 33200 山大王（原 4 件套降级保留：2pc 失衡值+6%）—— 用户「诺姆带山大王没问题」。',
    ],
    drive_disc_sets: { four_piece: discSetOf('34400v1'), two_piece: prev.drive_disc_sets.two_piece, alt_two_piece: discSetOf('33200') },
  }),
  1621: (prev) => ({
    strategy: [
      '人工条目（用户 2026-10-28 裁决）：只换 4 件套 —— 34400v1（3.4 新盘，击破位带 = 全队锐化伤害 +8%）。',
      '2 件套 33400 月光骑士颂（回能+20%）、主词条（4 暴击率 / 5 穿透率 / 6 回能）、副词条、专武 14162 绯月银棺全部沿用站点条目。',
      '备选 2 件套 = 31600 摇摆爵士（原 4 件套降级保留：2pc 回能+20%，与 33400 同值）。',
    ],
    drive_disc_sets: { four_piece: discSetOf('34400v1'), two_piece: prev.drive_disc_sets.two_piece, alt_two_piece: discSetOf('31600') },
  }),
}

// 人工条目标记（护栏测试据此豁免「与站点规则逐槽一致」，见源码头注释）
recs.metadata.curated = Array.from(new Set([...(recs.metadata.curated ?? []), '1601', '1661', '1571', '1621'])).sort()

let changed = 0
for (const [id, rawPatch] of Object.entries(PATCH)) {
  const prev = recs.characters[id]
  const patch = typeof rawPatch === 'function' ? rawPatch(prev) : rawPatch
  const next = { ...prev, ...patch, nanoka_id: id, source_url: `https://zzz.nanoka.cc/character/${id}` }
  const before = JSON.stringify(prev)
  const after = JSON.stringify(next)
  if (before === after) { console.log(`SAME ${id}`); continue }
  changed++
  console.log(`\nUPD ${id} ${(patch.name ?? prev.name).zhCN}`)
  for (const key of new Set([...Object.keys(prev), ...Object.keys(next)])) {
    const a = JSON.stringify(prev[key]); const b = JSON.stringify(next[key])
    if (a !== b) console.log(`  ${key}:\n    - ${String(a).slice(0, 220)}\n    + ${String(b).slice(0, 220)}`)
  }
  recs.characters[id] = next
}

if (process.argv.includes('--dry')) {
  console.log(`\ndry-run：${changed} 条待写`)
} else if (changed) {
  writeJsonCompact(recsPath, recs)
  console.log(`\nwritten ${recsPath}（${changed} 条）`)
} else {
  console.log('\n无变化')
}

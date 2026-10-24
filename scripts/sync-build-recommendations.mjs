#!/usr/bin/env node
/**
 * 从 nanoka 正式服数据同步 build-recommendations.json（邦布精灵配装推荐）。
 *
 * 用法：node scripts/sync-build-recommendations.mjs <id> [<id>...] [--write] [--force] [--main-stats-only]
 *   --write  写回 public/static/build-recommendations.json（默认 dry-run，逐条打印差异）
 *   --force  索引/角色 raw 已存在也重抓
 *   --main-stats-only  只重写 `main_stats`（保留其余字段）。用于**修单条口径**（如 2026-10-20 主词条规则订正）
 *      ——整条重建会把 en→zh 的 strategy/substats 名称一并翻掉，diff 里混进与本次无关的改动（规则 13 归因）。
 *
 * 数据源（全部落在 data/raw/，版本 = manifest.zzz.live）：
 *   data/raw/nanoka_character.json          角色索引（en 名）
 *   data/raw/nanoka_equipment.json          驱动盘套装索引（zh/en 名 + desc2/desc4）
 *   data/raw/nanoka_weapon.json             音擎索引（en 名 / atk / sub / desc / icon）
 *   data/raw/nanoka_missing/full/<id>.json  角色全量（fairy_recommend / strategy）
 *
 * 字段映射口径（2026-09-09 定，据 nanoka 正式服 3.2）：
 *   1. drive_disc_sets：fairy_recommend.slot4 → four_piece、slot2 → two_piece、slot_sub → alt_two_piece，
 *      套装名与 desc2/desc4 取 equipment 索引（zh + en）。
 *   2. main_stats 4/5/6：**每槽独立**按 `part4 → part5 → part6 → part_sub` 取首个"该槽合法"的词条
 *      （合法池见 `scripts/lib/build-recommendation-rule.mjs`）。这是 nanoka 页面自身的规则
 *      （bundle：`ml=[part4,part5,part6,part_sub].filter(>0)`、`slot.stats = ml.filter(槽合法)`、显示首项）；
 *      `alt_build` 是备选配装的副属性，**不参与**主词条选择。
 *      ⚠ 2026-10-20 订正：旧口径是"候选全局去重贪心"，与页面 24/62 不一致，且给 1631/1641 写出过
 *      该槽不合法的主词条（5 槽暴伤 / 6 槽穿透 / 4 槽掌控 / 5 槽精通 / 6 槽火伤）——护栏测试
 *      `src/data/__tests__/buildRecMainStatRule.test.ts`。回归夹具 1431 / 1461 / 1571，见 `--verify-rule`。
 *   3. substats：fairy_recommend.part_sub_list 顺序即优先级；名字/图标取既有条目里出现过的词条表。
 *   4. wengine：按 catalog.wEngines 的 ownerAgentId 找专武（nanoka_wengine_id/catalog_wengine_id/atk/sub_stat
 *      等取 weapon 索引）。
 *
 * 为什么不是「读 catalog.driveDiscSets」：条目要 en 名与 desc2/desc4 双语，catalog 只有中文 4pc 文本。
 * 与 `scripts/sync-signature-wengine-recs.mjs` 的关系：那个是**离线只补缺失专武块**；本脚本按 id
 * 从正式服全量重建条目（4pc/2pc/主词条/副词条/专武），需要出网。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { writeJsonCompact } from './lib/jsonio.mjs'
import { fetchJson } from './lib/http.mjs'
import { assignMainStatProps } from './lib/build-recommendation-rule.mjs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const STATIC = 'https://static.nanoka.cc'
const buildPath = resolve(root, 'public/static/build-recommendations.json')
const catalogPath = resolve(root, 'public/static/catalog.json')
const rawDir = resolve(root, 'data/raw')

const write = process.argv.includes('--write')
const force = process.argv.includes('--force')
const verifyRule = process.argv.includes('--verify-rule')
const mainStatsOnly = process.argv.includes('--main-stats-only')
const ids = process.argv.slice(2).filter(a => !a.startsWith('--'))


async function ensureRaw(file, url, label) {
  const target = resolve(rawDir, file)
  if (existsSync(target) && !force) return JSON.parse(readFileSync(target, 'utf8'))
  const data = await fetchJson(url)
  writeFileSync(target, JSON.stringify(data, null, 2))
  console.log(`OK  data/raw/${file}（${label}）`)
  return data
}

async function liveVersion() {
  const m = await fetchJson(`${STATIC}/manifest.json`, { timeoutMs: 20000 })
  return m.zzz?.live ?? m.zzz?.latest
}

const version = await liveVersion()
const characterIndex = await ensureRaw('nanoka_character.json', `${STATIC}/zzz/${version}/character.json`, '角色索引')
const equipmentIndex = await ensureRaw('nanoka_equipment.json', `${STATIC}/zzz/${version}/equipment.json`, '驱动盘套装索引')
const weaponIndex = await ensureRaw('nanoka_weapon.json', `${STATIC}/zzz/${version}/weapon.json`, '音擎索引')
const build = JSON.parse(readFileSync(buildPath, 'utf8'))
const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))

/** 词条表：从既有条目里回收 prop → { name, icon, format }（避免手抄图标路径） */
const PROP_TABLE = {}
for (const entry of Object.values(build.characters)) {
  for (const stat of [...Object.values(entry.main_stats ?? {}), ...(entry.substats ?? [])]) {
    if (stat?.prop && stat.icon) PROP_TABLE[stat.prop] = { name: stat.name, icon: stat.icon, format: stat.format }
  }
}
/** 显示名统一中文（既有条目中英混排；UI 直接渲染 name，见 TeamConfigPage 配装推荐块） */
const PROP_ZH = {
  11102: '生命值', 11103: '生命值', 12102: '攻击力', 12202: '冲击力', 13102: '防御力',
  20103: '暴击率', 21103: '暴击伤害', 23103: '穿透率',
  30502: '能量自动回复', 31203: '异常精通', 31402: '异常掌控',
  31503: '物理伤害加成', 31603: '火属性伤害加成', 31703: '冰属性伤害加成',
  31803: '电属性伤害加成', 31903: '以太伤害加成', 32303: '风属性伤害加成',
}
/**
 * PROP_TABLE 只从既有条目回收，全新档位首见时先落这里（条目落盘后自然进回收面）。
 * 11103 = 生命值副词条高一档（2026-10-24 随 1661 (Test1) 首见；与 11102 同名同图标，
 * 形状复用 1051 条目里的 11102）。
 */
const PROP_TABLE_FALLBACK = {
  11103: { name: '生命值', icon: 'UI/Sprite/A1DynamicLoad/IconAttribute/UnPacker/Role/IconHp.png', format: '{0:0.#%}' },
}
/** 固定值词条（异常精通）不是百分比 */
const PROP_FORMAT = { 31203: '{0:0}' }

function statOf(prop) {
  const id = String(prop)
  const known = PROP_TABLE[id] ?? PROP_TABLE_FALLBACK[id]
  if (!known) throw new Error(`词条 ${id} 不在既有词条表里——先确认它属于哪一槽，再补 PROP_ZH/PROP_TABLE 兜底`)
  return {
    prop: id,
    name: PROP_ZH[id] ?? known.name,
    icon: known.icon,
    format: PROP_FORMAT[id] ?? known.format ?? '{0:0.#%}',
  }
}

/** nanoka 文本带 <color=...> 标记；既有条目一律是纯文本 → 落盘前剥掉 */
const plain = s => String(s ?? '').replace(/<color[^>]*>/g, '').replace(/<\/color>/g, '').replace(/\s+/g, ' ').trim()

/**
 * 主词条分配：规则本体在 `lib/build-recommendation-rule.mjs`（脚本与护栏测试**同源**，
 * 不在两处各抄一份"每槽取首个合法"——抄一份就一定会漂）。
 */
function assignMainStats(fairy) {
  const props = assignMainStatProps(fairy)
  const out = {}
  for (const slot of [4, 5, 6]) {
    if (props[slot]) out[String(slot)] = statOf(props[slot])
  }
  return out
}

function discSetOf(id) {
  const eq = equipmentIndex[String(id)]
  if (!eq) return null
  return {
    id: String(id),
    name_en: plain(eq.en?.name),
    name_zh: plain(eq.zh?.name),
    desc2_en: plain(eq.en?.desc2),
    desc4_en: plain(eq.en?.desc4),
    desc2_zh: plain(eq.zh?.desc2),
    desc4_zh: plain(eq.zh?.desc4),
  }
}

/** 只重算主词条：不碰 strategy / substats / 套装 / 专武（`--main-stats-only` 用） */
function mainStatsPatch(id, full) {
  const prev = build.characters[id]
  return prev ? { ...prev, main_stats: assignMainStats(full.fairy_recommend ?? {}) } : buildEntry(id, full)
}

function buildEntry(id, full) {
  const fairy = full.fairy_recommend ?? {}
  const idx = characterIndex[String(id)] ?? {}
  const sets = {
    four_piece: discSetOf(fairy.slot4),
    two_piece: discSetOf(fairy.slot2),
    alt_two_piece: discSetOf(fairy.slot_sub),
  }
  for (const [k, v] of Object.entries(sets)) if (!v) delete sets[k]

  const weaponId = catalog.wEngines.find(w => String(w.ownerAgentId) === String(id))?.id
  const weapon = weaponId ? weaponIndex[String(weaponId)] : null
  const wengine = weaponId && weapon
    ? {
        nanoka_wengine_id: String(weaponId),
        rank: { 2: 'B', 3: 'A', 4: 'S' }[weapon.rank] ?? 'S',
        name_en: weapon.en ?? '',
        name_zh: weapon.zh ?? '',
        icon: weapon.icon ?? '',
        atk: weapon.atk,
        sub_stat: weapon.sub ?? '',
        desc: weapon.desc ?? '',
        catalog_wengine_id: String(weaponId),
      }
    : undefined

  return {
    name: { zhCN: full.name ?? '', en: idx.en ?? full.name ?? '' },
    nanoka_id: String(id),
    source_url: `https://zzz.nanoka.cc/character/${id}`,
    strategy: (Array.isArray(full.strategy) ? full.strategy : Object.values(full.strategy ?? {}))
      .map(s => String(s ?? '').trim()).filter(Boolean),
    drive_disc_sets: sets,
    main_stats: assignMainStats(fairy),
    substats: (fairy.part_sub_list ?? []).map((prop, i) => ({ ...statOf(prop), priority: i + 1 })),
    ...(wengine ? { wengine } : {}),
  }
}

if (ids.length === 0 && !verifyRule) {
  console.error('用法：node scripts/sync-build-recommendations.mjs <id> [<id>...] [--write] [--force] [--verify-rule]')
  process.exit(1)
}

let changed = 0
for (const id of ids) {
  const fullPath = resolve(rawDir, `nanoka_missing/full/${id}.json`)
  let full
  if (existsSync(fullPath)) full = JSON.parse(readFileSync(fullPath, 'utf8'))
  else full = await ensureRaw(`nanoka_missing/full/${id}.json`, `${STATIC}/zzz/${version}/zh/character/${id}.json`, `角色 ${id}`)

  // 只修口径时保留其余字段（strategy/substats 的中英名不在本次改动范围内）
  const patched = mainStatsOnly ? mainStatsPatch(id, full) : buildEntry(id, full)
  const prev = build.characters[id]
  const before = JSON.stringify(prev)
  const after = JSON.stringify(patched)
  if (before === after) {
    console.log(`SAME ${id} ${patched.name.zhCN}`)
    continue
  }
  changed++
  console.log(`\n${prev ? 'UPD ' : 'ADD '}${id} ${patched.name.zhCN}`)
  if (prev) {
    for (const key of new Set([...Object.keys(prev), ...Object.keys(patched)])) {
      const a = JSON.stringify(prev[key]), b = JSON.stringify(patched[key])
      if (a !== b) console.log(`  ${key}:\n    - ${a}\n    + ${b}`)
    }
  }
  if (write) build.characters[id] = patched
}

if (write && changed) {
  writeJsonCompact(buildPath, build)
  console.log(`\nwritten ${buildPath}（${changed} 条）`)
} else {
  console.log(`\n${write ? '无变化' : `dry-run：${changed} 条待写（--write 生效）`}`)
}

// 回归用例：既有 1431/1461/1571 三条人工条目的 4/5/6 槽分配必须被同一规则复现。
// 期望值取自 build-recommendations.json 里这三条人工条目（数据取正式服实时，不读可能过期的 raw 快照）。
if (verifyRule) {
  const expected = {
    1431: { 4: '21103', 5: '31503', 6: '12102' },
    1461: { 4: '20103', 5: '31803', 6: '12102' },
    1571: { 4: '20103', 5: '31603', 6: '30502' },
  }
  const failures = []
  for (const [id, want] of Object.entries(expected)) {
    const full = await fetchJson(`${STATIC}/zzz/${version}/zh/character/${id}.json`)
    const got = Object.fromEntries(Object.entries(assignMainStats(full.fairy_recommend)).map(([k, v]) => [k, v.prop]))
    if (JSON.stringify(got) !== JSON.stringify(want)) failures.push(`${id}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`)
  }
  console.log(failures.length ? `--verify-rule FAIL\n  ${failures.join('\n  ')}` : '--verify-rule PASS（1431/1461/1571 槽位分配规则复现）')
  process.exit(failures.length ? 1 : 0)
}

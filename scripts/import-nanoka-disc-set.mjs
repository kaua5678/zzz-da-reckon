#!/usr/bin/env node
/**
 * 从 nanoka 导入**驱动盘套装**到 catalog.json（幂等：同 id 覆盖）。
 *
 * 背景：catalog.driveDiscSets 是早期 wiki 快照，一直没有独立导入管线（只靠
 * `scripts/patch-disc-sets.mjs` 逐条打补丁）。新版本（3.4+）的套装在 wiki 收录前只能从
 * nanoka 的 equipment.json 拿：`https://static.nanoka.cc/zzz/<版本>/equipment.json`
 * （单文件含 zh/en/ko/ja 的 name / desc2 / desc4）。
 *
 * 数值口径：nanoka 只给**套装文本**，2pc / 4pc 的机读效果必须人工建模（`MANUAL_SETS`，
 * 与 `import-nanoka-wengine.mjs` 的 `MANUAL_EFFECTS` 同一分工）。没有人工建模的套装也能导入
 * （只落文本 + 空 buff），不会静默编数值。
 *
 * 用法：
 *   node scripts/import-nanoka-disc-set.mjs <id>... [--version <v>] [--tag vN] [--dry-run]
 *   --version <v>：显式指定 nanoka 构建；录测试服数据必须显式给（如 '3.4.1+19836465'）
 *   --tag vN：测试服版本占位——id/名字加后缀（`34300` → `34300v1`），与 beta 快照的
 *              `<agentId>v<n>` 同一命名纪律：v1 与之后正式服同 id 的套装**同时存在**、各自可选用，
 *              互不覆盖。占位构建里未定稿的名字（`EquipmentSuit_34300_name`）换成「驱动盘套装 <id>」。
 *   --dry-run：只打印将写入的条目，不落盘
 *
 * 来源：版本缺省 = manifest.zzz.live（正式服）。测试服构建写在 sources 的版本化 URL 上，
 * 同时把 dataVersion / sourceVersion 钉进 `sources` 与 `legacyIds` 之外的展示面——
 * 具体见 buildEntry 注释（DriveDiscSet 没有 verification 字段，版本只由 id 后缀与 sources 承担）。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeJsonCompact } from './lib/jsonio.mjs'
import { fetchJson } from './lib/http.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const rawDir = resolve(root, 'data/raw')
const catalogPath = resolve(root, 'public/static/catalog.json')
const STATIC = 'https://static.nanoka.cc'

const args = process.argv.slice(2)
const argOf = (flag) => {
  const i = args.indexOf(flag)
  return i >= 0 ? args[i + 1] : ''
}
const explicitVersion = argOf('--version')
const explicitTag = argOf('--tag')
const dryRun = args.includes('--dry-run')
if (explicitTag && !/^v\d+$/.test(explicitTag)) {
  console.error(`--tag 只接受 v1 / v2 …（收到 ${explicitTag}）`)
  process.exit(2)
}
const ids = args.filter(a => !a.startsWith('--') && a !== explicitVersion && a !== explicitTag)
if (ids.length === 0) {
  console.error("用法: node scripts/import-nanoka-disc-set.mjs <id>... [--version <v>] [--tag vN] [--dry-run]")
  process.exit(1)
}

/** 便捷构造（与 import-nanoka-wengine.mjs 同形；驱动盘指标都是百分比，mode 按属性口径给） */
const cov = { default: 1, min: 0, max: 1, step: 0.1 }
function fixed(id, stat, value, extra = {}) {
  return { id, type: 'fixed', stat, mode: 'pct', value, coverage: cov, ...extra }
}

/**
 * 套装 2pc/4pc 人工建模（键 = nanoka 套装 id，**不带版本后缀**）。
 * 未建模的套装不写 MANUAL_SETS —— 导入时只落文本，buff 留空。
 */
const MANUAL_SETS = {
  // ---- 3.4.1+19836465 测试服首版（v1 占位）----
  '34300': { // 2pc 防御 / 4pc 暴击 + 火属性锐化伤害无视防御
    twoPiece: [fixed('nanoka_34300_2pc_def', 'defPct', 16)],
    fourPiece: {
      self: [
        fixed('nanoka_34300_4pc_crit', 'critRate', 12, { mode: 'flat' }),
        fixed('nanoka_34300_4pc_fire_def', 'enemyFireDefReduction', 16, {
          condition: '装备者造成火属性锐化伤害时（锋御角色的火属性输出即锐化伤害，默认常驻）',
        }),
      ],
      condition: '暴击率常驻；无视防御按火属性防御区结算（引擎无「锐化专属防御区」通道，见 modelingNotes）',
      modelingNotes: {
        zhCN: '「火属性锐化伤害无视16%防御」落到 enemyFireDefReduction（火属性防御区）：'
          + '引擎的防御区只有元素维度没有「锐化伤害」维度，锋御角色的火属性伤害即锐化伤害，'
          + '故按元素通道近似；若将来引擎补锐化专属防御区，本条改挂该通道。',
      },
    },
  },
  '34400': { // 2pc 回能 / 4pc 暴击率门槛的暴伤+失衡，击破角色全队锐化增伤
    twoPiece: [fixed('nanoka_34400_2pc_regen', 'energyRegen', 20)],
    fourPiece: {
      self: [
        fixed('nanoka_34400_4pc_critdmg', 'critDmg', 30, {
          mode: 'flat',
          requirement: { outOfCombatStat: { stat: 'critRate', min: 50 } },
          condition: '装备者暴击率 ≥ 50%（按局外面板判定，与山大王 4pc 同口径）',
        }),
        fixed('nanoka_34400_4pc_stun', 'stunBuildUpBonus', 5, {
          mode: 'flat',
          requirement: { outOfCombatStat: { stat: 'critRate', min: 50 } },
          condition: '装备者暴击率 ≥ 50%（按局外面板判定）',
        }),
      ],
      team: [
        fixed('nanoka_34400_4pc_team_sharp', 'sharpDmgBonus', 8, {
          condition: '击破位装备者发动强化特殊技/连携技后（持续25秒，默认满覆盖）',
        }),
      ],
      teamRequirement: { specialty: 'stun' },
      condition: '暴伤/失衡按装备者暴击率门槛判定；全队锐化增伤要求装备者为击破角色',
    },
  },
}

/** manifest 解析（录测试服数据必须显式 --version） */
let resolvedVersion = ''
async function zzzVersion() {
  if (resolvedVersion) return resolvedVersion
  if (explicitVersion) { resolvedVersion = explicitVersion; return resolvedVersion }
  const m = await fetchJson(`${STATIC}/manifest.json`, { timeoutMs: 20000 })
  resolvedVersion = m.zzz?.live ?? m.zzz?.latest
  return resolvedVersion
}

/** 套装索引（整份 equipment.json 存档，按版本命名；raw 只读缓存，--force 语义不需要——版本变了文件名就变） */
async function equipmentIndex() {
  const ver = await zzzVersion()
  const target = resolve(rawDir, `nanoka_equipment_${ver}.json`)
  if (existsSync(target)) return JSON.parse(readFileSync(target, 'utf8'))
  const data = await fetchJson(`${STATIC}/zzz/${ver}/equipment.json`, { timeoutMs: 30000 })
  writeFileSync(target, JSON.stringify(data, null, 2))
  console.log(`OK  data/raw/nanoka_equipment_${ver}.json (${Object.keys(data).length} 套)`)
  return data
}

/** 测试服构建里未定稿的名字是占位键（EquipmentSuit_ 前缀）⇒ 换成稳定可读标签 */
function readableName(raw, id, kind) {
  const name = String(raw ?? '').trim()
  return !name || /^(Item_|Weapon_|EquipmentSuit_)/.test(name) ? `${kind} ${id}` : name
}
function withTag(name, tag) {
  return tag ? `${name} ${tag}` : name
}

/**
 * @fact data:测试服新条目/v1占位 口径: 测试服构建（带 hash，如 3.4.1+19836465）新增的音擎与驱动盘先录成 **id/名字带 v1 后缀**的占位条目（14160→14160v1、34300→34300v1），与 beta 快照 \`<agentId>v<n>\` 同一命名纪律：正式服同 id 之后照常录入，两者并存、各自可选用、互不覆盖；名字允许是占位标签（v1 只要求「能算」不要求定稿名） | 据 用户裁决@2026-10-25 | 验 src/core/__tests__/v1TestItems.test.ts | 锚 scripts/import-nanoka-disc-set.mjs#buildEntry | 信 确认
 * ⟳复核: 正式服 3.4 上线后按同 id 重抓 14160/14166/34300/34400 并与 v1 逐项对比（名字/数值/门槛），录正式 id 后 v1 保留作历史对比 | 到期 2026-12-31
 */
function buildEntry(id, src) {
  const zh = src?.zh ?? {}
  const en = src?.en ?? {}
  const manual = MANUAL_SETS[String(id)] ?? { fourPiece: null }
  const four = manual.fourPiece
  const nameZh = withTag(readableName(zh.name, id, '驱动盘套装'), explicitTag)
  const nameEn = withTag(readableName(en.name ?? zh.name, id, 'Drive Disc Set'), explicitTag)
  return {
    id: explicitTag ? `${id}${explicitTag}` : String(id),
    name: { zhCN: nameZh, en: nameEn },
    // 测试服构建不带 icon（空串）⇒ getImageUrl 回落占位图，不发注定 404 的请求
    images: {},
    sources: [`${STATIC}/zzz/${resolvedVersion}/equipment.json`],
    ...(manual.twoPiece?.length ? { twoPiece: { effects: manual.twoPiece } } : {}),
    fourPiece: {
      effectText: {
        zhCN: String(zh.desc4 ?? ''),
        en: /^EquipmentSuit_/.test(String(en.desc4 ?? '')) ? '' : String(en.desc4 ?? ''),
      },
      selfBuff: four?.self?.length
        ? {
            scope: 'inCombat',
            ...(four.condition ? { condition: four.condition } : {}),
            ...(four.modelingNotes ? { modelingNotes: four.modelingNotes } : {}),
            effects: four.self,
          }
        : null,
      teamBuff: four?.team?.length
        ? {
            scope: 'inCombat',
            effects: four.team,
            ...(four.teamRequirement ? { requirement: four.teamRequirement } : {}),
          }
        : null,
    },
  }
}

const index = await equipmentIndex()
const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))
for (const id of ids) {
  const src = index[String(id)]
  if (!src) {
    console.error(`套装 ${id} 不在 nanoka ${resolvedVersion} 的 equipment.json 里`)
    process.exit(1)
  }
  const entry = buildEntry(id, src)
  const idx = catalog.driveDiscSets.findIndex(s => String(s.id) === entry.id)
  if (idx >= 0) {
    catalog.driveDiscSets[idx] = { ...catalog.driveDiscSets[idx], ...entry }
    console.log(`UPD  ${entry.id} ${entry.name.zhCN}`)
  } else {
    catalog.driveDiscSets.push(entry)
    console.log(`ADD  ${entry.id} ${entry.name.zhCN}`)
  }
}
if (dryRun) {
  // 打印**本次改动的条目**（不是数组尾部：已有条目的 UPD 不会移动位置）
  const touched = ids.map(id => catalog.driveDiscSets.find(s => String(s.id) === (explicitTag ? `${id}${explicitTag}` : String(id))))
  console.log(JSON.stringify(touched, null, 2))
  console.log('(dry-run：未写盘)')
  process.exit(0)
}
writeJsonCompact(catalogPath, catalog)
console.log('written', catalogPath, `(${catalog.driveDiscSets.length} 套)`)

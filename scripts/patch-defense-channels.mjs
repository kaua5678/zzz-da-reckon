#!/usr/bin/env node
/**
 * 防御**三通道**数据迁移（2026-11-09 用户裁决，可重跑/幂等）。
 *
 * 用户口径（与抗性同构）：
 * > 「减防是不是也分直伤和异常和通用？」
 *
 * 修前原文「**造成的伤害**无视 N% 防御」（自身）一律写进 `enemyDefReduction` 族，
 * 而该族被直伤与异常**同时**读取 ⇒ 只作用于直伤的无视防御被异常也吃掉。
 * 与抗性同理：两族在 `defenseMultiplierDetail` 里同形（有效防御 = 基础 × (1 − 降低/100)），
 * 合并写法**静默通过全部既有测试**。
 *
 * 本脚本把「自身造成伤害无视防御」类 stat 迁到 `enemy{El?}DefIgnoreDirect`（直伤族）：
 * - teammate-buffs.json；catalog.json 的 wEngine selfBuff / teamBuff
 *
 * **保留不迁**（原文是「**使目标**的防御力降低」= 怪物身上结算区 debuff，直伤与异常都吃）：
 *   妮可 40 / 青衣 15 / 千夏 7 / 音擎 14136 索魂影眸 25
 *
 * **迁到直伤族**（原文「造成的伤害无视」/「攻击造成…无视」/「造成属性伤害时无视」）：
 *   奥菲丝 25 / 席德 20 / 希希芙 电6 / 音擎 14129·14130·14146 / 14152
 *
 * 异常专属 / 强击专属两族（`enemyAnomalyDefReduction` / `enemyAssaultDefReduction`）已存在且
 * 语义本就正确，本脚本**只看**通用族，不碰它们。
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const DRY = process.argv.includes('--dry')

/**
 * 「自身造成伤害无视防御」文本判据：命中即迁直伤族。
 *
 * ⚠ 百分比常写成**精炼阶梯**（`无视25%/28.75%/32.5%/36.25%/40%防御力`），只匹第一个数字会让
 * 「%」后面紧跟「/」而不是「防御」⇒ 漏判（实测 14129 千面日陨 / 14152 鳞齿寻踪 两条被静默跳过）。
 * 所以数字后允许 `(/数字%)*` 的阶梯尾巴。
 */
const PCT_LADDER = '\\d+(?:\\.\\d+)?%(?:/\\d+(?:\\.\\d+)?%)*'
/**
 * ★ 主语判据（用户 2026-11-09 二次裁决，与抗性同构）：
 * 只有主语是**攻击 / 招式 / 造成的伤害**才是直伤专属；主语是**角色**的裸「无视防御」是
 * **通用无视**（直伤与异常都吃）⇒ 留在 `enemyDefReduction` 族。
 *
 * 修前含 `|无视(?:目标|敌人|其)?…防御` 的**裸分支**，把「[零度处刑宣言]期间，**角色**命中敌人时
 * 无视 25% 防御力」（14129 千面日陨）误迁进直伤族（已改回）。
 * 现判据要求「主语词 + ≤8 字符（不含标点）+ 无视」紧邻。
 */
const SELF_IGNORE_RE = new RegExp(
  '(造成的伤害[^。；，\\n]{0,8}无视'
  + '|造成伤害[^。；，\\n]{0,8}无视'
  + '|攻击[^。；，\\n]{0,10}无视'
  + '|招式[^。；，\\n]{0,10}无视'
  + '|\\][^。；，\\n]{0,4}无视)',
)
/** 「使目标防御降低」文本判据：命中即**留在**通用族（先判这条，避免误迁） */
const ENEMY_REDUCE_RE = /(使(?:目标|敌人|其)[^。；\n]{0,24}防御(?:力)?降低|目标的?[^。；\n]{0,24}防御(?:力)?降低)/
/** 异常专属 / 强击专属：另有专用字段，本脚本不碰 */
const OTHER_FAMILY_RE = /^(?:enemy(?:Anomaly|Assault)|enemy(?:Physical|Fire|Ice|Electric|Ether|Wind)(?:Anomaly|Assault))DefReduction$/

const fam = stat => {
  const base = String(stat).split('__')[0]
  const m = /^enemy(?:(Physical|Fire|Ice|Electric|Ether|Wind))?DefReduction$/.exec(base)
  return m ? { element: m[1] ?? '' } : null
}
const toDirect = stat => String(stat).replace(/DefReduction(?=$|__)/, 'DefIgnoreDirect')

/** 判定：'keep' | 'direct' */
function classify(text, stat) {
  if (OTHER_FAMILY_RE.test(String(stat).split('__')[0])) return 'keep'
  if (!fam(stat)) return 'keep'
  const t = String(text ?? '')
  if (ENEMY_REDUCE_RE.test(t)) return 'keep'
  if (SELF_IGNORE_RE.test(t)) return 'direct'
  return 'keep'
}

const changes = []

// ---- 1. teammate-buffs.json ----
const tbPath = join(root, 'public', 'static', 'teammate-buffs.json')
const tb = JSON.parse(readFileSync(tbPath, 'utf8'))
for (const group of tb) {
  for (const buff of group.buffs ?? []) {
    const text = [buff.description?.zhCN, buff.name?.zhCN, buff.conditionLabel?.zhCN].filter(Boolean).join(' ')
    for (const eff of buff.effects ?? []) {
      if (classify(text, eff.stat) !== 'direct') continue
      const next = toDirect(eff.stat)
      if (next === eff.stat) continue
      changes.push({ file: 'teammate-buffs', id: `${group.id}/${buff.id}/${eff.id}`, from: eff.stat, to: next })
      eff.stat = next
    }
  }
}

// ---- 2. catalog.json：wEngine selfBuff / teamBuff ----
const catPath = join(root, 'public', 'static', 'catalog.json')
const catalog = JSON.parse(readFileSync(catPath, 'utf8'))
for (const w of catalog.wEngines ?? []) {
  const buffs = [w.effect?.selfBuff, w.effect?.teamBuff].filter(Boolean)
  for (const buff of buffs) {
    const text = [buff.description?.zhCN, w.effect?.description?.zhCN].filter(Boolean).join(' ')
    for (const eff of buff.effects ?? []) {
      if (classify(text, eff.stat) !== 'direct') continue
      const next = toDirect(eff.stat)
      if (next === eff.stat) continue
      changes.push({ file: 'catalog:wEngine', id: `${w.id}/${eff.id}`, from: eff.stat, to: next })
      eff.stat = next
    }
  }
}

// ---- 3. spec teamBuffs（src/specs/agents/*.json，2 空格缩进 + 尾换行）----
const specDir = join(root, 'src', 'specs', 'agents')
for (const file of readdirSync(specDir).filter(f => f.endsWith('.json')).sort()) {
  const p = join(specDir, file)
  const spec = JSON.parse(readFileSync(p, 'utf8'))
  let touched = false
  for (const buff of spec.teamBuffs ?? []) {
    const text = [buff.description, buff.name, buff.note].filter(Boolean).join(' ')
    for (const eff of buff.effects ?? []) {
      if (classify(text, eff.stat) !== 'direct') continue
      const next = toDirect(eff.stat)
      if (next === eff.stat) continue
      changes.push({ file, id: `${spec.id}/${buff.id}`, from: eff.stat, to: next })
      eff.stat = next
      touched = true
    }
  }
  if (touched && !DRY) writeFileSync(p, JSON.stringify(spec, null, 2) + '\n')
}

if (!DRY) {
  writeFileSync(tbPath, JSON.stringify(tb) + '\n')
  writeFileSync(catPath, JSON.stringify(catalog))
}

console.log(`${DRY ? '[dry-run] ' : ''}共 ${changes.length} 条防御迁移`)
for (const c of changes) console.log(`  direct  ${c.file} ${c.id}: ${c.from} → ${c.to}`)

#!/usr/bin/env node
/**
 * 抗性**三通道**数据迁移（2026-11-09 用户裁决，可重跑/幂等）。
 *
 * 用户口径：
 * > 「减抗的实现分为两种，一个是降低怪物的抗性…直伤和异常都能吃。还有一种是加自己的无视抗性，
 * >   这种抗性只有自己直伤能无视，所谓（造成伤害无视抗性），这种抗性没有降低 boss 身上的乘区，
 * >   所以异常状态吃不到这种减抗。」
 *
 * 修前全仓把三类文本一律写进 `enemyResReduction` 族，而该族被直伤与异常**同时**读取
 * ⇒ 「造成伤害无视 X% 抗性」（游戏里只作用于直伤）被异常白吃，异常伤害系统性偏高。
 *
 * 本脚本把「自身造成伤害无视」类 stat 迁到 `enemy{El?}ResIgnoreDirect`（直伤族）：
 * - teammate-buffs.json：按 description 文本判定
 * - spec teamBuffs（src/specs/agents/*.json）：按 description 文本判定
 * - catalog.json：wEngine.selfBuff.effects / driveDiscSets（按 wEngine 描述文本判定）
 *
 * **保留不迁**（原文是「使敌人的抗性降低」= 怪物身上结算区 debuff，直伤与异常都吃）：
 *   南宫羽18 / 柚叶10 / 耀嘉音18 / 苍角10 / 莱特15+10 / 莱卡恩25 / 青衣20 / 凯撒15 / 诺姆15
 *   / 洛克茜C1 15 / 般岳C1 10 / 可琳C2 10 / 格莉丝C2 8.5 / 塞斯积蓄抗性20 / 丽娜电抗
 *
 * **迁到直伤族**（原文「造成伤害无视」/「攻击命中无视」/「自身…无视」）：
 *   琉音C1 15 / 照C1 15 / 希希芙C1 5 / 卢西娅C1 18 / 知更鸟C2 15 / 猫又C1 16 / 浅羽C4 25
 *   / 零号安比C4 12 / 克拉蕾C2 18 / 艾莲潜能 10 / 雅额外能力 30 / 赛维里安C1 15 / 星徽比利C1 18
 *   / 挽昼C1 15 / 真斗C2 8 / 维琳娜C1 20 / 仪玄C2 15 / 席德额外能力 25 / 柏妮思C6 25
 *   / 专武 14159 / 14162 / 14163 / 14132 / 14155 / 14143 / 14157
 *
 * **迁到异常族**（原文「造成属性异常/紊乱伤害时无视」）：
 *   普罗米娅C6 15 / 菲欧妮C6 15 / 薇薇安C2 15（异放限定，走 releaseModifier 通道）
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const DRY = process.argv.includes('--dry')

/**
 * 「自身造成伤害无视抗性」文本判据：命中即迁直伤族。
 *
 * ⚠ **主语判据（用户 2026-11-09 二次裁决）**：
 * > 「菲欧妮他说无视抗性，应该是通用无视抗性，可以给异常吃。造成攻击无视才算直伤无视抗性。」
 * ⇒ 只有主语是**攻击 / 招式 / 造成的伤害**才是直伤专属；主语是**角色**的裸「无视抗性」是
 * **通用无视**（形态与怪物减抗相同，直伤与异常都吃）⇒ 留在 `enemyResReduction` 族。
 *
 * 修前本正则含 `自身…无视` / `无视(?:目标|敌人)…` 两条**裸分支**，把 6 条角色主语的条目误迁：
 * 菲欧妮 C6 / 琉音 C1 / 爱丽丝 C4 / 零号·安比 C4 / 猫又 C1 / 真斗 C2（已逐条改回通用族）。
 * 现判据要求「主语词 + ≤6 字符（不含标点）+ 无视」紧邻，于是
 * `攻击命中敌人时，猫又无视…` 这类**逗号断开**的角色主语句不会被误判。
 */
const SELF_IGNORE_RE = /(?:造成的伤害|造成伤害|攻击|招式)[^。；，\n]{0,6}无视/
/** 「使敌人抗性降低」文本判据：命中即**留在**通用族（先判这条，避免误迁） */
const ENEMY_REDUCE_RE = /(使敌人的?[^。；\n]{0,24}抗性降低|目标的?[^。；\n]{0,24}抗性降低|[^。；\n]{0,16}抗性降低\s*\d)/

const fam = stat => {
  const m = /^enemy(?:(Physical|Fire|Ice|Electric|Ether|Wind))?((?:Anomaly|Stun)?)Res(?:Reduction|Ignore)(?=$|__)/.exec(stat)
  return m ? { element: m[1] ?? '', kind: m[2] } : null
}
const toDirect = stat => stat.replace(/Res(Reduction|Ignore)(?=$|__)/, 'ResIgnoreDirect')
const toAnomaly = stat => stat.replace(/Res(Reduction|Ignore)(?=$|__)/, 'ResIgnoreAnomaly')

/** 判定一条效果的通道：'keep' | 'direct' | 'anomaly' */
function classify(text, stat) {
  const f = fam(stat)
  if (!f) return 'keep'
  if (f.kind) return 'keep' // 失衡抗性 / 积蓄抗性另一套机制
  const t = String(text ?? '')
  // 异常专属：「造成属性异常伤害时无视」「紊乱伤害…无视」「异放…无视」
  if (/造成[^。；\n]{0,12}异常[^。；\n]{0,12}无视|紊乱[^。；\n]{0,16}无视|异放[^。；\n]{0,16}无视|异常伤害[^。；\n]{0,16}无视/.test(t)) return 'anomaly'
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
      const verdict = classify(text, eff.stat)
      if (verdict === 'keep') continue
      const next = verdict === 'direct' ? toDirect(eff.stat) : toAnomaly(eff.stat)
      if (next === eff.stat) continue
      changes.push({ file: 'teammate-buffs', id: `${group.id}/${buff.id}/${eff.id}`, from: eff.stat, to: next, verdict })
      eff.stat = next
    }
  }
}

// ---- 2. spec teamBuffs ----
const specDir = join(root, 'src', 'specs', 'agents')
for (const file of readdirSync(specDir).filter(f => f.endsWith('.json'))) {
  const p = join(specDir, file)
  const raw = readFileSync(p, 'utf8')
  const spec = JSON.parse(raw)
  let touched = false
  for (const buff of spec.teamBuffs ?? []) {
    const text = [buff.description, buff.name, buff.note].filter(Boolean).join(' ')
    for (const eff of buff.effects ?? []) {
      const verdict = classify(text, eff.stat)
      if (verdict === 'keep') continue
      const next = verdict === 'direct' ? toDirect(eff.stat) : toAnomaly(eff.stat)
      if (next === eff.stat) continue
      changes.push({ file, id: `${spec.id}/${buff.id}/${eff.id}`, from: eff.stat, to: next, verdict })
      eff.stat = next
      touched = true
    }
  }
  if (touched && !DRY) writeFileSync(p, JSON.stringify(spec, null, 2) + '\n')
}

// ---- 3. catalog.json：wEngine selfBuff ----
const catPath = join(root, 'public', 'static', 'catalog.json')
const catalog = JSON.parse(readFileSync(catPath, 'utf8'))
for (const w of catalog.wEngines ?? []) {
  const buffs = [w.effect?.selfBuff, w.effect?.teamBuff].filter(Boolean)
  for (const buff of buffs) {
    const text = [buff.description?.zhCN, w.effect?.description?.zhCN].filter(Boolean).join(' ')
    for (const eff of buff.effects ?? []) {
      const verdict = classify(text, eff.stat)
      if (verdict === 'keep') continue
      const next = verdict === 'direct' ? toDirect(eff.stat) : toAnomaly(eff.stat)
      if (next === eff.stat) continue
      changes.push({ file: 'catalog:wEngine', id: `${w.id}/${eff.id}`, from: eff.stat, to: next, verdict })
      eff.stat = next
    }
  }
}

if (!DRY) {
  writeFileSync(tbPath, JSON.stringify(tb) + '\n')
  writeFileSync(catPath, JSON.stringify(catalog))
}

console.log(`${DRY ? '[dry-run] ' : ''}共 ${changes.length} 条迁移`)
for (const c of changes) console.log(`  ${c.verdict.padEnd(7)} ${c.file} ${c.id}: ${c.from} → ${c.to}`)

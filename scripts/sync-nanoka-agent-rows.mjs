#!/usr/bin/env node
/* 【热更增量同步】按 nanoka 新包 raw 刷新**已录入角色**的招式数值行——不重建切片。
 *
 * 为什么需要它（2026-10-30，随 3.4.1+19997538 热更立）：
 * `import-nanoka-beta-agent.mjs --force` 是**整片重建**：它只认 raw 能推出来的东西，于是会抹掉
 * 录入期补上去的产物——招式中文/英文名（新包 en/中文名常是占位或截断）、gachabase 补列
 * （gash_buildup / sharpness_gain）、level60 的淬锋补充字段（sharpCritDmg / sharpnessRegen）。
 * 实测：对 1601 整片重建一次，上述四类全部丢失。热更（同版本内的数值微调）不该付这个代价。
 *
 * 所以本脚本只做一件事：**把 raw 里能推出来的 6 类数值行刷成新包的值**，其余一律不动。
 * 它与导入器共用同一份派生口径（`scripts/lib/nanoka-move-rows.mjs`，单一事实源），
 * 因此不存在「两套算法算同一个数」的问题。
 *
 * 用法：node scripts/sync-nanoka-agent-rows.mjs <agentId>... [--write]
 * 前置：`data/raw/nanoka_missing/full/<id>.json` 已是新包（抓取走 fetch-nanoka-full-missing.mjs）。
 *
 * 明确不做（每条都是破坏性动作，交给人或走导入路径）：
 * - 不新增 catalog 没有的招式 id（结构/名字/分类要人判断）——报告里点名；
 * - **默认不删** catalog 有、raw 没有的招式行——报告里点名；`--drop-missing` 才删（逐条打印）。
 *   2026-10-30 唯一用例：1661018「支援突击：角力突击」在新包被并进 1661017（用户裁决
 *   「可能只是对应id变了」）——留着会对不上游戏，故显式删；
 * - 不改招式名 / level60 / faction / 非 6 类数值行（gash、sharpness、attack_data…）。
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeJsonCompact } from './lib/jsonio.mjs'
import { actionTime, collectMoveRows } from './lib/nanoka-move-rows.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const write = args.includes('--write')
const ids = args.filter(a => !a.startsWith('--'))
if (ids.length === 0) {
  console.error('用法: node scripts/sync-nanoka-agent-rows.mjs <agentId>... [--write]')
  process.exit(1)
}

/**
 * 暂缓表（2026-10-30 随 3.4.1+19997538 热更立）：两源（nanoka + gachabase）**一致**但
 * **量级/语义不自洽**的增量——先不落 catalog，等下一版构建到手逐条判「真改还是占位」。
 * 每条点名到「招式 id + 行 id」，理由写在同一条里；确认是可发布口径后从表里删行即可放行。
 * （"两源一致"只证明两个抓取面读到了同一份客户端数据，**不证明那份客户端数据是成品**。）
 *
 * **2026-10-30 当天立、当天撤**——暂缓的两类后来都判为真值：
 * - **1661017 反制支援**：不是量级异常，是**反制支援的秽盾定点基数 300 漏了**。按
 *   (678.37−300)/100 = 3.7837s 代入反制支援标准式（支援突击基线 + 20 等效能量）后，
 *   失衡/喧响/积蓄三列比值 1.0002 / 1.0005 / 1.0000、伤害列 1.2729 = 她自己的直伤系数
 *   （1661016 支援突击同值 1.2723）。基数 300 已进 `lib/type-bonus-time.mjs#counterAssistEtherBase`。
 * - **1661005 / 1661006 / 1661019 的 decibel·ether 归零**：用户 2026-10-30 裁决「按新的来吧，
 *   估计也是一些后台招式」——它们是自动触发的招式，不占前台时间、不产喧响与秽盾。
 */
const HOLD_DELTAS = {}
const holdOn = !args.includes('--no-hold')
const heldRows = (moveId) => (holdOn ? HOLD_DELTAS[moveId]?.rows ?? [] : [])
/** `--drop-missing`：新包已无的 id 真的从 catalog 删掉（默认只报告） */
const dropMissing = args.includes('--drop-missing')

const catalogPath = resolve(root, 'public/static/catalog.json')
const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))
const round = (v, n) => Math.round(v * 10 ** n) / 10 ** n

/**
 * 6 类数值行的口径：kind + 行 id + 派生值换算 + 建行时的额外字段。
 * ⚠ `emit` 决定「值 > 0 才建行」——与导入器一致；值为 0 时**删掉已有行**（新包归零 = 真实归零，
 *   两源（nanoka/gachabase）对账一致才这么处理，见 spec notes 的复核条目）。
 */
const ROW_SPECS = [
  { key: 'damage', rowId: 'damage', kind: 'damageMultiplier', scale: (v, m) => round(v, 3), extra: m => ({ damageBasis: 'atk', damageElement: m.damageElement }) },
  { key: 'daze', rowId: 'daze', kind: 'dazeMultiplier', scale: v => round(v, 3), extra: () => ({}) },
  { key: 'energy', rowId: 'energy_recovery', kind: 'energy', scale: v => round(v, 4), extra: () => ({}) },
  { key: 'decibel', rowId: 'decibel_recovery', kind: 'decibel', scale: v => round(v, 4), extra: () => ({}) },
  { key: 'anomaly', rowId: 'anomaly_buildup', kind: 'anomaly', scale: v => round(v, 3), extra: m => ({ damageElement: m.damageElement }) },
  { key: 'ether', rowId: 'ether_purify', kind: 'etherPurify', scale: v => round(v / 100, 3), extra: () => ({}) },
]

let changedFiles = false
for (const id of ids) {
  const rawPath = resolve(root, 'data/raw/nanoka_missing/full', `${id}.json`)
  const raw = JSON.parse(readFileSync(rawPath, 'utf8'))
  const slice = catalog.agentSkills.find(s => String(s.agentId) === id)
  if (!slice) {
    console.error(`[sync] catalog 里没有角色 ${id} 的招式切片（新角色走 import-nanoka-beta-agent.mjs）`)
    continue
  }
  const derived = collectMoveRows(raw, id)
  const current = new Map()
  for (const cat of slice.categories) for (const m of cat.moves) current.set(m.id, m)

  const diffs = []
  const missingInCatalog = []
  const heldHit = []
  for (const [moveId, m] of current) {
    const d = derived.get(moveId)
    if (!d) { missingInCatalog.push(moveId); continue }
    const held = heldRows(moveId)
    for (const spec of ROW_SPECS) {
      if (held.includes(spec.rowId)) { heldHit.push(`${moveId} ${spec.rowId}`); continue }
      const next = spec.scale(d[spec.key], m)
      const row = m.rows.find(r => r.id === spec.rowId)
      const prev = row ? row.values[0] : undefined
      if (next > 0) {
        if (!row) {
          m.rows.push({ id: spec.rowId, kind: spec.kind, values: [next], ...spec.extra(m) })
          diffs.push(`${moveId} ${spec.rowId}: （无行） → ${prev ?? '—'} ${next}`)
        } else if (prev !== next) {
          const from = prev
          row.values[0] = next
          diffs.push(`${moveId} ${spec.rowId}: ${from} → ${next}`)
        }
      } else if (row) {
        m.rows = m.rows.filter(r => r.id !== spec.rowId)
        diffs.push(`${moveId} ${spec.rowId}: ${prev} → 删除（新包归零）`)
      }
    }
    // 反制支援系先扣定点基数 300；传 moveId 供专属追击段（1611030 琢形）定点识别
    const nextTime = held.includes('actionTime') ? m.actionTime : actionTime(d.ether, m.name?.zhCN ?? '', m.id)
    if (m.actionTime !== nextTime) {
      diffs.push(`${moveId} actionTime: ${m.actionTime} → ${nextTime}`)
      m.actionTime = nextTime
    }
    if (d.energyCost) {
      const prevCost = Number(m.energyCost?.['Energy Cost'] ?? NaN)
      if (prevCost !== d.energyCost) {
        diffs.push(`${moveId} energyCost: ${Number.isFinite(prevCost) ? prevCost : '（无）'} → ${d.energyCost}`)
        m.energyCost = { 'Energy Cost': String(d.energyCost) }
      }
    }
  }
  const newInRaw = [...derived.keys()].filter(k => !current.has(k))
  console.log(`\n=== ${id}：${diffs.length} 处数值变化（raw ${rawPath.replace(root + '/', '')}） ===`)
  for (const line of diffs) console.log('  ' + line)
  if (newInRaw.length) console.log(`  ⚠ 新包有、catalog 无的招式 id（不自动新增，走 import 路径或人工录入）: ${newInRaw.join(', ')}`)
  if (missingInCatalog.length && !dropMissing) {
    console.log(`  ⚠ 新包已无、catalog 仍保留的招式 id（未删除，请人判断；--drop-missing 才删）: ${missingInCatalog.join(', ')}`)
  }
  if (missingInCatalog.length && dropMissing) {
    for (const moveId of missingInCatalog) {
      for (const cat of slice.categories) {
        const i = cat.moves.findIndex(x => x.id === moveId)
        if (i >= 0) {
          console.log(`  删除 ${moveId} ${cat.moves[i].name?.zhCN ?? ''}（新包已无此 id，--drop-missing）`)
          cat.moves.splice(i, 1)
          changedFiles = true
        }
      }
    }
  }
  for (const moveId of new Set(heldHit.map(h => h.split(' ')[0]))) {
    console.log(`  ⏸ 暂缓（未落盘）：${moveId} —— ${HOLD_DELTAS[moveId].reason}`)
  }
  if (diffs.length) changedFiles = true
}

if (write && changedFiles) {
  writeJsonCompact(catalogPath, catalog)
  console.log('\n已写入 catalog.json（紧凑）')
} else if (write) {
  console.log('\n无变化，未写盘')
} else {
  console.log('\ndry-run（--write 生效）')
}

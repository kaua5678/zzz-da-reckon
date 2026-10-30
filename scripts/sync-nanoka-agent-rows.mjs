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
 * - 不删除 catalog 有、raw 没有的招式行——报告里点名；
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
 * ⟳复核: 下一版 nanoka 构建到手时逐条判「真改还是占位」——1661017 若仍是 1087.4% 失衡且
 *   ether 仍 67837（⇒ 动作时间 6.784s）则按真改录入；1661005/1661006/1661019 的 decibel/ether
 *   归零若仍在，则确认「追加攻击不再产喧响/秽盾」并同步改 spec 口径 | 到期 2026-11-30
 */
const HOLD_DELTAS = {
  1661017: { rows: ['damage', 'daze', 'decibel_recovery', 'anomaly_buildup', 'ether_purify', 'actionTime'], reason: '量级异常：失衡 71→1087.4%、ether 42.49→678.37 ⇒ 动作时间 0.425→6.784s（一次反制支援不合理）' },
  1661005: { rows: ['decibel_recovery', 'ether_purify', 'actionTime'], reason: 'decibel/ether 归零 ⇒ 动作时间 0.55→0：等于「追加攻击不再产喧响与秽盾」，与同队 1661011 同类行不自洽' },
  1661006: { rows: ['decibel_recovery', 'ether_purify', 'actionTime'], reason: '同 1661005（强化追加攻击）' },
  1661019: { rows: ['decibel_recovery', 'anomaly_buildup', 'ether_purify', 'actionTime'], reason: '同 1661005（伤害 660→318.5 / 失衡 286.4→94.4 仍照录，只暂缓归零那三项）' },
}
const holdOn = !args.includes('--no-hold')
const heldRows = (moveId) => (holdOn ? HOLD_DELTAS[moveId]?.rows ?? [] : [])

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
    const nextTime = held.includes('actionTime') ? m.actionTime : actionTime(d.ether, m.name?.zhCN ?? '')
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
  if (missingInCatalog.length) console.log(`  ⚠ 新包已无、catalog 仍保留的招式 id（未删除，请人判断）: ${missingInCatalog.join(', ')}`)
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

/**
 * 招式伤害属性「对账器」——判据 18 的逻辑落点（**单一事实源**，规则 11）。
 *
 * 为什么要有本模块（2026-09-18 round 26 R25-J1）：
 * 判据 18 首版由外部协作者**内联**在 `check-guards.mjs` 里（`auditMoveElementsAgainstRaw`，~60 行）。
 * 三处缺陷经 R24/R25/R26 三轮独立实测确认，且 **`check-guards.mjs` 已 2250 行**（远超 1500 行熵阈，
 * `zc status` 点名）⇒ 逻辑抽到这里，`check-guards.mjs` 侧只留一行调用。
 *
 * ⚠ **接线状态（下一任必读）**：本模块**已实现并自测，但尚未接进 `check-guards.mjs`**——
 * 因为该文件在 2026-09-18 傍晚仍是一份**外部协作者的未提交 WIP**（规则 13：不许替它提交、
 * 也不许 revert 它）。接线 = 把 `check-guards.mjs` 的 `auditMoveElementsAgainstRaw` 改成
 * 调用本模块的 `reconcileMoveElements`（约 3 行）。**在那之前本模块零运行时效应**。
 *
 * ---------------------------------------------------------------------------
 * ★ 三处已实测缺陷 → 本模块的对应处置（每条都能被注入证伪，见
 *   `src/scripts/__tests__/moveElementReconcile.test.ts`）
 *
 * ① **无「反空洞」下限**：首版 `if (!resolved || resolved.size === 0) continue`
 *    ⇒ 解析器静默返回空就**整角色跳过、0 条不红**（实测：少 1 个角色 raw 就静默少对账 12 招）。
 *    处置：拆成两个独立信号——`skippedAgents`（逐角色：raw 在、catalog 在、却一条都没解析出来）
 *    与 `scannedMoves` 的**全局下限**（防「全体退化成 0」这种更极端的空洞）。
 *    同族先例：判据 10/13 都有下限（`NOUN_SOURCE_MIN_KEYS`）。
 * ② **行级红读数误导 + `undefined` 漏检**：首版 `new Set(rows.map(x => x.damageElement).filter(Boolean))`
 *    ⇒ row 字段被删成 `undefined` 时**看不见**（被 filter(Boolean) 吃掉）；且行级红时打印的是
 *    `move.damageElement`，输出成 `wind → 应为 wind` 这种自相矛盾的读数。
 *    处置：`undefined` 单独成类（`row-undefined`），且行级违规**打印该行自己的值**（`got` 取行面）。
 * ③ **无 orphan 检查**：解析器输出 catalog 里不存在的 moveId（两侧 id 体系漂移）不报。
 *    处置：`orphans` 显式收集。
 *
 * ---------------------------------------------------------------------------
 * ★ 设计纪律（沿用 `move-elements.mjs` 的同一条）：**只在有正面证据时输出**。
 * 本模块只做「拿解析结果 ↔ catalog 实际值对账」，**不产出新属性、不猜**；
 * 解析器没证据的 move 原样放过（那不是违规，是已知近似的既定边界）。
 *
 * ⚠ **floor 只在真实仓库根生效**（`enforceFloors` 默认 `true`，调用方传 `false` 即可关）。
 * 理由与判据 13 同款：测试会拿合成/临时目录构造小样本，若下限量对它们也生效，
 * 构造「注入退化 ⇒ 判红」的用例就会被地板本身干扰（噪音）。
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { ELEMENT_ROW_KINDS, resolveMoveElements } from './move-elements.mjs'

/**
 * 全局「反空洞」下限：真实仓库根上必须至少对账这么多招。
 *
 * 实测（2026-09-18 round 26，`data/raw/nanoka_missing/full` 64 个文件 / catalog 62 角色）：
 * **`scannedMoves` = 1049**、`reconciledAgents` = 62、violations / skippedAgents / orphans 全 0。
 * （与首版判据自报的「1049/1049 招达标」**逐位吻合** ⇒ 两种口径同源，差异只是首版没把它做成下限。）
 *
 * 下限取 1000（实测 1049 的 ~95%）：目的是拦「解析器整体失效 / raw 大面积丢失」这类**灾难性空洞**，
 * 不是拦正常的数据增删（逐角色空洞由 `skippedAgents` 精确拦，那条是 **0 容忍**）。
 * ⚠ 下调本常量必须在提交说明里写明理由（同 `NOUN_SOURCE_MIN_KEYS` 纪律）。
 */
export const MOVE_ELEMENT_MIN_SCANNED = 1000

/** 行级属性字段名（catalog move.rows[] 上承载属性的字段） */
const ROW_ELEMENT_FIELD = 'damageElement'

/**
 * 对账「catalog 的招式属性」↔「nanoka raw 散文解析结果」。
 *
 * @param {object} opts
 * @param {object} opts.catalog         已解析的 `public/static/catalog.json`
 * @param {string} opts.fullDir         `data/raw/nanoka_missing/full` 目录
 * @param {boolean} [opts.enforceFloors=true] 是否启用 `MOVE_ELEMENT_MIN_SCANNED` 下限
 * @returns {{
 *   rawFiles: number, catalogAgents: number, reconciledAgents: number,
 *   scannedMoves: number, violations: object[], skippedAgents: object[],
 *   orphans: object[], belowFloor: boolean, minScannedMoves: number,
 * }}
 */
export function reconcileMoveElements({ catalog, fullDir, enforceFloors = true }) {
  const skills = new Map((catalog?.agentSkills ?? []).map((s) => [String(s.agentId), s]))
  const agents = new Map((catalog?.agents ?? []).map((a) => [String(a.id), a]))
  const violations = []
  const skippedAgents = []
  const orphans = []
  let scannedMoves = 0
  let reconciledAgents = 0
  let rawFiles = 0

  const files = existsSync(fullDir) ? readdirSync(fullDir).filter((f) => f.endsWith('.json')).sort() : []
  rawFiles = files.length

  for (const file of files) {
    const id = file.slice(0, -5)
    const sk = skills.get(id)
    const ag = agents.get(id)
    // raw 有、catalog 没有 ⇒ 不是本判据的面（角色尚未录入），跳过且不记账
    if (!sk || !ag) continue

    let full
    try {
      full = JSON.parse(readFileSync(join(fullDir, file), 'utf8'))
    } catch {
      skippedAgents.push({ agentId: id, agentName: ag.name?.zhCN ?? id, reason: 'raw 解析失败（JSON 读不动）' })
      continue
    }

    const moveIds = (sk.categories ?? []).flatMap((c) => (c.moves ?? []).map((m) => String(m.id)))
    const resolved = resolveMoveElements(full, moveIds)

    // ★ 缺陷 ①：解析器返回空**不再静默 continue**——逐角色上报（0 容忍）
    if (!resolved || resolved.size === 0) {
      skippedAgents.push({
        agentId: id,
        agentName: ag.name?.zhCN ?? id,
        reason: `raw 在、catalog 有 ${moveIds.length} 招，但解析器一条都没解析出来（解析器静默失效 / raw 少角色 / 散文格式漂移）`,
      })
      continue
    }
    reconciledAgents++

    // ★ 缺陷 ③：解析器输出的 moveId 不在 catalog 里 ⇒ 两侧 id 体系漂移，显式上报
    const catalogMoveIds = new Set(moveIds)
    for (const moveId of resolved.keys()) {
      if (!catalogMoveIds.has(String(moveId))) orphans.push({ agentId: id, moveId: String(moveId) })
    }

    for (const cat of sk.categories ?? []) {
      for (const move of cat.moves ?? []) {
        const r = resolved.get(String(move.id))
        if (!r) continue
        scannedMoves++

        const rows = (move.rows ?? []).filter((x) => ELEMENT_ROW_KINDS.has(x.kind))

        // ★ 缺陷 ②：逐行判定，`undefined` 与「值不对」分开归类（不再 filter(Boolean) 吃掉）
        const badRows = rows
          .map((x) => ({ kind: x.kind, got: x[ROW_ELEMENT_FIELD] }))
          .filter((x) => x.got !== r.element)

        const moveChanged = move.damageElement !== r.element
        if (!moveChanged && badRows.length === 0) continue

        // 行级违规时 `got` 取**行自己的值**（首版取 move 面 ⇒ 打印成「wind → 应为 wind」自相矛盾）
        const undefinedRows = badRows.filter((x) => x.got === undefined)
        const wrongRows = badRows.filter((x) => x.got !== undefined)
        violations.push({
          agentId: id,
          agentName: ag.name?.zhCN ?? id,
          moveId: String(move.id),
          moveName: move.name?.zhCN ?? '',
          got: moveChanged ? move.damageElement : (undefinedRows[0]?.got ?? wrongRows[0]?.got),
          want: r.element,
          source: r.source,
          moveChanged,
          rowChanged: wrongRows.length > 0,
          rowUndefined: undefinedRows.length,
          rowWrong: wrongRows.length,
        })
      }
    }
  }

  const belowFloor = enforceFloors && scannedMoves < MOVE_ELEMENT_MIN_SCANNED
  return {
    rawFiles,
    catalogAgents: agents.size,
    reconciledAgents,
    scannedMoves,
    violations,
    skippedAgents,
    orphans,
    belowFloor,
    minScannedMoves: MOVE_ELEMENT_MIN_SCANNED,
  }
}

/** 对账结果 → 是否通过（`check-guards.mjs` 侧一行接线的判据面） */
export function moveElementReconcileOk(report) {
  return report.violations.length === 0
    && report.skippedAgents.length === 0
    && report.orphans.length === 0
    && !report.belowFloor
}

/** 对账结果 → 人类可读的多行 detail（`check-guards.mjs` 的 detail 数组直接用） */
export function formatMoveElementReconcile(report, limit = 15) {
  const lines = []
  lines.push(...report.violations.slice(0, limit).map((v) => {
    const bits = []
    if (v.moveChanged) bits.push(`move.damageElement ${v.got} → 应为 ${v.want}`)
    if (v.rowWrong) bits.push(`${v.rowWrong} 行属性错（首行 ${v.got} → 应为 ${v.want}）`)
    if (v.rowUndefined) bits.push(`${v.rowUndefined} 行属性字段缺失（undefined → 应为 ${v.want}）`)
    return `  ✗ ${v.agentId} ${v.agentName} move ${v.moveId} (${v.moveName}): ${bits.join('；')}（来源: ${v.source}）`
  }))
  if (report.violations.length > limit) lines.push(`  …另有 ${report.violations.length - limit} 条`)
  for (const s of report.skippedAgents) {
    lines.push(`  ✗ 空洞 ${s.agentId} ${s.agentName}: ${s.reason}`)
  }
  for (const o of report.orphans) {
    lines.push(`  ✗ orphan ${o.agentId}: 解析器输出 moveId ${o.moveId}，但 catalog 无此招（两侧 id 体系漂移）`)
  }
  if (report.belowFloor) {
    lines.push(`  ✗ 反空洞下限：仅对账 ${report.scannedMoves} 招 < 冻结下限 ${report.minScannedMoves}`)
    lines.push('     → raw 是属性的事实面，覆盖率不该塌陷；确需下调先改 MOVE_ELEMENT_MIN_SCANNED 并写明理由')
  }
  lines.push(...[
    '  → 修：node scripts/patch-move-elements.mjs --write',
    '  → 口径事实源：scripts/lib/move-elements.mjs（按原文 desc 散文 + 段序号解析）',
    '  → 对账逻辑：scripts/lib/move-element-reconcile.mjs（判据 18 的落点）',
  ])
  return lines
}

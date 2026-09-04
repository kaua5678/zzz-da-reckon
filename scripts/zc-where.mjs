#!/usr/bin/env node
// zc ctx —— 文件上下文反查器：把「我马上要摸 <文件>」从「翻 650KB 才知道要注意什么」
// 压成「读一页」。它是 zc brief 的镜像：brief 是 任务→上下文，ctx 是 文件→上下文。
//
// ── 为什么存在（机制① 的检索半边，2026-09-03 原型） ──────────────────────
// brief 回答「拿到任务该改哪」，但改之前还有个更细的问题没机器化：「这个文件上有哪些
// 口径/决策/坑是别人已经钉死、我不能踩的？」。这些知识**已经存在**于三处结构里：
//   ① 决策树（ARCHITECTURE §3 / AGENTS §2）：任务 → 先读/再改，倒过来就是「哪些任务会动到它」；
//   ② 手写 @fact 的「锚」槽：口径 → 代码符号，锚的路径就是「这条口径钉在哪个文件上」；
//   ③ 文件头注释：仓库规则「每个 core/ 文件头部都有职责注释」= 现成的单一事实源声明。
// 本模块只做**反向检索与引用**，不产生新知识——每条输出都带「文件:行」，命不中就大声说命不中。
//
// 用法：node scripts/zc.mjs ctx <文件路径> [--json]
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { scanAuthoredFacts, harvestRepo, formatFact, ROOT } from './zc.mjs'
import { parseMarkdownTables, findHeadingLine } from './zc-brief.mjs'

/** 归一化：去 ./ 与 src/ 前缀、统一斜杠，让决策树里的 core/damage.ts 与 src/core/damage.ts 相等 */
export function normPath(p) {
  return String(p ?? '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/^src\//, '').replace(/\/+$/, '')
}

/**
 * 「一段文本是否提到这个路径」。文件与目录分开判，避免误伤：
 * 文件目标只认「归一化路径逐字命中」或「文件名逐字命中」——绝不拿 core/ 这种目录前缀去撞，
 * 否则 core/damage.ts 会命中 core/resource.ts 那一整族（决策树里 core/ 出现了十几次）。
 */
export function mentionsPath(text, target) {
  const t = normPath(target)
  if (!t) return false
  const s = String(text ?? '')
  const isFile = /\.[A-Za-z0-9]+$/.test(t)
  if (s.includes(t) || s.includes('src/' + t) || s.includes('./' + t) || s.includes('/' + t)) return true
  if (isFile) {
    const base = t.split('/').pop()
    return s.includes(base)
  }
  return s.includes(t + '/')
}

/** 锚路径是否「落在」目标上：相等，或互为目录包含（锚在目标目录下 / 目标在锚目录下） */
export function anchorHits(anchorPath, target) {
  const na = normPath(anchorPath)
  const nt = normPath(target)
  if (na === nt) return true
  if (na.startsWith(nt + '/')) return true
  if (nt.startsWith(na + '/')) return true
  return false
}

/** 目标文件头注释（职责声明 = 单一事实源入口）。非 ts/mjs/vue 只回 null，不硬凑 */
export function firstHeaderComment(rel, root = ROOT) {
  const full = join(root, rel)
  if (!existsSync(full) || !statSync(full).isFile()) return null
  const src = readFileSync(full, 'utf8')
  if (/\.(ts|mjs|vue)$/.test(rel)) {
    const m = src.match(/\/\*\*?([\s\S]*?)\*\//)
    return m ? m[1].replace(/^\s*\*\s?/gm, '').trim() : null
  }
  return null
}

function readDoc(root, rel) {
  const p = join(root, rel)
  return existsSync(p) ? readFileSync(p, 'utf8') : ''
}

/**
 * 决策树反向索引：AGENTS §2 与 ARCHITECTURE §3 里「先读/再改」提到目标文件的行。
 * 复用 zc-brief 的表格解析（同一份结构化表格，不另造检索）。
 */
function reverseTree(target, root) {
  const rows = []
  for (const [rel, file] of [['AGENTS.md', 'AGENTS.md'], ['docs/ARCHITECTURE.md', 'docs/ARCHITECTURE.md']]) {
    for (const t of parseMarkdownTables(readDoc(root, rel))) {
      if (!/任务/.test(t.header[0] ?? '')) continue
      for (const row of t.rows) {
        if (row.cells.some(c => mentionsPath(c, target))) {
          rows.push({ task: row.cells[0], read: row.cells[1] ?? '', edit: row.cells.slice(2).join(' → '), at: file + ':' + row.line })
        }
      }
    }
  }
  return rows
}

/**
 * 文件上下文包：摸文件之前该看的一页。
 *   tree   决策树行（哪些任务会改到这里 + 先读要求）
 *   facts  手写 @fact 里「锚」钉在这个文件上的口径
 *   sourced 本文件自己的 notes/注释吐出的口径（仅 spec/mechanics 录入层文件有）
 *   header 头注释职责声明（core/ 文件的单一事实源入口）
 * 目标解析不到（文件不存在）→ resolved=null 且 ok=false，不编造任何命中。
 */
export function buildWhere(target, opts = {}) {
  const root = opts.root ?? ROOT
  const t = String(target ?? '').trim()
  const norm = normPath(t)
  const resolved = norm && existsSync(join(root, t)) ? t : (norm && existsSync(join(root, 'src', norm)) ? 'src/' + norm : null)
  if (!resolved) {
    return { target: t, resolved: null, tree: [], facts: [], sourced: [], header: null, counts: { tree: 0, facts: 0, sourced: 0 } }
  }
  const isFile = statSync(join(root, resolved)).isFile()

  const tree = reverseTree(t, root)

  const facts = scanAuthoredFacts(root)
    .filter(s => s.fact?.anchor && anchorHits(s.fact.anchor.split('#')[0], t))
    .map(s => ({ fact: formatFact(s.fact), at: s.file + ':' + s.line }))

  const isEntry = /^specs\/agents\/[^/]+\.json$/.test(norm) || /^mechanics\/agents\/[^/]+\.ts$/.test(norm)
  const sourced = isEntry
    ? harvestRepo(root).facts
        .filter(f => normPath(f.source) === norm)
        .slice(0, 12)
        .map(f => ({ fact: formatFact(f), at: f.source }))
    : []

  const header = isFile ? firstHeaderComment(resolved, root) : null

  return {
    target: t,
    resolved,
    tree,
    facts,
    sourced,
    header,
    counts: { tree: tree.length, facts: facts.length, sourced: sourced.length },
  }
}

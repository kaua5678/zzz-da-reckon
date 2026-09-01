#!/usr/bin/env node
// zc brief —— 上下文打包器：把「拿到任务该读什么」从「扫 650KB 散文」压成「读一页」。
//
// ── 为什么存在 ────────────────────────────────────────────────────────────
// 本仓库 agent 可读散文 ~650KB（AGENTS.md + docs 13 份 470KB + spec notes 170KB）。
// 任何一个具体任务真正用得上的通常不到 2%，但要找出那 2% 得先扫一遍——这是本仓库
// agent 最大的固定成本。决策树、坑表、根因表**都已经是结构化表格**，只是没人解析它们。
//
// 本模块只做检索与引用，不产生新知识：每一条输出都带「文件:行」，要深挖照着跳。
// 命不中就大声说命不中（"没命中决策树 → 自己读 ARCHITECTURE §3"），绝不编一个看似合理的答案。
//
// 用法：node scripts/zc.mjs brief "<任务一句话>" [--tier fast|full|loop] [--json]
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** 中日韩文本没有空格，用「单字 + 二元组」当词；拉丁词单独收（标识符/命令权重更高） */
export function cjkTokens(text) {
  const s = String(text ?? '').toLowerCase()
  const latin = s.match(/[a-z_][a-z0-9_.:-]{2,}/g) ?? []
  const cjk = s.match(/[\u4e00-\u9fff]+/g) ?? []
  const grams = []
  for (const run of cjk) {
    for (const ch of run) grams.push(ch)
    for (let i = 0; i + 1 < run.length; i++) grams.push(run.slice(i, i + 2))
  }
  return { latin, grams }
}

/**
 * 相关度：二元组命中权重 2、单字 1、拉丁标识符 4（moveId/函数名这类命中几乎必相关），
 * 再按候选文本长度开方衰减，避免长段落靠体量刷分。
 */
export function scoreText(query, text) {
  const q = cjkTokens(query)
  const t = cjkTokens(text)
  const tGrams = new Set(t.grams)
  const tLatin = new Set(t.latin)
  let score = 0
  for (const g of new Set(q.grams)) if (tGrams.has(g)) score += g.length >= 2 ? 2 : 1
  for (const w of new Set(q.latin)) if (tLatin.has(w)) score += 4
  return score / Math.sqrt(Math.max(20, String(text).length))
}

/**
 * 是否有「强命中」：只认二元组与拉丁标识符。
 * 单字命中不算数——中文单字（个/改/加/不）在任何文本里都撞得上，
 * 只按总分过滤会让「给我讲个笑话」也命中决策树（实测踩过），检索一旦开始编造就没人敢信了。
 */
export function hasStrongOverlap(query, text) {
  const q = cjkTokens(query)
  const t = cjkTokens(text)
  const tGrams = new Set(t.grams.filter(g => g.length >= 2))
  const tLatin = new Set(t.latin)
  for (const g of q.grams) if (g.length >= 2 && tGrams.has(g)) return true
  for (const w of q.latin) if (tLatin.has(w)) return true
  return false
}

/** markdown 表格 → 行（带原始行号）；表头判定交给调用方 */
export function parseMarkdownTables(md) {
  const lines = String(md).split('\n')
  const tables = []
  let cur = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const isRow = /^\s*\|.*\|\s*$/.test(line)
    if (!isRow) { if (cur) { tables.push(cur); cur = null } continue }
    const cells = line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim())
    if (cells.every(c => /^:?-+:?$/.test(c))) continue
    if (!cur) cur = { header: cells, rows: [], startLine: i + 1 }
    else cur.rows.push({ cells, line: i + 1 })
  }
  if (cur) tables.push(cur)
  return tables
}

/** 「N. **标题**：正文」式编号清单 → 条目（正文含后续缩进行） */
export function parseNumberedItems(md, fromLine = 1) {
  const lines = String(md).split('\n')
  const items = []
  let cur = null
  for (let i = fromLine - 1; i < lines.length; i++) {
    const m = lines[i].match(/^\s{0,3}(\d+)\.\s+(.*)$/)
    if (m) {
      if (cur) items.push(cur)
      cur = { n: Number(m[1]), title: m[2].replace(/\*\*/g, '').split('：')[0].slice(0, 80), body: m[2], line: i + 1 }
    } else if (cur && /^\s+\S/.test(lines[i])) {
      cur.body += ' ' + lines[i].trim()
    } else if (cur && /^#{1,6}\s/.test(lines[i])) {
      // 标题 = 本节结束：后面再出现的编号是别的清单，不能吃进来
      items.push(cur); cur = null
      break
    } else if (cur && /^>/.test(lines[i])) {
      items.push(cur); cur = null
    }
  }
  if (cur) items.push(cur)
  return items
}

/** 找到某个 markdown 标题所在行（1-based，未命中 = 0） */
export function findHeadingLine(md, re) {
  const lines = String(md).split('\n')
  for (let i = 0; i < lines.length; i++) if (/^#{1,4}\s/.test(lines[i]) && re.test(lines[i])) return i + 1
  return 0
}

/** 档位推断：跨文件/批量 → loop；引擎/录入/排查 → full；其余 fast */
export function inferTier(query) {
  const q = String(query)
  if (/重构|批量|迁移|全仓|跨多文件|数据管道|清仓/.test(q)) return 'loop'
  if (/录|机制|引擎|乘区|资源|失衡|异常|能量|喧响|buff|命座|排查|不生效|不变|不对|对不上|收敛|偏差|低估|高估/i.test(q)) return 'full'
  return 'fast'
}

function readDoc(root, rel) {
  const p = join(root, rel)
  return existsSync(p) ? readFileSync(p, 'utf8') : ''
}

/** 从任务描述里抓实体：4 位 agentId、moveId、setting id、文件路径 */
export function extractEntities(query) {
  const s = String(query)
  const paths = [...new Set(s.match(/[\w/.-]+\.(?:ts|vue|json|mjs)/g) ?? [])]
  return {
    moveIds: [...new Set(s.match(/\b1\d{6}\b/g) ?? [])],
    agentIds: [...new Set((s.match(/\b1\d{3}\b/g) ?? []))],
    settings: [...new Set(s.match(/[a-zA-Z]+\.[a-zA-Z][a-zA-Z0-9]+/g) ?? [])].filter(x => !paths.includes(x)),
    paths,
  }
}

function round(x) { return Math.round(x * 1000) / 1000 }

/** 打包：只检索既有结构化表格，逐条带出处 */
export function buildBrief(query, opts = {}) {
  const root = opts.root ?? process.cwd()
  const topN = opts.topN ?? 3
  const tier = opts.tier ?? inferTier(query)
  const agents = readDoc(root, 'AGENTS.md')
  const arch = readDoc(root, 'docs/ARCHITECTURE.md')
  const pipeline = readDoc(root, 'docs/ENGINE_PIPELINE_GUIDE.md')
  const sop = readDoc(root, 'docs/AGENT_RECORDING_SOP.md')

  const pick = (rows, textOf, n = topN) => rows
    .map(r => ({ ...r, score: scoreText(query, textOf(r)), strong: hasStrongOverlap(query, textOf(r)) }))
    .filter(r => r.strong && r.score > 0.08)
    .sort((a, b) => b.score - a.score)
    .slice(0, n)

  const ruleStart = findHeadingLine(agents, /硬性规则/)
  const rules = ruleStart
    ? parseNumberedItems(agents.split('\n').slice(ruleStart).join('\n'), 1).map(r => ({ ...r, line: r.line + ruleStart }))
    : []
  const hitRules = pick(rules, r => r.body)

  const taskRows = []
  for (const [md, file] of [[agents, 'AGENTS.md'], [arch, 'docs/ARCHITECTURE.md']]) {
    for (const t of parseMarkdownTables(md)) {
      if (!/任务/.test(t.header[0] ?? '')) continue
      for (const row of t.rows) taskRows.push({ ...row, file })
    }
  }
  const hitTasks = pick(taskRows, r => r.cells.join(' '))

  const pitStart = findHeadingLine(pipeline, /常见坑/)
  const pits = pitStart
    ? parseNumberedItems(pipeline.split('\n').slice(pitStart).join('\n'), 1).map(p => ({ ...p, line: p.line + pitStart }))
    : []
  const hitPits = pick(pits, p => p.body)

  const causeRows = []
  for (const t of parseMarkdownTables(sop)) {
    if (!/根因/.test(t.header[0] ?? '')) continue
    for (const row of t.rows) causeRows.push(row)
  }
  const hitCauses = pick(causeRows, r => r.cells.join(' '))

  return {
    query, tier,
    entities: extractEntities(query),
    rules: hitRules.map(r => ({ n: r.n, title: r.title, at: 'AGENTS.md:' + r.line, score: round(r.score) })),
    where: hitTasks.map(r => ({ task: r.cells[0], to: r.cells.slice(1).join(' → '), at: r.file + ':' + r.line, score: round(r.score) })),
    pits: hitPits.map(p => ({ n: p.n, title: p.title, at: 'docs/ENGINE_PIPELINE_GUIDE.md:' + p.line, score: round(p.score) })),
    causes: hitCauses.map(r => ({ cause: r.cells[0], symptom: r.cells[1], at: 'docs/AGENT_RECORDING_SOP.md:' + r.line, score: round(r.score) })),
    counts: { rules: rules.length, tasks: taskRows.length, pits: pits.length, causes: causeRows.length },
  }
}

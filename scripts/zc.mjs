#!/usr/bin/env node
// zc —— 本仓库的 agent 专属语言与单一动作入口（"给 agent 用的 CLI"，不是给人看的文档）。
//
// ── 为什么存在（2026-08-31 立项，证据） ─────────────────────────────────────
// 本仓库的 agent 可读知识已达 ~650KB 纯散文：AGENTS.md + docs/ 13 份 = 470KB，
// 60 个 spec 的 notes = 170KB，mechanics 模块头注释 ~1580 行。其中「口径」一词出现
// 992 次、「用户裁决/用户口径/用户确认」536 次、[已确认] 137 次、未建模 142 次、
// [猜测·x] 33 次 —— 这门语言其实**已经长出来了**，只是停在散文体：
//   ① 无解析器：口径只能靠 grep + 通读，token 成本随仓库线性增长；
//   ② 无索引：问「1411 的 C6 到底建不建模」要读 7KB notes；
//   ③ 无回声：规则 9 要求每次改动声明 verifier/coverage，但全仓 'verifier' 只出现 2 次
//      —— 它只活在聊天记录里，下一个 agent 继承不到；
//   ④ 无租约：规则 13（共享工作区不踩踏）纯靠文字，实测已发生两会话同时改同一文件。
// 36 个 scripts/*.mjs 无一支持 --json，agent 每次都要从人类散文里反解结果。
//
// 本文件的职责就是把上面四条变成机器设施：
//   L1 事实层  parseFactLine/formatFact —— 单行口径语法（语法定义 = 本文件的解析器，
//              不另写 markdown；'zc lang' 打印语法本身）
//   L2 索引层  harvestRepo —— 从既有散文里抽取事实（零迁移即可用），未解析的大声列出
//   L3 动作层  status / claim / done —— 开局考古一条命令、文件租约、verifier 落盘
// 输出统一信封 { ok, verb, data, next }（--json），失败必带 next: 下一步该跑什么。
//
// 用法：
//   node scripts/zc.mjs status [--json]           开局体检（git/租约/疑似并行会话/债/待办/最近验证）
//   node scripts/zc.mjs claim <路径…> [--as 车道] [--ttl 90] [--json]   占用文件（规则 13 机器化）
//   node scripts/zc.mjs release <路径…|--all>     释放租约
//   node scripts/zc.mjs lanes                     当前所有租约
//   node scripts/zc.mjs facts <主体|--all|--unparsed|--unverified>      口径索引查询
//   node scripts/zc.mjs done --verifier <命令> --coverage <范围> [--note …]  规则 9 落盘
//   node scripts/zc.mjs ctx <文件路径> [--json]    摸文件前反查：决策树行 + 钉在文件上的口径 + 头注释职责
//   node scripts/zc.mjs lang                      打印事实语法（唯一权威）
// 状态目录 .zc/（已 gitignore，与 .claude/ledgers 同性质：工作状态，不是项目知识）。
// 逃生口：租约冲突可用 --force 覆盖（会在 journal 留痕，供事后追责，不静默）。
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, appendFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
export const STATE_DIR = join(ROOT, '.zc')
export const LEASES_FILE = join(STATE_DIR, 'leases.json')
export const JOURNAL_FILE = join(STATE_DIR, 'journal.jsonl')

// ═══════════════════════════════════════════════════════════ L1 事实层（语言本体）

/**
 * 事实种类。选取依据 = 仓库既有标注的实际分布（不是凭空设计的分类学）：
 * 口径 992 / 未建模 142 / [已确认] 137 / [猜测·x] 33 / [近似] 10 / debt: 13。
 */
export const FACT_KINDS = ['口径', '未建模', '近似', '债', '决']
/** 置信度档位 = spec 既有的 [已确认] / [猜测·高中低] 两套标注的并集 */
export const CONFIDENCE = ['确认', '高', '中', '低']

/**
 * 单行事实语法（本函数即语法规范）：
 *   @fact <主体> <种类>: <内容> [| 据 <出处>] [| 验 <验证器>] [| 信 <置信度>]
 * 主体形如 agent:1411 / agent:1411/c6 / engine:decibel/保底4 / move:1411018 / ui:token/--c-warning
 * 四个槽位里「主体 + 种类 + 内容」必填，「据（谁定的·哪天）」「验（哪条测试证明它活着）」
 * 强烈建议填 —— 缺「验」的口径就是防死数据铁律要抓的死数据。
 */
// @fact engine:zc/语法单一定义 决: 事实语法只在解析器里定义一次，不写第二份 markdown；zc lang 打印的就是它自己 | 据 用户@2026-08-31·复核@2026-09-01 | 验 src/scripts/__tests__/zc.test.ts | 锚 scripts/zc.mjs#grammar | 信 确认
export function parseFactLine(line) {
  if (typeof line !== 'string') return null
  const m = line.trim().match(/^@fact\s+(\S+)\s+(\S+?)\s*:\s*([\s\S]+)$/)
  if (!m) return null
  const [, subject, kind, rest] = m
  if (!FACT_KINDS.includes(kind)) return null
  const parts = rest.split('|').map(s => s.trim()).filter(Boolean)
  const fact = { subject, kind, claim: parts[0] ?? '', provenance: null, verifier: null, anchor: null, confidence: null }
  // 槽位顺序固定（据→验→锚→信），formatFact 与本函数互逆；未知槽位关键字直接忽略而非报错，
  // 保证语法可向后扩展（老工具读新事实不炸，只是看不见新槽位）
  for (const p of parts.slice(1)) {
    const mm = p.match(/^(据|验|锚|信)\s+([\s\S]+)$/)
    if (!mm) continue
    if (mm[1] === '据') fact.provenance = mm[2].trim()
    else if (mm[1] === '验') fact.verifier = mm[2].trim()
    else if (mm[1] === '锚') fact.anchor = mm[2].trim()
    else fact.confidence = CONFIDENCE.includes(mm[2].trim()) ? mm[2].trim() : null
  }
  return fact.claim ? fact : null
}

/** 事实 → 单行文本（与 parseFactLine 互逆，测试锁死 roundtrip） */
export function formatFact(f) {
  let out = '@fact ' + f.subject + ' ' + f.kind + ': ' + f.claim
  if (f.provenance) out += ' | 据 ' + f.provenance
  if (f.verifier) out += ' | 验 ' + f.verifier
  if (f.anchor) out += ' | 锚 ' + f.anchor
  if (f.confidence) out += ' | 信 ' + f.confidence
  return out
}

/** 语法自述（'zc lang' 打印它；语言只有这一处定义，不写第二份 markdown） */
export function grammar() {
  return [
    '@fact <主体> <种类>: <内容> [| 据 <出处>] [| 验 <验证器>] [| 锚 <代码锚点>] [| 信 <置信度>]',
    '',
    '主体   agent:<id>[/<部位>]   如 agent:1411 / agent:1411/c6 / agent:1051/额外能力',
    '       engine:<域>[/<点>]    如 engine:decibel/保底4 / engine:damage/乘区顺序',
    '       move:<moveId>         如 move:1411018（执行行匹配一律用 moveId，规则 3）',
    '       ui:token/<名>         如 ui:token/--c-warning',
    '种类   ' + FACT_KINDS.join(' / ') + '（口径=已定的算法/语义；未建模=有意不做；近似=做了但有天花板；债=到期要还；决=流程裁决）',
    '内容   一句话，可计算/可检验；数值别复制（规则 11），指向单一来源',
    '据     谁定的·哪天：用户@2026-08-31 / nanoka / 实测 / <commit>',
    '       实现改动后复核过，就追加一段：用户@2026-08-26·复核@2026-09-01（原始裁决日期永不改写，漂移按最后一个日期算）',
    '验     哪条测试/命令证明它活着：yuzuha.test.ts::硬糖射击次数 / npm run probe:panel',
    '锚     这条口径实现在哪：<路径>[#<符号>]，如 src/core/damage.ts#calcDirectDamage',
    '       —— 锚断了（文件/符号没了）= check-guards 判据 6 直接红；锚文件在「据」之后被改过 = 进 zc drift 复核队列',
    '信     ' + CONFIDENCE.join(' / ') + '（对应既有标注 [已确认] / [猜测·高中低]）',
    '',
    '例：@fact agent:1411/c6 未建模: 蓄能炮弹整条不实现，甜度预算全给硬糖射击 | 据 用户@2026-08-30 | 信 确认',
    '例：@fact engine:decibel/保底4 口径: 缺口≤1500 补弹刀，>1500 判定实战打不出不补 | 据 用户@2026-08-31 | 验 decibelUltimateCount.test.ts',
  ].join('\n')
}

// ═══════════════════════════════════════════════════════ L2 索引层（从散文抽取）

/**
 * 种类与置信度是**两个正交维度**，分开扫（v0 曾合成一张表，于是
 * 「[猜测·中] …按满覆盖近似」这类句子只能二选一，丢掉另一半信息）。
 * 种类表顺序敏感：越具体越靠前（债 > 未建模 > 近似 > 泛用口径）。
 */
export const KIND_MARKERS = [
  { re: /debt:/, kind: '债' },
  { re: /未建模|不建模|未接入|未单独建模|暂未建模/, kind: '未建模' },
  { re: /\[近似\]|按.{0,12}近似|近似口径|近似边界/, kind: '近似' },
  { re: /实现口径|口径|裁决/, kind: '口径' },
]

/** 置信度标注（作者显式打的方括号标签，spec 模板 _comment 规定的两套） */
export const CONFIDENCE_TAGS = [
  { re: /\[已确认\]/, confidence: '确认' },
  { re: /\[猜测·高\]/, confidence: '高' },
  { re: /\[猜测·中\]/, confidence: '中' },
  { re: /\[猜测·低\]/, confidence: '低' },
]

/** 出处：用户裁决/口径/确认 + 就近日期 → 用户@YYYY-MM-DD */
export function extractProvenance(text) {
  const date = text.match(/20\d\d-\d\d-\d\d/)
  const byUser = /用户裁决|用户口径|用户确认|用户决断|用户裁定/.test(text)
  if (byUser) return '用户' + (date ? '@' + date[0] : '')
  if (date) return date[0]
  return null
}

/** 句子切分：中文分号/句号/换行为界，去掉过短碎片（<8 字多为标题词） */
export function splitSentences(text) {
  return String(text)
    .split(/[；;。\n]+/)
    .map(s => s.replace(/\s+/g, ' ').trim())
    .filter(s => s.length >= 8)
}

/**
 * 一段散文 → 事实列表 + 未解析句子。
 * 「未解析」不是噪声而是**待结构化的存量**：zc facts --unparsed 就是迁移工单。
 */
export function extractFacts(text, subject, source) {
  const facts = []
  const unparsed = []
  for (const s of splitSentences(text)) {
    const conf = CONFIDENCE_TAGS.find(m => m.re.test(s))?.confidence ?? null
    // 有置信度标签但无种类词 → 仍是一条口径（作者标了[已确认]就是在给口径背书）
    const kind = KIND_MARKERS.find(m => m.re.test(s))?.kind ?? (conf ? '口径' : null)
    if (!kind) { unparsed.push({ subject, source, text: s }); continue }
    facts.push({
      subject,
      kind,
      // 竖线是语法分隔符，抽取时清洗，保证 formatFact/parseFactLine 对任意抽取结果互逆
      claim: (s.length > 160 ? s.slice(0, 157) + '…' : s).replace(/\|/g, '/'),
      provenance: extractProvenance(s),
      verifier: null,
      confidence: conf,
      source,
    })
  }
  return { facts, unparsed }
}

/** 文件路径 → 主体。规则 7：spec 文件名必须 = agentId，所以路径本身就是绑定 */
export function subjectFromPath(path, moduleAgentIds = {}) {
  const p = path.split(sep).join('/')
  const spec = p.match(/src\/specs\/agents\/(\d+)\.json$/)
  if (spec) return 'agent:' + spec[1]
  const mod = p.match(/src\/mechanics\/agents\/([A-Za-z0-9_]+)\.ts$/)
  if (mod) return moduleAgentIds[mod[1]] ? 'agent:' + moduleAgentIds[mod[1]] : 'module:' + mod[1]
  if (p.endsWith('scripts/check-guards.mjs')) return 'engine:debt'
  return 'file:' + p
}

/**
 * 模块源码 → agentId。三种写法都要吃下（仓库实际分布）：
 *   agentIds: ['1411']            字面量
 *   agentIds: [AGENT_ID]          同文件常量间接（yixuan/sigrid 等多数模块）
 *   agentId: '1411'               单数字段
 * 解析不出时**不猜**（规则 15）：返回 null，由调用方列进 unresolved，绝不静默降级成
 * 「这个模块没有测试覆盖」这类假结论（v0 就踩过：module:yixuan 被误报 0 测试）。
 */
export function resolveModuleAgentId(source) {
  const direct = source.match(/agentIds\s*:\s*\[\s*'(\d{4})'/) ?? source.match(/agentId\s*:\s*'(\d{4})'/)
  if (direct) return direct[1]
  const ref = source.match(/agentIds\s*:\s*\[\s*([A-Za-z_][A-Za-z0-9_]*)\s*[,\]]/)
  if (!ref) return null
  const decl = source.match(new RegExp('(?:const|let)\\s+' + ref[1] + "\\s*(?::[^=]+)?=\\s*'(\\d{4})'"))
  return decl ? decl[1] : null
}

/** 模块文件名 → agentId（registry 是唯一绑定处）；解析失败的进 unresolved */
export function buildModuleAgentIds(root = ROOT) {
  const dir = join(root, 'src/mechanics/agents')
  const out = {}
  const unresolved = []
  if (!existsSync(dir)) return { map: out, unresolved }
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.ts')) continue
    const id = resolveModuleAgentId(readFileSync(join(dir, name), 'utf8'))
    if (id) out[name.replace(/\.ts$/, '')] = id
    else unresolved.push('src/mechanics/agents/' + name)
  }
  return { map: out, unresolved }
}

/** spec JSON 里所有 note 类字符串（notes[] + 任意深度的 note/notes 字段） */
export function collectSpecNotes(value, acc = []) {
  if (!value || typeof value !== 'object') return acc
  if (Array.isArray(value)) { for (const v of value) collectSpecNotes(v, acc); return acc }
  for (const [k, v] of Object.entries(value)) {
    if ((k === 'note' || k === 'notes') && typeof v === 'string') acc.push(v)
    else if (k === 'notes' && Array.isArray(v)) for (const s of v) { if (typeof s === 'string') acc.push(s) }
    else collectSpecNotes(v, acc)
  }
  return acc
}

/** 模块 .ts 的注释文本（块注释 + 行注释），口径大量藏在这里 */
export function collectComments(source) {
  const out = []
  for (const m of source.matchAll(/\/\*\*?([\s\S]*?)\*\//g)) out.push(m[1].replace(/^\s*\*/gm, '').trim())
  for (const m of source.matchAll(/(^|[\s;{)])\/\/[ \t]?([^\n]*)/g)) out.push(m[2].trim())
  return out.filter(Boolean)
}

/** 全仓抽取：spec notes + 机制模块注释 → 事实索引 */
export function harvestRepo(root = ROOT) {
  const { map: moduleAgentIds, unresolved } = buildModuleAgentIds(root)
  const facts = []
  const unparsed = []
  const specDir = join(root, 'src/specs/agents')
  if (existsSync(specDir)) {
    for (const name of readdirSync(specDir)) {
      if (!name.endsWith('.json')) continue
      const rel = 'src/specs/agents/' + name
      const subject = subjectFromPath(rel, moduleAgentIds)
      const json = JSON.parse(readFileSync(join(specDir, name), 'utf8'))
      for (const note of collectSpecNotes(json)) {
        const r = extractFacts(note, subject, rel)
        facts.push(...r.facts); unparsed.push(...r.unparsed)
      }
    }
  }
  const modDir = join(root, 'src/mechanics/agents')
  if (existsSync(modDir)) {
    for (const name of readdirSync(modDir)) {
      if (!name.endsWith('.ts')) continue
      const rel = 'src/mechanics/agents/' + name
      const subject = subjectFromPath(rel, moduleAgentIds)
      for (const c of collectComments(readFileSync(join(modDir, name), 'utf8'))) {
        const r = extractFacts(c, subject, rel)
        facts.push(...r.facts); unparsed.push(...r.unparsed)
      }
    }
  }
  const structuredRate = facts.length + unparsed.length > 0 ? facts.length / (facts.length + unparsed.length) : 0
  return {
    facts,
    unparsed,
    unresolved,
    stats: {
      facts: facts.length,
      unmarked: unparsed.length,
      subjects: new Set(facts.map(f => f.subject)).size,
      unresolvedModules: unresolved.length,
      /** 结构化率 = 带标注句 /（带标注句 + 未标注句）。未标注句多为描述性文字，不等于「待迁移工单」 */
      structuredRate: Math.round(structuredRate * 1000) / 1000,
      withoutProvenance: facts.filter(f => !f.provenance).length,
    },
  }
}

/** 主体 → 覆盖它的测试文件（沿用 verify-recording 的判据：测试文件是否引用 agentId） */
export function testsForSubject(subject, root = ROOT) {
  const id = subject.match(/^agent:(\d+)/)?.[1]
  if (!id) return []
  const out = []
  const rec = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) { if (name !== 'node_modules') rec(p); continue }
      if (!/\.test\.ts$/.test(name)) continue
      if (readFileSync(p, 'utf8').includes(id)) out.push(relative(root, p).split(sep).join('/'))
    }
  }
  const src = join(root, 'src')
  if (existsSync(src)) rec(src)
  return out
}

// ════════════════════════════════════════════ L2.5 锚点层（口径 ↔ 代码的绑定）
//
// 为什么需要锚：索引解决了「口径在哪」，但没解决「口径还算不算数」。散文口径最危险的
// 形态不是缺失，是**悄悄过期**——实现改了、口径没改，两边都看起来很自信。锚把一条口径
// 钉在具体符号上，于是有两种可机检的坏味道：
//   ① 断锚：文件/符号没了 → 口径必然已过期（check-guards 判据 6 直接红）
//   ② 漂移：锚文件在「据」的日期之后被改过 → 口径**可能**过期（进复核队列，不红——
//      红了会逼人乱改日期，反而毁掉出处的可信度）

/** 注释前缀剥离后以 @fact 开头的行 = 作者手写的事实（与抽取的事实分开算） */
export function stripCommentPrefix(line) {
  return String(line).replace(/^\s*(?:\/\/+|\/\*+|\*+|#|<!--)\s*/, '').trim()
}

/** 锚点写法 <路径>[#<符号>]；符号支持声明与测试标题两类命中 */
export function resolveAnchor(anchor, root = ROOT) {
  if (!anchor) return { ok: false, reason: 'anchor-missing' }
  const [path, symbol] = anchor.split('#')
  const full = join(root, path)
  if (!existsSync(full)) return { ok: false, reason: 'file-missing', path }
  if (!symbol) return { ok: true, reason: 'file', path }
  const src = readFileSync(full, 'utf8')
  const decl = new RegExp('(?:export\\s+)?(?:async\\s+)?(?:function|const|let|var|class|interface|type|enum)\\s+' + symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b')
  const asKey = new RegExp('(^|[\\s{,])' + symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[:(]')
  const asTitle = src.includes("it('" + symbol) || src.includes('it("' + symbol) || src.includes("describe('" + symbol) || src.includes('describe("' + symbol)
  if (decl.test(src) || asKey.test(src) || asTitle) return { ok: true, reason: 'symbol', path, symbol }
  return { ok: false, reason: 'symbol-missing', path, symbol }
}

/** 全仓扫作者手写事实（.ts/.mjs/.vue 的注释行） */
export function scanAuthoredFacts(root = ROOT) {
  const out = []
  const rec = (dir) => {
    if (!existsSync(dir)) return
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      const rel = relative(root, p).split(sep).join('/')
      if (statSync(p).isDirectory()) {
        if (['node_modules', 'dist', '.git'].includes(name)) continue
        rec(p); continue
      }
      if (!/\.(ts|mjs|vue)$/.test(name)) continue
      const lines = readFileSync(p, 'utf8').split('\n')
      for (let i = 0; i < lines.length; i++) {
        const body = stripCommentPrefix(lines[i])
        if (!body.startsWith('@fact ')) continue
        // 语法模板/示例行（主体写成 <主体> 这类占位符）不是事实：它们是语法自述的一部分，
        // 扫进来会让语言的定义文件自己变成第一条违规（自指问题第三次，前两次见 check-guards
        // 的 DEBT_SCAN_SELF_REFERENTIAL 与 GUARD_SYSTEM_FILES）
        if (/[<>]/.test(body.split(/\s+/)[1] ?? '')) continue
        // 行尾的注释收尾符号不属于内容
        const cleaned = body.replace(/\s*(\*\/|-->)\s*$/, '')
        out.push({ file: rel, line: i + 1, raw: cleaned, fact: parseFactLine(cleaned) })
      }
    }
  }
  rec(join(root, 'src'))
  rec(join(root, 'scripts'))
  return out
}

/**
 * 手写事实的完整性判据（判据 6 的判定核心）：语法必须能解析、必须有「据」、
 * 必须有能解析到的「锚」。抽取的散文事实不受此约束——它们是存量，不是新债。
 */
export function auditAuthoredFacts(root = ROOT) {
  const scanned = scanAuthoredFacts(root)
  const violations = []
  for (const s of scanned) {
    if (!s.fact) { violations.push({ ...s, problem: 'parse-failed' }); continue }
    if (!s.fact.provenance) violations.push({ ...s, problem: 'no-provenance' })
    const anchor = resolveAnchor(s.fact.anchor, root)
    if (!anchor.ok) violations.push({ ...s, problem: anchor.reason })
  }
  return { scanned, violations }
}

/** 锚文件最后一次改动时间（已提交取 git 提交时间；有未提交改动取 mtime——两者取晚） */
export function anchorTouchedAt(path, root = ROOT) {
  const full = join(root, path)
  const committed = (() => {
    const iso = git('log -1 --format=%cI -- "' + path + '"', root)
    return iso ? Date.parse(iso) : 0
  })()
  const dirty = parsePorcelain(git('status --porcelain -- "' + path + '"', root)).length > 0
  const mtime = existsSync(full) ? statSync(full).mtimeMs : 0
  return dirty ? Math.max(committed, mtime) : committed
}

/**
 * 复核队列：锚文件在「据」日期之后被改动过的手写事实。
 * 只报不红——日期比较天然粗糙（同日改动、格式化提交都会命中），红了会逼人改日期作弊。
 */
export function driftQueue(root = ROOT) {
  const { scanned } = auditAuthoredFacts(root)
  const rows = []
  for (const s of scanned) {
    const fact = s.fact
    if (!fact?.anchor || !fact.provenance) continue
    // 取**最后**一个日期：允许「据 用户@2026-08-26·复核@2026-09-01」这种追加形式——
    // 口径的作者与日期不该被复核改写（改日期＝作弊），但复核时间要能让漂移出队。
    const dates = fact.provenance.match(/20\d\d-\d\d-\d\d/g)
    const date = dates?.[dates.length - 1]
    if (!date) continue
    const anchorPath = fact.anchor.split('#')[0]
    const touched = anchorTouchedAt(anchorPath, root)
    if (touched > Date.parse(date + 'T23:59:59Z')) {
      rows.push({ subject: fact.subject, anchor: fact.anchor, since: date, touchedAt: new Date(touched).toISOString().slice(0, 10), at: s.file + ':' + s.line })
    }
  }
  return rows
}

// ═════════════════════════════════════════════════════════ L3 动作层（润滑设施）

export function readLeases() {
  if (!existsSync(LEASES_FILE)) return []
  try { return JSON.parse(readFileSync(LEASES_FILE, 'utf8')) } catch { return [] }
}

export function writeLeases(leases) {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true })
  writeFileSync(LEASES_FILE, JSON.stringify(leases, null, 2) + '\n')
}

export function isExpired(lease, now = Date.now()) {
  return now - lease.at > lease.ttlMs
}

/** 当前车道标识：显式 --as > DSH 会话 id > 进程兜底 */
export function currentLane(explicit) {
  return explicit || process.env.ZC_LANE || process.env.DSH_SESSION_ID || 'pid-' + process.pid
}

/** 冲突 = 别的车道持有同一路径（或其目录前缀）的未过期租约 */
export function findConflicts(leases, paths, lane, now = Date.now()) {
  const live = leases.filter(l => !isExpired(l, now) && l.lane !== lane)
  const out = []
  for (const p of paths) {
    for (const l of live) {
      if (l.path === p || p.startsWith(l.path.endsWith('/') ? l.path : l.path + '/') || l.path.startsWith(p.endsWith('/') ? p : p + '/')) {
        out.push({ path: p, holder: l })
      }
    }
  }
  return out
}

export function applyClaim(leases, paths, lane, ttlMs, now = Date.now()) {
  const kept = leases.filter(l => !isExpired(l, now) && !(l.lane === lane && paths.includes(l.path)))
  return [...kept, ...paths.map(path => ({ path, lane, at: now, ttlMs }))]
}

export function applyRelease(leases, paths, lane) {
  return leases.filter(l => !(l.lane === lane && (paths === '--all' || paths.includes(l.path))))
}

/**
 * 疑似并行会话：git 里已改动、但没有任何租约、且 mtime 在窗口内（默认 45 分钟）的文件。
 * 这正是本次立项当天踩到的坑——两个会话同改 resourceTrack.ts，靠人肉 ls -l 才发现。
 */
export function detectForeignWip(changed, leases, mtimes, now = Date.now(), windowMs = 45 * 60 * 1000, ownPaths = []) {
  const held = new Set(leases.filter(l => !isExpired(l, now)).map(l => l.path))
  // 自己在 journal 里认领过的改动不算陌生 WIP——否则收工 release 之后，
  // 自己刚交付的文件会立刻被自己的 status 报成「别人在改」（实测踩过）
  const mine = new Set(ownPaths)
  return changed.filter(p => !held.has(p) && !mine.has(p) && mtimes[p] != null && now - mtimes[p] <= windowMs)
}

/** 本车道近期在 journal 里认领过的文件（默认 12 小时内） */
export function recentlyOwnedPaths(journal, lane, now = Date.now(), windowMs = 12 * 60 * 60 * 1000) {
  const out = new Set()
  for (const e of journal) {
    if (e.lane !== lane) continue
    if (now - Date.parse(e.at ?? '') > windowMs) continue
    for (const p of e.changed ?? []) out.add(p)
  }
  return [...out]
}

export function envelope(verb, ok, data, next) {
  return { ok, verb, data, next: next ?? null }
}

// ───────────────────────────────────────────────────────────────────── git 读取

function git(cmd, root = ROOT) {
  try { return execSync('git ' + cmd, { cwd: root, encoding: 'utf8' }).trim() } catch { return '' }
}

export function parsePorcelain(text) {
  return text.split('\n').filter(Boolean).map(l => ({ status: l.slice(0, 2).trim(), path: l.slice(3).replace(/^"|"$/g, '') }))
}

function mtimeMap(paths, root = ROOT) {
  const out = {}
  for (const p of paths) {
    const full = join(root, p)
    if (existsSync(full)) out[p] = statSync(full).mtimeMs
  }
  return out
}

// ───────────────────────────────────────────────────────────────────── 各动词

async function verbStatus(root = ROOT) {
  const branch = git('rev-parse --abbrev-ref HEAD', root)
  const ahead = git('rev-list --count @{u}..HEAD', root) || '0'
  const changed = parsePorcelain(git('status --porcelain', root))
  const paths = changed.map(c => c.path)
  const leases = readLeases().filter(l => !isExpired(l))
  const allJournal = existsSync(JOURNAL_FILE)
    ? readFileSync(JOURNAL_FILE, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
    : []
  const foreign = detectForeignWip(paths, leases, mtimeMap(paths, root), Date.now(), undefined, recentlyOwnedPaths(allJournal, currentLane()))
  let debt = { registered: 0, unregistered: 0 }
  try {
    const g = await import(pathToFileURL(join(root, 'scripts/check-guards.mjs')).href)
    const markers = g.scanDebtMarkers(root)
    const audit = g.matchDebtRegistry(markers)
    debt = { registered: markers.length - audit.unregistered.length, unregistered: audit.unregistered.length, cleared: audit.cleared.length }
  } catch { /* 护栏不可用时不阻塞 status */ }
  const statusDoc = join(root, 'docs/implementation-status.md')
  let backlog = null
  if (existsSync(statusDoc)) {
    const rows = readFileSync(statusDoc, 'utf8').split('\n').filter(l => /^\| (命座|机制)/.test(l))
    backlog = rows.map(r => r.split('|').map(s => s.trim()).filter(Boolean)).map(c => ({ dim: c[0], done: c[1], partial: c[2], undescribed: c[3], pending: c[4] }))
  }
  const authored = auditAuthoredFacts(root)
  const drift = driftQueue(root)
  const journal = allJournal.slice(-3)
  const next = foreign.length > 0
    ? 'zc lanes  # 有 ' + foreign.length + ' 个文件疑似并行会话在改：先确认归属再动手（规则 13）'
    : 'zc claim <你要改的文件>  # 占道后再动手'
  return envelope('status', true, {
    branch, ahead: Number(ahead), changed: changed.length, changedPaths: paths, leases, foreignWip: foreign, debt, backlog, journal,
    facts: { authored: authored.scanned.length, broken: authored.violations.length, reviewQueue: drift.length },
  }, next)
}

async function verbClaim(args, root = ROOT) {
  const paths = args.positional
  if (paths.length === 0) return envelope('claim', false, {}, 'zc claim <路径…> [--as 车道] [--ttl 分钟]')
  const lane = currentLane(args.as)
  const ttlMs = (Number(args.ttl) || 90) * 60 * 1000
  const leases = readLeases()
  const conflicts = findConflicts(leases, paths, lane)
  if (conflicts.length > 0 && !args.force) {
    return envelope('claim', false, { conflicts }, '这些文件已被其他车道占用：' + conflicts.map(c => c.path + '←' + c.holder.lane).join(', ') + '。换文件、等它释放，或 --force（会在 journal 留痕）')
  }
  const next = applyClaim(leases, paths, lane, ttlMs)
  writeLeases(next)
  if (conflicts.length > 0) appendJournal({ kind: 'force-claim', lane, paths, over: conflicts.map(c => c.holder.lane) })
  // 机制①：占道即自动带出该文件的上下文（钉死的口径/决策树行/职责声明）——agent 不用再记得单独跑 ctx
  const { buildWhere } = await import(pathToFileURL(join(root, 'scripts/zc-where.mjs')).href)
  const context = paths.map(p => buildWhere(p, { root })).filter(w => w.resolved)
  return envelope('claim', true, { lane, paths, ttlMinutes: ttlMs / 60000, forced: conflicts.length > 0, context }, '改完记得 zc done --verifier <命令> --coverage <范围>')
}

function verbRelease(args) {
  const lane = currentLane(args.as)
  // 大声失败：既没给路径也没给 --all 时不要静默「释放 0 条」
  // （踩过：npm run zc release --all 被 npm 吞掉 --all，看起来成功其实没释放）
  if (!args.all && args.positional.length === 0) {
    return envelope('release', false, {}, 'node scripts/zc.mjs release <路径…> 或 release --all（注意：带 -- 开头的参数别走 npm run，npm 会自己吃掉）')
  }
  const target = args.all ? '--all' : args.positional
  const before = readLeases()
  const after = applyRelease(before, target, lane)
  writeLeases(after)
  return envelope('release', true, { lane, released: before.length - after.length }, null)
}

function verbLanes() {
  const now = Date.now()
  const leases = readLeases()
  const live = leases.filter(l => !isExpired(l, now))
  return envelope('lanes', true, { live: live.map(l => ({ ...l, ageMinutes: Math.round((now - l.at) / 60000) })), expired: leases.length - live.length }, null)
}

function verbFacts(args, root = ROOT) {
  const { facts, unparsed, stats, unresolved } = harvestRepo(root)
  if (args.unparsed) {
    const list = args.positional[0] ? unparsed.filter(u => u.subject.includes(args.positional[0])) : unparsed
    return envelope('facts', true, { stats, unparsed: list.slice(0, 50), unparsedTotal: list.length }, '未解析 = 待结构化存量：新写口径请用 zc lang 的单行语法')
  }
  if (args.gaps || args.unverified) {
    // 只对能绑定到 agentId 的主体下「无测试覆盖」结论；module:x（id 未解析）另列，不当结论用
    const bySubject = new Map()
    for (const f of facts) bySubject.set(f.subject, (bySubject.get(f.subject) ?? 0) + 1)
    const rows = [...bySubject.entries()]
      .filter(([subject]) => subject.startsWith('agent:'))
      .map(([subject, count]) => ({ subject, count, tests: testsForSubject(subject, root).length }))
      .filter(r => r.tests === 0)
      .sort((a, b) => b.count - a.count)
    const noProvenance = facts.filter(f => !f.provenance).length
    return envelope('facts', true, { stats, unverified: rows, noProvenance, unresolvedModules: unresolved },
      rows.length ? '这些主体有口径但无测试引用 → 防死数据铁律的缺口（规则 5）' : (unresolved.length ? 'unresolvedModules 是解析器缺口，不是覆盖缺口：补 resolveModuleAgentId 的写法' : null))
  }
  const key = args.positional[0]
  const sel = args.all || !key ? facts : facts.filter(f => f.subject.includes(key))
  const tests = key ? testsForSubject(key.startsWith('agent:') ? key : 'agent:' + key.replace(/^agent:/, ''), root) : []
  return envelope('facts', true, { stats, subject: key ?? null, count: sel.length, facts: sel.slice(0, args.all ? sel.length : 60), tests }, null)
}

/**
 * 上下文包：检索既有结构化表格（决策树/坑表/根因表/硬性规则）+ 实体事实，
 * 每条带出处。目的是把「读 650KB 才知道读哪 2%」压成一页。
 */
async function verbBrief(args, root = ROOT) {
  const query = args.positional.join(' ').trim()
  if (!query) return envelope('brief', false, {}, 'node scripts/zc.mjs brief "<任务一句话>" [--tier fast|full|loop]')
  const { buildBrief } = await import(pathToFileURL(join(root, 'scripts/zc-brief.mjs')).href)
  const brief = buildBrief(query, { root, tier: typeof args.tier === 'string' ? args.tier : undefined })
  // 实体层：任务里提到的 agentId → 既有口径与覆盖测试（facts 索引复用，不重新造检索）
  const harvest = brief.entities.agentIds.length ? harvestRepo(root) : { facts: [] }
  const entityFacts = brief.entities.agentIds.map(id => ({
    subject: 'agent:' + id,
    facts: harvest.facts.filter(f => f.subject === 'agent:' + id).slice(0, 6).map(f => formatFact(f)),
    tests: testsForSubject('agent:' + id, root).slice(0, 6),
  }))
  const verify = brief.tier === 'fast'
    ? ['npm run check-guards', 'npx vitest run <相关测试文件>']
    : ['npm run check', 'npm run typecheck', brief.tier === 'loop' ? 'npm run verify' : 'npx vitest run <相关测试文件>']
  const next = brief.where.length === 0
    ? '决策树没命中 → 自己读 docs/ARCHITECTURE.md §3（别猜），命中不了就说明这类任务还没进决策树，做完补一行'
    : 'node scripts/zc.mjs claim ' + (brief.where[0]?.to.match(/[\w/.-]+\.(?:ts|vue|json)/)?.[0] ?? '<目标文件>')
  return envelope('brief', true, { ...brief, entityFacts, verify }, next)
}

/**
 * 文件上下文反查（zc brief 的镜像：brief 是 任务→上下文，ctx 是 文件→上下文）。
 * 机制①（path-scoped 自动注入）的检索半边——把「摸文件前该知道的钉死口径」压成一页，
 * 每条带出处。目标解析不到就大声失败（规则 15：不猜路径）。
 */
async function verbCtx(args, root = ROOT) {
  const target = args.positional[0]
  if (!target) return envelope('ctx', false, {}, 'node scripts/zc.mjs ctx <文件路径>  # 摸文件前反查：决策树行 + 钉在文件上的口径 + 头注释职责')
  const { buildWhere } = await import(pathToFileURL(join(root, 'scripts/zc-where.mjs')).href)
  const w = buildWhere(target, { root })
  if (!w.resolved) return envelope('ctx', false, { target }, '文件不存在：' + target + '（规则 15：不猜路径）。给完整相对路径，或先用 ls 确认')
  const next = (w.counts.facts > 0 || w.counts.sourced > 0)
    ? '摸之前读完上面钉死的口径；改完 zc done --verifier <命令> --coverage <范围>'
    : '这个文件暂无钉死口径；改完 zc done --verifier <命令> --coverage <范围>'
  return envelope('ctx', true, { ...w }, next)
}

function verbDrift(root = ROOT) {
  const { scanned, violations } = auditAuthoredFacts(root)
  const queue = driftQueue(root)
  const next = violations.length
    ? '断锚/缺据的手写事实会让 check-guards 判据 6 变红：补 | 据 …… | 锚 <路径>#<符号>'
    : (queue.length ? '这些口径的实现自「据」之后动过 → 逐条复核，仍成立就把「据」更新到今天' : null)
  return envelope('drift', violations.length === 0, { authored: scanned.length, violations, reviewQueue: queue }, next)
}

function appendJournal(entry) {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true })
  appendFileSync(JOURNAL_FILE, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n')
}

// @fact engine:zc/收工落盘 决: 规则 9 的 verifier+coverage 必须经 zc done 进 .zc/journal.jsonl，只写在聊天里等于没写（全仓 'verifier' 曾只出现 2 次） | 据 实测@2026-08-31·复核@2026-09-01 | 验 src/scripts/__tests__/zc.test.ts | 锚 scripts/zc.mjs#verbDone | 信 确认
function verbDone(args) {
  if (!args.verifier || !args.coverage) {
    return envelope('done', false, {}, 'zc done --verifier "<证明它生效的命令/测试>" --coverage "<影响到哪些角色/页面/文件>"（规则 9）')
  }
  const lane = currentLane(args.as)
  const changed = parsePorcelain(git('status --porcelain')).map(c => c.path)
  appendJournal({ kind: 'done', lane, verifier: args.verifier, coverage: args.coverage, note: args.note ?? null, changed })
  return envelope('done', true, { lane, verifier: args.verifier, coverage: args.coverage, changed: changed.length }, '已落盘 .zc/journal.jsonl（下一个 agent 用 zc status 就能看到）')
}

// ─────────────────────────────────────────────────────────────────── CLI 装配

export function parseArgs(argv) {
  const out = { positional: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) { out.positional.push(a); continue }
    const key = a.slice(2)
    const nextArg = argv[i + 1]
    if (['as', 'ttl', 'verifier', 'coverage', 'note'].includes(key)) { out[key] = nextArg; i++ }
    else out[key] = true
  }
  return out
}

/** ctx / claim 共用的「文件上下文」排版（一处定义，避免两个动词的输出漂移） */
function whereHumanize(w) {
  const lines = []
  lines.push('文件：' + w.target + (w.resolved && w.resolved !== w.target ? '（解析为 ' + w.resolved + '）' : ''))
  if (w.header) {
    lines.push('【职责声明】(头注释)')
    for (const l of String(w.header).split('\n')) lines.push('  ' + l)
  }
  if (w.facts?.length) {
    lines.push('【钉在此文件的口径】(手写 @fact 锚指向这里) ' + w.facts.length + ' 条')
    for (const f of w.facts) lines.push('  ' + f.fact + '\n      « ' + f.at)
  }
  if (w.tree?.length) {
    lines.push('【决策树：哪些任务会改到这里】' + w.tree.length + ' 行')
    for (const t of w.tree) lines.push('  · ' + t.task + '\n      → ' + (t.edit || t.read) + '\n      « ' + t.at)
  }
  if (w.sourced?.length) {
    lines.push('【本文件自己吐的口径】(notes/注释抽取) ' + w.sourced.length + ' 条')
    for (const f of w.sourced) lines.push('  ' + f.fact + '\n      « ' + f.at)
  }
  return lines
}

function humanize(res) {
  const lines = []
  const d = res.data ?? {}
  if (res.verb === 'status') {
    lines.push('分支 ' + d.branch + ' · 未推送 ' + d.ahead + ' commit · 工作区改动 ' + d.changed + ' 文件')
    lines.push('租约 ' + (d.leases?.length ?? 0) + ' 条' + (d.leases?.length ? '：' + d.leases.map(l => l.path + '←' + l.lane.slice(0, 12)).join(', ') : ''))
    if (d.foreignWip?.length) lines.push('⚠ 疑似并行会话在改（无租约 + 45 分钟内改过）：' + d.foreignWip.join(', '))
    if (d.debt) lines.push('债务 ' + d.debt.registered + ' 条已登记' + (d.debt.unregistered ? ' / ✗ ' + d.debt.unregistered + ' 条未登记' : ''))
    if (d.facts) lines.push('手写事实 ' + d.facts.authored + ' 条' + (d.facts.broken ? ' / ✗ 断锚 ' + d.facts.broken : '') + (d.facts.reviewQueue ? ' / ⟳ 待复核 ' + d.facts.reviewQueue : ''))
    for (const b of d.backlog ?? []) lines.push('待办 ' + b.dim + '：已实现 ' + b.done + ' / 未描述 ' + b.undescribed + ' / 待办条目 ' + b.pending)
    for (const j of d.journal ?? []) lines.push('最近验证 [' + (j.at ?? '').slice(0, 16) + '] ' + (j.verifier ?? j.kind) + ' → ' + (j.coverage ?? ''))
  } else if (res.verb === 'facts') {
    lines.push('索引：' + d.stats.facts + ' 条事实 / ' + d.stats.subjects + ' 个主体 / 结构化率 ' + Math.round(d.stats.structuredRate * 100) + '%（另有 ' + d.stats.unmarked + ' 句无标注，多为描述性文字）/ ' + d.stats.withoutProvenance + ' 条缺「据」')
    for (const f of d.facts ?? []) lines.push(formatFact(f) + '   « ' + f.source)
    for (const u of d.unparsed ?? []) lines.push('? ' + u.subject + ' « ' + u.source + ' :: ' + u.text)
    for (const r of d.unverified ?? []) lines.push('✗ ' + r.subject + ' 有 ' + r.count + ' 条口径但 0 个测试引用')
    for (const p of d.unresolvedModules ?? []) lines.push('? 模块 agentId 未解析（解析器缺口，非覆盖缺口）：' + p)
    if (d.tests?.length) lines.push('覆盖测试：' + d.tests.join(', '))
  } else if (res.verb === 'brief') {
    lines.push('任务：' + d.query + '  →  档位 ' + d.tier + '（fast=只读规则+目标文件 / full=+决策树+管线 / loop=+账本）')
    if (d.where?.length) {
      lines.push('')
      lines.push('【改哪】（决策树命中 ' + d.where.length + '/' + d.counts.tasks + ' 行）')
      for (const w of d.where) lines.push('  · ' + w.task + '\n      → ' + w.to + '\n      « ' + w.at)
    }
    if (d.rules?.length) {
      lines.push('')
      lines.push('【必守规则】')
      for (const r of d.rules) lines.push('  · 规则' + r.n + ' ' + r.title + '  « ' + r.at)
    }
    if (d.pits?.length) {
      lines.push('')
      lines.push('【按症状查的坑】')
      for (const p of d.pits) lines.push('  · 坑' + p.n + ' ' + p.title + '  « ' + p.at)
    }
    if (d.causes?.length) {
      lines.push('')
      lines.push('【根因表命中】')
      for (const c of d.causes) lines.push('  · ' + c.cause + ' —— ' + c.symptom + '  « ' + c.at)
    }
    for (const e of d.entityFacts ?? []) {
      lines.push('')
      lines.push('【' + e.subject + ' 既有口径 ' + e.facts.length + ' 条】')
      for (const f of e.facts) lines.push('  ' + f)
      if (e.tests.length) lines.push('  覆盖测试：' + e.tests.join(', '))
    }
    lines.push('')
    lines.push('【收工验收】' + (d.verify ?? []).join(' && ') + '  然后 zc done --verifier … --coverage …')
  } else if (res.verb === 'ctx') {
    lines.push(...whereHumanize(d))
  } else if (res.verb === 'claim') {
    lines.push('已认领 ' + (d.paths?.length ?? 0) + ' 个文件（车道 ' + String(d.lane ?? '').slice(0, 12) + '，TTL ' + d.ttlMinutes + ' 分）')
    for (const w of d.context ?? []) { lines.push(''); lines.push(...whereHumanize(w)) }
  } else if (res.verb === 'drift') {
    lines.push('手写事实 ' + d.authored + ' 条 · 断锚/缺据 ' + (d.violations?.length ?? 0) + ' 条 · 待复核 ' + (d.reviewQueue?.length ?? 0) + ' 条')
    for (const v of d.violations ?? []) lines.push('✗ ' + v.problem + ' @ ' + v.file + ':' + v.line + ' :: ' + v.raw.slice(0, 90))
    for (const q of d.reviewQueue ?? []) lines.push('⟳ ' + q.subject + ' 据 ' + q.since + '，锚 ' + q.anchor + ' 于 ' + q.touchedAt + ' 动过（' + q.at + '）')
  } else if (res.verb === 'lanes') {
    if (!d.live?.length) lines.push('无活跃租约')
    for (const l of d.live ?? []) lines.push(l.path + ' ← ' + l.lane + '（' + l.ageMinutes + ' 分钟前，TTL ' + Math.round(l.ttlMs / 60000) + ' 分）')
  } else {
    lines.push(JSON.stringify(d))
  }
  if (res.next) lines.push('→ ' + res.next)
  return lines.join('\n')
}

export async function main(argv) {
  const verb = argv[0] ?? 'status'
  const args = parseArgs(argv.slice(1))
  let res
  switch (verb) {
    case 'status': res = await verbStatus(); break
    case 'claim': res = await verbClaim(args); break
    case 'release': res = verbRelease(args); break
    case 'lanes': res = verbLanes(); break
    case 'facts': res = verbFacts(args); break
    case 'done': res = verbDone(args); break
    case 'drift': res = verbDrift(); break
    case 'brief': res = await verbBrief(args); break
    case 'ctx': res = await verbCtx(args); break
    case 'lang': res = envelope('lang', true, { grammar: grammar() }, null); break
    default: res = envelope(verb, false, {}, '未知动词。可用：status / brief / ctx / claim / release / lanes / facts / drift / done / lang')
  }
  if (args.json) console.log(JSON.stringify(res, null, 2))
  else if (verb === 'lang') console.log(res.data.grammar)
  else console.log(humanize(res))
  return res
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  // 不用顶层 await：check-guards.mjs 静态 import 本文件（判据 6 复用事实解析器），
  // 而 verbStatus 又动态 import check-guards —— 顶层 await 会让本模块在被回环 import 时
  // 尚未求值完成，Node 报 "Detected unsettled top-level await" 并静默吐空结果。
  // 改成 .then 后模块求值立即完成，循环依赖正常解开（实测 2026-08-31 踩过）。
  main(process.argv.slice(2)).then((res) => { if (!res.ok) process.exitCode = 1 })
}

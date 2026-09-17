/**
 * Recording seam: fixed source packet → explicit per-unit decisions → checked traceability.
 * No LLM/regex is trusted to decide game semantics. Unknown terms fail closed.
 * Hashes pin raw/nouns/this agent's catalog moves; no timestamps or absolute paths.
 * Validation proves coverage and references, NOT semantic correctness or test success.
 */
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, relative } from 'node:path'
import ts from 'typescript'

function sourceTree(body) { return ts.createSourceFile('recording.ts', body, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS) }
function hasSymbol(body, symbol) {
  let found = false
  function visit(n) {
    if ((ts.isFunctionDeclaration(n) || ts.isVariableDeclaration(n) || ts.isMethodDeclaration(n) || ts.isPropertyAssignment(n)) && n.name?.getText() === symbol) found = true
    ts.forEachChild(n, visit)
  }
  visit(sourceTree(body))
  return found
}
function hasTest(body, title) {
  let count = 0
  function visit(n, disabled = false) {
    if (ts.isCallExpression(n)) {
      const callee = n.expression.getText()
      disabled ||= /^(?:it|test|describe)\.(?:skip|todo|only|skipIf|runIf)\b/.test(callee)
      if (/^(?:it|test)$/.test(callee) && ts.isStringLiteralLike(n.arguments[0]) && n.arguments[0].text === title && !disabled) {
        const callback = n.arguments[1]
        if (callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) {
          let assertion = false
          function scan(node) {
            if (ts.isCallExpression(node) && node.expression.getText() === 'expect') assertion = true
            ts.forEachChild(node, scan)
          }
          scan(callback.body)
          if (assertion) count++
        }
      }
    }
    ts.forEachChild(n, child => visit(child, disabled))
  }
  visit(sourceTree(body))
  return count === 1
}

export const RECORDING_VERSION = 1
const canonical = value => JSON.stringify(value, (_key, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v)
export const fingerprint = value => createHash('sha256').update(canonical(value)).digest('hex')
const esc = key => String(key).replaceAll('~', '~0').replaceAll('/', '~1')
const keys = obj => Object.keys(obj ?? {}).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))

export function cleanRecordingText(text, nouns) {
  return String(text ?? '')
    .replace(/<Term:(\d+)>(.*?)<\/Term>/gs, (_m, id, label) => {
      const name = nouns[id]?.name || label
      if (!name) throw new Error(`术语 ${id} 未命中 noun 表`)
      return name
    })
    .replace(/<IconMap:([^>]+)>/g, (_m, k) => ({ Icon_Normal: '[普攻键]', Icon_Special: '[特技键]', Icon_Dodge: '[闪避键]', Icon_Ultimate: '[终结键]', Icon_Assist: '[支援键]' })[k] ?? `[${k}]`)
    // Preserve Skill AND Prop: these are evidence, never catalog moveId assignments.
    .replace(/<\/?color(?:=[^>]*)?>/g, '')
    .replace(/<[^>]+>/g, tag => { throw new Error(`未知原文标签 ${tag}`) })
    .replace(/\r\n/g, '\n').trim()
}

export function makePacket(raw, nouns, moves, source, level) {
  const units = []
  function add(pointer, title, value, category) {
    if (typeof value !== 'string' || !value.trim()) return
    const text = cleanRecordingText(value, nouns)
    // Split only at sentence/newline boundaries, not commas inside conditions/formulas.
    const parts = text.match(/[^。；\n]+[。；\n]?/g) ?? []
    parts.forEach((quote, index) => {
      if (quote.trim()) units.push({ id: `${pointer}:${index}`, pointer, title, category, quote: quote.trim(), context: text })
    })
  }
  for (const cat of keys(raw.skill)) {
    for (const [i, entry] of (raw.skill[cat].description ?? []).entries()) {
      add(`/skill/${esc(cat)}/description/${i}/desc`, entry.name, entry.desc, cat)
    }
  }
  const levels = keys(raw.passive?.level)
  const selected = level === undefined ? levels.at(-1) : levels.find(k => Number(raw.passive.level[k].level) === Number(level))
  if (!selected) throw new Error('被动等级缺失或所选等级不存在')
  const passive = raw.passive.level[selected]
  for (const [i, desc] of (passive.desc ?? []).entries()) add(`/passive/level/${selected}/desc/${i}`, passive.name?.[i], desc, 'passive')
  for (const k of keys(raw.talent)) add(`/talent/${esc(k)}/desc`, raw.talent[k].name, raw.talent[k].desc, 'talent')
  // Potential texts vary in shape; inventory every desc/description string, without interpreting it.
  function walk(value, pointer) {
    if (!value || typeof value !== 'object') return
    for (const k of keys(value)) {
      const p = `${pointer}/${esc(k)}`
      if (['desc', 'description'].includes(k) && typeof value[k] === 'string') add(p, value.name ?? '潜能', value[k], 'potential')
      else walk(value[k], p)
    }
  }
  walk(raw.potential, '/potential')
  walk(raw.potential_detail, '/potential_detail')
  if (!units.length) throw new Error('没有可录入的原文')
  return { version: RECORDING_VERSION, agentId: String(raw.id), source, passiveLevel: Number(passive.level),
    hashes: { raw: fingerprint(raw), nouns: fingerprint(nouns), moves: fingerprint(moves) }, moves, units }
}

export function loadPacket(root, agentId, level) {
  if (!/^\d{4}$/.test(agentId)) throw new Error('请先 resolve 查证角色，再传四位 agentId')
  const dir = 'data/raw/nanoka_missing'
  const nounFile = readdirSync(resolve(root, dir)).filter(f => /^noun_[\d.]+\.json$/.test(f))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).at(-1)
  if (!nounFile) throw new Error('缺少 noun 词表')
  const json = p => JSON.parse(readFileSync(resolve(root, p), 'utf8'))
  const rawFile = `${dir}/full/${agentId}.json`
  const raw = json(rawFile)
  if (String(raw.id) !== agentId) throw new Error('raw id 与文件名不一致')
  const catalog = json('public/static/catalog.json')
  if (!catalog.agents.some(a => String(a.id) === agentId)) throw new Error('角色未收录 catalog')
  const moves = catalog.agentSkills.filter(a => String(a.agentId) === agentId)
  if (!moves.length) throw new Error('catalog 缺少角色招式表')
  return makePacket(raw, json(`${dir}/${nounFile}`), moves, { raw: rawFile, nouns: `${dir}/${nounFile}` }, level)
}

export function draftRecording(packet) {
  return { version: RECORDING_VERSION, packet, decisions: packet.units.map(u => ({ sourceId: u.id, status: 'pending', reason: '', mechanics: [] })), mechanics: [] }
}

export const mechanismTemplate = {
  id: 'unique-mechanic-id', sources: ['copy-unit-id'], dimension: 'D1', certainty: 'L1',
  trigger: '', target: '', gate: '', formula: '', field: '', countSource: '', duration: '', cap: '',
  assumptions: [], decisionEvidence: '',
  implementation: { spec: 'src/specs/agents/<id>.json#/notes/0', consumer: 'src/mechanics/agents/<module>.ts#<symbol>' },
  cases: ['positive', 'negative', 'boundary'].map(kind => ({ kind, input: '', expected: '', test: { file: '', title: '' } })),
}

function pointerAt(value, pointer) {
  if (!pointer.startsWith('/')) throw new Error('JSON 引用需要 /pointer')
  return pointer.slice(1).split('/').reduce((v, k) => v?.[k.replaceAll('~1', '/').replaceAll('~0', '~')], value)
}

export function validateRecording(doc, packet, { stage = 'plan', readText } = {}) {
  const errors = []
  const fail = msg => errors.push(msg)
  const text = v => typeof v === 'string' && v.trim().length > 0
  if (!['plan', 'complete'].includes(stage)) return ['未知校验阶段']
  if (doc?.version !== RECORDING_VERSION) fail('契约版本不匹配')
  if (canonical(doc?.packet) !== canonical(packet)) fail('原文证据包漂移：重新生成并逐条复核，不能只改 hash')
  const decisions = Array.isArray(doc?.decisions) ? doc.decisions : []
  const mechanics = Array.isArray(doc?.mechanics) ? doc.mechanics : []
  const unitIds = new Set(packet.units.map(u => u.id))
  const ids = new Set()
  const seen = new Set()
  for (const d of decisions) {
    if (!d || !unitIds.has(d.sourceId) || seen.has(d.sourceId)) { fail('未知/重复 sourceId'); continue }
    seen.add(d.sourceId)
    if (!['modeled', 'out_of_scope', 'blocked'].includes(d.status)) fail(`${d.sourceId}: 尚未处置`)
    if (d.status === 'blocked') fail(`${d.sourceId}: 未决口径 ${d.reason ?? ''}`)
    if (d.status === 'out_of_scope' && !text(d.reason)) fail(`${d.sourceId}: 排除必须说明理由与影响`)
    if (!Array.isArray(d.mechanics) || (d.status === 'modeled' && d.mechanics.length === 0)
      || (d.status !== 'modeled' && d.mechanics.length > 0)) fail(`${d.sourceId}: 机制映射无效`)
  }
  for (const id of unitIds) if (!seen.has(id)) fail(`${id}: 原文漏项`)
  for (const m of mechanics) {
    if (!m || !text(m.id) || ids.has(m.id)) { fail('机制 id 缺失/重复'); continue }
    ids.add(m.id)
    const prefix = `${m.id}: `
    if (!/^D[1-9]$/.test(m.dimension)) fail(prefix + '维度需 D1–D9')
    if (!/^L[0-3]$/.test(m.certainty)) fail(prefix + '确定性需 L0–L3')
    for (const field of ['trigger', 'target', 'gate', 'formula', 'field', 'countSource', 'duration', 'cap']) {
      if (!text(m[field])) fail(prefix + `${field} 必填（不适用也写明）`)
    }
    if (!Array.isArray(m.sources) || !m.sources.length) fail(prefix + '缺原文依据')
    for (const s of m.sources ?? []) {
      if (!unitIds.has(s) || !decisions.some(d => d?.sourceId === s && d.status === 'modeled' && d.mechanics?.includes(m.id))) fail(prefix + '原文双向映射断裂')
    }
    if (!Array.isArray(m.assumptions)) fail(prefix + 'assumptions 必须显式列出')
    for (const a of m.assumptions ?? []) if (!text(a?.premise) || !text(a?.falsifier)) fail(prefix + '假设缺前提/可观察失败')
    if (['L2', 'L3'].includes(m.certainty) && (!m.assumptions?.length || !text(m.decisionEvidence))) fail(prefix + '近似/裁决缺假设与依据')
    if (!text(m.implementation?.spec) || !text(m.implementation?.consumer)) fail(prefix + '缺 spec/消费者落点')
    const cases = Array.isArray(m.cases) ? m.cases : []
    for (const kind of ['positive', 'negative', 'boundary']) {
      if (!cases.some(c => c?.kind === kind && text(c.input) && text(c.expected))) fail(prefix + `缺 ${kind} 输入/预期（实现前固定）`)
    }
    if (stage === 'complete') {
      for (const [kind, ref] of Object.entries(m.implementation ?? {})) {
        try {
          const [file, anchor] = ref.split('#')
          if (!anchor || !readText) throw new Error('缺锚点/文件读取器')
          const body = readText(file)
          if (kind === 'spec') {
            if (file !== `src/specs/agents/${packet.agentId}.json` || pointerAt(JSON.parse(body), anchor) === undefined) throw new Error('spec 指针不存在/角色不匹配')
          } else if (kind === 'consumer') {
            if (!file.startsWith('src/') || !/\.(ts|mjs)$/.test(file) || !/^[\w$]+$/.test(anchor) || !hasSymbol(body, anchor)) throw new Error('消费者符号不存在')
          } else throw new Error('未知实现引用类型')
        } catch (e) { fail(prefix + `实现引用无效 ${kind}: ${e.message}`) }
      }
      for (const c of cases) {
        try {
          if (!/^src\/.*\.test\.ts$/.test(c.test?.file) || !text(c.test?.title)) throw new Error('缺测试文件/唯一测试名')
          const body = readText(c.test.file)
          // Static trace only. The actual Vitest execution remains mandatory.
          if (!hasTest(body, c.test.title)) throw new Error('唯一可执行测试未找到或该测试体无 expect 断言')
        } catch (e) { fail(prefix + `测试引用无效: ${e.message}`) }
      }
    }
  }
  for (const d of decisions) for (const id of d?.mechanics ?? []) {
    if (!ids.has(id) || !mechanics.some(m => m?.id === id && m.sources?.includes(d.sourceId))) fail(`${d.sourceId}: 机制双向映射断裂`)
  }
  return errors
}

export function repositoryReader(root) {
  return file => {
    if (typeof file !== 'string' || !file || file.includes('\\') || file.split('/').includes('..') || file.startsWith('/')) throw new Error('引用必须为仓库相对路径')
    const path = resolve(root, file)
    if (relative(root, path).startsWith('..')) throw new Error('引用越界')
    return readFileSync(path, 'utf8')
  }
}

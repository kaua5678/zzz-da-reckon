/**
 * 判据 30：通用字段的「唯一声明方」前提必须有机器判据（T128，2026-10-10）。
 *
 * ## 缺口形状（T127 §3.4 实测发现，本判据是它的机器面）
 *
 * `exContinuous` 是「连续强特通道」的通用声明字段（`src/types/resource/config.ts` 声明注释：
 * 「正反馈资源环的通用表达……由角色模块在自己的 buildCharConfig / applyTeamConfig 里声明；
 * 引擎不读 agentId。当前唯一声明方 = 1051」）。引擎有 **5 处判据直接读它**：
 *
 * | # | 位置 | 判据 | 有 refund 门？ | 语义归属 |
 * |---|---|---|---|---|
 * | 1 | `core/resource/helpers.ts:79` | `continuous = exContinuous && exRefundPerPaid > 0` | ✅ 有 | 通道入口条件（通用） |
 * | 2 | `core/resource/helpers.ts:274` | `decibelExCount = exContinuous ? floor(ex) : ex` | ❌ 无 | **自门控**：`fractional` 为假时 ex 恒整数 ⇒ `floor` 是恒等（见下） |
 * | 3 | `core/resource/helpers.ts:387` | `realUltForTime = exContinuous && !exFinalize` | ❌ 无 | 迭代期实数**时间信道**（通用，但只在实数迭代期成立） |
 * | 4 | `core/resource/helpers.ts:396` | `exForTime = … ? (prev+new)/2 : ex` | ❌ 无 | 时间信道 0.5 阻尼（通用，同上） |
 * | 5 | `core/resource/helpers.ts:682` | `storedEx = … ? (prev+new)/2 : ex` | ❌ 无 | **状态写入阻尼**（同上；⚠ 这条把实数写进声明方自己的 state） |
 * | 6 | `core/resource.ts:134` | `continuousExPresent` ⇒ 内层迭代上限抬到 100 | ❌ 无 | 阻尼残差每轮减半 ⇒ 需要 40+ 轮（通用，同上） |
 *
 * **分类结论（T128 逐行核实，比「3 处没有 refund 门」更准的一句）**：这 5 处**不是**「1051 专属语义」，
 * 而是「迭代期实数化 + 阻尼」这一个**整包**通道的语义；#2 自门控（`continuous` 为假 ⇒ `fractional` 为假
 * ⇒ `exSpecialCount` 是 `Math.floor(...)` 的整数 ⇒ `Math.floor(ex) === ex`，该读点退化为恒等），
 * 其余 #3/#4/#5/#6 **无门且互相咬合**（实数时间信道 + 双阻尼 + 100 轮预算是一套，拆开任何一个都不自洽）。
 *
 * 危险不在「第二个人写它」，而在**整包静默继承**：新声明方若只想要「次数实数化」而不想要
 * 阻尼/实数时间信道/100 轮预算（或它的 state 消费端不接受实数），引擎不会红——它会照 1051 的方式跑，
 * 把 `(prev+new)/2` 的**实数**写进那个模块的 `exSpecialCount` 状态（#5）。
 *
 * 而 5 处判据的注释逐字写着「agentId 判断冗余已删：`exContinuous` **唯一写入方** = yidhari.ts」
 * ——引擎**依赖这个前提**才敢删掉原来的 agentId 判断。本判据就是把这个前提变成机器判据。
 *
 * ## 为什么是「扫描写入方」而不是别的形态（T128 选型，含排除理由）
 *
 * - ✅ **选它**：它就是注释里那句前提的**字面形式**（「唯一写入方 = yidhari.ts」）；零引擎改动、零数值风险；
 *   红信息能直接点名新声明方与需要显式处理的 5 处读点。
 * - ❌ 排除「反向蕴含断言」（`exContinuous === true` ⇒ `exRefundPerPaid > 0` 在全部读点成立）：
 *   要落地必须给 #3/#4/#5/#6 **加 refund 门** = 改引擎数值语义（本任务明令不许，且实测 #2 之外的读点
 *   在 `refund>0` 的第二个声明方上是**正确**的——加门会把它挡在通道外）。
 * - ❌ 排除「运行时断言」（在 `calcTeamResources` 里断言读到该字段的 cfg 的 agentId）：
 *   那是把删掉的 agentId 判断请回引擎（违反规则 6），且静态可判的事不该留到运行时。
 *
 * ## 判据语义：**不是「永远不许第二个」**（用户 2026-10-10 裁决：判据不能阻挡开发）
 *
 * 红 = 「**新增声明方时必须显式处理**」，红信息给三条出路（登记 / 按能力分流 / 只是挪位改登记表）。
 * 登记表本身就是「显式处理」的留痕：谁声明、为什么这 5 处读点对它成立。
 *
 * ## 度量口径
 *
 * - 扫描面 = `src/**` 非测试 `.ts`（`./app-program.mjs` 的 `isAppTsScanned`，与判据 28/29 同一份 program，
 *   同进程缓存 ⇒ 零额外建program成本）。`.vue` 不在内：展示层禁止 import core/mechanics（判据 7），
 *   够不到 cfg；`__tests__`/`*.test.ts` 不在内：测试夹具构造 cfg 不算「声明方」。
 * - 写入形态（AST，非正则 ⇒ 注释与字符串天然不计）：
 *   `x.<field> = v` / `x['<field>'] = v` / `x.<field> ||= v`（含全部赋值算子）/ 对象字面量 `{ <field>: v }` 与简写 `{ <field> }`。
 *   类型声明（`<field>?: T` 是 PropertySignature）与读取（`x.<field> === true`、解构）**不计**。
 * - 粒度 = **文件**（前提原文就是「唯一写入方 = yidhari.ts」；同文件多处写不破坏蕴含，故只报数不判红）。
 * - ⚠ 已知边界（如实记录，不装看不见）：`receiver` 只作**证据**不作判据。`input.cfg.exContinuous = true`
 *   （本模块自己那份）与 `characters[i].cfg.exContinuous = true`（**队友**那份）静态同形，要分辨得知道
 *   输入契约 ⇒ 硬判会误伤。故 receiver 原样打进红信息，由人一眼看出是不是跨槽写入。
 * - 反空洞下限：扫描面文件数 < `FIELD_WRITER_MIN_FILES` ⇒ 判红（扫描面塌陷会让「零违规」与「仪器坏了」同形）。
 * - 登记表过期也红：登记了却没扫到写入点 = 前提已变（字段改名 / 写入点搬家），与「多了一个写入方」同等对待。
 *
 * ⚠ 本文件在 `scanDebtMarkers` 的扫描面里（`scripts/**` 的 .mjs）——正文不得出现那个五字母标记的字面形式。
 */
import { createRequire } from 'node:module'
import { dirname, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { appTsProgram, isAppTsScanned } from './app-program.mjs'

const require = createRequire(import.meta.url)
const ts = require('typescript')
/** 仓库根（从 `scripts/lib/` 上溯三级；与 check-guards.mjs 的 ROOT 同值） */
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))))

/**
 * 「唯一声明方」前提登记表（单源）。
 *
 * 每条 = 一个通用字段 + 引擎依赖「只有它一个声明方」才敢做的读点 + 实际声明方清单。
 * 新增声明方 ⇒ 本判据红 ⇒ 在本表加一条 `writers` 条目，`why` 必须回答：
 * **这个新声明方为什么对下面每一个 `readers` 读点都成立**（尤其 #5 会把阻尼后的实数写进它的 state）。
 * 若答案只是「它也想要实数化」而不想要整套 ⇒ 正解是按能力/新字段把读点分流（见 `formatFieldWriters` 的三条出路）。
 */
export const SINGLE_WRITER_FIELDS = [
  {
    field: 'exContinuous',
    /** 引擎读点（人读锚；⚠ 不参与匹配——行号会随重构漂移，匹配粒度是文件） */
    readers: [
      'src/core/resource/helpers.ts:79  通道入口（有 refund 门）',
      'src/core/resource/helpers.ts:274 迭代期喧响按整数次数（自门控：ex 非实数时 floor 是恒等）',
      'src/core/resource/helpers.ts:387 迭代期必要时间用实数终结技期望（无门）',
      'src/core/resource/helpers.ts:396 必要时间 0.5 阻尼（无门）',
      'src/core/resource/helpers.ts:682 状态写入 0.5 阻尼（无门；⚠ 把实数写进声明方的 state）',
      'src/core/resource.ts:134        内层迭代上限抬到 100（无门）',
    ],
    writers: [
      {
        file: 'src/mechanics/agents/yidhari.ts',
        since: '2026-10-10',
        why: '1051 伊德海莉：极寒重碾非失衡每发回 15 闪能属自指反馈（refund 解析求解），'
          + '迭代期强特次数实数化 + 阻尼 + 实数 ult 时间信道 + 内层上限 100 是一套（@fact yidhari:refund不动点，'
          + '锚 src/core/resource/helpers.ts#resolveExSpecialCount）；它同时写 exRefundPerPaid=15 让 #1 的 refund 门为真。',
      },
    ],
  },
]

/** 反空洞下限：2026-10-10 实测扫到 src 非测试 .ts 共 301 个（下限取约 83%，与判据 28/29 同量级） */
export const FIELD_WRITER_MIN_FILES = 250

const ASSIGN_FORMS = new Map([
  [ts.SyntaxKind.EqualsToken, 'assignment'],
  [ts.SyntaxKind.BarBarEqualsToken, 'compound'],
  [ts.SyntaxKind.AmpersandAmpersandEqualsToken, 'compound'],
  [ts.SyntaxKind.QuestionQuestionEqualsToken, 'compound'],
])

/** 赋值左侧的字段名与接收者文本；不是「某对象的某成员」时返回 null */
function assignedTarget(left, sf) {
  if (ts.isPropertyAccessExpression(left) && ts.isIdentifier(left.name)) {
    return { field: left.name.text, form: 'property', receiver: left.expression.getText(sf).replace(/\s+/g, ' ') }
  }
  if (ts.isElementAccessExpression(left)) {
    const arg = left.argumentExpression
    if (arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))) {
      return { field: arg.text, form: 'element', receiver: left.expression.getText(sf).replace(/\s+/g, ' ') }
    }
  }
  return null
}

/**
 * 一个 AST 节点是不是「对某登记字段的写入」；是则返回 { field, form, receiver }。
 * 四种形态：成员赋值 / 元素赋值 / 复合赋值 / 对象字面量（含简写）。类型声明与读取都不命中。
 */
export function fieldWriteAt(node, fields, sf) {
  const wanted = fields instanceof Set ? fields : new Set(fields)
  if (ts.isBinaryExpression(node)) {
    const operator = ASSIGN_FORMS.get(node.operatorToken.kind)
    if (!operator) return null
    const target = assignedTarget(node.left, sf)
    if (!target || !wanted.has(target.field)) return null
    return { field: target.field, form: operator === 'compound' ? 'compound' : target.form, receiver: target.receiver }
  }
  if (ts.isPropertyAssignment(node) && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))) {
    if (wanted.has(node.name.text)) return { field: node.name.text, form: 'literal', receiver: '' }
  }
  if (ts.isShorthandPropertyAssignment(node) && wanted.has(node.name.text)) {
    return { field: node.name.text, form: 'literal-shorthand', receiver: '' }
  }
  return null
}

/**
 * 扫一个 program 里的字段写入点。`isScanned(rel)` 决定哪些源文件参与。
 * 返回 { sites: [{ file, line, field, form, receiver, text }], scanned }。
 */
export function findFieldWrites(program, { root = ROOT, isScanned = isAppTsScanned, fields = SINGLE_WRITER_FIELDS } = {}) {
  const wanted = new Set(fields.map(f => f.field))
  const sites = []
  let scanned = 0
  if (!program) return { sites, scanned }
  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile) continue
    const rel = relative(root, sf.fileName).split(sep).join('/')
    if (!isScanned(rel)) continue
    scanned++
    const visit = (n) => {
      const hit = fieldWriteAt(n, wanted, sf)
      if (hit) {
        sites.push({
          file: rel,
          line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
          ...hit,
          text: n.getText(sf).replace(/\s+/g, ' ').slice(0, 120),
        })
      }
      ts.forEachChild(n, visit)
    }
    visit(sf)
  }
  return { sites, scanned }
}

/**
 * 自证：内存里的一份小程序（noLib，免加载 lib.d.ts），正例覆盖四种写入形态、反例覆盖读取 / 类型声明 /
 * 注释 / 字符串 / 别名解构。detector 瞎了（漏抓第二种写法）时判据会自己红，而不是静静放行。
 */
export function fieldWriterSelfTest() {
  const failures = []
  const file = '/__field_writer_selftest__/a.ts'
  const code = [
    'interface Cfg { exContinuous?: boolean; other?: boolean }',                  // 1 类型声明：不是写入
    'declare const cfg: Cfg',                                                     // 2
    'declare function want(): boolean',                                           // 3
    'export function a() { cfg.exContinuous = true }',                            // 4 违规：成员赋值
    'export function b(c: Cfg) { c["exContinuous"] = true }',                     // 5 违规：元素赋值
    'export function c(c: Cfg) { c.exContinuous ||= true }',                      // 6 违规：复合赋值
    'export function d() { return { exContinuous: true } }',                      // 7 违规：对象字面量
    'export function e(c: Cfg) { return { exContinuous } }',                      // 8 违规：字面量简写
    'export function f(c: Cfg) { return c.exContinuous === true }',               // 9 读：不算
    'export function g(c: Cfg) { const { exContinuous } = c; return exContinuous }', // 10 解构读：不算
    'export function h(c: Cfg) { return { other: c.exContinuous } }',             // 11 别的字段：不算
    '// cfg.exContinuous = true',                                                 // 12 注释：不算
    "export const i = 'cfg.exContinuous = true'",                                 // 13 字符串：不算
    'export function j(c: Cfg) { c.other = c.exContinuous ?? false }',            // 14 读 + 别的字段写：不算
  ].join('\n')
  const options = { strict: true, noEmit: true, noLib: true, types: [] }
  const host = ts.createCompilerHost(options)
  const getSourceFile = host.getSourceFile.bind(host)
  host.getSourceFile = (f, lang, ...rest) => (f === file ? ts.createSourceFile(f, code, ts.ScriptTarget.Latest, true) : getSourceFile(f, lang, ...rest))
  host.fileExists = (f) => f === file
  host.readFile = (f) => (f === file ? code : undefined)
  const program = ts.createProgram({ rootNames: [file], options, host })
  const r = findFieldWrites(program, { root: '/__field_writer_selftest__', isScanned: () => true })
  const got = r.sites.map(s => `${s.line}${s.form}`).join(',')
  const want = '4property,5element,6compound,7literal,8literal-shorthand'
  if (got !== want) failures.push(`命中应为 ${want}，实为 ${got}：${JSON.stringify(r.sites.map(s => s.text))}`)
  // 接收者文本必须被捕获（红信息里靠它分辨「自己那份 cfg」与「队友那份」）
  const recv = r.sites.find(s => s.line === 5)?.receiver
  if (recv !== 'c') failures.push(`元素赋值的 receiver 应为 "c"，实为 ${JSON.stringify(recv)}`)
  if (r.scanned !== 1) failures.push(`自证扫描面应为 1，实为 ${r.scanned}`)
  return { ok: failures.length === 0, failures }
}

/** 登记表 → Map<field, Set<file>> */
function registeredWriters(fields) {
  const out = new Map()
  for (const f of fields) out.set(f.field, new Set(f.writers.map(w => w.file)))
  return out
}

/**
 * 全仓扫描 + 判定。`extra` = 未登记写入方（新增声明方），`missing` = 登记了却没扫到（前提已变）。
 * 两者都判红：一个前提的机器判据必须**双向**成立，否则字段改名/搬家会静默变成「零写入方」假绿。
 */
export function scanFieldWriters(root = ROOT, fields = SINGLE_WRITER_FIELDS) {
  const selfTest = fieldWriterSelfTest()
  const program = appTsProgram(root)
  if (!program) {
    return { sites: [], scanned: 0, selfTest, belowFloor: true, extra: [], missing: [], byFile: new Map(), ok: false }
  }
  const { sites, scanned } = findFieldWrites(program, { root, fields })
  const belowFloor = scanned < FIELD_WRITER_MIN_FILES
  const expected = registeredWriters(fields)
  const byFile = new Map()
  for (const s of sites) {
    if (!byFile.has(s.file)) byFile.set(s.file, [])
    byFile.get(s.file).push(s)
  }
  const extra = sites.filter(s => !(expected.get(s.field) ?? new Set()).has(s.file))
  const missing = []
  for (const f of fields) {
    for (const w of f.writers) {
      if (!byFile.has(w.file)) missing.push({ field: f.field, file: w.file })
    }
  }
  return {
    sites, scanned, selfTest, belowFloor, extra, missing, byFile,
    ok: !belowFloor && selfTest.ok && extra.length === 0 && missing.length === 0,
  }
}

/** 判据的红信息：先点名，再给三条出路（用户 2026-10-10 裁决：判据不许变成「不许第二个」的死锁） */
export function formatFieldWriters(report) {
  const lines = []
  if (!report.selfTest.ok) lines.push('  ✗ detector 自证失败：', ...report.selfTest.failures.map(f => '    ' + f))
  if (report.belowFloor) {
    lines.push(`  ✗ 反空洞下限：只扫到 ${report.scanned} 个 .ts < ${FIELD_WRITER_MIN_FILES} → tsconfig.app.json 的 include 变了 / src 搬家了？`,
      '    → 修扫描器，**不要**改这个下限（扫描面塌陷 = 判据瞎了，不是「前提变干净了」）')
  }
  if (report.extra.length > 0) {
    lines.push(`  ✗ 未登记的声明方 ${report.extra.length} 处——引擎 5 处读点会把它们当 1051 处理（实数迭代期 + 阻尼 + 实数 ult 时间信道 + 内层上限 100，见本文件头表）：`)
    for (const s of report.extra.slice(0, 10)) {
      lines.push(`      ${s.file}:${s.line}  [${s.form}${s.receiver ? ` 接收者 ${s.receiver}` : ''}]  ${s.text}`)
    }
    lines.push('    → 三条出路（判据语义是「新增声明方必须显式处理」，**不是**「不许第二个」）：',
      '      ① 新声明方确实要整套语义 ⇒ 在 scripts/lib/field-writer-uniqueness.mjs 的 SINGLE_WRITER_FIELDS 加一条 writers（why 必须回答：为什么下面每个 readers 读点对它都成立——尤其 #5 会把阻尼后的实数写进它的 state）',
      '      ② 只要其中一部分（如只想要次数实数化）⇒ 把那几处读点按能力/新字段分流，别复用 exContinuous',
      '      ③ 只是重构挪位 ⇒ 改登记表里那条 writers.file（登记表过期同样红）')
  }
  if (report.missing.length > 0) {
    lines.push(`  ✗ 登记表过期 ${report.missing.length} 条——登记的声明方已扫不到写入点（字段改名 / 写入点搬家）：`)
    for (const m of report.missing) lines.push(`      ${m.field} ← ${m.file}`)
    lines.push('    → 改登记表的 file（或该字段真的没人声明了 ⇒ 连同引擎 5 处读点一起清掉，别留着前提空转）')
  }
  return lines
}

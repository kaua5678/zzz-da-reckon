/**
 * 判据 26：展示层（`src/views/**`、`src/components/**`）禁写角色 / 招式 id 字面量（硬门 0；CC-449，2026-10-04）。
 *
 * 为什么需要（事故）：
 *   r487（2026-10-04）文档断言「`src/views` + `src/components` 无 moveId 字面量」，实际 `StunAxisPage.vue` 当时有 3 处
 *   （`'1371014'`/`'1371020'` 凝神窗口触发、`'1371020'` isPromotable 排除）——结论是按记忆写的，grep 没真跑。
 *   更早的 CC-56/57/58/59/62/431/446/448 一共八轮，每轮都是在页面里撞见一处写死的角色 / 招式 id 再下沉，
 *   每处配一条**只盯那一个文件 / 那一个字面量**的源码锁（`agentMechanicViewCc62.test.ts` 查 `=== '1471'`、
 *   `axisWindowLaneDecl.test.ts` 查 StunAxisPage 的 7 位 id…）。锁是按病灶长的，不是按规则长的 ⇒ 新页面新字面量没人拦。
 *   本判据把规则本身变成机器判据：**展示层一个角色 / 招式 id 字面量都不能有**。
 *
 * 规则来源：`ARCHITECTURE` §0「展示 → 编排 → 引擎」+ 规则 6「引擎按能力查询，不按角色查询」在展示层的投影——
 *   页面要「只对某个角色 / 某个招式这样显示」时，正解是：
 *   · 模块声明展示层专用字段（`AgentMechanicModule.axisWindowLane` / `axisDurationInputs` / `characterCountInputs` /
 *     `axisNonDecibelUltimates` …范式 CC-65 / CC-446 / CC-448）+ `composables/agentMechanicView.ts` 门面；
 *   · 页面默认选中的角色 / 招式（时间图默认主 C、逻辑编辑器默认融合招…）归 `src/data/viewAgentDefaults.ts`
 *     （那里是唯一允许的「展示层默认 id」落点，不在本判据扫描范围）。
 *
 * 计量口径（纯句法）：
 *   · 命中 = 被引号（' " `）包着的 **四位 `1xx1`**（角色 id：1011…1641）或 **七位 `1xx1xxx`**（招式 id = 角色 id + 三位序号）。
 *   · 注释不计：`//` 到行尾、`/* … *\/`、`<!-- … -->`（含跨行）先剥掉再匹配——r485 教训：模板注释里也会出现 id。
 *   · 测试文件（`__tests__/`、`*.test.ts`）不扫；`.d.ts` 不扫。
 *   · 不设豁免表：真有「页面必须写死 id」的场景，先把它搬进 `data/viewAgentDefaults.ts` 再说——那是一次性的、可 grep 的落点。
 *   · 反空洞下限：扫描文件数 < `EXHIBITION_ID_LITERAL_MIN_FILES` 视为目录没扫到，判据失败（与判据 25 同款）。
 *
 * 明确**不**纳入（别偷偷加宽）：
 *   · 五位道具 id（20101 / 31201）、boss id（4xxxx）、年份（'2026'）——形状不同天然排除。
 *   · 不带引号的数字（`:step="1000"`、`top: 84`）——不是 id。
 *   · 编排层 `src/composables/**`：角色身份判定已由判据 2（AST 身份判定棘轮）+ 判据 24 看守；
 *     7 位招式 id 在编排层仍可能是合法的招式表查找，纳入前先普查。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
/** 仓库根（从 `scripts/lib/` 上溯三级；与 check-guards.mjs 的 ROOT 同值） */
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
export const EXHIBITION_ID_LITERAL_DIRS = ['src/views', 'src/components']
export const EXHIBITION_ID_LITERAL_BASELINE = 0
/** 反空洞下限：2026-10-04 实测展示层非测试 .vue/.ts 共 40 个 */
export const EXHIBITION_ID_LITERAL_MIN_FILES = 30
/** 角色 id（四位 1xx1）或招式 id（七位 1xx1xxx），且被引号包着 */
export const ID_LITERAL = /(['"`])(1\d{2}1(?:\d{3})?)\1/g
/** 剥注释：块注释 / 模板注释整段清空（保留换行以稳住行号），行注释从 `//` 剥到行尾（`://` 不算） */
export function stripComments(text) {
  const blank = (s) => s.replace(/[^\n]/g, ' ')
  return text
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/<!--[\s\S]*?-->/g, blank)
    .split('\n')
    .map(l => l.replace(/(^|[^:'"`])\/\/.*$/, '$1'))
    .join('\n')
}
/** 单文件 → [{ line, id, text }] */
export function findIdLiterals(text) {
  const out = []
  const raw = text.split('\n')
  stripComments(text).split('\n').forEach((l, i) => {
    for (const m of l.matchAll(ID_LITERAL)) out.push({ line: i + 1, id: m[2], text: raw[i].trim().slice(0, 110) })
  })
  return out
}
function isScanned(name) {
  if (name.endsWith('.vue')) return true
  return name.endsWith('.ts') && !name.endsWith('.d.ts') && !name.endsWith('.test.ts')
}
export function detectorSelfTest() {
  const failures = []
  const t1 = "<template>\n  <span v-if=\"act.moveId === '1371020'\">x</span>\n</template>\n<script setup lang=\"ts\">\nconst main = '1471'\n</script>\n"
  const h1 = findIdLiterals(t1)
  if (!(h1.length === 2 && h1[0].line === 2 && h1[0].id === '1371020' && h1[1].line === 5 && h1[1].id === '1471')) failures.push('正例未命中或行号错：' + JSON.stringify(h1))
  const t2 = "// 原写死 '1371'\n/* '1471029'\n */\n<!-- 模板注释\n  '1581' -->\nconst url = 'https://x/1371'\nconst n = 1000\nconst step = `1001`\n"
  const h2 = findIdLiterals(t2)
  // 第 8 行反引号包着的 1001 是 1xx1 形状 ⇒ 应计（模板字符串同样是字面量）；其余全不计
  if (!(h2.length === 1 && h2[0].line === 8)) failures.push('注释 / 无引号 / URL 误计：' + JSON.stringify(h2))
  const t3 = "const a = '2026'\nconst b = '20101'\nconst c = '41001'\nconst d = \"1371\" // 行尾注释不影响前面的命中\n"
  const h3 = findIdLiterals(t3)
  if (!(h3.length === 1 && h3[0].line === 4 && h3[0].id === '1371')) failures.push('形状排除或行尾注释处理错：' + JSON.stringify(h3))
  return { ok: failures.length === 0, failures }
}
/** 全展示层扫描（判据 26） */
export function scanExhibitionIdLiterals(root = ROOT) {
  const sites = []
  let scanned = 0
  const rec = (dir) => {
    if (!existsSync(dir)) return
    for (const n of readdirSync(dir)) {
      const p = join(dir, n)
      if (statSync(p).isDirectory()) { if (n !== '__tests__') rec(p); continue }
      if (!isScanned(n)) continue
      scanned++
      const rel = relative(root, p).split(sep).join('/')
      for (const s of findIdLiterals(readFileSync(p, 'utf8'))) sites.push({ file: rel, ...s })
    }
  }
  for (const d of EXHIBITION_ID_LITERAL_DIRS) rec(join(root, d))
  const selfTest = detectorSelfTest()
  const belowFloor = scanned < EXHIBITION_ID_LITERAL_MIN_FILES
  return { count: sites.length, sites, scanned, selfTest, belowFloor,
    ok: sites.length === EXHIBITION_ID_LITERAL_BASELINE && selfTest.ok && !belowFloor }
}
export function formatExhibitionIdLiterals(report) {
  const lines = []
  if (!report.selfTest.ok) lines.push('  ✗ detector 自证失败：', ...report.selfTest.failures.map(f => '    ' + f))
  if (report.belowFloor) lines.push(`  ✗ 只扫到 ${report.scanned} 个文件（下限 ${EXHIBITION_ID_LITERAL_MIN_FILES}）：目录改名 / 搬家了？改 EXHIBITION_ID_LITERAL_DIRS`)
  if (report.count > EXHIBITION_ID_LITERAL_BASELINE) {
    lines.push(`  ✗ 展示层出现 ${report.count} 处角色 / 招式 id 字面量（硬门 0）：`)
    lines.push('    → 按角色 / 招式特判 ⇒ 模块声明展示层字段 + composables/agentMechanicView 门面（范式 CC-65 / CC-446 / CC-448）')
    lines.push('    → 页面默认选中项 ⇒ src/data/viewAgentDefaults.ts')
    for (const s of report.sites.slice(0, 20)) lines.push(`      ${s.file}:${s.line}  [${s.id}]  ${s.text}`)
  }
  return lines
}

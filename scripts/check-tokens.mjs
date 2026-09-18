#!/usr/bin/env node
// 机器护栏：设计令牌体系（AGENTS 规则 11「跨文件常量只从单一来源引用」在样式层的落地）。
//
// 为什么存在：本仓库 27 个 .vue 各带一个 <style scoped>，共 4085 行 CSS，但**只有颜色令牌**
// （--app-* / --wa-*）——间距/圆角/字号/阴影/层级/动效全部靠各文件手写。结果是同一语义有
// 十几种写法（绿 #63e2b7×16、金橙 #f6ad55/#facc15/#fbbf24/#f0a020 四种、红四种），改一处
// 要改十处，且明亮模式无人兜底（26 个 .vue 里 0 个有 html.light 覆盖）。
//
// 纯 CSS 改动在本仓库**没有任何自动化 verifier**：132 个 .test.ts 无一 import .vue，
// vitest environment='node'，1256 用例对样式全盲——既不会红，也证明不了生效。
// 本文件就是补这个缺口的：把「令牌是否闭合」「双主题是否对称」「色值是否回收」
// 「对比度是否达标」变成会大声失败的机器判据。
//
// 九条判据：
//   1. tokens-defined    —— var(--x) 引用必须在 global.css 有定义（防拼写/漏定义）
//   2. theme-parity      —— :root 与 html.light 的令牌键集必须双向相等（防双主题走偏）
//   3. hardcoded-color   —— 硬编码色值按文件棘轮，只减不增
//   4. font-size         —— 字号必须落在尺度档位上，离群值按文件棘轮，只减不增
//   5. contrast          —— 关键前景/背景对对比度达标（明亮模式白底白字的机器兜底）
//   6. alias             —— --wa-* 直接引用数只减不增（推语义别名层），var() 总数只增不减
//      （口径 = src 下全部 .vue **加** src/composables 下的 .ts：把取色/几何抽到 .ts 不再被误报）
//   7. font-stack-parity —— global.css 与 App.vue 的字体栈同源
//   8. naive-token-reuse —— App.vue 的 themeOverrides 与 global.css 令牌同值
//   9. scene-contrast    —— **3D 自绘 Canvas 场景**的底/墨成对达标
//      ⚠ 为什么必须单列（2026-09-18 round 31）：判据 5 的背景固定取 --app-panel/--app-bg，
//      而 3D 场景的底**由组件自己画**（不是页面底）⇒ 两个组件用固定深底 + 跟随主题的 --wa-*
//      墨色时，判据 5 **全绿**（令牌对页面底确实达标）而场景内实测塌到 **1.01:1**。
//      即：判据 5 的覆盖面**结构上到不了**自绘场景 —— 这是"护栏全绿但页面不可读"的典型盲区。
//  10. scene-ink-closure —— **形状面**，与判据 9 成对：场景选择器的 var() 必须落在 --scene-* 白名单
//  11. tinted-contrast  —— **自带底色贴片**（chip / 表头 / inset 行）的墨对比度达标
//      ⚠ 与判据 9 同源的**第二类结构盲区**（2026-09-18 round 31-a2 实测）：判据 5 的背景
//      **固定取 --app-panel**，而这类贴片在页面底上**又加了一层**（--wa-20~100 / 语义 -soft）
//      ⇒ 判据 5 只验「令牌 vs 页面底」，看不见「贴片上的墨」。实测：**37 条规则**在亮色档
//      掉到 1.03~3.82:1（23 条连 3.0 都不到），而判据 5 **全绿**。
//      另一条独立通路：**字面量与 :root 令牌逐位同值**（手抄的产物）⇒ 亮色档完全失效
//      （如 `#63e2b7` 在白底贴片上 1.49:1，而 `var(--c-success)` 是 4.63）。
//  12. tinted-ink-closure —— **形状面**，与判据 11 成对：贴片规则里不得写字面量色值
//      （= 该表面无法跟随主题）。只有行为面 ⇒ 「把 `--fg-2` 换回 `--wa-450`」看不见
//      （--wa-450 自己没变、仍在白名单外但值合法）；只有形状面 ⇒ 「字面量换成同值的错令牌」看不见。
//
// 用法：
//   node scripts/check-tokens.mjs             # 检查（npm run check / verify 已挂载）
//   node scripts/check-tokens.mjs --report    # 打印当前实测值，用于冻结/下调基线
//
// 逃生口：基线只许下调（进步），上调没有合法路径——要放宽先想清楚是不是在掩盖问题。
import { readFileSync, readdirSync, statSync, existsSync, realpathSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

export const GLOBAL_CSS = 'src/styles/global.css'

// ---------------------------------------------------------------- 文本解析

/** 去掉 CSS 注释（/* *\/ 与行注释），避免注释里的示例代码被计入 */
export function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[\s;{])\/\/[^\n]*/g, '$1')
}

/**
 * 抽出 .vue 的 <style> 块正文（去标签与注释）。
 * 返回 [{ content, startLine }]，startLine 用于归因（当前判据只用到计数，保留备用）。
 *
 * **`<style scoped src="./x.css">` 必须跟着读**（2026-09-14 实测缺口）：
 * 首版只看 `.vue` 内联的 `<style>` 正文，把样式外置到独立 `.css` 后**三份计数一起消失**
 * （实测 TimeChartsPage 把 627 行样式搬到 `views/timeCharts/TimeChartsPage.css` 后：
 * 硬编码色值 33→3、离群字号 8→0、var() 76→21），判据只会报「是进步，下调基线」——
 * 于是「把 CSS 挪出 .vue」成了三条棘轮的静默逃生通道。
 * 传 `{ root, filePath }` 时按 `<style src>` 解析同仓 `.css` 一并计入；不传则退回旧行为（纯字符串提取）。
 */
export function extractStyleBlocks(source, opts = {}) {
  const { root = null, filePath = null } = opts
  const out = []
  const re = /<style\b([^>]*)>([\s\S]*?)<\/style>/g
  let m
  while ((m = re.exec(source)) !== null) {
    const before = source.slice(0, m.index)
    const startLine = before.split('\n').length
    const attrs = m[1] ?? ''
    const srcMatch = /\bsrc\s*=\s*("([^"]*)"|'([^']*)')/.exec(attrs)
    const srcFile = srcMatch ? (srcMatch[2] ?? srcMatch[3] ?? '') : ''
    let content = stripComments(m[2])
    let external = ''
    if (srcFile && root && filePath) {
      // 解析相对 .vue 的路径；越出 root 或文件缺失时**不静默**——留一行注释型标记给归因
      const dir = dirname(join(root, filePath))
      const resolved = srcFile.startsWith('/') ? join(root, srcFile.slice(1)) : join(dir, srcFile)
      const rel = relative(root, resolved)
      if (!rel.startsWith('..') && existsSync(resolved)) {
        external = stripComments(readFileSync(resolved, 'utf8'))
        content += '\n' + external
      } else {
        content += `\n/* ✗ <style src="${srcFile}"> 无法解析（${rel}）——该块的色值/字号/var 未计入 */\n`
      }
    }
    out.push({ content, external, startLine })
  }
  return out
}

/**
 * 抽出 <template> 正文（内联 style="..." 与 :style 绑定都在这）。
 * **不含 <script>**：脚本里的属性/职业色板是「数据色」，UI_THEME_GUIDE §5 明确
 * 「明暗通吃，不进变量表」，把它们计入硬编码只会淹没真正该回收的主题色。
 */
export function extractTemplateSource(source) {
  const blocks = []
  const re = /<template\b[^>]*>([\s\S]*?)<\/template>/g
  let m
  while ((m = re.exec(source)) !== null) blocks.push(stripComments(m[1]))
  return blocks.join('\n')
}

/**
 * 抽出 CSS 声明区域（{...} 的内容），避开选择器里的 #id。
 * 用括号配对扫描，只取最内层花括号内容。
 */
export function extractDeclarationRegions(css) {
  const out = []
  const stack = []
  let buf = ''
  for (let i = 0; i < css.length; i++) {
    const ch = css[i]
    if (ch === '{') {
      if (stack.length === 0) { stack.push(i); buf = ''; continue }
      stack.push(i); buf += ch; continue
    }
    if (ch === '}') {
      stack.pop()
      if (stack.length === 0) { out.push(buf); buf = '' }
      else buf += ch
      continue
    }
    if (stack.length > 0) buf += ch
  }
  return out
}

const HEX_RE = /#[0-9a-fA-F]{3,8}\b/g
const FN_COLOR_RE = /\b(?:rgb|rgba|hsl|hsla)\s*\([^)]*\)/g

/** 数一段文本里的硬编码色值（hex + rgb/rgba/hsl/hsla 函数调用） */
export function countHardcodedColors(text) {
  const hex = text.match(HEX_RE) ?? []
  const fn = text.match(FN_COLOR_RE) ?? []
  return hex.length + fn.length
}

/**
 * 去掉 JS/TS 注释（`//` 行注释与 `/* *\/` 块注释），保留字符串字面量内容。
 *
 * 为什么需要（2026-09-18 round 31 实测）：判据 10 要抓 `ctx.fillStyle = 'var(--x)'`
 * 这个**会被静默忽略**的写法，而两文件的反面教材注释里**逐字引用**了它 ⇒ 不剥注释
 * 就把「说明这个坑的文档」本身判成违规（首版实测 2 条假红）。
 * ⚠ 与 CSS 版 stripComments 分开：JS 的 `//` 在 URL（`https://`）里也会出现，
 * 故先保护字符串字面量再剥。
 */
export function stripJsComments(text) {
  // 先把字符串/模板串替换成占位符（保留长度无关，只求不被注释正则误伤）
  const strings = []
  const masked = String(text).replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, (m) => {
    strings.push(m)
    return `\u0000${strings.length - 1}\u0000`
  })
  const stripped = masked
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  return stripped.replace(/\u0000(\d+)\u0000/g, (_, i) => strings[Number(i)])
}

/** 所有 var(--x) 引用的令牌名（含 fallback 语法 var(--a, #fff) 只取主名） */
export function findVarRefs(text) {
  return [...text.matchAll(/var\(\s*(--[\w-]+)/g)].map(m => m[1])
}

/**
 * 归一化字体栈用于比对：抹掉引号、折行与大小写差异，只比字体序列本身。
 * （global.css 里的值为了可读性折了行，App.vue 里是单行——直接字符串比会假红。）
 */
export function normalizeFontStack(input) {
  return String(input)
    .replace(/\s+/g, ' ')
    .replace(/["']/g, '')
    .trim()
    .toLowerCase()
    .replace(/,\s*$/, '')
}

/** 从 App.vue 源码抽 common.fontFamily 的字面值 */
export function extractAppFontFamily(appSource) {
  const m = appSource.match(/fontFamily\s*:\s*(['"])((?:[^\\]|\\.)*?)\1/)
  return m ? m[2] : null
}

/**
 * 按名字抽一个 `{ ... }` 块的内容（花括号配对，可嵌套）。
 * 同时支持 `const <name> ...= {` 与 `<name>: {` 两种写法。
 */
export function extractBlock(source, name) {
  const re = new RegExp(`(?:const\\s+${name}\\b[^=]*=\\s*\\{|\\b${name}\\s*:\\s*\\{)`)
  const m = re.exec(source)
  if (!m) return null
  const open = source.indexOf('{', m.index)
  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') { depth--; if (depth === 0) return source.slice(open + 1, i) }
  }
  return null
}

/** 去掉嵌套的 `{...}`，只留顶层内容（用于取顶层 key: value，不被子组件段干扰） */
export function stripNestedBraces(block) {
  let depth = 0
  let out = ''
  for (const ch of block) {
    if (ch === '{') { depth++; continue }
    if (ch === '}') { depth--; continue }
    if (depth === 0) out += ch
  }
  return out
}

/** 抽顶层 `key: 'value'` 对（值用单引号，App.vue 的写法） */
export function extractFlatPairs(block) {
  if (block == null) return new Map()
  const out = new Map()
  for (const m of stripNestedBraces(block).matchAll(/(\w+)\s*:\s*'([^']*)'/g)) out.set(m[1], m[2])
  return out
}

/**
 * 跟随别名取最终原始值（--fill-hover → var(--wa-60) → rgba(...)），最多 8 层。
 * fallback：别名层只定义在 :root，按主题块解析时会缺失，需要退回合并表继续跟链
 * （链中间每一跳仍优先用主题自己的值，所以 --wa-60 会取到该主题的正确色）。
 */
export function resolveTokenRaw(tokens, name, fallback) {
  let cur = name
  for (let i = 0; i < 8; i++) {
    const raw = tokens.has(cur) ? tokens.get(cur) : fallback?.get(cur)
    if (raw == null) return null
    const ref = raw.match(/var\(\s*(--[\w-]+)/)
    if (!ref) return raw
    cur = ref[1]
  }
  return null
}

/** 同值判定：能解析成颜色就比颜色（容忍 `rgba(1,2,3,.5)` 与 `rgba(1, 2, 3, 0.5)` 的写法差异），否则比归一化字符串 */
export function sameValue(a, b) {
  if (a == null || b == null) return false
  const ca = parseColor(a)
  const cb = parseColor(b)
  if (ca && cb) {
    const eq = (x, y) => Math.abs(x - y) < 0.005
    return eq(ca.r, cb.r) && eq(ca.g, cb.g) && eq(ca.b, cb.b) && eq(ca.a, cb.a)
  }
  return String(a).replace(/\s+/g, ' ').trim() === String(b).replace(/\s+/g, ' ').trim()
}

/** 字号声明值（px / rem / em），用于尺度判据 */
export function findFontSizes(css) {
  return [...css.matchAll(/font-size\s*:\s*([\d.]+)(px|rem|em)/g)].map(m => ({
    value: m[1] + m[2],
    num: parseFloat(m[1]),
    unit: m[2],
  }))
}

// ---------------------------------------------------------------- 令牌表

/**
 * 解析 global.css：返回 { root: Map(name->value), light: Map, order: [] }
 * 只取顶层 :root / html.light 两个块；其它选择器里的变量定义不参与奇偶校验。
 */
export function parseGlobalTokens(css) {
  const src = stripComments(css)
  const grab = (selectorRe) => {
    const map = new Map()
    const m = src.match(selectorRe)
    if (!m) return map
    // 从选择器位置起做一次花括号配对，取出块体
    const open = src.indexOf('{', m.index)
    if (open < 0) return map
    let depth = 0, close = -1
    for (let i = open; i < src.length; i++) {
      if (src[i] === '{') depth++
      else if (src[i] === '}') { depth--; if (depth === 0) { close = i; break } }
    }
    const body = src.slice(open + 1, close < 0 ? src.length : close)
    for (const dm of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      map.set(dm[1], dm[2].trim())
    }
    return map
  }
  return {
    root: grab(/^\s*:root\s*\{/m),
    light: grab(/^\s*html\.light\s*\{/m),
  }
}

// ---------------------------------------------------------------- 颜色计算

/** 解析 #rgb / #rgba / #rrggbb / #rrggbbaa / rgb() / rgba() → { r,g,b,a }（0-255 / 0-1） */
export function parseColor(input) {
  if (typeof input !== 'string') return null
  const s = input.trim().toLowerCase()
  let m = s.match(/^#([0-9a-f]{3,4})$/)
  if (m) {
    const h = m[1]
    return {
      r: parseInt(h[0] + h[0], 16),
      g: parseInt(h[1] + h[1], 16),
      b: parseInt(h[2] + h[2], 16),
      a: h.length === 4 ? parseInt(h[3] + h[3], 16) / 255 : 1,
    }
  }
  m = s.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/)
  if (m) {
    return {
      r: parseInt(m[1].slice(0, 2), 16),
      g: parseInt(m[1].slice(2, 4), 16),
      b: parseInt(m[1].slice(4, 6), 16),
      a: m[2] ? parseInt(m[2], 16) / 255 : 1,
    }
  }
  m = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/)
  if (m) {
    return {
      r: parseFloat(m[1]),
      g: parseFloat(m[2]),
      b: parseFloat(m[3]),
      a: m[4] === undefined ? 1 : (m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4])),
    }
  }
  return null
}

/** alpha 合成：把半透明前景压到不透明背景上 */
export function flatten(fg, bg) {
  const a = fg.a ?? 1
  return {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
    a: 1,
  }
}

/** WCAG 相对亮度 */
export function relativeLuminance({ r, g, b }) {
  const f = (v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

/** WCAG 对比度（1..21） */
export function contrastRatio(fg, bg) {
  const l1 = relativeLuminance(flatten(fg, bg))
  const l2 = relativeLuminance(bg)
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1]
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * 从令牌表里解析一个令牌的最终颜色（跟随 var() 引用，最多 8 层防环）。
 * 半透明令牌会被压到 baseBg 上。
 */
export function resolveTokenColor(tokens, name, baseBg) {
  let cur = name
  for (let i = 0; i < 8; i++) {
    const raw = tokens.get(cur)
    if (!raw) return null
    const direct = parseColor(raw)
    if (direct) return direct.a < 1 && baseBg ? flatten(direct, baseBg) : direct
    const ref = raw.match(/var\(\s*(--[\w-]+)/)
    if (!ref) return null
    cur = ref[1]
  }
  return null
}

// ---------------------------------------------------------------- 扫描

/**
 * 扫描面 = `src/**` 的全部 `.vue` **加** `src/styles/*.css`。
 *
 * 为什么把 `src/styles/*.css` 收进来（2026-09-14，收敛跨页图表样式时发现）：
 * 首版的扫描面只有 `.vue`（+ `src/composables/*.ts` 贡献 var 引用），于是**把 CSS 从 .vue 搬进
 * `src/styles/` 会让四条棘轮一起失明**——与 2026-09-14 早先修的 `<style src>` 盲区**同型**
 * （那次是搬进独立 .css，这次是搬进 styles 目录）。实测：把 6 个跨页图表类收进
 * `styles/charts.css` 后，若不扩面，两页的硬编码色值/离群字号计数会「凭空下降」，
 * 判据只会报「是进步，把基线下调」⇒ 又一个静默逃生通道。
 *
 * ⚠ `global.css` **除外**：它是令牌定义源（`:root`/`html.light` 的字面色值就是定义本体），
 * 计进去会把「定义」误判成「散落」（与 `App.vue` 在 HARDCODED_WHITELIST 里同一个道理）。
 */
export const STYLE_SHEET_EXCLUDED = ['src/styles/global.css']

function walkVue(root) {
  const out = []
  const rec = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) rec(p)
      else if (name.endsWith('.vue')) out.push(relative(root, p).split(sep).join('/'))
    }
  }
  rec(join(root, 'src'))
  // src/styles/*.css（顶层，不递归子目录：目前只有 global.css 与 charts.css）
  const stylesDir = join(root, 'src', 'styles')
  if (existsSync(stylesDir)) {
    for (const name of readdirSync(stylesDir)) {
      if (!name.endsWith('.css')) continue
      const rel = relative(root, join(stylesDir, name)).split(sep).join('/')
      if (!STYLE_SHEET_EXCLUDED.includes(rel)) out.push(rel)
    }
  }
  return out.sort()
}

/**
 * 扫描 `src/composables` 下的 .ts（递归，排除 `__tests__` 与 `*.test.ts`）里的 var() 引用。
 *
 * 为什么需要（2026-09-12 评审 #14 时连续踩中三次）：`var()` 总数与 `--wa-*` 直引两个棘轮
 * **原先只扫 .vue**，于是「把图表的取色/几何逻辑抽到 composables/*.ts」每次都被判成
 * "有变量被改回字面量"（实测连续 571→569→566→561 四次下调基线）。更糟的是反向也漏：
 * **在 .ts 里把 `var(--x)` 改成字面色值，本判据完全看不见** —— 而 `src/composables/` 正是
 * 图表取色的主要落点（`timelineChart` / `versionChartGeometry` / `filmSimChart` /
 * `pullValueChart` / `pullPlannerChart` 等）。
 * 故把该目录的 .ts 一并纳入 var() 统计与「令牌必须已定义」检查。
 * 注：只贡献 var 引用，**不参与**按文件的硬编码色值/字号基线（那些基线的口径仍是 .vue）。
 */
export function scanComposableFiles(root) {
  const out = []
  const base = join(root, 'src', 'composables')
  if (!existsSync(base)) return out
  const rec = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) {
        if (name === '__tests__') continue
        rec(p)
      } else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) {
        const rel = relative(root, p).split(sep).join('/')
        const src = readFileSync(p, 'utf8')
        out.push({ path: rel, varRefs: findVarRefs(stripComments(src)) })
      }
    }
  }
  rec(base)
  return out.sort((a, b) => a.path.localeCompare(b.path))
}

/**
 * 逐文件扫描 .vue：硬编码色值数、离群字号数、var() 引用。
 * 返回 [{ path, hardcoded, fontOutliers: [{value}], varRefs: [names] }]
 */
export function scanVueFiles(root, fontScale) {
  const scale = new Set(fontScale)
  return walkVue(root).map(path => {
    const source = readFileSync(join(root, path), 'utf8')
    // 独立 .css 文件没有 <style> 包裹：整份正文就是样式（否则会算出 0，又是一次静默失明）
    const isPlainCss = path.endsWith('.css')
    const styleBlocks = isPlainCss
      ? [{ content: stripComments(source), external: '', startLine: 1 }]
      : extractStyleBlocks(source, { root, filePath: path })
    const css = styleBlocks.map(b => b.content).join('\n')
    const decls = extractDeclarationRegions(css).join('\n')

    // 硬编码色值：样式只数声明区（避开 #id 选择器）+ 模板内联样式；排除 <script> 的数据色
    const hardcoded = countHardcodedColors(decls) + countHardcodedColors(extractTemplateSource(source))
    // 字号：只在 CSS 声明里
    const fontOutliers = findFontSizes(decls).filter(f => !scale.has(f.num)).map(f => f.value)
    // varRefs 必须走「去注释」后的文本：注释里引用旧令牌名（如「原为 var(--x)」）不是活引用，
    // 计入会让 tokens-defined 与 alias 棘轮同时误报。
    // **外置样式表里的引用也要计入**（同 extractStyleBlocks 的 src 说明）：否则把 CSS 搬出 .vue
    // 会让 var 总数「无端下跌」，alias 棘轮当场误报「有变量被改回字面量」。
    // 只补 `external`（真正来自 .css 文件的那部分）——内联 <style> 本来就在 source 里，补整块会双计。
    const externalCss = styleBlocks.map(b => b.external ?? '').join('\n')
    return { path, hardcoded, fontOutliers, varRefs: findVarRefs(stripComments(source) + '\n' + externalCss) }
  })
}

// ---------------------------------------------------------------- 基线

/**
 * 硬编码色值的合法白名单：这些位置的字面色值是**定义本体**，不是散落的重复。
 * 注：判据只扫 .vue 的 <style> 声明区与 <template> 内联样式——<script> 里的
 * 属性/职业色板是 UI_THEME_GUIDE §5 认可的「数据色」，不计入。
 */
export const HARDCODED_WHITELIST = [
  'src/App.vue', // Naive UI themeOverrides 必须给具体色值（JS 侧，无 CSS 变量可用）
]

/**
 * 硬编码色值基线（按文件，2026-08-31 首次运行 `node scripts/check-tokens.mjs --report` 实测冻结）。
 * 口径：<style> 声明区 + <template> 内联样式里的 hex / rgb() / rgba() / hsl() / hsla()。
 * 合计 184 处。棘轮：每文件只允许「等于基线」，多于基线 = 新增债务，少于基线 = 进步但
 * 必须把数字下调（防止基线变死数据，与 check-guards 的 AGENT_BRANCH_BASELINE 同纪律）。
 */
export const HARDCODED_BASELINE = {
  'src/components/AppHeader.vue': 3,
  'src/components/BossCard.vue': 7,
  'src/components/BossSelectCard.vue': 3,
  'src/components/CharacterCard.vue': 3,
  'src/components/FinalPanel.vue': 3,
  'src/components/ImpactChart.vue': 4,
  'src/components/MarginalUtilityCard.vue': 1,
  'src/components/ResourceResultCard.vue': 7,
  'src/components/StatPanel.vue': 6,
  'src/views/AttributeConfigPage.vue': 2,
  'src/views/BossHpInflationPage.vue': 1,
  'src/views/CalculatorView.vue': 1,
  'src/views/CharIncrementPage.vue': 3,
  'src/views/DebugPage.vue': 1,
  'src/views/LogicEditorPage.vue': 1,
  'src/views/MechanicsTablePage.vue': 0,
  'src/views/PositionComparePage.vue': 3,
  'src/views/ResourceUtilizationPage.vue': 2,
  'src/views/ResultPage.vue': 3,
  'src/views/RunArchivePage.vue': 4,
  'src/views/StunAxisPage.vue': 17,
  'src/views/TeamComparePage.vue': 4,
  'src/views/TeamConfigPage.vue': 0,
  // 2026-09-12 评审 #14 第十刀：悬浮卡样式整体搬进 components/ChartHoverCard.vue
  // （scoped 样式不作用到子组件 ⇒ 必须随组件走）。该文件 2 处字面色值是**逐字搬迁**：
  // `.hc-swap` 的 #f6ad55 与 `.hover-card` 的 box-shadow rgba(0,0,0,.4)——本次不改观感，
  // 若将来要令牌化，属独立的视觉调整（需实机比对）。
  'src/components/ChartHoverCard.vue': 1,
  // 2026-09-14 直伤系数图抽组件（components/charts/DirectDamageChart.vue）：2 处字面色值是**逐字搬迁**——
  // 模板里测试服阴影的 rgba(246,173,85,.06) 与 .dd-label 的 paint-order 描边 rgba(10,10,14,.85)。
  // 页面侧同轮下降 33 → 32（删掉了随组件走的 4 条 dd-* 规则里的字面色值）。
  'src/components/charts/DirectDamageChart.vue': 2,
  // 2026-09-14 控制面板抽组件（components/charts/TimeChartsControls.vue）：1 处字面色值是**逐字搬迁**
  // —— .boss-data-title 的 #f6ad55（原在 TimeChartsPage.css）。页面侧同轮 32 → 31。
  'src/components/charts/TimeChartsControls.vue': 0,
  // Chart 4 抽组件（2026-09-14）：这两处字面色值是**逐字搬迁**（`.sim-gold-line` 的 #f6ad55、
  // `.gold-axis-label` 的 rgba(246,173,85,0.75)），原记在 TimeChartsPage.vue 名下 ⇒ 那边 20→18、
  // 这边 +2，**合计 160 不变**（棘轮未放松）。
  // 为什么不顺手换成 var(--c-warning)：暗色主题下 --c-warning == #f6ad55，但**亮色主题是 #b45309**
  //（global.css 双主题对称）⇒ 换令牌 = 亮色主题金线改色 = 真视觉 delta，与「抽组件零 delta」的验收冲突。
  // 正解（单独一轮 + 双主题实机取证）见账本 Open。
  'src/components/charts/FilmSimChart.vue': 1,
  // Chart 6 抽组件（2026-09-14，工人 309e86b2 复核数字、派活方登记）：18 → 12，**净 −6 全部是逐字搬迁**
  // （lane-cell/lane-text 随 lane-* 共用类进 chart-blocks.css +2；pp-purchase/pp-team-text/pv-sel-row
  //  + 模板 rgba(99,179,237,.13) 随组件走 +4）。三处合计 12+5+4 = 21，与改前 18+3 = 21 **相等 ⇒ 棘轮未放松**。
  // ⚠ pv-sel-row 不换令牌也不搬进共享表：它一搬 = Chart 5 的选中高亮凭空出现 = 真视觉 delta（见该 css 头注释）。
  'src/components/charts/PullPlannerChart.vue': 3,  // 4 → 3（2026-09-15 N2：`.pv-sel-row` 的选中行底色原写在这里、` 只有 Chart 6 一个 scope 生效；迁进 styles/chart-blocks.css 并换成语义令牌 `--c-warning-soft`（双主题各一份）⇒ 该文件的字面色值少一处。
  'src/views/TimeChartsPage.vue': 7,   // 23 → 21（node-note 的两处字面色值随该类迁去 chart-blocks.css）
  // → 20（2026-09-14 修「抽组件后样式留在页面 scoped」失样式面：`.kill-line-ref` 从页面 scoped
  // 搬进 styles/chart-blocks.css 时，那条字面 `rgba(99,226,183,0.35)` 换成语义令牌
  // `stroke: var(--c-success)` + `stroke-opacity: .35`（暗色主题逐位等价）⇒ 净 −1 处字面色值。
  // 2026-09-14 图表块基元外置（src/styles/chart-blocks.css，经 <style scoped src> 载入）：
  // 1 处字面色值是**逐字搬迁**——`.kill-line` 的 #63e2b7（原在 TimeChartsPage.css）。页面 31 → 30。
  'src/styles/chart-blocks.css': 3,  // 3 → 5（2026-09-14 Chart 6 抽组件：`.lane-cell`/`.lane-text` 两条 rgba 随 lane-* 共用类**逐字搬迁**进来；
  //   同轮页面 18→12、新组件 +4，三处合计 12+5+4 = 21 = 改前 18+3 ⇒ **总量不变、棘轮未放松**）   // 1 → 3（+ .node-note 的 #f6ad55 与 rgba(246,173,85,.35)，逐字搬迁）
  // 2026-09-14 Chart 5 抽组件（components/charts/PullValueChart.vue）：7 处字面色值是**整组搬迁**
  // （原在 TimeChartsPage.css 的 .pv-* 规则里）。页面 30 → 23。
  'src/components/charts/PullValueChart.vue': 5,
  'src/views/WEngineFieldPage.vue': 2,
  // ---- 2026-09-18 round 29：3D 可视化组件（外部协作者 `310ba51`）——**修红基线，非新增债务** ----
  //
  // ⚠ 背景：`310ba51` 落地两个 3D 组件时**未同步本表**，导致 HEAD 上 `check-tokens` **EXIT=1**
  // （3 条判据红）。因 `npm run verify` 是 `&&` 链，这一红**吞掉了后面 5 步**（validate:data /
  // validate:specs / verify:recording / vitest / build 全程不跑）——正是判据 10「红基线不允许过夜」
  // 描述的那类失效（历史上有 job 因同样的原因整张护栏哑掉）。本表按**规则 10**（先量 delta → 逐条
  // 归因 → 确认有意才登记）补登记。**实测归因 = 两文件贡献，逐项可被单一变量解释**：
  //   硬编码色值：两文件 44 处（28 + 16）——但全库合计 184 → 203（**Δ+19**，非 +44）
  //   即旧文件侧同轮净 −25（别处令牌化），棘轮方向未被本次放松。
  //
  // 为什么这些字面色值**不换成语义令牌**（与上面 FilmSimChart 同一条理由）：
  // 两组件都是 **Canvas 深色场景**（`.rs3d-canvas-container` / `.td3d-canvas-wrap` 自带
  // `radial-gradient` 固定深底，`html.light` 零覆盖），其墨色是**按深底调的**；
  // `--c-*`/`--fg-*` 在 `html.light` 被整体压深（`--c-success` 霓虹 #63e2b7 → #0f7a5a）
  // ⇒ 换令牌 = 深底上凭空变暗 = 真视觉 delta。**正解是让 3D 场景跟随主题**
  // （单独一轮 + 双主题实机取证），见 OPEN-ITEMS「3D 组件主题化」条。
  // 本轮的 `--wa-120/--wa-60/--wa-100 → --line/--fill-hover/--fill-active` 是**唯一可严格等价**的一步
  // （这三个别名只在 `:root` 定义、委托同名 `--wa-*`，`html.light` **未重定义** ⇒ 双主题逐位不变）。
  // ⚠ `--wa-400` **没有**这样换：`:root` 是 `--fg-placeholder: var(--wa-400)`，但 `html.light`
  // 重定义为 `var(--wa-480)` ⇒ 换它会在亮色下改观感（**不是**等价变换）。
  //
  // ---- 2026-09-18 round 31：**3D 场景主题化落地**（R29-J2 结案）⇒ 两行基线大幅下调 ----
  // 改法：`--scene-*` 场景专用令牌（`global.css` 双主题各一份，由 theme-parity 校验）+
  // Canvas 侧 `sceneInk()`/`sceneInkAlpha()` 读回真实色值（Canvas 不解析 var()，见 R29 那条 bug）。
  // 实测：28 → **5**（剩下 5 处见下方说明）、16 → **0**。**这是棘轮要求的方向（只减不增）。**
  // ⚠ 剩下的 5 处是 `.rs3d-color-spectrum` 的**色阶图例**（Z 值 → 颜色的映射条），
  // 其色标必须与 `getZColor()` 的数值分段逐位一致；换成主题令牌会让「图例说的颜色」与
  // 「曲面实际画的颜色」分叉 ⇒ 属**数据色**（UI_THEME_GUIDE §5「明暗通吃，不进变量表」），
  // 与 3D 场景底/墨无关，**故保留为字面值并在此登记**（不是漏网）。
  'src/components/charts/ResponseSurface3D.vue': 5,
  // 16 → **0**（round 31 场景主题化）：该文件的 16 处字面色值**全部**收进 `--scene-*` 令牌
  // 或 `sceneInkAlpha()`（唯一剩下的 `TYPE_COLOR_MAP` 属性色板在 `<script>` 里 = 数据色，本判据不计）。
  // 保留 0 这一行而不是删键：与 FONT_SIZE_BASELINE 的 `TimeChartsPage.vue: 0` 同款——
  // **键在 = 「这个文件已被清账」这件事本身是记录**，删键会让后来者以为从未审计过。
  'src/components/charts/TeamDamage3DChart.vue': 0,
}

/**
 * 字号尺度档位。从现有 286 处 font-size 声明的实测频次收敛而来（不是凭空拍）：
 * 8/9 图表刻度微标、10 次要、11 次要正文、**12 正文主力(86 处)**、13 小标题、
 * 14 标题、16/18/20/24 显示级。
 * 归并规则：**半档一律向下取整**（11.5→11、10.5→10、9.5→9、8.5→8），
 * 整数离群值向下归到最近档位（15→14、17→16、22→20），7 上抬到最小档 8。
 * 向下取整是为了守住「密度不降」——字号变大才会挤压一屏可见行数。
 */
export const FONT_SCALE = [8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 24]

/**
 * 离群字号基线（按文件，2026-08-31 实测冻结；B3 清洗 AppHeader 17px→--text-3xl 后 21→20）。
 * 10.5px×5  11.5px×5  9.5px×3  15px×3  8.5px×2  7px/22px 各 1。
 * 同棘轮语义：清洗一个文件就下调该行数字。
 */
export const FONT_SIZE_BASELINE = {
  'src/components/BossCard.vue': 1,
  'src/components/FinalPanel.vue': 4,
  'src/views/CharIncrementPage.vue': 2,
  'src/views/MechanicsTablePage.vue': 1,
  'src/views/ResourcePage.vue': 2,
  'src/views/StunAxisPage.vue': 1,
  // 同上：11.5px 随样式搬入 ChartHoverCard（原就在页面的离群基线里，本次仅文件归属变化）
  'src/components/ChartHoverCard.vue': 1,
  'src/views/TimeChartsPage.vue': 0,   // 3 → 0：最后三处（11.5/11.5/8.5px）归到档位 11/11/8（目标里「清零两页离群字号」达成）
  'src/components/charts/DirectDamageChart.vue': 1,   // .dd-caption 的 11.5px（搬迁前就在页面的离群基线里）
  'src/components/charts/TimeChartsControls.vue': 1,   // .boss-data-item 的 11.5px（原在页面的离群基线里）
  'src/components/charts/PullValueChart.vue': 2,   // .pv-row-label 10.5px / .pv-detail-bar-label 8.5px（随组件搬迁）
  // 2026-09-14 第二轮：共享控件基元（.ctl-*/.chart-progress/.progress-text/.ctl-note）收敛到
  // src/styles/charts.css ⇒ `.ctl-note` 的 10.5px 从页面基线**平移**到本表（页面 7→6、本表 0→1），
  // 合计不变。是归属变化不是新增债务。
  'src/styles/charts.css': 1,
  // 2026-09-18 round 29：3D 响应面的空态图标 36px（外部协作者 `310ba51`）。
  // 36 不在 FONT_SCALE 档位里；但它是**空态占位图标**（`.rs3d-empty-icon`，一个 📊 类的装饰字符），
  // 不是正文字号 ⇒ 归到档位 24 会显著改版式。按既有先例（PullValueChart 的 8.5/10.5px 同样登记在册）
  // 冻结一行，**不动档位表**。若要清零，属独立的视觉调整（需实机比对空态观感）。
  'src/components/charts/ResponseSurface3D.vue': 1,
}

/**
 * --wa-* 直接引用总数基线（2026-08-31 实测 449；B3 顶栏换 --app-border/--fg-2 后 447）。
 * 为什么要有这条：--wa-* 的 47 档是历史 codemod 的机械产物（原 rgba(255,255,255,α)），
 * 人记不住 `--wa-250` 是描边还是悬浮底——这是「同义色散落」的同类病根。
 * 解法是加语义别名层（--line/--line-strong/--fill-hover/--fill-active/--text-2/--text-3），
 * 新代码用别名、老代码不动，本棘轮保证直接引用数只减不增。
 */
export const WA_REF_BASELINE = 448  /* ★ 2026-09-18 round 31-a2「贴片墨对比度」：466 → **448**（−18）。
   方向 = 棘轮要求的方向（只减不增）。逐条归因：12 个文件把「按页面底调」的三级墨
   （`--wa-350/--wa-400/--wa-450/--wa-500/--wa-520/--wa-550/--wa-600/--wa-460`）
   换成**既有语义别名 `--fg-2`**（次级文字）——它们原是压在自己**带浅底**的贴片
   （chip / 表头 / inset 行）上，实测亮色档掉到 2.18~3.82:1（正文门槛 4.5）。
   `--fg-2` 在全部 22 种贴片底上两侧最差 **4.63** ⇒ 不必另立新档（规则 12：能复用就不新增）。
   另 +2 处是 `.sap-mw-window.mw-l2/mw-l3` 换成 `--wa-700/--wa-750`（那两条底是
   自定义半透明 rgba(…,0.35)，`--fg-2` 的 0.75α 在**夜间**只有 4.00~4.76，不够；见下）。
   ⚠ 净 −18 里含「同值令牌化」的 4 处：`#63e2b7/#93c5fd/#f6ad55` 等字面量与
   `--c-success/--c-info/--c-warning` **逐位同值**（手抄 :root 的产物）⇒ 改回令牌后
   夜间逐位不变、亮色档从 1.49~1.79 升到 4.5+。
   下方 round 31 的原始归因保留（它是 3D 场景那批的历史证据）。 */
  /* 466（2026-09-18 round 31「3D 场景主题化」）：474 → **466**（−8）。
   方向 = 棘轮要求的方向（只减不增）。逐条归因：两组件把**按页面底调**的 --wa-* 直引
   （在自绘场景里语义就是错的 —— 实测亮色档压到场景底只有 1.01~2.89:1）换成
   `--scene-*` 场景专用令牌；其中 18 处落在场景选择器/Canvas 里（由 --scene-* 接管），
   另有 8 处 `--wa-400/--wa-450/--wa-500` 的文字墨改为 `--scene-ink-dim` ⇒ --wa-* −8，
   而 var() 总数不变（687，1:1 换名）——**两个数字一起看才说明"换的是语义不是数量"**。
   ⚠ 下方 round 29 的原始归因保留（它是补登记红基线那次的历史证据）。 */
  /* 444 → 474（2026-09-18 round 29：3D 可视化组件 `310ba51` 未同步本表
   ⇒ HEAD `check-tokens` EXIT=1，按规则 10 量 delta 后补登记。delta 逐条归因：
   ResponseSurface3D.vue +18、TeamDamage3DChart.vue +22 ⇒ 恰好 +40；本轮把其中 6 处**严格等价**的
   `--wa-120/--wa-60/--wa-100` 换成 `--line/--fill-hover/--fill-active`（这三个别名只在 :root 定义、
   委托同名 --wa-*，html.light 未重定义 ⇒ 双主题逐位不变）⇒ 484 − 6 − 4(见下) = **474**。
   ⚠ 同轮修了一个**真 bug**：`TeamDamage3DChart.vue` 的 3D 柱阵标签写
   `ctx.fillStyle = 'var(--wa-450)'` —— Canvas **不解析 CSS 变量**且**静默忽略**该赋值
   ⇒ 非 hover 标签继承了上一笔的 `shadeColor(s.color,-25)`。已改为 `cssVarColor('--fg-3')`
   （getComputedStyle 读回真实色值，跟随主题）。该处同时使 --wa-* 再 −1、var() 再 +1。 */  /* 443 → 444（2026-09-14 直伤系数图抽组件：图例类随组件走，
   组件内多出 6 处 --wa-* 引用，页面侧同步减少 ⇒ 净 +1）。 */
  /* 446 → 443（2026-09-14 图表样式收敛）：6 个跨页同名类
   （grid-line/axis-label/x-label/hover-line/trend-line/trend-point）从两页各自 scoped 定义
   收敛进 src/styles/charts.css。逐字归因：删 8 个 var（时间图表 4 / 血量膨胀 4）、新增共享表 5 个
   ⇒ 净 −3；wa 删 7、新增 4 ⇒ 净 −3。**是去重不是回退**（`--wa-80`/`--wa-450`/`--wa-350` 各从 2 份变 1 份）。
   同轮 check-tokens 的扫描面扩到 src/styles/*.css——否则这次「搬家」会让四条棘轮一起失明。 */

/** var() 引用总数基线（2026-08-31 实测 494→497→502；B4 语义色替换后 524；2026-09-03 实战对比 buff 快捷区 +1；2026-09-04 难度权重弹层 --fg-2 +1；2026-09-04 时间图表 Chart 7 同槽位对比 --c-info/--c-warning/--line-strong 等 +12；2026-09-10 失衡易伤可见化 结果页列/汇总行 + 部署页缺口折叠 = +10；2026-09-10 难度曲线「被挤掉」行 --c-danger +1（全部语义别名，同轮 hardcoded-color/tokens-defined 转绿）；2026-09-12 图表图例筛选交互（队伍对比/时间图表/血量膨胀三页图例可点 + 隐藏态 --fill-hover/--line-strong/--fg-3；血量膨胀页图例收敛到共享 seriesFilter 时把 --wa-750 换成 --fg-2）= +21；2026-09-13 Boss 卡控制技组编辑器（ca-label/ca-idx/ca-fold 全走 --fg-2/--fg-3 语义别名）= +3；2026-09-13 结果页失衡易伤逐人增幅行（--app-tablehead-bg/--app-accent-gold）= +2）。只增不减，防把变量改回字面量 */
export const VAR_TOTAL_BASELINE = 743  /* ★ 2026-09-18 round 31-a2「贴片墨对比度」：687 → **743**（+56）。
   这是**棘轮允许的方向**（本键语义 = 「只增不减，防把变量改回字面量」）⇒ 上调即进步登记。
   逐条归因：12 个文件的贴片墨改成 `var(--fg-2)`（既有别名）+ 4 处逐位同值字面量
   （`#63e2b7`→`var(--c-success)` 等）改成令牌 + `.sap-mw-window.*` 两条换 `--wa-700/--wa-750`。
   ⚠ 两个数字一起看：--wa-* 直引 **−18** 而 var() 总数 **+22** ⇒ 说明「换的是语义不是数量」。
   下方 round 31 的原始归因保留。 */
  /* 687（2026-09-18 round 31「3D 场景主题化」）：648 → **687**（+39）。
   这是**棘轮允许的方向**（本键语义 = 「只增不减，防把变量改回字面量」）⇒ 上调即进步登记。
   逐文件归因（`--report` 实测）：两组件把 44 处字面色值换成 `var(--scene-*)` /
   `--c-*` 令牌，另加 `--line`/`--fill-hover`/`--fill-active` 既有替换；
   ⚠ 同时 **--wa-\* 直引净 0**（474，见 WA_REF_BASELINE 注释）——两个数字一起看才说明
   「换的是语义不是数量」。下方 round 29 的原始归因保留。 */
  /* 605 → 648（2026-09-18 round 29：同上，3D 组件 `310ba51` 未同步）
   —— 两文件合计 +44 处 var()（ResponseSurface3D 21 / TeamDamage3DChart 23）；
   本轮把 6 处严格等价的 --wa-* 换成语义别名（var() 总数不变，只动 --wa-* 分项），
   并把 1 处 Canvas 非法 `var()` 改成 `cssVarColor()` 调用（--wa-* −1、var() +1）⇒ 实到 648。
   ⚠ 这是**补登记既有红基线**（同轮 check-tokens 由 EXIT=1 转 EXIT=0），不是新增债务：
   棘轮方向未被本次放松——本轮自己的改动只让 --wa-* **下降**（474 < 484）。 */  /* 604 → 605（2026-09-15 N2：`.pv-sel-row` 底色由字面 rgba 换成 var(--c-warning-soft)，+1 处 var() 引用；同轮 hardcoded-color 因此 −1）。 */  /* 601 → 604（2026-09-15 同页：无专武档的下位件展示条 `<div class="fc-note">` —— 3 处全走语义别名 --fg-3/--fg-2/--line，`--wa-*` 直引仍 444 不变）。 */  /* 582 → 601（2026-09-15 自由对比工作台：`views/FreeComparePage.vue` 全页**零 `--wa-*` 直引**——11 处全走语义别名 --fg-3/--fg-2/--line，纯新增 var() 引用 +19；`--wa-*` 直引保持 444 不变，符合「老代码不动、新代码只用别名」的棘轮方向）。 */  /* 581 → 582（2026-09-14 同上：`.kill-line-ref` 的字面色值换成 var(--c-success)，+1 处 var() 引用）。 */  /* 587 → 581（2026-09-14 第三轮：`.legend` 家族全局化去重）。
   逐字归因：该家族原本在 4 个文件各写一份（时间图表页 / 血量膨胀页 / 队伍对比页 / 直伤图组件），
   收敛到 src/styles/charts.css 一份后，重复的 var() 引用消失 ⇒ **净 −6**（--fill-hover/--fg-2/--fg-3
   各从 2–4 份变 1 份）。这是去重不是「改回字面量」（--wa-* 直引不变，仍 444）。 */  /* 584 → 587（同上：直伤图抽组件，图例类 var() 引用随组件走，净 +3）。 */  /* 576 → 573（2026-09-14 图表样式收敛去重）→ 577
   （环境膨胀图 .inf-line 用 var(--c-chart-4) 等 +4）→ 582（队伍对比第三轴：时间档配色
   4 档 --c-chart-9/3/4/6 + 未收录中性色 --fg-3 = +5，全部走语义别名）。
   注：--wa-* 直引始终不变（443）——新图取色一律用语义别名，不用 --wa-* 直引。
   → 584（同金分配对比表：最优行 --fill-hover + 落选代价 --c-danger = +2）。 */
/* 2026-09-12 **口径变更（一次性重冻结）**：var() 总数与 --wa-* 直引的统计面从「src 下全部 .vue」
   扩为「.vue + src/composables 下的 .ts」（见 scanComposableFiles）。

   为什么改：图表取色/几何此前在 .vue 里，评审 #14 把它们抽进 composables/*.ts 后，本判据
   连续四次把"搬家"误报为"改回字面量"（571→569→566→561 四次手动下调基线）。反向也漏：
   在 .ts 里把 var(--x) 换成字面色值，本判据完全看不见 —— 而 src/composables 正是取色的主要落点。
   扩面后实测：var 561→571、--wa-* 443→446（差值即 .ts 里原本不可见的引用），
   且 `tokens-defined` 在同一次扫描里对 .ts 一并生效（实测无未定义令牌）。

   效果：**代码在 .vue 与 .ts 之间搬家不再改变计数** ⇒ 该棘轮只对真正的"变量↔字面量"变化敏感。
   历史（.vue-only 口径下的四次下调）：571→569→566→561，均因逻辑外迁，非回退。 */


// ---------------------------------------------------------------- 判据

/**
 * App.vue ↔ global.css 的取值对应表（判据 naive-token-reuse）。
 * 为什么需要：Naive UI 的 themeOverrides 是 JS 侧的字面值，引用不了 CSS 变量，
 * 于是每个表面色都在两个地方各写一遍。没有机器校验时两边必然漂移——
 * 表现就是「Naive 组件一套灰、自定义组件另一套灰」，是本任务要治的核心病症。
 *
 * 格式：[主题块, 键（'Section.key' 表示组件段内的键）, global.css 令牌]
 * 主题块取 darkCommon / lightCommon / darkOverrides / lightOverrides。
 * 品牌色梯子（primaryColor*）不在此表：它们是为白字对比度专门调的，由 contrast 判据管。
 */
export const NAIVE_TOKEN_MAP = [
  ['darkCommon', 'bodyColor', '--app-bg'],
  ['darkCommon', 'cardColor', '--app-panel'],
  ['darkCommon', 'inputColor', '--wa-60'],
  ['darkCommon', 'inputColorDisabled', '--wa-30'],
  ['darkCommon', 'dividerColor', '--app-border'],
  ['darkCommon', 'borderColor', '--app-border'],
  ['darkCommon', 'tableHeaderColor', '--app-tablehead-bg'],
  ['darkCommon', 'tableColor', '--app-panel'],
  ['darkCommon', 'tableColorHover', '--fill-hover'],
  ['darkCommon', 'tableColorStriped', '--wa-15'],
  ['darkCommon', 'tagColor', '--wa-60'],
  ['darkCommon', 'textColorBase', '--app-text'],
  ['darkCommon', 'textColorDisabled', '--wa-300'],
  ['darkCommon', 'placeholderColor', '--fg-placeholder'],
  ['darkCommon', 'scrollbarColor', '--scrollbar-thumb'],
  ['darkCommon', 'scrollbarColorHover', '--scrollbar-thumb-hover'],

  ['lightCommon', 'bodyColor', '--app-bg'],
  ['lightCommon', 'cardColor', '--app-panel'],
  ['lightCommon', 'inputColor', '--app-inset'],
  ['lightCommon', 'inputColorDisabled', '--wa-30'],
  ['lightCommon', 'dividerColor', '--app-border'],
  ['lightCommon', 'borderColor', '--app-border'],
  ['lightCommon', 'tableHeaderColor', '--app-tablehead-bg'],
  ['lightCommon', 'tableColor', '--app-panel'],
  ['lightCommon', 'tableColorHover', '--fill-hover'],
  ['lightCommon', 'tableColorStriped', '--wa-15'],
  ['lightCommon', 'tagColor', '--wa-60'],
  ['lightCommon', 'textColorBase', '--app-text'],
  ['lightCommon', 'textColorDisabled', '--wa-300'],
  ['lightCommon', 'placeholderColor', '--fg-placeholder'],
  ['lightCommon', 'scrollbarColor', '--scrollbar-thumb'],
  ['lightCommon', 'scrollbarColorHover', '--scrollbar-thumb-hover'],

  // Tooltip 是 common 里没有的表面色，只能组件级写——也最容易出现「Naive 提示与
  // 自绘图表提示两张皮」，所以单独列出强制对齐
  ['darkOverrides', 'Tooltip.color', '--app-tooltip-bg'],
  ['darkOverrides', 'Tooltip.textColor', '--app-tooltip-text'],
  ['lightOverrides', 'Tooltip.color', '--app-tooltip-bg'],
  ['lightOverrides', 'Tooltip.textColor', '--app-tooltip-text'],
]

/** 需要断言对比度的前景/背景令牌对（背景统一落在 --app-panel，先压到 --app-bg 上） */
export const CONTRAST_TEXT_PAIRS = [
  '--app-text',
  '--app-text-solid',
  '--c-success',
  '--c-warning',
  '--c-danger',
  '--c-info',
]
export const CONTRAST_TEXT_MIN = 4.5
/** 图表色序：只做填充不承载文字，门槛放宽 */
export const CONTRAST_CHART_MIN = 3.0
export const CONTRAST_CHART_PAIRS = [
  '--c-chart-1', '--c-chart-2', '--c-chart-3', '--c-chart-4',
  '--c-chart-5', '--c-chart-6', '--c-chart-7', '--c-chart-8',
  '--c-chart-9', // 流明：B2 定义了 9 色，漏列就等于这一色从未被校验
]

/**
 * 额外的「前景/背景对」断言（对应 App.vue 里显式写死的前景/背景覆盖）。
 * 纪律：App.vue 每新增一对，这里必须同步加一行——覆盖数可以长，断言数必须跟着长。
 * bg 若是半透明，会先压到 --app-bg 上再算。
 */
export const CONTRAST_EXTRA_PAIRS = [
  // Naive Tooltip 与自绘 SVG tooltip（.hover-card / .bar-tip / .chart-tooltip-box）共用这套值，
  // 任一侧在亮色模式下穿帮都会直接表现为「提示框里的字看不见」
  { label: 'tooltip', fg: '--app-tooltip-text', bg: '--app-tooltip-bg', min: 4.5 },
  // 占位符不承载实质信息，门槛放宽（WCAG 对 placeholder 也没有 4.5 的硬性要求）。
  // 用语义别名而非固定档位：明暗两侧需要不同墨色才都能过 3:1。
  { label: 'placeholder', fg: '--fg-placeholder', bg: '--app-panel', min: 3 },
]

/**
 * 形状面（tinted-ink-closure）的**唯一豁免表**（键 = `file::selector`）。
 *
 * 为什么必须开口子（2026-09-18 round 31-a2 实测）：`.rs3d-color-spectrum` 是 3D 曲面的
 * **Z 值色阶图例条** —— 它的色标必须与 JS `getZColor()` 的数值分段**逐位一致**，
 * 否则「图例说的颜色」与「曲面实际画的颜色」分叉。那是**数据色**
 * （UI_THEME_GUIDE §5「明暗通吃，不进变量表」），**不该**跟随主题。
 * `#1e3a8a` 只是**恰好**与 `--c-info-strong` 同值（getZColor 在 t=0 处 r=30,g=58,b=138
 * = #1e3a8a 深海军蓝）⇒ 换令牌会让图例随主题漂移 = 引入分叉，正是本判据要防的反面。
 *
 * ⚠ 纪律（防豁免腐烂）：条目必须**仍被命中** —— 选择器改名/不再是字面量即红，
 * 见 `checkTokens.test.ts` 的「豁免仍然有效」用例。**不是**永久豁免：该选择器一旦
 * 不再是数据色阶，条目必须删除。
 */
export const TINTED_LITERAL_ALLOW_SET = new Map([
  ['src/components/charts/ResponseSurface3D.vue::.rs3d-color-spectrum',
    'Z 值色阶图例：色标必须与 getZColor() 数值分段逐位一致（数据色，不跟随主题）'],
])

export function runAllChecks(root = ROOT) {
  const results = []
  const cssPath = join(root, GLOBAL_CSS)
  if (!existsSync(cssPath)) {
    return { results: [{ name: `global.css 存在`, ok: false, detail: [`  ✗ 找不到 ${GLOBAL_CSS}`] }], ok: false }
  }
  const css = readFileSync(cssPath, 'utf8')
  const { root: darkTokens, light: lightTokens } = parseGlobalTokens(css)
  const allTokens = new Set([...darkTokens.keys(), ...lightTokens.keys()])
  const scanned = scanVueFiles(root, FONT_SCALE)

  // ---- 1. tokens-defined ----
  const undefinedRefs = new Set()
  let varTotal = 0
  let waRefs = 0
  // .vue + composables 的 .ts 共同构成「UI 层 var() 口径」（见 scanComposableFiles 注释）
  const scannedComposables = scanComposableFiles(root)
  for (const f of [...scanned, ...scannedComposables]) {
    for (const name of f.varRefs) {
      varTotal++
      if (name.startsWith('--wa-')) waRefs++
      // --n-* 是 Naive UI 自身变量，不归本项目令牌管
      if (name.startsWith('--n-')) continue
      if (!allTokens.has(name)) undefinedRefs.add(`${f.path} → ${name}`)
    }
  }
  results.push({
    name: `tokens-defined (规则 11: var() 引用必须在 ${GLOBAL_CSS} 有定义) ${allTokens.size} 个令牌`,
    ok: undefinedRefs.size === 0,
    detail: [...undefinedRefs].sort().map(s => `  ✗ 未定义令牌：${s} → 在 global.css 双主题各补一份，或改回已存在的令牌`),
  })

  // ---- 2. theme-parity（只约束「与主题相关」的令牌）----
  // 判定标准：**值里含色值字面量**（#hex / rgb / rgba / hsl）的才算主题相关。
  //   --space-4: 8px            → 无色值 → 免检（只写 :root 一份即可，靠继承生效）
  //   --fg-2: var(--wa-750)     → 无色值 → 免检（它委托给已对称的 --wa-*）
  //   --shadow-1: 0 1px 2px rgba(2,6,23,.4) → 含色值 → 必须双份（阴影确实随主题变）
  //   --app-bg: #0f172a         → 含色值 → 必须双份
  // 否则「键集完全相等」会把几十个尺度令牌逼着在 html.light 里抄一遍，纯噪音。
  const isThemeDependent = (v) => /#[\da-f]{3,8}\b|rgba?\(|hsla?\(/i.test(v)
  const themeKeys = new Set(
    [...darkTokens.keys(), ...lightTokens.keys()].filter(
      k => isThemeDependent(darkTokens.get(k) ?? '') || isThemeDependent(lightTokens.get(k) ?? ''),
    ),
  )
  const onlyDark = [...themeKeys].filter(k => !lightTokens.has(k))
  const onlyLight = [...themeKeys].filter(k => !darkTokens.has(k))
  results.push({
    name: `theme-parity (含色值令牌双主题对称) ${themeKeys.size}/${themeKeys.size} 需对称，共 ${new Set([...darkTokens.keys(), ...lightTokens.keys()]).size} 个令牌`,
    ok: onlyDark.length === 0 && onlyLight.length === 0,
    detail: [
      ...onlyDark.map(k => `  ✗ 只定义在 :root：${k} → 明亮模式漏色，在 html.light 补一份`),
      ...onlyLight.map(k => `  ✗ 只定义在 html.light：${k} → 夜间模式漏色，在 :root 补一份`),
    ],
  })

  // ---- 3. hardcoded-color 棘轮 ----
  const colorDetail = []
  let colorOk = true
  for (const f of scanned) {
    if (HARDCODED_WHITELIST.includes(f.path)) continue
    const baseline = HARDCODED_BASELINE[f.path]
    if (baseline === undefined) {
      if (f.hardcoded > 0) {
        colorOk = false
        colorDetail.push(`  ✗ 新文件带硬编码色值：${f.path} = ${f.hardcoded} → 改用 --app-*/--wa-* 令牌；确需字面值则冻结一行基线`)
      }
      continue
    }
    if (f.hardcoded > baseline) {
      colorOk = false
      colorDetail.push(`  ✗ 硬编码色值 ${baseline}→${f.hardcoded}：${f.path} → 迁到 --app-*/--wa-*（App.vue 外的字面色值都违反 UI_THEME_GUIDE §1）`)
    } else if (f.hardcoded < baseline) {
      colorOk = false
      colorDetail.push(`  ✗ 硬编码色值 ${baseline}→${f.hardcoded}：${f.path} 是进步，把 check-tokens.mjs 的 HARDCODED_BASELINE 下调到 ${f.hardcoded}（棘轮只减不增）`)
    }
  }
  const colorSum = scanned.filter(f => !HARDCODED_WHITELIST.includes(f.path))
    .reduce((s, f) => s + f.hardcoded, 0)
  results.push({
    name: `hardcoded-color ratchet (UI_THEME_GUIDE §1: 字面色值仅 3 处合法) 合计 ${colorSum}`,
    ok: colorOk,
    detail: colorDetail,
  })

  // ---- 4. font-size 棘轮 ----
  const fontDetail = []
  let fontOk = true
  for (const f of scanned) {
    const baseline = FONT_SIZE_BASELINE[f.path] ?? 0
    if (f.fontOutliers.length > baseline) {
      fontOk = false
      const sample = [...new Set(f.fontOutliers)].slice(0, 6).join(' / ')
      fontDetail.push(`  ✗ 离群字号 ${baseline}→${f.fontOutliers.length}：${f.path}（${sample}）→ 归到档位 ${FONT_SCALE.join('/')}`)
    } else if (f.fontOutliers.length < baseline) {
      fontOk = false
      fontDetail.push(`  ✗ 离群字号 ${baseline}→${f.fontOutliers.length}：${f.path} 是进步，把 FONT_SIZE_BASELINE 下调到 ${f.fontOutliers.length}`)
    }
  }
  const fontSum = scanned.reduce((s, f) => s + f.fontOutliers.length, 0)
  results.push({
    name: `font-size ratchet (字号必须落在尺度档位) 离群合计 ${fontSum}`,
    ok: fontOk,
    detail: fontDetail,
  })

  // ---- 5. contrast ----
  const contrastDetail = []
  const checkPairs = (tokens, label) => {
    const bgSolid = resolveTokenColor(tokens, '--app-panel', resolveTokenColor(tokens, '--app-bg', null) ?? { r: 255, g: 255, b: 255, a: 1 })
      ?? resolveTokenColor(tokens, '--app-bg', null)
    if (!bgSolid) { contrastDetail.push(`  ✗ [${label}] 无法解析 --app-panel/--app-bg`); return }
    for (const name of CONTRAST_TEXT_PAIRS) {
      if (!tokens.has(name)) continue // 令牌尚未引入（B2 之前），跳过而非误报
      const fg = resolveTokenColor(tokens, name, bgSolid)
      if (!fg) { contrastDetail.push(`  ✗ [${label}] 无法解析 ${name}`); continue }
      const ratio = contrastRatio(fg, bgSolid)
      if (ratio < CONTRAST_TEXT_MIN) {
        contrastDetail.push(`  ✗ [${label}] ${name} vs --app-panel = ${ratio.toFixed(2)}:1 < ${CONTRAST_TEXT_MIN} → 调整该令牌色值`)
      }
    }
    for (const name of CONTRAST_CHART_PAIRS) {
      if (!tokens.has(name)) continue
      const fg = resolveTokenColor(tokens, name, bgSolid)
      if (!fg) { contrastDetail.push(`  ✗ [${label}] 无法解析 ${name}`); continue }
      const ratio = contrastRatio(fg, bgSolid)
      if (ratio < CONTRAST_CHART_MIN) {
        contrastDetail.push(`  ✗ [${label}] ${name} vs --app-panel = ${ratio.toFixed(2)}:1 < ${CONTRAST_CHART_MIN}（图表色仅填充，门槛放宽）`)
      }
    }
    // 额外对（App.vue 显式写死的前景/背景覆盖，见 CONTRAST_EXTRA_PAIRS）
    for (const p of CONTRAST_EXTRA_PAIRS) {
      if (!tokens.has(p.fg) || !tokens.has(p.bg)) continue
      const bg = resolveTokenColor(tokens, p.bg, resolveTokenColor(tokens, '--app-bg', null) ?? bgSolid)
      const fg = resolveTokenColor(tokens, p.fg, bg)
      if (!bg || !fg) { contrastDetail.push(`  ✗ [${label}] 无法解析 ${p.fg} / ${p.bg}`); continue }
      const ratio = contrastRatio(fg, bg)
      if (ratio < p.min) {
        contrastDetail.push(`  ✗ [${label}] ${p.label}：${p.fg} vs ${p.bg} = ${ratio.toFixed(2)}:1 < ${p.min} → 调整令牌或在 App.vue 里改用它色`)
      }
    }
  }
  checkPairs(darkTokens, 'dark')
  checkPairs(lightTokens, 'light')

  // 明亮主色 vs 白字：把 App.vue 注释里那条硬约束机器化
  try {
    const appSrc = readFileSync(join(root, 'src/App.vue'), 'utf8')
    const m = appSrc.match(/lightCommon[^=]*=\s*\{[\s\S]*?primaryColor\s*:\s*['"]([^'"]+)['"]/)
    if (m) {
      const pc = parseColor(m[1])
      if (pc) {
        const ratio = contrastRatio({ r: 255, g: 255, b: 255, a: 1 }, pc)
        if (ratio < CONTRAST_TEXT_MIN) {
          contrastDetail.push(`  ✗ [light] App.vue lightCommon.primaryColor ${m[1]} vs #ffffff = ${ratio.toFixed(2)}:1 < ${CONTRAST_TEXT_MIN} → 压深主色保按钮白字对比度`)
        }
      } else {
        contrastDetail.push(`  ✗ 无法解析 App.vue 的 lightCommon.primaryColor：${m[1]}`)
      }
    }
  } catch { /* App.vue 缺失由 build 负责报错 */ }

  results.push({
    name: `contrast (WCAG AA 正文 ≥${CONTRAST_TEXT_MIN} / 图表 ≥${CONTRAST_CHART_MIN})`,
    ok: contrastDetail.length === 0,
    detail: contrastDetail,
  })

  // ---- 6. alias 棘轮 ----
  const aliasDetail = []
  if (waRefs > WA_REF_BASELINE) {
    aliasDetail.push(`  ✗ --wa-* 直接引用 ${WA_REF_BASELINE}→${waRefs}：新代码请用语义别名（--line/--line-strong/--fill-hover/--fill-active/--text-2/--text-3）`)
  } else if (waRefs < WA_REF_BASELINE) {
    aliasDetail.push(`  ✗ --wa-* 直接引用 ${WA_REF_BASELINE}→${waRefs}：是进步，把 WA_REF_BASELINE 下调到 ${waRefs}`)
  }
  if (varTotal < VAR_TOTAL_BASELINE) {
    aliasDetail.push(`  ✗ var() 引用总数 ${VAR_TOTAL_BASELINE}→${varTotal}：有变量被改回字面量了，回退`)
  } else if (varTotal > VAR_TOTAL_BASELINE) {
    aliasDetail.push(`  ✗ var() 引用总数 ${VAR_TOTAL_BASELINE}→${varTotal}：是进步，把 VAR_TOTAL_BASELINE 上调到 ${varTotal}`)
  }
  results.push({
    name: `alias ratchet (--wa-* 直接引用 ≤${WA_REF_BASELINE}，var() 总数 ≥${VAR_TOTAL_BASELINE}) 实到 wa=${waRefs} var=${varTotal}`,
    ok: aliasDetail.length === 0,
    detail: aliasDetail,
  })

  // ---- 7. font-stack-parity ----
  // 字体栈在 global.css(--app-font-sans) 与 App.vue(common.fontFamily) 各有一份，CSS 与 JS
  // 无法互相引用，只能靠机器校验兜住规则 11。Naive 的 n-global-style 会用 App.vue 的值覆盖
  // body，两处分叉 = Naive 组件与自定义组件两套字体。
  const fontStackDetail = []
  const cssFont = darkTokens.get('--app-font-sans') ?? null
  const cssFontLight = lightTokens.get('--app-font-sans') ?? null
  try {
    const appFont = extractAppFontFamily(readFileSync(join(root, 'src/App.vue'), 'utf8'))
    if (cssFont === null) {
      fontStackDetail.push(`  ✗ global.css 缺少 --app-font-sans → 在 :root 与 html.light 各补一份`)
    }
    if (cssFontLight !== null && cssFont !== null && normalizeFontStack(cssFont) !== normalizeFontStack(cssFontLight)) {
      fontStackDetail.push(`  ✗ --app-font-sans 双主题不一致：:root 与 html.light 值不同`)
    }
    if (appFont === null) {
      fontStackDetail.push(`  ✗ App.vue 未设置 common.fontFamily → Naive 会用内置字体覆盖 body`)
    } else if (cssFont !== null && normalizeFontStack(appFont) !== normalizeFontStack(cssFont)) {
      fontStackDetail.push(`  ✗ 字体栈分叉：App.vue 的 common.fontFamily 与 global.css 的 --app-font-sans 不一致`)
      fontStackDetail.push(`      App.vue    : ${normalizeFontStack(appFont)}`)
      fontStackDetail.push(`      global.css : ${normalizeFontStack(cssFont)}`)
    }
  } catch { /* App.vue 缺失由 build 负责报错 */ }
  results.push({
    name: `font-stack-parity (规则 11: 字体栈单一事实源 global.css ↔ App.vue)`,
    ok: fontStackDetail.length === 0,
    detail: fontDetail,
  })

  // ---- 8. naive-token-reuse ----
  // App.vue 的 themeOverrides 是 JS 字面值，引用不了 CSS 变量，每个表面色都得写两遍。
  // 本判据锁死「两边必须同值」，防「Naive 组件一套灰、自定义组件另一套灰」。
  const reuseDetail = []
  let checked = 0
  try {
    const appSrc = readFileSync(join(root, 'src/App.vue'), 'utf8')
    const themeOf = (block) => (block.startsWith('dark') ? darkTokens : lightTokens)
    // 别名层只写在 :root（属于 darkTokens），解析明亮侧时需要这条合并表兜底
    const combined = new Map([...darkTokens, ...lightTokens])
    for (const [block, key, token] of NAIVE_TOKEN_MAP) {
      const section = extractBlock(appSrc, block)
      if (section === null) { reuseDetail.push(`  ✗ App.vue 找不到 ${block} 块`); continue }
      let actual
      if (key.includes('.')) {
        const [comp, inner] = key.split('.')
        actual = extractFlatPairs(extractBlock(section, comp)).get(inner)
      } else {
        actual = extractFlatPairs(section).get(key)
      }
      const expected = resolveTokenRaw(themeOf(block), token, combined)
      if (actual === undefined) { reuseDetail.push(`  ✗ App.vue ${block}.${key} 未设置（期望 ${token}）`); continue }
      if (expected === null) { reuseDetail.push(`  ✗ global.css 缺少令牌 ${token}（${block}.${key} 要引用它）`); continue }
      if (!sameValue(actual, expected)) {
        reuseDetail.push(`  ✗ ${block}.${key} 与 ${token} 漂移：App.vue="${actual}"  global.css="${expected}"`)
      } else checked++
    }
  } catch { /* App.vue 缺失由 build 负责报错 */ }
  results.push({
    name: `naive-token-reuse (规则 11: App.vue 表面色必须取自 global.css 令牌) ${checked}/${NAIVE_TOKEN_MAP.length} 对齐`,
    ok: reuseDetail.length === 0 && checked === NAIVE_TOKEN_MAP.length,
    detail: reuseDetail,
  })

  // ---- 9. scene-contrast（3D 自绘 Canvas 场景）----
  // 为什么单列一条（2026-09-18 round 31，R29-J2 结案）：
  // 判据 5（contrast）只断言「令牌 vs --app-panel/--app-bg」，而 3D 场景的底**不是页面底**
  // ——它由组件自己画（`--scene-bg-inner/outer`）。这正是本 bug 藏身之处：两个组件曾用
  // **固定深底** + 跟随主题的 `--wa-*` 墨色 ⇒ 亮色主题下判据 5 全绿（令牌对页面底达标），
  // 而**场景内**实测塌到 1.01:1。⇒ 判据 5 的覆盖面**结构上到不了**这里，必须显式补。
  // 算法：把半透明场景底的**两端**（内圈/外圈）分别压到 --app-bg 上取实色，再算各墨色的对比度。
  const sceneDetail = []
  /**
   * 每个墨色**实际坐在哪个表面上** —— 不能一律当成"坐在三种表面上"。
   * 为什么必须分（首版实测的教训）：HUD/图例文字坐在 `--scene-panel` 浮层上（自带底色），
   * 若也拿它去比容器外圈，`--c-success` 会以 4.19 被判红——**那是假红**：
   * 该文字根本不直接坐在容器渐变上（浮层把它垫起来了）。判据宁可精细，不要"宁可错杀"。
   *   canvas = 画在 Canvas 上（直接坐容器渐变内/外圈）
   *   panel  = 坐在 `--scene-panel` 浮层上（HUD / 图例 / 空态）
   */
  const SCENE_INK_PAIRS = [
    // Canvas 直绘文字：轴标（10px 文字，正文门槛）
    { label: '--scene-axis-x', min: CONTRAST_TEXT_MIN, role: '轴标', on: ['canvas'] },
    { label: '--scene-axis-y', min: CONTRAST_TEXT_MIN, role: '轴标', on: ['canvas'] },
    { label: '--scene-axis-z', min: CONTRAST_TEXT_MIN, role: '轴标', on: ['canvas'] },
    // Canvas 直绘标记（图形 ⇒ 图表门槛）
    { label: '--scene-mark-cur', min: CONTRAST_CHART_MIN, role: '标记', on: ['canvas'] },
    { label: '--scene-mark-max', min: CONTRAST_CHART_MIN, role: '标记', on: ['canvas'] },
    // 次级墨：既是 Canvas 柱阵标签，也是 HUD/图例文字 ⇒ 两类表面都要过
    { label: '--scene-ink-dim', min: CONTRAST_TEXT_MIN, role: '正文', on: ['canvas', 'panel'] },
    // 强调墨：TD3D 的 KPI 直接画在画布上（无浮层底）+ HUD 标题
    { label: '--app-text-solid', min: CONTRAST_TEXT_MIN, role: '正文', on: ['canvas', 'panel'] },
    // 浮层内语义色（RS3D HUD 的涨跌色 / 高亮行、TD3D 副标题）
    { label: '--c-success', min: CONTRAST_TEXT_MIN, role: '正文', on: ['panel'] },
    { label: '--c-danger', min: CONTRAST_TEXT_MIN, role: '正文', on: ['panel'] },
    { label: '--c-info', min: CONTRAST_TEXT_MIN, role: '正文', on: ['panel'] },
  ]
  const checkScene = (tokens, label) => {
    const pageBg = resolveTokenColor(tokens, '--app-bg', null)
    if (!pageBg) { sceneDetail.push(`  ✗ [${label}] 无法解析 --app-bg`); return }
    // 表面清单（名称对齐 SCENE_INK_PAIRS.on 的取值）
    const canvasSurfaces = []
    for (const side of ['--scene-bg-inner', '--scene-bg-outer']) {
      const raw = resolveTokenColor(tokens, side, null)
      if (!raw) { sceneDetail.push(`  ✗ [${label}] 无法解析场景底 ${side}`); continue }
      // 场景底是半透明的（夜间档）⇒ 压到页面底上取实色
      canvasSurfaces.push({ name: side, bg: raw.a < 1 ? flatten(raw, pageBg) : raw, kind: 'canvas' })
    }
    const outer = canvasSurfaces.find(s => s.name === '--scene-bg-outer')?.bg
    const panelRaw = resolveTokenColor(tokens, '--scene-panel', null)
    const surfaces = [...canvasSurfaces]
    if (outer && panelRaw) {
      surfaces.push({
        name: '--scene-panel(over outer)', kind: 'panel',
        bg: panelRaw.a < 1 ? flatten(panelRaw, outer) : panelRaw,
      })
    }
    for (const s of surfaces) {
      for (const p of SCENE_INK_PAIRS) {
        if (!p.on.includes(s.kind)) continue
        if (!tokens.has(p.label)) continue
        const fgRaw = resolveTokenColor(tokens, p.label, null)
        if (!fgRaw) { sceneDetail.push(`  ✗ [${label}] 无法解析 ${p.label}`); continue }
        const fg = fgRaw.a < 1 ? flatten(fgRaw, s.bg) : fgRaw
        const ratio = contrastRatio(fg, s.bg)
        if (ratio < p.min) {
          sceneDetail.push(
            `  ✗ [${label}] 3D 场景(${s.name}) ${p.role} ${p.label} = ${ratio.toFixed(2)}:1 < ${p.min}`
            + ` → 场景底与墨色必须**成对**跟随主题（见 global.css 的 --scene-* 注释）`,
          )
        }
      }
    }
  }
  checkScene(darkTokens, 'dark')
  checkScene(lightTokens, 'light')
  results.push({
    name: `scene-contrast (3D 自绘场景的底/墨成对: 正文 ≥${CONTRAST_TEXT_MIN} / 刻度标记 ≥${CONTRAST_CHART_MIN})`,
    ok: sceneDetail.length === 0,
    detail: sceneDetail,
  })

  // ---- 10. scene-ink-closure（**形状面**，与判据 9 成对）----
  // 为什么判据 9 不够：它断言的是「--scene-* 这几个令牌的色值达标」——
  // **有人把场景文字改回 `--wa-450`，判据 9 照样全绿**（那个令牌不在被断言的清单里，
  // 而它自己确实没变）。这正是 R30 §2.3 说的「只有行为面 ⇒ 对'接回错源'全盲」。
  // ⇒ 本判据钉**结构**：3D 自绘场景选择器里的 var() 引用必须落在场景令牌白名单内。
  // 白名单 = 场景底/墨/浮层/轴标/标记 + 语义色 + 结构色（--line 等，均无色值、委托 --wa-*）。
  const closureDetail = []
  /**
   * 场景选择器前缀 → 该规则内允许出现的令牌。
   * ⚠ `--wa-*` **一律不在白名单**：它按页面底调，在自绘场景里语义就是错的（实测亮色档 1.01:1）。
   * `--line`/`--fill-hover`/`--fill-active` 放行：它们委托同名 --wa-* 但**只用于场景外的
   * 控件区**，且无色值本体、双主题逐位不变（R29 已论证）。
   */
  const SCENE_TOKEN_ALLOW = new Set([
    '--scene-bg-inner', '--scene-bg-outer', '--scene-ink-dim', '--scene-panel', '--scene-panel-line',
    '--scene-shadow', '--scene-axis-x', '--scene-axis-y', '--scene-axis-z',
    '--scene-mark-cur', '--scene-mark-max',
    '--app-text-solid', '--c-success', '--c-info', '--c-warning', '--c-danger',
    '--c-success-soft', '--c-info-soft', '--c-warning-soft',
    '--line', '--line-strong', '--fill-hover', '--fill-active', '--app-primary',
  ])
  /** 命中即算「场景内」的选择器前缀（两组件共用的场景容器与浮层） */
  const SCENE_SELECTOR_PREFIXES = [
    '.rs3d-canvas-container', '.rs3d-hud', '.rs3d-legend-bar', '.rs3d-marker-dot', '.dot-cur', '.dot-max',
    '.rs3d-color-spectrum', '.rs3d-spectrum-labels', '.rs3d-empty-overlay', '.rs3d-empty-icon', '.rs3d-empty-text',
    '.td3d-canvas-wrap', '.td3d-hud', '.td3d-center-kpi', '.td3d-kpi-sub', '.td3d-kpi-val', '.td3d-kpi-hint',
  ]
  for (const file of ['src/components/charts/ResponseSurface3D.vue', 'src/components/charts/TeamDamage3DChart.vue']) {
    const src = readFileSync(join(root, file), 'utf8')
    const styleCss = extractStyleBlocks(src, { root, filePath: file }).map(b => b.content).join('\n')
    // 逐条规则扫（选择器 { 声明 }），只看选择器命中场景前缀的
    for (const m of styleCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = m[1].trim()
      if (!SCENE_SELECTOR_PREFIXES.some(p => selector.includes(p))) continue
      for (const name of findVarRefs(m[2])) {
        if (name.startsWith('--n-')) continue // Naive UI 自身变量
        if (!SCENE_TOKEN_ALLOW.has(name)) {
          closureDetail.push(
            `  ✗ ${file} 场景选择器「${selector.split('\n').pop().trim()}」引用了 ${name}`
            + ` → 场景墨/底必须用 --scene-*（该令牌按页面底调，在自绘场景里会读不出；见判据 9）`,
          )
        }
      }
    }
    // Canvas 侧：`ctx.*Style = 'var(--x)'` **会被静默忽略**（不是 CSS 属性赋值）——R29 实测踩到
    // ⚠ 必须先剥注释：两文件的反面教材注释里**逐字写着**这个错误写法（"不要写 ctx.fillStyle = 'var(--wa-450)'"），
    // 不剥就把自己的文档判成违规（实测首版正是如此，2 条假红）。
    const scriptBody = stripJsComments((src.match(/<script[^>]*>([\s\S]*?)<\/script>/) ?? [])[1] ?? '')
    for (const m of scriptBody.matchAll(/ctx\.(?:fill|stroke)Style\s*=\s*['"`]var\(/g)) {
      closureDetail.push(`  ✗ ${file} 第 ${scriptBody.slice(0, m.index).split('\n').length} 行：Canvas 赋值 'var(...)' 会被静默忽略 → 用 cssVarColor()/sceneInk*() 读回真实色值`)
    }
    // Canvas 侧：不得拿**页面墨**当场景墨（cssVarColor 的实参）
    for (const m of scriptBody.matchAll(/cssVarColor\(\s*['"`](--wa-[\w-]+|--fg-[\w-]+)['"`]/g)) {
      closureDetail.push(`  ✗ ${file} 第 ${scriptBody.slice(0, m.index).split('\n').length} 行：Canvas 场景墨借用了页面令牌 ${m[1]} → 用 --scene-ink-*`)
    }
  }
  results.push({
    name: `scene-ink-closure (3D 场景只用 --scene-* 墨: 场景选择器的 var() + Canvas 取色)`,
    ok: closureDetail.length === 0,
    detail: closureDetail,
  })

  // ---- 11. tinted-contrast（自带底色贴片）----
  // 为什么必须单列（2026-09-18 round 31-a2）：判据 5 的背景**固定取 --app-panel/--app-bg**，
  // 于是它只回答「令牌 vs 页面底」。而 chip / 表头 / inset 行这类表面在页面底上**又加了一层**
  // （`background: var(--wa-40)` / `var(--c-success-soft)`），墨实际坐在**那一层**上。
  // ⇒ 判据 5 对「贴片上的墨」**结构不可见**：实测 37 条规则亮色档只有 1.03~3.82:1，
  //   而判据 5 **10/10 全绿**。这与判据 9（自绘场景）是**同一类盲区**（假设背景唯一），
  //   只是成因不同：判据 9 是「底由组件自己画」，本条是「底在页面底上又叠了一层」。
  // 算法：把每条规则的 background 先压到页面底取实色，再把 color 压到**该实色**上算对比度。
  // ⚠ 与判据 9 的分表面纪律一致：只对**同一条规则内**的 bg/color 成对断言（不跨规则猜堆叠），
  //   避免"宁可错杀"的假红（R31 教训：假红比漏报更伤——后来者会不信任判据）。
  const tintedDetail = []
  /** 解析一个 CSS 值 → 颜色（支持 var() 跟随 + 渐变取所有色标；半透明压到 under 上） */
  const resolveCssValue = (tokens, value, under) => {
    const one = (v) => {
      v = v.trim()
      const vm = v.match(/^var\(\s*(--[\w-]+)\s*\)$/)
      if (vm) return resolveTokenColor(tokens, vm[1], under)
      const c = parseColor(v)
      if (!c) return null
      return c.a < 1 && under ? flatten(c, under) : c
    }
    // 渐变（linear/radial）：取**全部**色标，逐个参与比较（判据 3 的教训：只取首色会漏）
    if (/gradient\(/i.test(value)) {
      const inner = value.slice(value.indexOf('(') + 1, value.lastIndexOf(')'))
      const stops = []
      let depth = 0, cur = ''
      for (const ch of inner) {
        if (ch === '(') depth++
        if (ch === ')') depth--
        if (ch === ',' && depth === 0) { stops.push(cur); cur = '' } else cur += ch
      }
      stops.push(cur)
      return stops
        .map(s => s.trim())
        .filter(s => !/^(to\s|\d+(deg|turn|rad)|from|at\s|circle|ellipse|linear|radial|conic)/i.test(s))
        .map(s => s.replace(/\s+[\d.]+%$/, ''))
        .map(one)
        .filter(Boolean)
    }
    const c = one(value)
    return c ? [c] : []
  }
  /** 该声明值里的**色值字面量**（hex / rgb[a]），用于形状面与"同值令牌"提示 */
  const colorLiterals = (value) =>
    [...value.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g)].map(m => m[0])
  /** 累加各主题下的最差对比度命中 */
  const checkTinted = (tokens, label, hits) => {
    const pageBg = resolveTokenColor(tokens, '--app-bg', null) ?? { r: 255, g: 255, b: 255, a: 1 }
    const panel = resolveTokenColor(tokens, '--app-panel', pageBg) ?? pageBg
    for (const f of scanned) {
      if (STYLE_SHEET_EXCLUDED.includes(f.path)) continue
      let cssText
      try { cssText = extractStyleBlocks(readFileSync(join(root, f.path), 'utf8'), { root, filePath: f.path }).map(b => b.content).join('\n') } catch { continue }
      for (const m of cssText.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selector = m[1].trim().split('\n').pop().trim()
        const body = m[2]
        const bgM = body.match(/(?:^|;)\s*background(?:-color)?\s*:\s*([^;]+)/)
        const fgM = body.match(/(?:^|;)\s*color\s*:\s*([^;]+)/)
        if (!bgM || !fgM) continue
        const bgv = bgM[1].trim(), fgv = fgM[1].trim()
        if (/^(transparent|none|inherit|currentColor|unset|initial)\b/i.test(bgv)) continue
        const bgs = resolveCssValue(tokens, bgv, panel)
        if (!bgs.length) continue // 底解析不了（如数据色 var() 组合）⇒ 跳过而非误报
        const fgs = resolveCssValue(tokens, fgv, null)
        if (!fgs.length) continue
        // 墨若半透明，压到**它自己那条规则的底**上（不是页面底）
        const ratios = []
        for (const bg of bgs) {
          for (const fgRaw of resolveCssValue(tokens, fgv, null)) {
            const fg = fgRaw.a < 1 ? flatten(fgRaw, bg) : fgRaw
            ratios.push(contrastRatio(fg, bg))
          }
        }
        const worst = Math.min(...ratios)
        if (worst >= CONTRAST_TEXT_MIN) continue
        const key = `${f.path}::${selector}`
        const rec = hits.get(key) ?? { file: f.path, selector, bgv, fgv, worst: {} }
        rec.worst[label] = worst
        rec.best = { bgv, fgv }
        hits.set(key, rec)
      }
    }
  }
  const tintedHits = new Map()
  checkTinted(darkTokens, 'dark', tintedHits)
  checkTinted(lightTokens, 'light', tintedHits)
  // 只报**两侧都**算得出且至少一侧不达标 —— 单侧缺失说明令牌没双份（theme-parity 会另报）
  for (const rec of [...tintedHits.values()].sort((a, b) => Math.min(...Object.values(a.worst)) - Math.min(...Object.values(b.worst)))) {
    const labels = Object.entries(rec.worst).map(([k, v]) => `${k}=${v.toFixed(2)}`)
    // 若是「字面量逐位等于某 :root 令牌值」，直接给出可执行的替换建议（这是最常见的根因）
    const lits = [...colorLiterals(rec.bgv), ...colorLiterals(rec.fgv)]
    const sameTok = []
    for (const lit of lits) {
      const c = parseColor(lit)
      if (!c) continue
      for (const [k, v] of darkTokens) {
        if (!/^--(c-|app-|scene-)/.test(k)) continue
        if (sameValue(lit, v)) { sameTok.push(`${lit} = ${k}（逐位同值，却是字面量）`); break }
      }
    }
    tintedDetail.push(
      `  ✗ ${rec.file} 「${rec.selector}」墨 ${rec.fgv} 压底 ${rec.bgv} = ${labels.join(' / ')}`
      + ` < ${CONTRAST_TEXT_MIN} → 贴片的墨要按**贴片底**选（不是页面底）：`
      + `浅底用 --fg-2/--app-text，语义底用 --c-*-strong`
      + (sameTok.length ? `；★ ${sameTok.join('；')} ⇒ 换成该令牌即可（夜间逐位不变）` : ''),
    )
  }
  results.push({
    name: `tinted-contrast (自带底色贴片的墨: chip/表头/inset 行 ≥${CONTRAST_TEXT_MIN})`,
    ok: tintedDetail.length === 0,
    detail: tintedDetail,
  })

  // ---- 12. tinted-ink-closure（**形状面**，与判据 11 成对）----
  // 为什么判据 11 不够：它断言的是「**当前**这条规则算出来达标」。
  //   ⇒ **有人把 --fg-2 换回 --wa-450，判据 11 会红（好）**；但**有人把达标的值写死成字面量**
  //   它**照样绿** —— 那条规则从此**不跟随主题**，亮色档再塌回去（这是"接回错源/写死"盲区）。
  // ⇒ 本判据钉**结构**：贴片规则的 bg/fg **不得手抄主题令牌的值**。
  //
  // ★ 口径为什么是「与某**双主题值不同**的令牌逐位同值」而不是「一律不许有字面量」
  //   （首版太宽，实测 17 条命中里多数是**合法的主题无关**贴片 ⇒ 假红）：
  //   反例 = `AppHeader .brand-badge`（`linear-gradient(--app-accent-gold, --app-accent-gold-soft)`
  //   + 深墨 `#241a03`）—— 那个渐变**双主题逐位相同**（品牌金），深墨压金底两侧都达标
  //   ⇒ 判据 11 绿、且它**本就不该**跟随主题。一律禁字面量会把它判成违规 = **假红**。
  //   R31 §2.4 的教训：**假红比漏报更伤**（后来者会不信任判据）⇒ 宁可精细。
  //   而「手抄令牌值」是**可证明**的根因：该字面量**在另一主题下就是错的**（如 #63e2b7 在
  //   白底贴片上 1.49:1，而同值的 var(--c-success) 亮色是 4.63）⇒ 零假阳性、可执行建议明确。
  //   ⚠ 与判据 9/10 的关系：判据 11 已覆盖「对比度」，本条只覆盖「**为什么**它不会跟着主题变」，
  //     两条缺一不可（注入 A/B 实测见 scripts/check-tokens.d.mts 与交接文档）。
  const tintedClosure = []
  /**
   * 形状面的**唯一豁免**（键 = `file::selector`）。
   * 为什么必须开口子（2026-09-18 round 31-a2 实测）：`.rs3d-color-spectrum` 是 3D 曲面的
   * **Z 值色阶图例条** —— 它的色标必须与 JS `getZColor()` 的数值分段**逐位一致**，
   * 否则「图例说的颜色」与「曲面实际画的颜色」分叉。那是**数据色**
   * （UI_THEME_GUIDE §5「明暗通吃，不进变量表」），**不该**跟随主题。
   * `#1e3a8a` 只是**恰好**与 `--c-info-strong` 同值（getZColor 在 t=0 处 r=30,g=58,b=138
   * = #1e3a8a 深海军蓝）⇒ 换令牌会让图例随主题漂移 = 引入分叉，正是本判据要防的反面。
   * ⚠ 纪律（防豁免腐烂）：条目必须**仍被命中**（stale 即红，见 checkTokens.test.ts 的
   * 「豁免仍有效」用例）；一旦该选择器不再是数据色阶，豁免必须删除。
   */
  const TINTED_LITERAL_ALLOW = TINTED_LITERAL_ALLOW_SET
  /** 主题相关令牌：双主题值**不同**（值相同 = 与主题无关，允许字面量）。值 → 令牌名 */
  const themeDependentByValue = new Map()
  for (const [k, v] of darkTokens) {
    if (!/^--(c-|app-|scene-)/.test(k)) continue
    if (lightTokens.has(k) && sameValue(v, lightTokens.get(k))) continue // 双主题同值 = 主题无关
    const c = parseColor(v)
    if (c && !themeDependentByValue.has(`${c.r},${c.g},${c.b},${c.a.toFixed(4)}`)) {
      themeDependentByValue.set(`${c.r},${c.g},${c.b},${c.a.toFixed(4)}`, k)
    }
  }
  for (const [k, v] of lightTokens) {
    if (!/^--(c-|app-|scene-)/.test(k)) continue
    if (darkTokens.has(k) && sameValue(v, darkTokens.get(k))) continue
    const c = parseColor(v)
    if (c && !themeDependentByValue.has(`${c.r},${c.g},${c.b},${c.a.toFixed(4)}`)) {
      themeDependentByValue.set(`${c.r},${c.g},${c.b},${c.a.toFixed(4)}`, k)
    }
  }
  for (const f of scanned) {
    if (STYLE_SHEET_EXCLUDED.includes(f.path)) continue
    let cssText
    try { cssText = extractStyleBlocks(readFileSync(join(root, f.path), 'utf8'), { root, filePath: f.path }).map(b => b.content).join('\n') } catch { continue }
    for (const m of cssText.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = m[1].trim().split('\n').pop().trim()
      if (TINTED_LITERAL_ALLOW.has(`${f.path}::${selector}`)) continue
      const body = m[2]
      // ★ 扫**全部**声明，不要求同时有 background：
      //   首版只扫「bg+color 成对」⇒ 漏掉了**只有 color** 的那一类（实测 29 条：
      //   文字继承父容器/页面底，没有自己的 background）——它们与成对那类是**同一个根因**
      //   （手抄令牌值 ⇒ 冻在单主题），漏掉等于护栏只覆盖了一半。
      //   ⚠ 不是过度扩张：判定条件仍是「字面量**逐位等于**某个双主题值不同的令牌」，
      //   故品牌金那类**主题无关**色值不会被误报（见上文 AppHeader 反例）。
      const hits = []
      for (const d of body.matchAll(/([a-z-]+)\s*:\s*([^;]+)/g)) {
        const prop = d[1]
        if (!/(color|background|fill|stroke|shadow|border)/.test(prop)) continue
        for (const lit of colorLiterals(d[2])) {
          const c = parseColor(lit)
          if (!c) continue
          const tok = themeDependentByValue.get(`${c.r},${c.g},${c.b},${c.a.toFixed(4)}`)
          if (tok) hits.push(`${prop}: ${lit} = ${tok}（逐位同值）`)
        }
      }
      if (!hits.length) continue
      tintedClosure.push(
        `  ✗ ${f.path} 「${selector}」的手抄色值 ${hits.join('；')}`
        + ` → 该令牌**双主题值不同**，抄成字面量后这条规则**不再跟随主题**（亮色档会塌回去）；`
        + `直接换成 var(<令牌>) —— 夜间逐位不变、亮色档自动生效`,
      )
    }
  }
  results.push({
    name: `tinted-ink-closure (贴片不得手抄主题令牌值: 抄了就冻在单主题)`,
    ok: tintedClosure.length === 0,
    detail: tintedClosure,
  })

  return { results, ok: results.every(r => r.ok), stats: { scanned, varTotal, waRefs, darkTokens, lightTokens } }
}

// ---------------------------------------------------------------- CLI

const isReport = process.argv.includes('--report')
const invokedAsCli = process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href

if (invokedAsCli) {
  if (isReport) {
    const { stats } = runAllChecks()
    const rows = stats.scanned
      .filter(f => f.hardcoded > 0 || f.fontOutliers.length > 0)
      .map(f => ({ path: f.path, hardcoded: f.hardcoded, fontOutliers: f.fontOutliers.length }))
    console.log('=== 按文件实测（粘贴为基线）===')
    console.log('export const HARDCODED_BASELINE = {')
    for (const r of rows.filter(r => r.hardcoded > 0 && !HARDCODED_WHITELIST.includes(r.path))) {
      console.log(`  '${r.path}': ${r.hardcoded},`)
    }
    console.log('}')
    console.log('')
    console.log('export const FONT_SIZE_BASELINE = {')
    for (const r of rows.filter(r => r.fontOutliers > 0)) console.log(`  '${r.path}': ${r.fontOutliers},`)
    console.log('}')
    console.log('')
    console.log(`export const WA_REF_BASELINE = ${stats.waRefs}`)
    console.log(`export const VAR_TOTAL_BASELINE = ${stats.varTotal}`)
    console.log('')
    const totalHard = stats.scanned.reduce((s, f) => s + f.hardcoded, 0)
    const totalFont = stats.scanned.reduce((s, f) => s + f.fontOutliers.length, 0)
    console.log(`合计：硬编码色值 ${totalHard} 处 / 离群字号 ${totalFont} 处 / var() ${stats.varTotal}（其中 --wa-* ${stats.waRefs}）`)
    const outliers = new Map()
    for (const f of stats.scanned) for (const v of f.fontOutliers) outliers.set(v, (outliers.get(v) ?? 0) + 1)
    console.log('离群字号取值分布：' + [...outliers.entries()].sort((a, b) => b[1] - a[1]).map(([v, n]) => `${v}×${n}`).join('  '))
  } else {
    const { results, ok } = runAllChecks()
    for (const r of results) {
      console.log(`${r.ok ? 'ok' : '✗'} ${r.name}`)
      for (const d of r.detail) console.log(d)
    }
    if (!ok) { console.log(`${results.filter(r => !r.ok).length} token check(s) failed`); process.exit(1) }
    console.log(`${results.length} token checks passed`)
  }
}

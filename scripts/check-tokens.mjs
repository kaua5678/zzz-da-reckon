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
// 六条判据：
//   1. tokens-defined    —— var(--x) 引用必须在 global.css 有定义（防拼写/漏定义）
//   2. theme-parity      —— :root 与 html.light 的令牌键集必须双向相等（防双主题走偏）
//   3. hardcoded-color   —— 硬编码色值按文件棘轮，只减不增
//   4. font-size         —— 字号必须落在尺度档位上，离群值按文件棘轮，只减不增
//   5. contrast          —— 关键前景/背景对对比度达标（明亮模式白底白字的机器兜底）
//   6. alias             —— --wa-* 直接引用数只减不增（推语义别名层），var() 总数只增不减
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
 */
export function extractStyleBlocks(source) {
  const out = []
  const re = /<style\b([^>]*)>([\s\S]*?)<\/style>/g
  let m
  while ((m = re.exec(source)) !== null) {
    const before = source.slice(0, m.index)
    out.push({
      content: stripComments(m[2]),
      startLine: before.split('\n').length,
    })
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
  return out.sort()
}

/**
 * 逐文件扫描 .vue：硬编码色值数、离群字号数、var() 引用。
 * 返回 [{ path, hardcoded, fontOutliers: [{value}], varRefs: [names] }]
 */
export function scanVueFiles(root, fontScale) {
  const scale = new Set(fontScale)
  return walkVue(root).map(path => {
    const source = readFileSync(join(root, path), 'utf8')
    const styleBlocks = extractStyleBlocks(source)
    const css = styleBlocks.map(b => b.content).join('\n')
    const decls = extractDeclarationRegions(css).join('\n')

    // 硬编码色值：样式只数声明区（避开 #id 选择器）+ 模板内联样式；排除 <script> 的数据色
    const hardcoded = countHardcodedColors(decls) + countHardcodedColors(extractTemplateSource(source))
    // 字号：只在 CSS 声明里
    const fontOutliers = findFontSizes(decls).filter(f => !scale.has(f.num)).map(f => f.value)
    // varRefs 必须走「去注释」后的文本：注释里引用旧令牌名（如「原为 var(--x)」）不是活引用，
    // 计入会让 tokens-defined 与 alias 棘轮同时误报。
    return { path, hardcoded, fontOutliers, varRefs: findVarRefs(stripComments(source)) }
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
  'src/components/BossCard.vue': 8,
  'src/components/BossSelectCard.vue': 8,
  'src/components/CharacterCard.vue': 3,
  'src/components/FinalPanel.vue': 5,
  'src/components/ImpactChart.vue': 5,
  'src/components/MarginalUtilityCard.vue': 1,
  'src/components/ResourceResultCard.vue': 7,
  'src/components/StatPanel.vue': 6,
  'src/views/AttributeConfigPage.vue': 4,
  'src/views/BossHpInflationPage.vue': 1,
  'src/views/CalculatorView.vue': 1,
  'src/views/CharIncrementPage.vue': 6,
  'src/views/DebugPage.vue': 2,
  'src/views/LogicEditorPage.vue': 1,
  'src/views/MechanicsTablePage.vue': 1,
  'src/views/PositionComparePage.vue': 5,
  'src/views/ResourceUtilizationPage.vue': 3,
  'src/views/ResultPage.vue': 12,
  'src/views/RunArchivePage.vue': 5,
  'src/views/StunAxisPage.vue': 29,
  'src/views/TeamComparePage.vue': 6,
  'src/views/TeamConfigPage.vue': 0,
  'src/views/TimeChartsPage.vue': 35,
  'src/views/WEngineFieldPage.vue': 3,
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
  'src/views/TimeChartsPage.vue': 9,
}

/**
 * --wa-* 直接引用总数基线（2026-08-31 实测 449；B3 顶栏换 --app-border/--fg-2 后 447）。
 * 为什么要有这条：--wa-* 的 47 档是历史 codemod 的机械产物（原 rgba(255,255,255,α)），
 * 人记不住 `--wa-250` 是描边还是悬浮底——这是「同义色散落」的同类病根。
 * 解法是加语义别名层（--line/--line-strong/--fill-hover/--fill-active/--text-2/--text-3），
 * 新代码用别名、老代码不动，本棘轮保证直接引用数只减不增。
 */
export const WA_REF_BASELINE = 447

/** var() 引用总数基线（2026-08-31 实测 494→497→502；B4 语义色替换后 524；2026-09-03 实战对比 buff 快捷区 +1）。只增不减，防把变量改回字面量 */
export const VAR_TOTAL_BASELINE = 525

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
  for (const f of scanned) {
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

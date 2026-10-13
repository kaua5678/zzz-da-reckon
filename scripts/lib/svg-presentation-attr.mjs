/**
 * 「SVG 呈现属性被 CSS 类覆盖」扫描器（判据 31 的实现面）。
 *
 * 要拦的形态（2026-10-12 用户报「血量膨胀里面的线条全是蓝色的了」）：
 *   模板给 SVG 元素传**呈现属性**（`:stroke="b.color"` / `:stroke-width="hover ? 2 : 1"`），
 *   而同一个元素上的 class 在 CSS 里声明了**同名属性** ⇒ **CSS 类选择器胜出**，
 *   呈现属性静默失效。
 *
 * 规范依据（不是经验之谈）：SVG 的 `stroke`/`fill`/`stroke-width`/`opacity` 等既是
 * presentation attribute 又是 CSS 属性；presentation attribute 在层叠中的优先级等同于
 * **特异性为 0 的 author 规则**，任何类选择器都能覆盖它。`style=""` 内联才能胜出。
 *
 * 实证（修复前，CDP 读回 computedStyle）：
 *   · 血量膨胀页 `.trend-line`：25 条折线的 attribute 有 **20 种颜色**，
 *     但 computed stroke **只有 1 种**（`rgb(68,147,248)` = `--app-primary`）——全变蓝。
 *     根因 = `styles/charts.css` 的 `.trend-line { stroke: var(--app-primary) }`。
 *   · 5 张图的 hover 加粗 `:stroke-width="hover ? 2 : 1"` 全部是死的
 *     （`.trend-point { stroke-width: 0.5 }` 恒胜出，实测 hover 前后 computed 都是 0.5px）。
 *   · `.lane-cell` 的当期 Boss 橙色描边同理失效。
 *   合计 9 处死绑定，跨 6 个文件。
 *
 * ⚠ 为什么现有 30 条判据全都看不见它：它们查的是「令牌值 vs 底」「scoped 可达性」
 *   「死通道」——**没有一条**在语义层问「这个动态绑定还有效吗」。
 *   与判据 16（scoped 样式可达性）同族：都是「写了但吃不到」，只是机制不同
 *   （16 = scope id 失配；本条 = 层叠优先级被压）。
 *
 * 判定规则（只报**可证明**的死绑定，宁漏不误伤）：
 *   对 src 下每个 .vue 的模板里每个**静态 `class="..."`** 含共享表类的 SVG 图形元素，
 *   若该元素带 `:stroke` / `:fill` / `:stroke-width` / `:opacity` 等**动态绑定**，
 *   且**同一元素**的 `class` 里那个类在样式表里声明了**同名属性**，
 *   且该元素的 `:style` 里**没有**同名属性（camelCase 或 kebab-case）⇒ 违规。
 *
 * 修法（唯一正解）：把该属性挪进 `:style`（内联胜出）。这也是本仓 `.trend-point`
 * 注释里早就写明的口径（「描边色/宽可被页面用 :style 内联覆盖」）——当时只是没机器校验。
 *
 * 豁免：
 *   ① `:style` 里已有同名属性（生效中，只是写法冗余）；
 *   ② 类**不是**静态写死的（`:class` 动态表达式不判——静态解析不可靠，与判据 16 同口径）；
 *   ③ 类在样式表里没声明该属性（属性生效 ⇒ 无冲突）。
 *
 * @fact ui:样式/SVG呈现属性 口径: SVG 的 stroke/fill/stroke-width/opacity 等呈现属性优先级等同「特异性 0 的 author 规则」⇒ **低于任何类选择器**；共享表（styles/charts.css 等）里声明了同名属性的类，会让调用方的 `:stroke` / `:stroke-width` 动态绑定**静默失效**（实测 25 条折线 20 色 attribute → computed 仅 1 色；5 图 hover 加粗恒为 0.5px）。要动态控制必须走 `:style` 内联 | 据 实测@2026-10-12（用户报「血量膨胀线条全变蓝」） | 验 src/scripts/__tests__/svgPresentationAttr.test.ts | 锚 scripts/lib/svg-presentation-attr.mjs#scanSvgPresentationAttr | 信 确认
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/** 会被 CSS 覆盖的 SVG 呈现属性（同时也是 CSS 属性） */
export const PRESENTATION_PROPS = ['stroke', 'fill', 'stroke-width', 'opacity', 'font-size']

/** 扫描面：参与层叠的样式表（全局 + 共享 + 页面 css + .vue 内联 <style>） */
const STYLE_GLOBS = ['src/styles', 'src/views', 'src/components']

function walk(dir, filter, out = []) {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, filter, out)
    else if (filter(name)) out.push(p)
  }
  return out
}

/** 去掉 CSS 注释 */
function stripCssComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '')
}

/**
 * 收集「类名 → 该类声明过的呈现属性集合」。
 * 只看**类选择器**（`.foo`）——元素/属性选择器同样能覆盖呈现属性，但本仓图表基元都是类，
 * 收窄口径可避免误报（宁漏不误伤，与判据 16 同纪律）。
 */
export function collectClassDeclarations(root) {
  /** @type {Map<string, Set<string>>} */
  const decl = new Map()
  const files = []
  for (const dir of STYLE_GLOBS) {
    walk(join(root, dir), n => n.endsWith('.css'), files)
    walk(join(root, dir), n => n.endsWith('.vue'), files)
  }
  for (const file of files) {
    let text
    try { text = readFileSync(file, 'utf8') } catch { continue }
    const blocks = file.endsWith('.css')
      ? [text]
      : [...text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1])
    for (const raw of blocks) {
      const css = stripCssComments(raw)
      for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const body = m[2]
        // 该规则体里声明了哪些呈现属性
        const props = new Set()
        for (const prop of PRESENTATION_PROPS) {
          if (new RegExp(`(?:^|;)\\s*${prop}\\s*:`, 'i').test(body)) props.add(prop)
        }
        if (props.size === 0) continue
        // 选择器里的每个类都算（`.a`、`.a.b`、`.a .b` 都收——被点名的类都可能是"压住"的那一方）
        for (const cls of m[1].matchAll(/\.([A-Za-z_][\w-]*)/g)) {
          const name = cls[1]
          const set = decl.get(name) ?? new Set()
          for (const p of props) set.add(p)
          decl.set(name, set)
        }
      }
    }
  }
  return decl
}

/**
 * 扫描死绑定。
 * @returns {{ file: string, tag: string, cls: string, prop: string, bound: string }[]}
 */
export function scanSvgPresentationAttr(root) {
  const decl = collectClassDeclarations(root)
  const violations = []
  const vueFiles = walk(join(root, 'src'), n => n.endsWith('.vue'))

  for (const file of vueFiles) {
    const src = readFileSync(file, 'utf8')
    const rel = relative(root, file).split(sep).join('/')
    // 只看模板段（script 里的字符串不是 DOM）。
    // ⚠ 必须**贪心**取到最后一个 `</template>`：SFC 里普遍有嵌套的 `<template #header>`
    //   （Naive 卡片插槽），非贪心会在第一个内层 `</template>` 就截断 ⇒ 本判据**一条都扫不到**
    //   （首版实测：匹配到 0 个标签，A/B 注入完全不红 = 恒真的空判据）。
    const tplM = src.match(/<template\b[^>]*>([\s\S]*)<\/template>/)
    if (!tplM) continue
    const tpl = tplM[1]
    for (const tag of tpl.matchAll(/<(polyline|line|rect|circle|path|text|polygon|ellipse)\b([^>]*?)\/?>/g)) {
      const tagName = tag[1]
      const attrs = tag[2]
      // 静态 class（动态 :class 不判——静态解析不可靠，与判据 16 同口径）
      const cm = attrs.match(/(?<![:@\w-])class="([^"]*)"/)
      if (!cm) continue
      const classes = cm[1].split(/\s+/).filter(Boolean)
      const declared = new Set()
      for (const c of classes) for (const p of decl.get(c) ?? []) declared.add(p)
      if (declared.size === 0) continue
      // 该元素的 :style 里已有同名属性 ⇒ 生效中（写法冗余，不判）
      const styleM = attrs.match(/:style="([^"]*)"/)
      const styleBody = styleM ? styleM[1] : ''
      for (const prop of declared) {
        const bind = attrs.match(new RegExp(`(?::|v-bind:)${prop}="([^"]*)"`))
        if (!bind) continue
        const camel = prop.replace(/-(\w)/g, (_, c) => c.toUpperCase())
        const inStyle = new RegExp(`\\b${prop}\\s*:`, 'i').test(styleBody)
          || new RegExp(`\\b${camel}\\s*:`, 'i').test(styleBody)
        if (inStyle) continue
        violations.push({
          file: rel, tag: tagName, cls: classes.join(' '), prop, bound: bind[1].slice(0, 60),
        })
      }
    }
  }
  return violations.sort((a, b) => a.file.localeCompare(b.file) || a.prop.localeCompare(b.prop))
}

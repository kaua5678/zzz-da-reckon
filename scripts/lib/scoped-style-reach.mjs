/**
 * 「scoped 样式可达性」扫描器（判据 16 的实现面）。
 *
 * 要拦的形态（2026-09-14 实测抓到的真 bug）：
 *   抽组件时把 DOM 搬进子组件，但那条样式**留在页面的 scoped CSS 里**。
 *   `<style scoped>` 给选择器追加 `[data-v-页面id]`，而子组件的元素只带**自己**的 scope id
 *   ⇒ 规则静默失配，机器不红、编译通过、测试全绿，只是屏幕上少了一条线/一处字号。
 *   实证：`.kill-line-ref`（Chart 3 的 100% 击杀线，`4b3b739` 抽走）computedStyle
 *   `stroke: none`；`.dd-caption`（Chart 5 说明文字，`36b49f4` 抽走）13px/无 margin（= 继承值）。
 *
 * 为什么值得做成判据：这类缺口的症状是「少了一条不重要的线」，人眼复盘极易放过；
 * 而「抽 svg 块」是本仓库正在批量做的事（TimeChartsPage 2715→1104），每抽一块都可能再造一条。
 *
 * 判据定义（只报**可证明**的失配，宁漏不误伤）：
 *   对每条定义在「页面私有 scoped 样式文件」（src/views 目录下的 .css，或页面 .vue 的内联 scoped style）
 *   里的类选择器 `.X`：若 `.X` 被**某个子组件模板**静态使用（class="..." 或 class="'a b'"），
 *   且该组件**没有**以 `<style scoped src>` 载入定义它的那个文件 ⇒ 违规。
 *   豁免：① `n-*` 等第三方运行时类；② 全局表（src/styles/global.css、charts.css）里的类
 *   ——全局规则无 scope id，任何组件都吃得到；③ `:class` 动态表达式（静态解析不可靠，不判）。
 *
 * @fact ui:样式/scoped可达性 口径: 页面私有 scoped 样式里定义的类，若被未载入该文件的子组件静态使用 ⇒ 该规则对组件不生效（判据 16 违规）；跨块共享的类必须放 styles/chart-blocks.css（经 <style scoped src> 由各块各自载入 ⇒ 特异性不变）或全局 charts.css | 据 实测@2026-09-14（Chart 3 击杀线 stroke:none / Chart 5 dd-caption 继承 13px，两条都是抽组件漏搬样式的静默回归）| 验 src/scripts/__tests__/scopedStyleReach.test.ts | 锚 scripts/lib/scoped-style-reach.mjs#scanScopedStyleReach | 信 高
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative, sep, dirname } from 'node:path'

/** 全局样式：无 scope id，任何组件都能吃到 ⇒ 不算失配 */
const GLOBAL_STYLE_FILES = new Set(['src/styles/global.css', 'src/styles/charts.css'])
/** 第三方/运行时类前缀（naive-ui 注入，不由本仓 CSS 定义） */
const IGNORED_CLASS_PREFIXES = ['n-', 'is-', 'hc-']

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}
const rel = (root, p) => relative(root, p).split(sep).join('/')

/** 解析 `<style ... src="...">` 与内联 `<style scoped>`，返回该 .vue 可见的样式来源 */
function styleSources(vueText) {
  const scoped = []   // 带 scope id 的来源（本文件内联 scoped，或 <style scoped src>）
  const plain = []    // 无 scoped 的内联 style（少数用法）
  // ⚠ 开标签必须**锚在行首**：正文注释里也会出现「<style scoped src>」字样（实测
  //   PullValueChart.vue / NewCharacterChart.vue 的文件头注释都这么写）。不锚定则会把注释里的
  //   字样当开标签、非贪婪吞掉后面真正的块 ⇒ 该组件解析成「没有样式」⇒ 误报/漏报双向失真。
  //   闭标签**不能**要求行首：`<style scoped src="..."></style>` 是同一行的常见写法。
  for (const m of vueText.matchAll(/^<style\b([^>]*)>([\s\S]*?)<\/style>/gm)) {
    const attrs = m[1]
    const isScoped = /\bscoped\b/.test(attrs)
    const src = (attrs.match(/src="([^"]+)"/) ?? [])[1]
    if (src) scoped.push({ src, inline: false, scoped: isScoped })
    else if (m[2].trim()) plain.push({ src: null, inline: true, scoped: isScoped, css: m[2] })
  }
  return { scoped, plain }
}

/** 把 `@/x/y.css` / `../../a/b.css` 解析成仓库相对路径 */
function resolveStyleSrc(vueFile, src) {
  if (src.startsWith('@/')) return 'src/' + src.slice(2)
  const base = dirname(vueFile)
  const parts = (base ? base.split('/') : []).concat(src.split('/'))
  const stack = []
  for (const p of parts) {
    if (p === '.' || p === '') continue
    if (p === '..') stack.pop()
    else stack.push(p)
  }
  return stack.join('/')
}

/** 模板里**静态**使用的 class token（只认 class="a b" 与 :class="{ 'a': x }" 里的字面量之外的部分） */
function staticClasses(vueText) {
  // 取「模板区」= 文件开头到第一个 `<script` 之前。
  // ⚠ 不能用「第一个 </template>」截断：SFC 里 `<template #header>` 的闭合标签会先出现，
  //   那样模板只剩开头几行，(svg 内的类全看不到) ⇒ 真 bug 被判成「没用到」（实测漏掉 kill-line-ref）。
  const sc = vueText.indexOf('<script')
  const tpl = sc > 0 ? vueText.slice(0, sc) : vueText
  const out = new Set()
  for (const m of tpl.matchAll(/\bclass="([^"{}]*?)"/g)) {
    for (const c of m[1].split(/\s+/)) if (/^[a-zA-Z][\w-]*$/.test(c)) out.add(c)
  }
  return out
}

/** CSS 文本里定义的类选择器（含逗号组：`.a, .b { }` 两条都算） */
function definedClasses(cssText) {
  const out = new Set()
  // 去注释，避免注释里的 `.foo` 被当成定义
  const stripped = cssText.replace(/\/\*[\s\S]*?\*\//g, ' ')
  for (const m of stripped.matchAll(/(^|[}\s;,(])(\.([a-zA-Z][\w-]*))/g)) out.add(m[3])
  return out
}

/**
 * 扫描一个仓库根，返回违规清单。
 * 只对**组件目录**（src/components/**）与子视图做消费方判定：
 * 页面自己用自己的页面 CSS 是正常用法，不算违规。
 */
export function scanScopedStyleReach(root) {
  if (!existsSync(join(root, 'src'))) return { skip: 'no-src', violations: [], defs: 0, consumers: 0 }
  const files = walk(join(root, 'src')).map(p => rel(root, p))
  const vuePages = files.filter(f => f.endsWith('.vue') && f.startsWith('src/views/'))
  const vueComponents = files.filter(f => f.endsWith('.vue') && f.startsWith('src/components/'))
  const cssFiles = files.filter(f => f.endsWith('.css'))

  // 1) 每个 .vue 的「可见样式」：谁载入了哪个文件 / 内联写了什么
  const visibility = new Map()  // vue -> { classes: Set, sources: Set<cssRel> }
  const readVue = f => {
    if (visibility.has(f)) return visibility.get(f)
    const text = readFileSync(join(root, f), 'utf8')
    const { scoped, plain } = styleSources(text)
    const sources = new Set()
    const classes = new Set()
    for (const s of scoped) {
      if (!s.scoped) continue                       // 非 scoped 的 src 载入 = 全局生效，不记账
      const r = resolveStyleSrc(f, s.src)
      sources.add(r)
      for (const c of definedClasses(readCss(r))) classes.add(c)
    }
    for (const s of plain) {
      if (!s.scoped) continue
      for (const c of definedClasses(s.css)) classes.add(c)
    }
    const info = { classes, sources }
    visibility.set(f, info)
    return info
  }
  const cssCache = new Map()
  function readCss(r) {
    if (cssCache.has(r)) return cssCache.get(r)
    let t = ''
    // 页面 CSS 与 styles/ 下的共享 CSS 都读；读不到（如第三方）给空串
    const p = join(root, r)
    if (existsSync(p) && statSync(p).isFile()) t = readFileSync(p, 'utf8')
    cssCache.set(r, t)
    return t
  }

  // 2) 收集「页面私有 scoped 定义」：定义在页面 CSS（src/views 下的 .css 或页面内联 scoped）里的类
  const defs = []   // { cls, defFile, via }
  for (const page of vuePages) {
    const info = readVue(page)
    for (const cls of info.classes) {
      // 该类的定义文件（页面 CSS 才算「私有」；styles/ 下的是共享，组件也常载入）
      for (const src of info.sources) {
        if (src.startsWith('src/views/') && definedClasses(readCss(src)).has(cls)) {
          defs.push({ cls, defFile: src, page })
        }
      }
    }
  }
  // 页面内联 scoped 的定义也算私有
  for (const page of vuePages) {
    const text = readFileSync(join(root, page), 'utf8')
    const { plain } = styleSources(text)
    for (const s of plain) {
      if (!s.scoped) continue
      for (const cls of definedClasses(s.css)) {
        if (GLOBAL_STYLE_FILES.has(page)) continue
        defs.push({ cls, defFile: page + '#inline', page })
      }
    }
  }

  // 3) 消费方判定：组件模板静态用了这个类，但组件看不到定义它的文件
  const violations = []
  const seen = new Set()
  for (const comp of vueComponents) {
    const used = staticClasses(readFileSync(join(root, comp), 'utf8'))
    const info = readVue(comp)
    for (const d of defs) {
      if (IGNORED_CLASS_PREFIXES.some(p => d.cls.startsWith(p))) continue
      if (!used.has(d.cls)) continue
      if (info.classes.has(d.cls)) continue                 // 组件自己（或其载入的共享 CSS）有定义 ⇒ 可达
      if (d.defFile === d.page && d.page === comp) continue // 自用
      const key = d.cls + '@' + comp
      if (seen.has(key)) continue
      seen.add(key)
      violations.push({
        cls: d.cls, component: comp, definedIn: d.defFile, ownerPage: d.page,
        note: '组件静态用了该 class，但定义只在页面私有 scoped 样式里 ⇒ 该规则对本组件不生效',
      })
    }
  }
  // 全局表里的类不计（任何组件都吃得到）
  const globalClasses = new Set()
  for (const g of GLOBAL_STYLE_FILES) for (const c of definedClasses(readCss(g))) globalClasses.add(c)
  const real = violations.filter(v => !globalClasses.has(v.cls))
  return { skip: null, violations: real, defs: defs.length, consumers: vueComponents.length }
}

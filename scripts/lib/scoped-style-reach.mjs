/**
 * 「scoped 样式可达性」扫描器（判据 16 的实现面）。
 *
 * 要拦的形态（2026-09-14 实测抓到的真 bug）：
 *   抽组件时把 DOM 搬进子组件，但那条样式**留在别处的 scoped 里**。
 *   `<style scoped>` 给选择器追加 `[data-v-定义方id]`，而子组件的元素只带**自己**的 scope id
 *   ⇒ 规则静默失配，机器不红、编译通过、测试全绿，只是屏幕上少了一条线/一处字号。
 *   实证：`.kill-line-ref`（Chart 3 的 100% 击杀线，`4b3b739` 抽走）computedStyle
 *   `stroke: none`；`.dd-caption`（Chart 5 说明文字，`36b49f4` 抽走）13px/无 margin（= 继承值）。
 *
 * 为什么值得做成判据：这类缺口的症状是「少了一条不重要的线」，人眼复盘极易放过；
 * 而「抽 svg 块」是本仓库正在批量做的事（TimeChartsPage 2715→1104），每抽一块都可能再造一条。
 *
 * 判据定义（只报**可证明**的失配，宁漏不误伤）。三个定义来源面，同一条判定规则：
 *   面一·页面私有 scoped：类定义在页面私有样式里（src/views 下的 .css，或页面 .vue 的内联 scoped style）；
 *   面二·共享 scoped-src 文件：类定义在**任何**被 ≥1 个 .vue 经 `<style scoped src>` 载入的 .css 里
 *         （如 src/styles/chart-blocks.css、src/views/timeCharts/*.css）——这类文件的规则只带
 *         **载入方**的 scope id，没载入的组件吃不到；
 *   面三·他组件内联 scoped：类定义在某个 .vue 的内联 `<style scoped>` 里（如 ChartHoverCard.vue）。
 *   违规 = 某组件（src/components/**）模板**静态**使用类 `.X`（class="..."，不含 :class 动态表达式），
 *   `.X` 在上述任一面有定义，但该组件**既没载入定义它的文件、自身内联 scoped 里也没有同名定义**
 *   ⇒ 该规则对该组件必然不生效（scoped 选择器带的是**定义方**的 data-v-*）。
 *   豁免：① `n-*`/`is-*`/`hc-*` 等第三方/运行时类前缀；② 全局表（src/styles/global.css、
 *   src/styles/charts.css）里的类——全局规则无 scope id，任何组件都吃得到；③ `:class` 动态表达式
 *   （静态解析不可靠，不判）；④ 无任何 scoped 定义的类（可能来自非 scoped 样式/运行时注入，
 *   不可证明失配，不判）；⑤ 组件经**非 scoped** `<style src>` 载入的文件里的类（全局注入，可达）。
 *
 * @fact ui:样式/scoped可达性 口径: 任何 scoped 定义面（页面私有 scoped 文件/内联、被 <style scoped src> 载入的共享 css、他组件内联 scoped）里的类，若被既未载入定义文件、自身内联也无同名定义的组件静态使用 ⇒ 该规则对组件不生效（判据 16 违规）；跨块共享的类必须放 styles/chart-blocks.css（经 <style scoped src> 由各块各自载入 ⇒ 特异性不变）或全局 charts.css | 据 实测@2026-09-14（Chart 3 击杀线 stroke:none / Chart 5 dd-caption 继承 13px，两条都是抽组件漏搬样式的静默回归）| 验 src/scripts/__tests__/scopedStyleReach.test.ts | 锚 scripts/lib/scoped-style-reach.mjs#scanScopedStyleReach | 信 高
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

/** 定义面归类（写进 violation.kind，供报红文案分面解释） */
function kindOf(defFile) {
  if (defFile.endsWith('#inline')) {
    return defFile.slice(0, -'#inline'.length).startsWith('src/views/') ? 'page-inline' : 'component-inline'
  }
  return defFile.startsWith('src/views/') ? 'views-css' : 'shared-css'
}

/**
 * 扫描一个仓库根，返回违规清单。
 * 只对**组件目录**（src/components/**）做消费方判定：
 * 页面自己用自己的页面 CSS 是正常用法，不算违规。
 */
export function scanScopedStyleReach(root) {
  if (!existsSync(join(root, 'src'))) return { skip: 'no-src', violations: [], defs: 0, consumers: 0 }
  const files = walk(join(root, 'src')).map(p => rel(root, p))
  const vueFiles = files.filter(f => f.endsWith('.vue'))
  const vueComponents = vueFiles.filter(f => f.startsWith('src/components/'))
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

  // 1) 每个 .vue 的「可见样式」：谁载入了哪个文件 / 内联写了什么
  //    classes = 该组件**可达**的类全集（载入的 scoped src 文件的类 + 自己内联 scoped 的类
  //              + 非 scoped src 载入文件的类——后者全局注入，人人可达）
  const visibility = new Map()  // vue -> { classes: Set, sources: Set<cssRel>, inlineClasses: Set }
  const readVue = f => {
    if (visibility.has(f)) return visibility.get(f)
    const text = readFileSync(join(root, f), 'utf8')
    const { scoped, plain } = styleSources(text)
    const sources = new Set()
    const classes = new Set()
    const inlineClasses = new Set()
    for (const s of scoped) {
      const r = resolveStyleSrc(f, s.src)
      if (!s.scoped) {                          // 非 scoped 的 src 载入 = 全局注入 ⇒ 规则人人可达
        for (const c of definedClasses(readCss(r))) classes.add(c)
        continue
      }
      sources.add(r)
      for (const c of definedClasses(readCss(r))) classes.add(c)
    }
    for (const s of plain) {
      if (!s.scoped) continue
      for (const c of definedClasses(s.css)) { classes.add(c); inlineClasses.add(c) }
    }
    const info = { classes, sources, inlineClasses }
    visibility.set(f, info)
    return info
  }

  // 2) 定义面收集（三个面统一进 definedIn：cls -> [defFile...]）：
  //    面一+面二：被 ≥1 个 .vue 经 <style scoped src> 载入的 css 文件（全局表除外）里的全部类；
  //    面一+面三：任一 .vue 内联 <style scoped> 里的全部类。
  const definedIn = new Map()   // cls -> Set<defFile>
  const defs = []               // { cls, defFile }（计数面，按 cls@defFile 去重）
  const defSeen = new Set()
  const addDef = (cls, defFile) => {
    const key = cls + '@' + defFile
    if (defSeen.has(key)) return
    defSeen.add(key)
    defs.push({ cls, defFile })
    if (!definedIn.has(cls)) definedIn.set(cls, new Set())
    definedIn.get(cls).add(defFile)
  }
  for (const vue of vueFiles) {
    const info = readVue(vue)
    for (const src of info.sources) {
      if (GLOBAL_STYLE_FILES.has(src)) continue   // 全局表无 scope id，不进定义面
      for (const cls of definedClasses(readCss(src))) addDef(cls, src)
    }
    for (const cls of info.inlineClasses) addDef(cls, vue + '#inline')
  }

  // 3) 消费方判定：组件模板静态用了这个类，但组件看不到任何一处定义
  // 全局表里的类不计（无 scope id，任何组件都吃得到）
  const globalClasses = new Set()
  for (const g of GLOBAL_STYLE_FILES) for (const c of definedClasses(readCss(g))) globalClasses.add(c)
  const violations = []
  for (const comp of vueComponents) {
    const used = staticClasses(readFileSync(join(root, comp), 'utf8'))
    const info = readVue(comp)
    for (const cls of used) {
      if (IGNORED_CLASS_PREFIXES.some(p => cls.startsWith(p))) continue
      if (globalClasses.has(cls)) continue          // 全局表里也有 ⇒ 组件必然吃得到（豁免②）
      if (info.classes.has(cls)) continue          // 组件自己定义、或其载入的文件里有定义 ⇒ 可达
      const defFiles = definedIn.get(cls)
      if (!defFiles?.size) continue                // 无 scoped 定义 ⇒ 不可证明失配，不判（宁漏）
      const files_ = [...defFiles].sort()
      const kinds = [...new Set(files_.map(kindOf))]
      violations.push({
        cls, component: comp,
        definedIn: files_.join('、'),
        ownerPage: files_[0],
        kind: kinds.join('+'),
        note: '组件静态用了该 class，但所有定义都在**别处的 scoped** 里（本组件未载入、内联也无同名定义）'
          + ' ⇒ scoped 选择器带的是定义方的 data-v-*，该规则对本组件不生效',
      })
    }
  }
  return { skip: null, violations, defs: defs.length, consumers: vueComponents.length }
}

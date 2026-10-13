/**
 * 判据 31「SVG 呈现属性不被 CSS 类覆盖」双层测试（2026-10-12）。
 *
 *  ① detector 单测（构造源码，**可红性自证**）：这一层是本判据的立身之本——
 *     首版 detector 有两个致命缺陷，都被 A/B 注入当场抓出：
 *       · `<template>` 用**非贪心**匹配 ⇒ 遇到 Naive 卡片插槽 `<template #header>` 就截断，
 *         实测「匹配到 0 个标签」，A/B 注入**完全不红**（恒真的空判据）；
 *       · 只收 `.vue` 内联 `<style>` ⇒ 漏掉 `src/styles/*.css`（真 bug 的 `.trend-line`
 *         恰好在全局 charts.css 里）。
 *     故本文件对这两点各配一条「必须报」用例。
 *  ② 仓库级判据：真实仓库当前死绑定数 = 0（本轮清 9 处，跨 6 文件）。
 *     基线取 **0** 而不是「冻结存量」：非零存量全是真 bug，没有可豁免的形态
 *     （修法唯一 = 把属性挪进 `:style`，不是登记豁免）。
 *
 * 立项依据（用户 2026-10-12 报「血量膨胀里面的线条全是蓝色的了」）：
 *   `styles/charts.css` 的 `.trend-line { stroke: var(--app-primary) }` 覆盖了模板的
 *   `:stroke="b.color"`（SVG 呈现属性优先级 < 任何类选择器）⇒ 25 条折线的 attribute 有 20 种色、
 *   computed 只剩 1 种（实测 CDP 读回 rgb(68,147,248)）。
 *   同类还有 5 张图的 hover 加粗 `:stroke-width`（恒 0.5px）与 `.lane-cell` 的 Boss 橙描边。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// @ts-expect-error -- scripts/lib 纯 JS 工具模块（与 scoped-style-reach 同处理：不新建手写 .d.mts）
import * as svgNs from '../../../scripts/lib/svg-presentation-attr.mjs'

interface SvgViolation { file: string; tag: string; cls: string; prop: string; bound: string }

const svg = svgNs as {
  scanSvgPresentationAttr: (root: string) => SvgViolation[]
  collectClassDeclarations: (root: string) => Map<string, Set<string>>
}

/** 全局表：`.trend-line` 声明 stroke（真 bug 的形态） */
const CHARTS_CSS = `
.trend-line { fill: none; stroke: var(--app-primary); stroke-width: 2; }
.trend-point { stroke: var(--wa-250); stroke-width: 0.5; }
`
/** 只声明 width 的类：调用方传 :stroke 是**合法**的（对照组的核心） */
const PAGE_CSS = `
.curve-seg { stroke-width: 2; }
`

let root = ''
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'svg-attr-'))
  mkdirSync(join(root, 'src/styles'), { recursive: true })
  mkdirSync(join(root, 'src/views'), { recursive: true })
  writeFileSync(join(root, 'src/styles/charts.css'), CHARTS_CSS)
  writeFileSync(join(root, 'src/views/page.css'), PAGE_CSS)
})
afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }) })

const scan = () => svg.scanSvgPresentationAttr(root)
const pageVue = (body: string) => `<template>
  <n-card>
    <template #header><span>槽位插槽</span></template>
    ${body}
  </n-card>
</template>
<script setup lang="ts">const x = 1</script>
<style scoped src="./page.css"></style>`

describe('判据 31 detector（构造输入，可红性自证）', () => {
  it('★ :stroke 被同名类的 stroke 声明覆盖 ⇒ 报（这就是「线条全变蓝」的形状）', () => {
    writeFileSync(join(root, 'src/views/Bad.vue'),
      pageVue('<polyline :points="pts" :stroke="c" fill="none" class="trend-line" />'))
    const hit = scan().find(v => v.cls === 'trend-line' && v.prop === 'stroke')
    expect(hit, '漏报：:stroke 属性被 charts.css 的 .trend-line{stroke} 覆盖，绑定是死的').toBeTruthy()
    expect(hit!.bound).toBe('c')
  })

  it('★ 改成 :style 内联 ⇒ 不报（唯一正解，discriminating pair 的另一半）', () => {
    writeFileSync(join(root, 'src/views/Good.vue'),
      pageVue('<polyline :points="pts" fill="none" class="trend-line" :style="{ stroke: c }" />'))
    expect(scan().filter(v => v.file.endsWith('Good.vue'))).toEqual([])
  })

  it('★ :style 里用 camelCase（strokeWidth）也算已覆盖 ⇒ 不报', () => {
    writeFileSync(join(root, 'src/views/Camel.vue'),
      pageVue('<circle class="trend-point" :stroke-width="w" :style="{ strokeWidth: w }" />'))
    expect(scan().filter(v => v.file.endsWith('Camel.vue'))).toEqual([])
  })

  it('★ 类里没声明该属性 ⇒ 不报（`:stroke` 生效中，不是死绑定）', () => {
    // .curve-seg 只声明了 stroke-width，故 :stroke 合法、:stroke-width 才是死的
    writeFileSync(join(root, 'src/views/Partial.vue'),
      pageVue('<line class="curve-seg" :stroke="c" />'))
    expect(scan().filter(v => v.file.endsWith('Partial.vue'))).toEqual([])
  })

  it('★ 同一条规则里传了被声明的那一个 ⇒ 报（对照组：精度，不是「有 class 就报」）', () => {
    writeFileSync(join(root, 'src/views/WidthDead.vue'),
      pageVue('<line class="curve-seg" :stroke-width="w" />'))
    const hit = scan().find(v => v.file.endsWith('WidthDead.vue'))
    expect(hit, '漏报：.curve-seg 声明了 stroke-width，故 :stroke-width 是死的').toBeTruthy()
    expect(hit!.prop).toBe('stroke-width')
  })

  it('★ 嵌套 <template #header> 不会截断扫描（首版非贪心匹配 ⇒ 0 标签 = 恒真判据）', () => {
    // pageVue 里**故意**带一个 <template #header>；若 detector 用非贪心匹配，
    // 下面这条注入就扫不到 ⇒ 本用例失败。
    writeFileSync(join(root, 'src/views/Nested.vue'),
      pageVue('<circle class="trend-point" :stroke="c" />'))
    const hit = scan().find(v => v.file.endsWith('Nested.vue'))
    expect(hit, '漏报：内层 </template> 截断了模板提取（这正是首版 0 命中的根因）').toBeTruthy()
    expect(hit!.prop).toBe('stroke')
  })

  it('★ 独立 .css 文件里的类声明被计入（真 bug 的 .trend-line 在全局 charts.css）', () => {
    const decl = svg.collectClassDeclarations(root)
    expect([...(decl.get('trend-line') ?? [])]).toContain('stroke')
    expect([...(decl.get('trend-point') ?? [])]).toContain('stroke-width')
  })

  it('动态 :class 不判（静态解析不可靠，与判据 16 同纪律）', () => {
    writeFileSync(join(root, 'src/views/Dyn.vue'),
      pageVue('<polyline :class="cls" :stroke="c" />'))
    expect(scan().filter(v => v.file.endsWith('Dyn.vue'))).toEqual([])
  })
})

describe('判据 31 仓库级（真实扫描）', () => {
  it('★ 真实仓库当前死绑定 = 0（本轮清 9 处：trend-line stroke + 5 处 hover stroke-width + lane-cell）', () => {
    // 基线 = 0：非零存量全是真 bug，没有可豁免形态（修法唯一 = 挪进 :style）。
    // 注意：这里扫的是**真实仓库根**（不是临时目录），与 check-guards 的判据 31 同源。
    const real = svg.scanSvgPresentationAttr(process.cwd())
    if (real.length > 0) console.log(real.map(v => `${v.file} <${v.tag} class="${v.cls}"> :${v.prop}="${v.bound}"`).join('\n'))
    expect(real).toEqual([])
  })
})

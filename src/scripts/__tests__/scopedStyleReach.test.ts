/**
 * 判据 16「scoped 样式可达性」双层测试（2026-09-14；同日扩面至三个定义来源面）。
 *
 *  ① detector 单测（构造源码，可红性自证）：
 *     「组件用了页面私有 scoped 的类」必须报；补上 `<style scoped src>` 载入后必须不报
 *     ——这一对是判据的核心 discriminating pair（少一半就是误报/漏报）。
 *     面二「类只定义在共享 scoped-src 文件（chart-blocks.css）」与
 *     面三「类只定义在另一个组件的内联 scoped」各配一对「违规报 / 合法不报」。
 *  ② 仓库级判据：真实仓库当前失配数 = 0（本轮已清 3 条，见账本；扩面后仍 0）。
 *     基线取 **0** 而不是「冻结存量」：非零存量全是真 bug，没有可豁免的形态
 *     （豁免通道 = 把类搬进 styles/chart-blocks.css 或组件自己的 css，不是登记）。
 *
 * 立项依据（规则 16①「口径必须挂在活代码上」的反面实证）：三条真 bug 全在 HEAD 上静默存在
 *   `.kill-line-ref`（Chart 3 抽走，`4b3b739`）→ 100% 击杀线 computedStyle `stroke: none`
 *   `.dd-caption`（Chart 5 抽走，`36b49f4`）→ 说明文字 11px/`--wa-500` 失效，实测继承 13px
 *   `.pv-summary`（Chart 5 抽走后页面 Chart 6 仍用）→ 组件侧摘要行 flex/gap 失效
 * 三条都不是「写错」，是**搬 DOM 时没搬规则**；vue-tsc/单测/ui-check 全都不红。
 * 扩面依据：面一只能拦「规则留在页面」；规则留在**共享 css 但消费者没载入**（面二）或留在
 *   **他组件内联 scoped**（面三）时同样静默失配，形状不同、症状相同。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// @ts-expect-error -- scripts/lib 纯 JS 工具模块（与 dead-channel-ls 同处理：不新建手写 .d.mts；
// 将来补了声明，本行会以「未使用的 expect-error」变红，届时删掉即可）
import * as reachNs from '../../../scripts/lib/scoped-style-reach.mjs'

interface ReachViolation { cls: string; component: string; definedIn: string; ownerPage: string }
interface ReachResult { skip: string | null; violations: ReachViolation[]; defs: number; consumers: number }

const reach = reachNs as {
  scanScopedStyleReach: (root: string) => ReachResult
}

const PAGE_CSS = `
.time-charts-page { display: flex; }
.kill-line-ref { stroke: var(--c-success); stroke-opacity: .35; }
.pv-summary { display: flex; gap: 6px; }
`
const SHARED_CSS = `
.chart-subtitle { font-size: 12px; }
`

const pageVue = (extraStyle = '') => `<template>
  <div class="time-charts-page">
    <line class="kill-line-ref" />
    <div class="pv-summary">{{ x }}</div>
  </div>
</template>
<script setup lang="ts">const x = 1</script>
<style scoped src="./timeCharts/page.css"></style>
${extraStyle}`

/** 组件模板：用 .kill-line-ref 与 .chart-subtitle */
const compVue = (styleBlock: string) => `<template>
  <n-card>
    <span class="chart-subtitle">标题</span>
    <line class="kill-line-ref" />
  </n-card>
</template>
<script setup lang="ts">const y = 1</script>
${styleBlock}`

let root = ''
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'scoped-reach-'))
  mkdirSync(join(root, 'src/views/timeCharts'), { recursive: true })
  mkdirSync(join(root, 'src/components/charts'), { recursive: true })
  mkdirSync(join(root, 'src/styles'), { recursive: true })
  writeFileSync(join(root, 'src/views/timeCharts/page.css'), PAGE_CSS)
  writeFileSync(join(root, 'src/styles/chart-blocks.css'), SHARED_CSS)
  writeFileSync(join(root, 'src/styles/charts.css'), '.legend { margin-bottom: 10px; }')
  writeFileSync(join(root, 'src/styles/global.css'), ':root { --c-success: #63e2b7; }')
  writeFileSync(join(root, 'src/views/Page.vue'), pageVue())
})
afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }) })

function scan() { return reach.scanScopedStyleReach(root) }

describe('判据 16 detector（构造输入，可红性自证）', () => {
  it('★ 组件用了页面私有 scoped 定义的类 ⇒ 报（这就是三条真 bug 的形状）', () => {
    writeFileSync(join(root, 'src/components/charts/Bad.vue'), compVue('<style scoped>\n.zzz { color: red; }\n</style>'))
    const r = scan()
    const hit = r.violations.find(v => v.cls === 'kill-line-ref' && v.component.endsWith('Bad.vue'))
    expect(hit, '漏报：kill-line-ref 只定义在页面 css，组件不可能吃到它').toBeTruthy()
    expect(hit!.definedIn).toContain('page.css')
  })

  it('★ 组件用 <style scoped src> 载入定义文件 ⇒ 不报（修好了就该绿，防判据惩罚正确行为）', () => {
    writeFileSync(join(root, 'src/components/charts/Bad.vue'),
      compVue('<style scoped src="../../views/timeCharts/page.css"></style>'))
    const r = scan()
    expect(r.violations.filter(v => v.component.endsWith('Bad.vue') && v.cls === 'kill-line-ref')).toHaveLength(0)
  })

  it('页面自己用 = 正常，不报（判据只拦跨边界失配）', () => {
    writeFileSync(join(root, 'src/components/charts/Bad.vue'), compVue('<style scoped></style>'))
    const r = scan()
    expect(r.violations.some(v => v.ownerPage === 'src/views/Page.vue' && v.component === 'src/views/Page.vue')).toBe(false)
  })

  it('全局表（styles/charts.css、global.css）里的类不算失配 ⇒ 无 scope id 人人可吃', () => {
    writeFileSync(join(root, 'src/components/charts/Legend.vue'),
      compVue('<style scoped>\n.x { color: red; }\n</style>').replace('chart-subtitle', 'legend'))
    const r = scan()
    expect(r.violations.some(v => v.component.endsWith('Legend.vue') && v.cls === 'legend')).toBe(false)
  })

  it('⚠ 反向闸门（本轮实测踩过的解析坑）：模板里有 <template #header> 时，'
    + '用「第一个 </template>」截断会把 svg 段整段丢掉 ⇒ 真 bug 被判成「没用到」（漏报）', () => {
      const nested = `<template>
  <n-card>
    <template #header>
      <span class="chart-subtitle">标题</span>
    </template>
    <svg><line class="kill-line-ref" /></svg>
  </n-card>
</template>
<script setup lang="ts">const y = 1</script>
<style scoped>
.zzz { color: red; }
</style>`
      writeFileSync(join(root, 'src/components/charts/Nested.vue'), nested)
      const r = scan()
      expect(r.violations.some(v => v.cls === 'kill-line-ref' && v.component.endsWith('Nested.vue')),
        '嵌套 <template #slot> 截断导致漏报').toBe(true)
    })

  it('注释里写「<style scoped src>」字样不得被当成真标签（实测 PullValueChart/NewCharacterChart 文件头就这么写）', () => {
    const withProse = `<!-- 用 <style scoped src> 载入 ⇒ 特异性不变 -->
<style scoped src="../../styles/chart-blocks.css"></style>`
    writeFileSync(join(root, 'src/components/charts/Prose.vue'), compVue(withProse)
      .replace('.zzz { color: red; }', '')
      .replace('class="kill-line-ref"', 'class="pv-summary"'))
    const r = scan()
    // pv-summary 只在 page.css 定义，本组件没载入 ⇒ 必须报（若注释被当标签，会把后面的真块吞掉 ⇒ 误报为「组件没有样式」之外的形状）
    expect(r.violations.some(v => v.cls === 'pv-summary' && v.component.endsWith('Prose.vue'))).toBe(true)
    expect(r.violations.some(v => v.cls === 'chart-subtitle' && v.component.endsWith('Prose.vue')),
      'chart-subtitle 由 chart-blocks.css 提供 ⇒ 不该报').toBe(false)
  })

  // ---- 面二：共享 scoped-src 文件（chart-blocks.css 之类）----

  /** 单类消费者：模板只静态用一个类，样式块由用例给 */
  const singleClsComp = (cls: string, styleBlock: string) => `<template>\n  <span class="${cls}">x</span>\n</template>\n<script setup lang="ts">const z = 1</script>\n${styleBlock}`

  it('★ 面二：类只定义在共享 scoped-src 文件里，消费者组件没载入它 ⇒ 报', () => {
    // 先造一个合法载入方，让 chart-blocks.css 成为「被 <style scoped src> 载入的共享文件」
    writeFileSync(join(root, 'src/components/charts/SharedUser.vue'),
      singleClsComp('chart-subtitle', '<style scoped src="@/styles/chart-blocks.css"></style>'))
    // 消费者：模板用了 chart-subtitle，但既没载入 chart-blocks.css、自己也没有定义
    writeFileSync(join(root, 'src/components/charts/SharedMissing.vue'),
      singleClsComp('chart-subtitle', '<style scoped>\n.own-elsewhere { color: red; }\n</style>'))
    const r = scan()
    const hit = r.violations.find(v => v.cls === 'chart-subtitle' && v.component.endsWith('SharedMissing.vue'))
    expect(hit, '漏报：chart-subtitle 只在 chart-blocks.css 定义，消费者没载入就吃不到').toBeTruthy()
    expect(hit!.definedIn).toContain('chart-blocks.css')
    expect(r.violations.some(v => v.cls === 'chart-subtitle' && v.component.endsWith('SharedUser.vue')),
      '合法载入方不该被误报').toBe(false)
  })

  it('★ 面二：消费者也用 <style scoped src> 载入共享文件 ⇒ 不报（合法写法不误伤）', () => {
    writeFileSync(join(root, 'src/components/charts/SharedMissing.vue'),
      singleClsComp('chart-subtitle', '<style scoped src="@/styles/chart-blocks.css"></style>'))
    const r = scan()
    expect(r.violations.filter(v => v.cls === 'chart-subtitle' && v.component.endsWith('SharedMissing.vue')),
      '修好了就该绿').toHaveLength(0)
  })

  // ---- 面三：他组件内联 scoped ----

  it('★ 面三：类只定义在另一个组件的内联 scoped 里，消费者静态使用 ⇒ 报', () => {
    // 定义方：自己内联 scoped 定义 + 自己用（合法）
    writeFileSync(join(root, 'src/components/charts/HoverOwner.vue'),
      singleClsComp('owner-badge', '<style scoped>\n.owner-badge { border: 1px solid red; }\n</style>'))
    // 消费者：用了 owner-badge，但内联 scoped 里没有同名定义、也没有任何载入源提供它
    writeFileSync(join(root, 'src/components/charts/BadgeBorrower.vue'),
      singleClsComp('owner-badge', '<style scoped>\n.other-cls { color: red; }\n</style>'))
    const r = scan()
    const hit = r.violations.find(v => v.cls === 'owner-badge' && v.component.endsWith('BadgeBorrower.vue'))
    expect(hit, '漏报：owner-badge 只在 HoverCardOwner 内联 scoped 定义，别的组件永远吃不到').toBeTruthy()
    expect(hit!.definedIn).toContain('HoverOwner.vue#inline')
    expect(r.violations.some(v => v.cls === 'owner-badge' && v.component.endsWith('HoverOwner.vue')),
      '定义方自用不该被误报').toBe(false)
  })

  it('★ 面三：消费者自己内联 scoped 里也有同名定义 ⇒ 不报（各自一份是 scoped 下的合法写法）', () => {
    writeFileSync(join(root, 'src/components/charts/BadgeBorrower.vue'),
      singleClsComp('owner-badge', '<style scoped>\n.owner-badge { border: 1px solid red; }\n</style>'))
    const r = scan()
    expect(r.violations.filter(v => v.cls === 'owner-badge' && v.component.endsWith('BadgeBorrower.vue')),
      '组件自己有同名定义 ⇒ 可达，不判').toHaveLength(0)
  })
})

describe('判据 16 仓库级（真实树）', () => {
  it('当前零失配（本轮清掉 3 条：kill-line-ref / dd-caption / pv-summary）', () => {
    const r = reach.scanScopedStyleReach(process.cwd())
    if (r.violations.length) console.log(r.violations.map(v => `${v.cls} @ ${v.component} ← ${v.definedIn}`).join('\n'))
    expect(r.violations).toHaveLength(0)
  })

  it('扫描面非空（防「清空输入即通过」的假绿）', () => {
    const r = reach.scanScopedStyleReach(process.cwd())
    expect(r.skip).toBeNull()
    expect(r.defs).toBeGreaterThan(200)
    expect(r.consumers).toBeGreaterThan(10)
  })
})

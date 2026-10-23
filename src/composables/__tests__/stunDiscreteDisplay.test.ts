/**
 * **残疾失衡展示映射**的判据（2026-10-22 修 TDZ + 窗长单一来源）。
 *
 * ## 这条测试防的两件事
 *
 * ① **切页白屏**（用户 2026-10-22 实报）：三个页面曾写
 *    `const label = useStunDiscreteDisplay(() => stunPoolResult.value, () => configStore.enemy).value?.label ?? null`。
 *    `stunPoolResult` / `curvePool` 在同一模块**声明在后面**，而 setup 自上而下执行 ⇒ 立即求值踩 TDZ：
 *    `Uncaught (in promise) ReferenceError: Cannot access 'stunPoolResult' before initialization`
 *    ⇒ `<script setup>` 直接中断、整个页签不渲染（F12 里只有一条 Vue warn「Unhandled error during execution of setup function」）。
 *    判据 = 三个页面各渲染一次（SSR，node 环境），setup 不得抛 TDZ。
 *
 * ② **窗长抄了第二份公式**：旧签名自己算 `stunWindowDuration(stunTime, teamBonus)`，而三个调用点都没传
 *    `teamBonus`（恒 0）⇒ 琉音(+2)/仪玄(+3)/般岳C1 队展示按 16s、引擎按 18s，「第几窗装不下」差一档。
 *    判据 = 带 +2s 的队必须报引擎的 18s，且按 16s 算会给出**不同**结论（否则本判据零判别力）。
 *
 * 语义来源 = `core/effectiveTime#decomposeStunWindows`（用户口径「最后一次达到失衡量但是不完整」的不等式）。
 */
import { describe, expect, it } from 'vitest'
import { createSSRApp, nextTick, ref } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createPinia, setActivePinia } from 'pinia'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { setupHarness } from '@/test/harness'
import { useStunDiscreteDisplay } from '@/composables/stunDiscreteDisplay'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { useConfigStore } from '@/stores/config'
import { effectiveBattleTime } from '@/core/effectiveTime'
import type { StunPoolResult } from '@/types/resource'

/** 造一个只带 `stunCount` 的池（本模块只读这一个字段） */
const poolOf = (stunCount: number) => ({ stunCount }) as StunPoolResult

describe('残疾失衡分解文案（decomposeStunWindows 的展示映射）', () => {
  it('K×W > effTime ⇒ 完整 N + 1 次残疾失衡（完成率可为 0%）', () => {
    const d = useStunDiscreteDisplay({ pool: () => poolOf(11), windowDuration: () => 18, effectiveTime: () => 180 })
    expect(d.value).toEqual({ full: 10, frac: 0, label: '已完成 10 失衡 + 1 次残疾失衡（完成率 0.0%）' })
  })

  it('刚好装满（K×W == effTime）⇒ 无残疾段，label = null', () => {
    const d = useStunDiscreteDisplay({ pool: () => poolOf(10), windowDuration: () => 18, effectiveTime: () => 180 })
    expect(d.value).toEqual({ full: 10, frac: null, label: null })
  })

  it('时间装得下 ⇒ 无残疾段；池缺席 / 窗长非正 / 有效时长缺席 ⇒ null（不编数据）', () => {
    const ok = useStunDiscreteDisplay({ pool: () => poolOf(4), windowDuration: () => 18, effectiveTime: () => 180 })
    expect(ok.value).toEqual({ full: 4, frac: null, label: null })
    for (const bad of [
      { pool: () => null, windowDuration: () => 18, effectiveTime: () => 180 },
      { pool: () => poolOf(4), windowDuration: () => 0, effectiveTime: () => 180 },
      { pool: () => poolOf(4), windowDuration: () => 18, effectiveTime: () => null },
    ]) expect(useStunDiscreteDisplay(bad).value).toBeNull()
  })

  it('★ 是**活 computed**（每次重算都读当下的值）——不是 setup 那一刻的快照', async () => {
    const pool = ref<StunPoolResult | null>(poolOf(10))
    const w = ref(18)
    const d = useStunDiscreteDisplay({ pool: () => pool.value, windowDuration: () => w.value, effectiveTime: () => 180 })
    expect(d.value?.label).toBeNull()
    pool.value = poolOf(11)
    await nextTick()
    expect(d.value?.label, '池变了文案必须跟着变（旧写法 .value ?? null 会冻在首帧）')
      .toBe('已完成 10 失衡 + 1 次残疾失衡（完成率 0.0%）')
    w.value = 16
    await nextTick()
    expect(d.value?.label, '窗长变了也要重算（16×11=176 ≤ 180 ⇒ 无残疾段）').toBeNull()
  })
})

describe('窗长的单一事实源 = 引擎 useResourceCalc#windowDuration（不抄第二份公式）', () => {
  it('★ 带 +2s 失衡延时的队：展示必须用 18s（引擎），不是 stunTime+4 = 16s', async () => {
    // auto-1371-1481-1451：1481 琉音核心被动「敌人失衡后失衡持续时间 +2 秒」
    await setupHarness([{ agentId: '1371' }, { agentId: '1481' }, { agentId: '1451' }], { recommendedBuild: true })
    const config = useConfigStore()
    const calc = useResourceCalc()
    expect(config.enemy.stunTime, '本判据的前提：Boss 失衡时间 12s').toBe(12)
    expect(calc.windowDuration.value, '引擎窗长 = 12 + 连携 4 + 全队失衡延时 2').toBe(18)
    expect(calc.stunEffectiveTime.value, '有效时长 = 战斗时间 − 无敌时间').toBe(effectiveBattleTime(config.enemy))

    // K 取 11（18×11=198 > 180 ⇒ 有残疾段；16×11=176 ≤ 180 ⇒ 无残疾段）⇒ 两条路结论不同，可判别
    const live = useStunDiscreteDisplay({
      pool: () => poolOf(11), windowDuration: () => calc.windowDuration.value, effectiveTime: () => calc.stunEffectiveTime.value,
    })
    const naive = useStunDiscreteDisplay({
      pool: () => poolOf(11), windowDuration: () => config.enemy.stunTime + 4, effectiveTime: () => calc.stunEffectiveTime.value,
    })
    expect(live.value?.label, '引擎窗长 18s ⇒ 第 11 窗装不下').toBe('已完成 10 失衡 + 1 次残疾失衡（完成率 0.0%）')
    expect(naive.value?.label, '反证：按 16s 算会报「没有残疾段」——旧写法就是这个结果').toBeNull()
  }, 300_000)
})

/**
 * ★ 用户实报的那条：**切页不加载**。
 *
 * 判据 = 页面 setup 不得抛 TDZ。用 SSR 渲染跑真实 `<script setup>`（node 环境、无 onMounted），
 * setup 期任何异常都会从 `renderToString` 抛出来——实测与浏览器报**同一个** `ReferenceError`。
 *
 * ⚠ TeamComparePage 不进这条 SSR 用例：它渲染到 naive-ui 的 `Follower` 时会在 node 下抛
 * `document is not defined`（css-render 挂 `document.head`），且以 unhandled rejection 形式污染
 * 整个测试文件（实测 12 条）。⇒ 它的 TDZ 由下面的**源码顺序锁**守（同一个错型、更强的判定面：
 * 三个页面都覆盖，且不依赖谁能 SSR）。
 */
describe('三页 setup 不得踩 TDZ（2026-10-22 切页白屏回归）', () => {
  async function renderPage(load: () => Promise<{ default: unknown }>): Promise<string> {
    const mod = await load()
    const pinia = createPinia()
    setActivePinia(pinia)
    const app = createSSRApp(mod.default as never)
    app.use(pinia)
    app.config.warnHandler = () => {}
    return renderToString(app)
  }

  it('RunArchivePage / ResultPage：setup 跑通并渲染出内容', async () => {
    await setupHarness([{ agentId: '1371' }, { agentId: '1481' }, { agentId: '1451' }], { recommendedBuild: true })
    const pages: Array<() => Promise<{ default: unknown }>> = [
      () => import('@/views/RunArchivePage.vue') as Promise<{ default: unknown }>,
      () => import('@/views/ResultPage.vue') as Promise<{ default: unknown }>,
    ]
    for (const load of pages) expect((await renderPage(load)).length).toBeGreaterThan(0)
  }, 300_000)
})

/**
 * TeamComparePage 不能整页 SSR（理由见上一段注释）⇒ 用**源码顺序**判 TDZ：
 * 取值函数里读到的每个标识符（`() => X.value`）都必须在调用点之前声明。
 *
 * 这条对三页同时成立，比「只断言 curvePool 在前」更硬：以后谁把 `useResourceCalc()` 解构挪到
 * 调用点之后，照样会红。
 */
describe('源码锁：取值函数读的标识符必须声明在调用点之前（TDZ 的通用形态）', () => {
  const PAGES = ['views/RunArchivePage.vue', 'views/ResultPage.vue', 'views/TeamComparePage.vue']

  const KEYS = ['pool', 'windowDuration', 'effectiveTime'] as const

  /** 取 `useStunDiscreteDisplay({ … })` 的调用点位置与三个入参各自的取值函数体 */
  function callSite(src: string) {
    const m = /const\s+\w+\s*=\s*useStunDiscreteDisplay\(\{/.exec(src)
    expect(m, '页面必须调用 useStunDiscreteDisplay').toBeTruthy()
    const at = m!.index
    const block = src.slice(at)
    return { at, block }
  }

  for (const rel of PAGES) {
    it(`${rel}：三个入参的取值函数都只读已声明变量`, () => {
      const src = readFileSync(resolve(__dirname, '../../', rel), 'utf-8')
      const { at, block } = callSite(src)
      for (const key of KEYS) {
        const g = new RegExp(`${key}: \\(\\) => ([a-zA-Z_$][\\w$]*)`).exec(block)
        expect(g, `${rel}: 入参 ${key} 必须是取值函数（() => x.value）`).toBeTruthy()
        const id = g![1]!
        const decl = new RegExp(`(?:const|let)\\s+[^=]*\\b${id}\\b[^=]*=`).exec(src.slice(0, at))
        expect(decl, `${rel}: ${key} 读的 '${id}' 必须声明在调用点之前（否则 setup 抛 TDZ、切页白屏）`).toBeTruthy()
      }
    })
  }
})

describe('源码锁：调用点不许在 setup 顶层读 .value（TDZ / 冻快照两条路都堵）', () => {
  const code = (rel: string) =>
    readFileSync(resolve(__dirname, '../../', rel), 'utf-8')
      .split('\n').filter(l => !/^\s*(\/\/|\*|\/\*|<!--)/.test(l)).join('\n')

  it('三个页面都传取值函数、都不写 useStunDiscreteDisplay(...).value，模板都传载荷 ref', () => {
    for (const rel of ['views/RunArchivePage.vue', 'views/ResultPage.vue', 'views/TeamComparePage.vue']) {
      const src = code(rel)
      expect(src, rel + '：不许在 setup 顶层读 .value（TDZ）').not.toMatch(/useStunDiscreteDisplay\([\s\S]{0,400}?\)\s*\.value/)
      expect(src, rel + '：必须传引擎窗长').toMatch(/windowDuration: \(\) =>/)
      expect(src, rel + '：必须传引擎有效时长').toMatch(/effectiveTime: \(\) =>/)
      expect(src, rel + '：模板必须传载荷 ref').toMatch(/:stun-discrete-label="[A-Za-z]+\?\.label \?\? null"/)
    }
  })
})

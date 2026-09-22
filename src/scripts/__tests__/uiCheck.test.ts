/**
 * 护栏的护栏：`scripts/lib/ui-check-runtime.mjs`（ui-check.mjs 的失败判定核心）。
 *
 * 立项依据（A1.b，缺陷由 A1.a 实跑确认，产物 /tmp/zzz-agent-a-repro/）：
 *   ui-check.mjs 的假绿不是「断言写错」，是**判定根本不存在**——
 *   ① `clickText` 找不到元素返回字符串 `'NOT_FOUND(n=18)'`（非异常），调用点只 console.log
 *      ⇒ `--tab __MISSING_CONTROL__` 打 PASS 退出 0（negA1/A2/A3）；
 *   ② `realMouseClick` 找不到元素返回 null，调用点不判 null ⇒ `option:/open:` 同样假绿（negC1）；
 *   ③ 原生 `disabled` 吞掉 `click()`（`clickEventsFired:0`）仍报 ok（negB1）；
 *   ④ `display:none` 元素上 `click()` 真派发（`hidClicks:1`）仍报 ok（negB2）。
 * 本文件断言的是**修复契约本身**：注入必然 NOT_FOUND / disabled / 不可见 的动作，
 * 必须产出 failures 且退出码 1——修复若被静默回退（有人把判定改回「只 console.log」），这里先红。
 *
 * 另外两条防漂移锁（本文件同时是它们的机器面）：
 *   - `ACTION_VERBS` / `ACTION_FLAGS` 必须与 ui-check.mjs 里真实存在的动词分支 / flag 读取一一对应
 *     （新增一个动作动词而不登记 ⇒ 那条路径没人判失败 ⇒ 本测试红）；
 *   - `eval:` 是诊断读回，`false`/`null` 是**合法诊断值**，绝不能被并进动作失败判定。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ACTION_VERBS,
  ACTION_FLAGS,
  STEP_ACTION_VERBS,
  FIXED_ACTION_FLAGS,
  PAGE_WAIT_VERBS,
  DIAGNOSTIC_VERBS,
  PASSIVE_VERBS,
  classifyAction,
  actionFailure,
  exitCodeFor,
  collectFailures,
  failureBlock,
  roundId,
  artifactNames,
  staleNames,
  inPageHidden,
  inPageDisabled,
  inPageLabel,
  performClick,
  probeRealClickTarget,
  probeFocusTarget,
  visibleMenuOptions,
  inPageCall,
  inPageElementCall,
} from '../../../scripts/lib/ui-check-runtime.mjs'

const UI_CHECK = join(__dirname, '../../../scripts/ui-check.mjs')
const uiCheckSource = readFileSync(UI_CHECK, 'utf8')

// ---- 极简假 DOM：够 inPageHidden / inPageDisabled / performClick 跑，不需要 jsdom ----

interface FakeOpts {
  text?: string
  className?: string
  disabled?: boolean
  disabledAttr?: boolean
  ariaDisabled?: string | null
  display?: string
  visibility?: string
  opacity?: string
  width?: number
  height?: number
  active?: boolean | (() => boolean)
  inner?: any
  parent?: any
  onClick?: () => void
}

function fakeEl(opts: FakeOpts = {}): any {
  const el: any = {
    nodeType: 1,
    __style: opts,
    textContent: opts.text ?? '',
    className: opts.className ?? '',
    disabled: opts.disabled,
    innerHTML: '',
    getAttribute: (n: string) => (n === 'aria-disabled' ? (opts.ariaDisabled ?? null) : null),
    hasAttribute: (n: string) => (n === 'disabled' ? !!opts.disabledAttr : false),
    querySelector: () => opts.inner ?? null,
    scrollIntoView: () => {},
    click: () => opts.onClick?.(),
    parentElement: opts.parent ?? null,
    classList: {
      contains: (c: string) => (c === 'n-tabs-tab--active'
        ? (typeof opts.active === 'function' ? opts.active() : !!opts.active)
        : false),
    },
  }
  el.getBoundingClientRect = () => ({
    x: 0, y: 0, top: 0, left: 0,
    width: opts.width ?? 40, height: opts.height ?? 20,
    right: opts.width ?? 40, bottom: opts.height ?? 20,
  })
  return el
}

/**
 * 缺省 `getComputedStyle`：按元素自己声明的 `__style` 返回（无声明 = 可见）。
 * 逐级向上（祖先链）由各用例显式传入的 `style` 覆盖。
 */
const defaultStyle = (el: any) => {
  const o = el?.__style ?? {}
  return {
    display: o.display ?? 'block',
    visibility: o.visibility ?? 'visible',
    opacity: o.opacity ?? '1',
  }
}

/** 装上假 DOM（`document.querySelectorAll` / `getComputedStyle` / `window`），返回卸载函数。 */
function installFakeDom(bySelector: Record<string, any[]>, style: (el: any) => any = defaultStyle) {
  const g = globalThis as any
  const saved = { document: g.document, getComputedStyle: g.getComputedStyle, window: g.window }
  g.document = { querySelectorAll: (sel: string) => bySelector[sel] ?? [], activeElement: null, body: fakeEl(), documentElement: fakeEl() }
  g.getComputedStyle = (el: any) => ({ display: 'block', visibility: 'visible', opacity: '1', ...style(el) })
  g.window = { innerWidth: 1600, innerHeight: 1400 }
  return () => { g.document = saved.document; g.getComputedStyle = saved.getComputedStyle; g.window = saved.window }
}

/** 缺省假 DOM：所有用例都在「有 getComputedStyle/window 的浏览器样环境」里跑（模块本身假定页内环境）。 */
let uninstallDefault: (() => void) | null = null
beforeEach(() => { uninstallDefault = installFakeDom({}) })
afterEach(() => { uninstallDefault?.(); uninstallDefault = null; vi.restoreAllMocks() })

describe('动词分类（防「判定漏了一条动作路径」）', () => {
  it('动作类动词全部必须命中目标', () => {
    for (const v of ['tab', 'click', 'open', 'option', 'realclick', 'type', 'radio', 'select', 'popover', 'input', 'main-c']) {
      expect(classifyAction(v)).toBe('action')
    }
  })

  it('wait 是等状态（允许回落到页面文本），eval/sleep 不参与动作判定', () => {
    expect(classifyAction('wait')).toBe('page-wait')
    expect(classifyAction('eval')).toBe('diagnostic')
    expect(classifyAction('sleep')).toBe('passive')
    expect(classifyAction('__nope__')).toBe('unknown')
  })

  it('eval: 的 false/null 是合法诊断值，不进失败判定', () => {
    expect(DIAGNOSTIC_VERBS).toContain('eval')
    // 诊断动词不在动作集里 ⇒ 不会被 actionFailure 判失败
    for (const v of DIAGNOSTIC_VERBS) expect(ACTION_VERBS).not.toContain(v)
    for (const v of PAGE_WAIT_VERBS) expect(ACTION_VERBS).not.toContain(v)
    for (const v of PASSIVE_VERBS) expect(ACTION_VERBS).not.toContain(v)
  })

  it('ACTION_VERBS 与 ui-check.mjs 的真实动词分支一一对应（新增分支不登记即红）', () => {
    // 源码里的动词分支是 `} else if (verb === 'x') {`；分类集必须与它集合相等——
    // 新增一个动作动词而不登记 ⇒ 那条路径没人判失败 ⇒ 本测试红。
    const branches = [...uiCheckSource.matchAll(/verb === '([\w-]+)'/g)].map(m => m[1])
    expect(branches.length).toBeGreaterThan(0)
    expect(new Set(branches)).toEqual(new Set([...STEP_ACTION_VERBS, ...PAGE_WAIT_VERBS, ...DIAGNOSTIC_VERBS, ...PASSIVE_VERBS]))
  })

  it('动作集 = step 动词 ∪ 固定 flag 名（两条路径都覆盖）', () => {
    expect(new Set(ACTION_VERBS)).toEqual(new Set([...STEP_ACTION_VERBS, ...FIXED_ACTION_FLAGS]))
    expect(ACTION_FLAGS).toEqual(FIXED_ACTION_FLAGS)
  })

  it('ACTION_FLAGS 每一个都在 ui-check.mjs 里被真实读取（漏一个 = 那条 flag 路径没人判失败）', () => {
    for (const f of ACTION_FLAGS) {
      expect(uiCheckSource, `flag --${f} 未被读取`).toMatch(new RegExp(`(?:arg|flag)\\(\\s*'${f}'`))
    }
    // 反向：源码里读取的 flag 除白名单外都必须是动作类（新增动作 flag 不登记即红）
    const NON_ACTION = ['url', 'port', 'out', 'wait-timeout', 'wait-for', 'chrome', 'chrome-libs', 'value', 'keep-open', 'step']
    const read = [...uiCheckSource.matchAll(/(?:arg|flag)\(\s*'([\w-]+)'/g)].map(m => m[1])
    for (const f of new Set(read)) {
      if (!NON_ACTION.includes(f)) expect(ACTION_FLAGS, `--${f} 未登记为动作类`).toContain(f)
    }
  })
})

describe('动作结果判定（fail-closed：只认 ok）', () => {
  it('① NOT_FOUND 字符串必须判失败（negA1/A2/A3 的根因）', () => {
    const f = actionFailure('tab', 'NOT_FOUND(n=18)')
    expect(f).not.toBeNull()
    expect(f).toContain('NOT_FOUND(n=18)')
    expect(collectFailures('tab', 'NOT_FOUND(n=18)')).toHaveLength(1)
    expect(exitCodeFor(collectFailures('tab', 'NOT_FOUND(n=18)'))).toBe(1)
  })

  it('② null（realMouseClick 找不到元素）必须判失败（negC1 的根因）', () => {
    expect(actionFailure('option', null)).not.toBeNull()
    expect(actionFailure('open', null)).not.toBeNull()
    expect(exitCodeFor(collectFailures('option', null))).toBe(1)
  })

  it('③ 未确认命中的其它返回值一律失败（fail-closed，防新增「悄悄返回别的值」）', () => {
    for (const r of ['NO_ROW:0', 'false', '', false, 0, {}, { ok: false, reason: '目标已禁用(disabled)' }]) {
      expect(actionFailure('input', r as any), JSON.stringify(r)).not.toBeNull()
    }
  })

  it('④ 只有 ok / {ok:true} 不失败', () => {
    expect(actionFailure('tab', 'ok')).toBeNull()
    expect(actionFailure('tab', { ok: true, label: '队伍配置' } as any)).toBeNull()
    expect(exitCodeFor([])).toBe(0)
  })

  it('失败块沿用既有 FAIL 打印格式（兼容既有消费者）', () => {
    const block = failureBlock(['A', 'B'])
    expect(block).toContain('实机点通 FAIL：')
    expect(block).toContain('  ✗ A')
    expect(block).toContain('  ✗ B')
  })
})

describe('禁用 / 不可见判定（negB1 / negB2 的根因）', () => {
  it('原生 disabled 必须判出来（disabled 会吞掉 click()，事件一条不派发）', () => {
    expect(inPageDisabled(fakeEl({ disabled: true }))).toBe('disabled')
    expect(inPageDisabled(fakeEl({ disabledAttr: true }))).toBe('disabled 属性')
    expect(inPageDisabled(fakeEl({ ariaDisabled: 'true' }))).toBe('aria-disabled=true')
    expect(inPageDisabled(fakeEl({ className: 'n-button n-button--small-type n-button--disabled' }))).toBe('class:n-button--disabled')
    expect(inPageDisabled(fakeEl({ className: 'n-button' }))).toBeNull()
  })

  it('display:none / visibility:hidden / opacity:0（含祖先）必须判不可见', () => {
    expect(inPageHidden(fakeEl({ display: 'none' }))).toBe('display:none')
    expect(inPageHidden(fakeEl({ visibility: 'hidden' }))).toBe('visibility:hidden')
    expect(inPageHidden(fakeEl({ opacity: '0' }))).toBe('opacity:0')
    expect(inPageHidden(fakeEl({}))).toBeNull()
    expect(inPageHidden(fakeEl({ width: 0, height: 0 }))).toBe('零尺寸(0×0)')
  })

  it('祖先不可见 ⇒ 后代不可见（getComputedStyle 逐级向上）', () => {
    const hidden = fakeEl({ display: 'none' })
    const child = fakeEl({ parent: hidden })
    const uninstall = installFakeDom({}, (el: any) => (el === hidden ? { display: 'none' } : {}))
    try {
      expect(inPageHidden(child)).toBe('display:none')
    } finally { uninstall() }
  })

  it('零尺寸只判「文本命中的容器」，不判 --radio 点进去的 inner input（naive-ui 的 input 是 opacity:0 但可点）', () => {
    // 容器可见 + inner opacity:0 ⇒ 容器判定通过（回归保护：--radio 难度曲线 这条既有正控不许变红）
    const inner = fakeEl({ opacity: '0' })
    const wrap = fakeEl({ inner })
    const uninstall = installFakeDom({}, (el: any) => (el === inner ? { opacity: '0' } : {}))
    try {
      expect(inPageHidden(wrap)).toBeNull()
      expect(inPageDisabled(inner)).toBeNull()
    } finally { uninstall() }
  })
})

describe('performClick：动作必须命中（修复契约的端到端断言）', () => {
  it('① 文本找不到 ⇒ 失败（不是 NOT_FOUND 字符串静默通过）', async () => {
    const uninstall = installFakeDom({ '.n-tabs-tab': [fakeEl({ text: '队伍配置' })] })
    try {
      const res = await performClick('.n-tabs-tab', '__MISSING_CONTROL__')
      expect(res.ok).toBe(false)
      const f = actionFailure('tab', res)
      expect(f).not.toBeNull()
      expect(f as string).toContain('NOT_FOUND')
      expect(exitCodeFor([f as string])).toBe(1)
    } finally { uninstall() }
  })

  it('② 目标 disabled ⇒ 失败且**不派发 click**（negB1：clickEventsFired 必须保持 0）', async () => {
    let fired = 0
    const el = fakeEl({ text: '撤销', disabled: true, onClick: () => { fired++ } })
    const uninstall = installFakeDom({ '.n-button': [el] })
    try {
      const res = await performClick('.n-button', '撤销')
      expect(res.ok).toBe(false)
      expect(res.reason).toContain('禁用')
      expect(fired).toBe(0)
      expect(exitCodeFor(collectFailures('click', res))).toBe(1)
    } finally { uninstall() }
  })

  it('③ 目标 display:none ⇒ 失败且不派发 click（negB2：hidClicks 必须保持 0）', async () => {
    let fired = 0
    const el = fakeEl({ text: 'HIDDEN_PROBE', display: 'none', onClick: () => { fired++ } })
    const uninstall = installFakeDom({ '.n-button': [el] })
    try {
      const res = await performClick('.n-button', 'HIDDEN_PROBE')
      expect(res.ok).toBe(false)
      expect(res.reason).toContain('display:none')
      expect(fired).toBe(0)
      expect(exitCodeFor(collectFailures('click', res))).toBe(1)
    } finally { uninstall() }
  })

  it('③b 零尺寸（0×0）也判不可见 —— 实测 display:none 元素的矩形就是 0×0，两者都要拦住', async () => {
    let fired = 0
    const el = fakeEl({ text: 'ZERO_PROBE', width: 0, height: 0, onClick: () => { fired++ } })
    const uninstall = installFakeDom({ '.n-button': [el] })
    try {
      const res = await performClick('.n-button', 'ZERO_PROBE')
      expect(res.ok).toBe(false)
      expect(res.reason).toContain('零尺寸')
      expect(fired).toBe(0)
    } finally { uninstall() }
  })

  it('④ 目标可见可点 ⇒ ok（正控路径不许被判定误伤）', async () => {
    let fired = 0
    const el = fakeEl({ text: '计算曲线', onClick: () => { fired++ } })
    const uninstall = installFakeDom({ '.n-button': [el] })
    try {
      const res = await performClick('.n-button', '计算曲线')
      expect(res).toEqual({ ok: true, label: '计算曲线' })
      expect(fired).toBe(1)
      expect(collectFailures('click', res)).toEqual([])
      expect(exitCodeFor(collectFailures('click', res))).toBe(0)
    } finally { uninstall() }
  })

  it('⑤ 页签点完没激活 ⇒ 失败（点了个不切换的页签不能算通过）', async () => {
    vi.useFakeTimers()
    const el = fakeEl({ text: '逻辑编辑', active: false })
    const uninstall = installFakeDom({ '.n-tabs-tab': [el] })
    try {
      const p = performClick('.n-tabs-tab', '逻辑编辑', false, true)
      await vi.advanceTimersByTimeAsync(5000)
      const res = await p
      expect(res.ok).toBe(false)
      expect(res.reason).toContain('未激活')
    } finally { uninstall(); vi.useRealTimers() }
  })

  it('⑥ 页签点击后变 active ⇒ ok', async () => {
    let active = false
    const el = fakeEl({ text: '逻辑编辑', active: () => active, onClick: () => { active = true } })
    const uninstall = installFakeDom({ '.n-tabs-tab': [el] })
    try {
      const res = await performClick('.n-tabs-tab', '逻辑编辑', false, true)
      expect(res.ok).toBe(true)
      expect(res.activated).toBe(true)
    } finally { uninstall() }
  })
})

describe('probeRealClickTarget / probeFocusTarget / visibleMenuOptions', () => {
  it('元素表达式为 null ⇒ 失败（negC1：option:/open: 的 null）', () => {
    const res = probeRealClickTarget(null)
    expect(res.ok).toBe(false)
    expect(exitCodeFor(collectFailures('option', res))).toBe(1)
  })

  it('禁用元素 ⇒ 失败，不返回坐标（不会静默点到别处）', () => {
    const res = probeRealClickTarget(fakeEl({ text: '撤销', disabled: true }))
    expect(res.ok).toBe(false)
    expect(res.reason).toContain('禁用')
  })

  it('可见元素 ⇒ 返回可点坐标', () => {
    const res = probeRealClickTarget(fakeEl({ text: '预设队伍' }))
    expect(res.ok).toBe(true)
    expect(typeof (res as any).x).toBe('number')
  })

  it('视口外 ⇒ 失败（scrollIntoView 后仍落在视口外就是点不到）', () => {
    const el = fakeEl({ text: '远端控件', height: 4000 })
    el.getBoundingClientRect = () => ({ x: 0, y: 3000, top: 3000, left: 0, width: 40, height: 40, right: 40, bottom: 3040 })
    const res = probeRealClickTarget(el)
    expect(res.ok).toBe(false)
    expect(res.reason).toContain('视口外')
  })

  it('type: 没有聚焦元素 ⇒ 失败（insertText 无处落字不能算 ok）', () => {
    const uninstall = installFakeDom({})
    try {
      ;(globalThis as any).document.activeElement = (globalThis as any).document.body
      const res = probeFocusTarget()
      expect(res.ok).toBe(false)
      expect(res.reason).toContain('没有聚焦元素')
    } finally { uninstall() }
  })

  it('visibleMenuOptions 只认真正可见的菜单（关掉的菜单仍留在 DOM 里）', () => {
    const opt = fakeEl({ text: '8 金' })
    const menu = fakeEl({})
    menu.querySelectorAll = () => [opt]
    const hiddenMenu = fakeEl({})
    hiddenMenu.querySelectorAll = () => [fakeEl({ text: '预设基础档' })]
    const uninstall = installFakeDom({ '.n-base-select-menu': [hiddenMenu, menu] },
      e => (e === hiddenMenu ? { display: 'none' } : {}))
    try {
      const opts = visibleMenuOptions() as any[]
      expect(opts).toHaveLength(1)
      expect(opts[0].textContent).toBe('8 金')
    } finally { uninstall() }
  })
})

describe('产物命名与轮次标识（防旧产物冒充新绿）', () => {
  it('失败轮产物与通过轮不同名（失败轮绝不覆盖/冒充成功产物）', () => {
    const pass = artifactNames('/tmp/x', 'pass')
    const fail = artifactNames('/tmp/x', 'fail')
    expect(pass.report).toBe('/tmp/x/ui-check-report.json')   // 既有键/文件名兼容
    expect(pass.shot).toBe('/tmp/x/ui-check-full.png')
    expect(fail.report).toBe('/tmp/x/ui-check-failure.json')
    expect(fail.shot).toBe('/tmp/x/ui-check-failure.png')
    expect(new Set([pass.report, pass.shot, fail.report, fail.shot]).size).toBe(4)
  })

  it('过期改名目标与通过轮产物不同名（开跑即改名）', () => {
    const s = staleNames('/tmp/x')
    expect(s.report).toBe('/tmp/x/ui-check-report.stale.json')
    expect(s.shot).toBe('/tmp/x/ui-check-full.stale.png')
  })

  it('roundId 是文件名安全的时间戳（产物带本轮标识）', () => {
    const id = roundId(new Date('2026-09-22T12:34:56.789Z'))
    expect(id).toBe('2026-09-22T12-34-56-789Z')
    expect(id).not.toMatch(/[:.]/)
  })
})

describe('注入包装（页内函数在浏览器里必须能独立求值）', () => {
  it('inPageCall 把依赖函数一起注入，表达式可独立求值', async () => {
    const uninstall = installFakeDom({ '.n-button': [fakeEl({ text: '保存' })] })
    try {
      const expr = inPageCall(performClick, '.n-button', '保存')
      // 假 DOM 下用 Function 求值（等价于浏览器 Runtime.evaluate）
      const out = await new Function(`return (${expr})`)()
      expect(out.ok).toBe(true)
      expect(expr).toContain('inPageHidden')
      expect(expr).toContain('inPageDisabled')
    } finally { uninstall() }
  })

  it('inPageElementCall 注入 extra（visibleMenuOptions 之类）', () => {
    const expr = inPageElementCall('null', probeRealClickTarget, [visibleMenuOptions])
    expect(expr).toContain('visibleMenuOptions')
    expect(expr).toContain('probeRealClickTarget')
    expect(inPageLabel(fakeEl({ text: ' x  y ' }))).toBe('x y')
  })
})

/**
 * 接线锁：判定核心写好了、**主脚本没接上**同样等于没修（假绿的原始形态就是「算了但没人看」）。
 * 这里对 ui-check.mjs 做结构断言——每个动作分支必须消费判定结果、产物必须走 finally、退出码必须由 failures 决定。
 */
describe('ui-check.mjs 接线（判定必须真的被消费）', () => {
  it('每个动作类动词分支都消费判定（漏一个 = 那条路径又变假绿）', () => {
    // 按分支切段（首个分支是 `if (verb === 'tab')`，其余是 `} else if (verb === 'x')`），
    // 逐段检查：段落里出现 recordAction/collectFailures 才算「判了」。
    const sections = uiCheckSource.split(/(?:\} else )?if \(verb === '/).slice(1)
    expect(sections.length).toBeGreaterThan(0)
    for (const sec of sections) {
      const verb = sec.match(/^([\w-]+)'/)?.[1]
      expect(verb, '无法解析动词分支：' + sec.slice(0, 40)).toBeTruthy()
      const body = sec.split(/(?:\} else )?if \(verb === '/)[0]
      const isAction = STEP_ACTION_VERBS.includes(verb as string)
      if (isAction) {
        expect(body, `动作分支 ${verb} 没有消费失败判定`).toMatch(/recordAction\(|collectFailures\(/)
      } else {
        expect(body, `非动作分支 ${verb} 不该被动作判定误伤`).not.toMatch(/recordAction\(|collectFailures\(/)
      }
    }
  })

  it('固定 flag 路径也消费判定（--tab/--click/--radio/--select/--option/--popover/--input/--main-c）', () => {
    expect(uiCheckSource).toMatch(/actionFailure|collectFailures/)
    for (const f of FIXED_ACTION_FLAGS) {
      // `--main-c` 是布尔 flag（flag('main-c')），其余是取值的 arg('<名>')
      const read = uiCheckSource.includes(`arg('${f}'`) || uiCheckSource.includes(`flag('${f}')`)
      expect(read, `--${f} 未在源码里读取`).toBe(true)
    }
    // 固定 flag 段落数量与「判定消费点」数量都要有：动作 flag 全在 try 块里且各自有判定
    const actionCalls = [...uiCheckSource.matchAll(/recordAction\(/g)].length
    expect(actionCalls, '固定 flag 动作没有统一判定入口 recordAction').toBeGreaterThanOrEqual(FIXED_ACTION_FLAGS.length)
  })

  it('产物写在 finally 里（任何 throw 都要留下本轮证据，不能只剩旧绿产物）', () => {
    const finallyIdx = uiCheckSource.indexOf('} finally {')
    expect(finallyIdx).toBeGreaterThan(-1)
    const tail = uiCheckSource.slice(finallyIdx)
    expect(tail, 'finally 块里没有产物写入').toMatch(/writeArtifacts|writeFileSync/)
  })

  it('退出码由 failures 决定（不是恒 0）', () => {
    expect(uiCheckSource).toMatch(/process\.exit\(exitCodeFor\(failures\)\)/)
    expect(uiCheckSource).toMatch(/failures\.length > 0/)
  })

  it('开跑即把上一轮产物改名成 *.stale.*（防旧绿冒充本轮）', () => {
    expect(uiCheckSource).toMatch(/staleNames/)
    expect(uiCheckSource).toMatch(/renameSync/)
  })
})

/**
 * ui-check.mjs 的**判定核心**：动作类动词「有没有真的点到目标」、失败判定、产物命名。
 *
 * 为什么单独成模块（A1.b）：ui-check.mjs 此前有实测确认的**假绿**缺陷——
 *   ① `clickText` 找不到元素时返回字符串 `'NOT_FOUND(n=..)'`（非异常），调用点只 `console.log`
 *      不判返回值 ⇒ 退出 0 打 PASS（实测：`--tab __MISSING_CONTROL__` → `NOT_FOUND(n=18)` + 退出 0）；
 *   ② `realMouseClick` 找不到元素返回 `null`，调用点不判 null ⇒ `option:/open:` 的 null 同样假绿；
 *   ③ 原生 `disabled` 吞掉 `click()`、`display:none` 元素上 `click()` 仍真派发 ⇒ 脚本报 ok；
 *   ④ 报告/截图写在 try 尾部，任何 throw（waitFor 超时 / 未知动词）跳 catch 就不写本轮产物，
 *      旧的成功产物原地留存 ⇒ 旧绿冒充新绿。
 * 判定逻辑留在 .mjs 主体里无法单测（只能起浏览器跑负控），抽到本模块后
 * `src/scripts/__tests__/uiCheck.test.ts` 能在 node 里直接断言
 * 「注入必然 NOT_FOUND / disabled / 不可见 的动作必须非零退出」——即本修复自身的回归护栏。
 *
 * 页内函数（`performClick` / `probeRealClickTarget` / `visibleMenuOptions` / `probeFocusTarget`）
 * 有两个消费者：① 经 `inPageCall` / `inPageElementCall` 注入浏览器执行；
 * ② node 单测直接调用（`inPageHidden` / `inPageDisabled` 在模块作用域里同名可达）。
 * 因此这些函数**只许引用自己的形参 + `inPageHidden` / `inPageDisabled` + 浏览器全局**，
 * 不许闭包引用别的模块级变量（注入后那些名字不存在，会在浏览器里 ReferenceError）。
 */
import { join } from 'node:path'

// ---- 动词分类：哪些「没点到」必须进 failures ----

/**
 * **通用脚本步**里的动作类动词：语义就是「去点/去操作某个具体目标」，没命中目标 = 这一步没生效 = 必须红。
 * 对应 ui-check.mjs 的 `--step <verb>:...` 分支。
 */
export const STEP_ACTION_VERBS = ['tab', 'click', 'open', 'option', 'realclick', 'type']

/** **固定 flags** 里的动作类动词（少登记一个，那条 flag 路径就没人判失败）。 */
export const FIXED_ACTION_FLAGS = ['tab', 'click', 'radio', 'select', 'option', 'popover', 'input', 'main-c']

/** 动作类动词全集（step 动词 + 固定 flag 名）——`classifyAction` 的输入域。 */
export const ACTION_VERBS = [...new Set([...STEP_ACTION_VERBS, ...FIXED_ACTION_FLAGS])]

/** 固定动作 flag 清单（与 `ACTION_VERBS` 同源的机器面，供测试做覆盖断言）。 */
export const ACTION_FLAGS = FIXED_ACTION_FLAGS

/**
 * `wait:` 允许回落到「页面文本包含」——`--step "wait:时间截断"` 这类用法是**等状态**不是**点目标**，
 * 不能按「选择器没命中」判失败（会误伤既有点通流程）。它的失败路径本来就有：waitFor 超时抛异常。
 */
export const PAGE_WAIT_VERBS = ['wait']

/** `eval:` 是诊断读回，`false`/`null` 都是**合法诊断值**，不是动作失败。 */
export const DIAGNOSTIC_VERBS = ['eval']

/** 纯等待，无目标可判。 */
export const PASSIVE_VERBS = ['sleep']

/** 动词分类：action（必须命中）/ page-wait / diagnostic / passive / unknown（unknown 由调用方抛错）。 */
export function classifyAction(verb) {
  if (STEP_ACTION_VERBS.includes(verb) || FIXED_ACTION_FLAGS.includes(verb)) return 'action'
  if (PAGE_WAIT_VERBS.includes(verb)) return 'page-wait'
  if (DIAGNOSTIC_VERBS.includes(verb)) return 'diagnostic'
  if (PASSIVE_VERBS.includes(verb)) return 'passive'
  return 'unknown'
}

/**
 * 动作执行结果 → 失败原因（`null` = 命中，不失败）。**fail-closed**：动作类动词只认
 * `'ok'` / `{ ok: true }` / 真实鼠标坐标（`{ ok: true, x, y }`），其余一律算没命中——
 * 新增一种「悄悄返回别的值」的写法不会再静默变绿。
 *
 * @param verb 动作动词（用于失败原因里的定位信息）
 * @param result 页内返回值：`'ok'` / `'NOT_FOUND(n=..)'` / `'NO_ROW:n'` / `null` / `{ ok, reason }`
 * @returns 失败原因字符串；命中返回 null
 */
export function actionFailure(verb, result) {
  const where = `[${verb}]`
  if (result === null || result === undefined) return `${where} 未命中目标：选择器/文本没匹配到元素（返回 ${result === null ? 'null' : 'undefined'}）`
  if (typeof result === 'string') {
    if (result === 'ok') return null
    if (result.startsWith('NOT_FOUND')) return `${where} 未命中目标：${result}`
    return `${where} 动作未确认命中：${result.slice(0, 120)}`
  }
  if (typeof result === 'object') {
    if (result.ok === true) return null
    if (result.ok === false) return `${where} ${result.reason ?? '未命中目标'}`
    return `${where} 结果缺 ok 字段（判定不明，按未命中处理）：${JSON.stringify(result).slice(0, 120)}`
  }
  return `${where} 未知结果类型：${String(result).slice(0, 120)}`
}

/** 退出码：有失败即 1（契约「失败判定真的会红」的机器面）。 */
export function exitCodeFor(failures) {
  return failures.length > 0 ? 1 : 0
}

/** 动作结果 → 失败清单（命中返回 `[]`）——调用点直接 `failures.push(...collectFailures(verb, res))`。 */
export function collectFailures(verb, result) {
  const f = actionFailure(verb, result)
  return f ? [f] : []
}

/** FAIL 打印块（与修复前的既有格式逐字兼容：`实机点通 FAIL：` + 每条 `  ✗ `）。 */
export function failureBlock(failures) {
  return ['', '实机点通 FAIL：', ...failures.map(f => '  ✗ ' + f)].join('\n')
}

// ---- 产物命名：失败轮也要留证据，且不许被旧产物冒充 ----

/** 本轮标识（ISO 时间戳，文件名安全）：产物带本轮标识/时间。 */
export function roundId(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-')
}

/**
 * 产物路径。**通过轮**沿用既有文件名/键（`ui-check-full.png` / `ui-check-report.json`，
 * 兼容既有消费者）；**失败轮**写专用文件名，永不会与上一轮成功产物同名互相冒充。
 */
export function artifactNames(outDir, status) {
  return status === 'pass'
    ? { status, report: join(outDir, 'ui-check-report.json'), shot: join(outDir, 'ui-check-full.png') }
    : { status, report: join(outDir, 'ui-check-failure.json'), shot: join(outDir, 'ui-check-failure.png') }
}

/** 上一轮产物的「过期」改名目标（开跑即改名 ⇒ 本轮失败也不会留下看起来新鲜的旧绿）。 */
export function staleNames(outDir) {
  return { report: join(outDir, 'ui-check-report.stale.json'), shot: join(outDir, 'ui-check-full.stale.png') }
}

// ---- 页内判定（注入浏览器 / node 单测共用） ----

/**
 * 元素不可见的判定：**自身 + 全部祖先**的 display/visibility/opacity，外加零尺寸矩形。
 *
 * 注意调用面：只判「文本命中的那个容器元素」，**不判 `--radio` 点进去的 inner input**——
 * naive-ui 的 `.n-radio-button input` 实测 `opacity:0`（视觉隐藏但可点），判它会误伤
 * `--radio 难度曲线` 这条既有正控。inner 只额外参与 disabled 判定。
 *
 * @returns 不可见原因；可见返回 null
 */
export function inPageHidden(el) {
  if (!el || el.nodeType !== 1) return '元素不存在'
  // 先查祖先链（能说出具体原因：display:none / visibility:hidden / opacity:0），
  // 再查零尺寸兜底（`display:none` 的元素矩形本来就是 0×0，先查矩形会把原因说成「零尺寸」）。
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
    const st = getComputedStyle(n)
    if (st.display === 'none') return 'display:none'
    if (st.visibility === 'hidden' || st.visibility === 'collapse') return 'visibility:' + st.visibility
    if (Number(st.opacity) === 0) return 'opacity:0'
  }
  const rect = el.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return '零尺寸(0×0)'
  return null
}

/**
 * 元素被禁用的判定（原生 `disabled` / `aria-disabled` / naive-ui 的 `*--disabled` 类 /
 * 显式 `disabled` 属性）。**为什么必须判**：原生 disabled 会吞掉 `click()`——元素找得到、
 * click() 也调了、事件一条不派发，脚本却报 ok（实测 `clickEventsFired:0`）。
 *
 * @returns 禁用原因；可点返回 null
 */
export function inPageDisabled(el) {
  if (!el || el.nodeType !== 1) return null
  if (el.disabled === true) return 'disabled'
  if (el.hasAttribute && el.hasAttribute('disabled')) return 'disabled 属性'
  if (el.getAttribute && el.getAttribute('aria-disabled') === 'true') return 'aria-disabled=true'
  const cls = typeof el.className === 'string' ? el.className : ''
  const m = cls.match(/(?:^|\s)([\w-]+--disabled)(?:\s|$)/)
  if (m) return 'class:' + m[1]
  return null
}

/** 文本命中元素的短标签（失败原因里带上是哪个元素，便于定位）。 */
export function inPageLabel(el) {
  return ((el && el.textContent) || '').replace(/\s+/g, ' ').trim().slice(0, 30)
}

/**
 * 页内点击 + 命中判定（**动作类动词的唯一执行入口**）：
 *   ① 按 `sel` + 文本包含找到元素；找不到 → `{ ok:false, reason:'未命中目标 NOT_FOUND(n=..)' }`
 *   ② 容器 disabled / 不可见 → `{ ok:false, reason }`，**不静默点错**
 *   ③ inner（`--radio` 点 input）只额外判 disabled
 *   ④ 真点；`expectActivate` 时轮询「点击后目标真的变成激活态」（页签类；`--tab` 的假绿形态是
 *      「点了个不可点/不存在的东西，页面根本没切」——类名变化是唯一可靠判据）
 */
export async function performClick(sel, text, inner = false, expectActivate = false) {
  const els = [...document.querySelectorAll(sel)]
  const el = els.find(e => (e.textContent || '').replace(/\s+/g, '').includes(text))
  if (!el) return { ok: false, reason: `未命中目标 NOT_FOUND(n=${els.length})：${sel} 里没有含「${text}」的元素` }
  const target = inner ? (el.querySelector('input') || el) : el
  const disabled = inPageDisabled(el) || inPageDisabled(target)
  if (disabled) return { ok: false, reason: `目标已禁用(${disabled})：${inPageLabel(el)}`, found: true, disabled }
  const hidden = inPageHidden(el)
  if (hidden) return { ok: false, reason: `目标不可见(${hidden})：${inPageLabel(el)}`, found: true, hidden }
  const alreadyActive = expectActivate ? el.classList.contains('n-tabs-tab--active') : false
  target.click()
  if (!expectActivate) return { ok: true, label: inPageLabel(el) }
  if (alreadyActive) return { ok: true, label: inPageLabel(el), activated: true, alreadyActive: true }
  const t0 = Date.now()
  while (Date.now() - t0 < 3000) {
    if (el.classList.contains('n-tabs-tab--active')) return { ok: true, label: inPageLabel(el), activated: true, ms: Date.now() - t0 }
    await new Promise(r => setTimeout(r, 60))
  }
  return { ok: false, reason: `点击后目标未激活（${sel} 仍是非 active）：${inPageLabel(el)}`, found: true, activated: false }
}

/**
 * 页内「真实鼠标点击」目标探测：先 scrollIntoView（控件可能在视口外，实测 y=3383 > 视口 1400），
 * 再判 disabled / 不可见 / 点位落空，返回可点坐标。找不到元素（`el` 为 null）也是失败。
 */
export function probeRealClickTarget(el) {
  if (!el) return { ok: false, reason: '未命中目标：元素表达式求值为 null（选择器/文本没匹配到元素）' }
  const disabled = inPageDisabled(el)
  if (disabled) return { ok: false, reason: `目标已禁用(${disabled})：${inPageLabel(el)}`, found: true, disabled }
  if (el.scrollIntoView) el.scrollIntoView({ block: 'center', inline: 'center' })
  const hidden = inPageHidden(el)
  if (hidden) return { ok: false, reason: `目标不可见(${hidden})：${inPageLabel(el)}`, found: true, hidden }
  const r = el.getBoundingClientRect()
  const x = Math.round(r.x + r.width / 2)
  const y = Math.round(r.y + r.height / 2)
  const vw = typeof window === 'undefined' ? Infinity : window.innerWidth
  const vh = typeof window === 'undefined' ? Infinity : window.innerHeight
  if (x < 0 || y < 0 || x > vw || y > vh) {
    return { ok: false, reason: `目标点落在视口外(${x},${y} / 视口 ${vw}×${vh})：${inPageLabel(el)}`, found: true }
  }
  return { ok: true, x, y, inView: r.top >= 0 && r.bottom <= vh, label: inPageLabel(el) }
}

/**
 * `type:` 的前置判定：必须有**非 body 的聚焦元素**——否则 `Input.insertText` 无处落字，
 * 脚本此前照样报 ok（静默无效）。
 */
export function probeFocusTarget() {
  const el = document.activeElement
  if (!el || el === document.body || el === document.documentElement) {
    return { ok: false, reason: '没有聚焦元素：type 之前必须先 open/click 聚焦一个输入框' }
  }
  const disabled = inPageDisabled(el)
  if (disabled) return { ok: false, reason: `聚焦元素已禁用(${disabled})`, found: true }
  return { ok: true, tag: el.tagName, label: inPageLabel(el) }
}

/**
 * 当前**真正可见**的下拉菜单里的选项（取最后一个可见菜单）。
 * naive-ui 把菜单 teleport 到 body，**关掉的菜单仍留在 DOM 里**（父容器还是 visible）⇒
 * 必须按「菜单元素自身可见」筛，否则会点到上一个菜单的选项（实测把「8 金」点成了「预设基础档」）。
 */
export function visibleMenuOptions() {
  const menus = [...document.querySelectorAll('.n-base-select-menu')].filter(m => !inPageHidden(m))
  const last = menus[menus.length - 1]
  return last ? [...last.querySelectorAll('.n-base-select-option')] : []
}

// ---- 注入包装：把页内函数 + 其依赖的判定函数源码一起塞进表达式 ----

/** 页内函数依赖的判定函数源码前缀（`inPageHidden` / `inPageDisabled` 是页内函数的唯一外部依赖）。 */
function depsSource() {
  return `const inPageHidden = ${inPageHidden.toString()}; const inPageDisabled = ${inPageDisabled.toString()}; const inPageLabel = ${inPageLabel.toString()};`
}

/**
 * 把页内函数 `fn(...args)` 包装成可在浏览器里求值的表达式。
 * `extra` 传入页内函数会调用的其它页内函数（如 `visibleMenuOptions`），按函数名注入。
 */
export function inPageCall(fn, ...args) {
  const argSrc = args.map(a => JSON.stringify(a)).join(', ')
  return `(() => { ${depsSource()} return (${fn.toString()})(${argSrc}) })()`
}

/** 同上，但形参是**元素表达式**（求值成元素或 null），用 `probe`（缺省 probeRealClickTarget）判定。 */
export function inPageElementCall(findExpr, probe = probeRealClickTarget, extra = []) {
  const extraSrc = extra.map(f => `const ${f.name} = ${f.toString()};`).join(' ')
  return `(() => { ${depsSource()} ${extraSrc} return (${probe.toString()})((${findExpr})) })()`
}

/**
 * 真鼠标点击（CDP `Input.dispatchMouseEvent`）：naive-ui 的 select / option 依赖 document 级
 * mousedown，纯 `el.click()` 会「找到元素也点了，但值没变」。`send` 由调用方注入（保持本模块可单测）。
 *
 * 判定在**页内**完成（`probeRealClickTarget`）⇒ 禁用/不可见/落点视口外一律返回 `{ok:false}`，
 * 调用点据此记 failure，**不发鼠标事件**（不会静默点到别的元素上）。
 */
export async function realMouseClick(send, findExpr, probe = probeRealClickTarget, extra = []) {
  const pt = await send('Runtime.evaluate', {
    expression: inPageElementCall(findExpr, probe, extra),
    returnByValue: true,
    awaitPromise: true,
  }).then(r => r.result?.value)
  if (!pt) return { ok: false, reason: '未命中目标：目标探测表达式没有返回结果（页面可能已崩）' }
  if (!pt.ok) return pt
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x, y: pt.y })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', clickCount: 1 })
  return pt
}

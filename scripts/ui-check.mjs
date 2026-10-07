#!/usr/bin/env node
/**
 * 实机点通（UI 冒烟）：CDP 驱动 headless Chromium 打开 `dist/` 静态服务，按「页签 → 控件 → 按钮」
 * 走一遍，读回 DOM 体检结果并截图。
 *
 * 为什么有这个脚本：UI 改动的可信度此前只到 `vue-tsc` 模板检查 + 展示层单测，每次收工都要写一句
 * 「实机点通没做」。本脚本把 C9 那条一次性配方固化成一条命令（用户态、不需要 root、不需要装包管理器依赖）。
 *
 * ★ 失败判定（A1.b 修复；缺陷由 A1.a 实跑确认，产物 /tmp/zzz-agent-a-repro/）：
 *   此前**动作类动词「没点到」不会红**——`clickText` 找不到元素返回字符串 `NOT_FOUND(n=..)`、
 *   `realMouseClick` 找不到元素返回 `null`，调用点只 `console.log` 不判返回值 ⇒ 退出 0 打 PASS；
 *   原生 `disabled` 吞掉 `click()`、`display:none` 元素上 `click()` 仍真派发 ⇒ 同样报 ok。
 *   现在**动作类动词必须命中目标**，三类「没点到」全部进 failures：
 *     ① 找不到元素（NOT_FOUND / null）② 目标 disabled ③ 目标不可见（含祖先 display/visibility/opacity）
 *   `eval:` 是诊断读回（`false`/`null` 是合法诊断值，不判失败）；`wait:` 允许回落到页面文本包含
 *   （等状态不是点目标），它的失败路径仍是超时抛异常。
 *   判定核心在 `scripts/lib/ui-check-runtime.mjs`（可单测，见 `src/scripts/__tests__/uiCheck.test.ts`）。
 *   DOM 体检另判「原始数值外露」（r716）：终态页面文本出现 ≥7 位小数的浮点噪声或 NaN / Infinity ⇒ 失败
 *   （`rawNumberLeaks`；展示处漏了 `fmt` 的典型症状，如 `轴轮数 2.7757914099116654 轮`）。
 *
 * 产物：报告/截图写在 **finally** 里 ⇒ 任何 throw（超时、未知动词、页内异常）也留下本轮证据；
 *   失败轮写 `ui-check-failure.json` / `ui-check-failure.png`（不与通过轮同名，旧绿不会冒充新绿），
 *   开跑时把上一轮产物改名为 `*.stale.*` 并在本轮报告里记 `staleFrom`。
 *
 * 前置（本机已就绪，换机器时照做）：
 *   1) 静态服务：`python3 -m http.server 8099 --directory dist`（先 `npm run build`）
 *   2) Chromium：`~/.cache/ms-playwright/` 下 `chromium-…` 里的 `chrome-linux64/chrome`，或 `chrome-headless-shell`；
 *      若报缺 `libnspr4.so/libnss3.so/...`（非 root 装不了），用户态解包补齐：
 *        mkdir -p /tmp/chromedeps && cd /tmp/chromedeps && apt-get download libnspr4 libnss3 libasound2t64 \
 *          && mkdir -p root && for d in *.deb; do dpkg-deb -x "$d" root/; done
 *        然后 `CHROME_LIBS=/tmp/chromedeps/root/usr/lib/x86_64-linux-gnu` 传给本脚本。
 *
 * 用法（默认流程 = 本仓「队伍对比 · 难度曲线」）：
 *   node scripts/ui-check.mjs --tab 队伍对比 --radio 难度曲线 --main-c --click 计算曲线 --wait-for polyline
 * 参数：
 *   --url <URL>        默认 http://127.0.0.1:8099/
 *   --tab <文本>       点页头页签（按文本包含匹配）
 *   --radio <文本>     点单选/单选按钮（点在 input 上）
 *   --main-c           点「按主C快选」并选第一个选项（把全选 127 队收窄成 1~5 队）
 *   --select <标签>     打开某个 `.ctl-field`（按标签文本）里的下拉
 *   --option <文本片段> 与 --select 搭配：点选中包含该文本的选项（如 --option "8 金"）
 *   --popover <按钮文本> 打开一个弹层（点该按钮），配合 --input/--value 设置里面的数字输入
 *   --input <字段标签> --value <值>  在弹层里按行标签设置数字输入（如 --input G2 --value 9）
 *   --click <文本>     点按钮（按文本包含匹配）
 *   --wait-for <表达式> 轮询到该 JS 表达式为真（如 `polyline` 或完整表达式）
 *   --wait-timeout <ms> 默认 300000
 *   --out <目录>       截图与体检结果输出目录，默认 /tmp/zzz-ui
 *   --port <端口>      CDP 端口，默认 9222（脚本自己拉起浏览器，退出时关掉）
 *   --keep-open        跑完不关浏览器
 *   --step <verb:参数> 通用脚本步（可重复，按顺序执行；见下方 stepList 注释）：tab/open/option/click/realclick/type/wait/eval/sleep
 *                      `type:` = 向当前聚焦元素键入文本（filterable 下拉按文本过滤用）
 *                      例：--step "tab:队伍配置" --step "open:选择预设队伍" --step "option:般岳" --step "tab:资源池" --step "wait:时间截断"
 * 退出码：0 = 跑完且**零 JS 错误**；1 = 有错/超时/动作没命中目标（错误会打印）。
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, existsSync, readdirSync, renameSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  artifactNames,
  collectFailures,
  exitCodeFor,
  failureBlock,
  inPageCall,
  performClick,
  probeFocusTarget,
  probeRealClickTarget,
  rawNumberLeaks,
  realMouseClick,
  roundId,
  staleNames,
  visibleMenuOptions,
} from './lib/ui-check-runtime.mjs'

const argv = process.argv.slice(2)
const arg = (name, def = undefined) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : def
}
const flag = name => argv.includes(`--${name}`)
const sleep = ms => new Promise(r => setTimeout(r, ms))

const URL_APP = arg('url', 'http://127.0.0.1:8099/')
const PORT = Number(arg('port', '9222'))
const OUT = arg('out', '/tmp/zzz-ui')
const WAIT_TIMEOUT = Number(arg('wait-timeout', '300000'))
const WAIT_FOR = arg('wait-for', null)
const ROUND = roundId()

/** 找 Chromium：优先 chrome-headless-shell（依赖更少），其次完整 chrome */
function findChrome() {
  const explicit = process.env.CHROME_BIN || arg('chrome')
  if (explicit) return explicit
  const root = join(homedir(), '.cache', 'ms-playwright')
  if (!existsSync(root)) return null
  const candidates = []
  for (const dir of readdirSync(root)) {
    for (const sub of ['chrome-headless-shell-linux64/chrome-headless-shell', 'chrome-linux64/chrome']) {
      const p = join(root, dir, sub)
      if (existsSync(p)) candidates.push(p)
    }
  }
  return candidates.sort((a, b) => (a.includes('headless') ? -1 : 1) - (b.includes('headless') ? -1 : 1))[0] ?? null
}

// Startup is part of the same failure/report lifecycle as page actions.
let child = null
let ws = null
let browserError = null
let phase = 'startup'
const staleRenamed = []
const jsErrors = []
let seq = 0
const pending = new Map()

async function startBrowser() {
  mkdirSync(OUT, { recursive: true })
  const stale = staleNames(OUT)
  // Rotate failure artifacts too: a failed screenshot must not expose an older image.
  for (const [from, to] of [
    [join(OUT, 'ui-check-report.json'), stale.report],
    [join(OUT, 'ui-check-full.png'), stale.shot],
    [join(OUT, 'ui-check-failure.json'), join(OUT, 'ui-check-failure.stale.json')],
    [join(OUT, 'ui-check-failure.png'), join(OUT, 'ui-check-failure.stale.png')],
  ]) {
    if (!existsSync(from)) continue
    renameSync(from, to) // A rotation failure is a real failure, not a silent PASS.
    staleRenamed.push(to)
  }
  const chrome = findChrome()
  if (!chrome) throw new Error('找不到 Chromium：设 CHROME_BIN=<path> 或装 playwright 浏览器（见文件头前置说明）')
  const defaultLibDir = join(homedir(), '.local', 'chrome-deps')
  const libDir = process.env.CHROME_LIBS || arg('chrome-libs', '') || (existsSync(defaultLibDir) ? defaultLibDir : '')
  child = spawn(chrome, [
    '--headless', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
    `--remote-debugging-port=${PORT}`, '--window-size=1600,1400',
    `--user-data-dir=${join(OUT, 'chrome-profile')}`, 'about:blank',
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: libDir ? { ...process.env, LD_LIBRARY_PATH: libDir } : process.env,
  })
  child.on('error', e => { browserError = e })
  child.stderr.on('data', d => { if (String(d).includes('error while loading')) console.error('[chrome]', String(d).trim()) })
  const assertRunning = () => {
    if (browserError) throw browserError
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Chromium 提前退出（code=${child.exitCode}, signal=${child.signalCode}）`)
    }
  }
  let ready = false
  for (let i = 0; i < 60; i++) {
    assertRunning()
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(1000) })
      if (r.ok) { ready = true; break }
    } catch { /* 尚未就绪；启动错误由 assertRunning 报出 */ }
    await sleep(300)
  }
  assertRunning()
  if (!ready) throw new Error(`Chromium 起不来（CDP ${PORT} 无响应）。检查 Chromium 依赖与端口。`)
  const pageUrl = `http://127.0.0.1:${PORT}/json/new?about:blank`
  let r = await fetch(pageUrl, { method: 'PUT', signal: AbortSignal.timeout(5000) })
  if (!r.ok) r = await fetch(pageUrl, { signal: AbortSignal.timeout(5000) })
  if (!r.ok) throw new Error(`CDP 创建页面失败：HTTP ${r.status}`)
  const page = await r.json()
  if (!page.webSocketDebuggerUrl) throw new Error('CDP 页面响应缺少 webSocketDebuggerUrl')
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error('ws 连接超时')), 5000)
    ws.onopen = () => { clearTimeout(timer); res() }
    ws.onerror = () => { clearTimeout(timer); rej(new Error('ws 连接失败')) }
    ws.onclose = () => { clearTimeout(timer); rej(new Error('ws 连接提前关闭')) }
  })
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return }
    if (m.method === 'Runtime.exceptionThrown') jsErrors.push('exception: ' + String(m.params?.exceptionDetails?.exception?.description ?? '').slice(0, 200))
    if (m.method === 'Runtime.consoleAPICalled' && m.params?.type === 'error') {
      jsErrors.push('console.error: ' + (m.params.args ?? []).map(a => a.value ?? a.description ?? '').join(' ').slice(0, 200))
    }
  }
  ws.onclose = () => {
    for (const settle of pending.values()) settle({ error: { message: 'CDP 连接已关闭' } })
    pending.clear()
  }
}

const send = (method, params = {}, timeoutMs = 0) => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error('CDP 尚未连接或已关闭'))
  const id = ++seq
  return new Promise((res, rej) => {
    const timer = timeoutMs ? setTimeout(() => {
      pending.delete(id)
      rej(new Error(`${method}: 超时(${timeoutMs}ms)`))
    }, timeoutMs) : null
    pending.set(id, m => {
      clearTimeout(timer)
      m.error ? rej(new Error(`${method}: ${JSON.stringify(m.error)}`)) : res(m.result)
    })
    try { ws.send(JSON.stringify({ id, method, params })) } catch (e) {
      clearTimeout(timer)
      pending.delete(id)
      rej(e)
    }
  })
}
async function evaluate(expression) {
  const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (res.exceptionDetails) throw new Error('eval: ' + String(res.exceptionDetails.exception?.description ?? JSON.stringify(res.exceptionDetails)).slice(0, 300))
  return res.result.value
}
async function waitFor(expr, timeoutMs, label) {
  const t0 = Date.now()
  for (;;) {
    if (await evaluate(`(()=>{try{return !!(${expr})}catch(e){return false}})()`)) return Date.now() - t0
    if (Date.now() - t0 > timeoutMs) throw new Error(`超时(${timeoutMs}ms)：${label}`)
    await sleep(400)
  }
}
const step = async (label, fn) => {
  const t0 = Date.now()
  const res = await fn()
  console.log(`[${String(Date.now() - t0).padStart(7)}ms] ${label}${res === undefined ? '' : ' → ' + JSON.stringify(res)}`)
  return res
}

/**
 * 关掉所有可能开着的下拉（Esc + 点身体 + 等一拍）。
 * 为什么必须做：naive-ui 的菜单 teleport 到 body，**关掉后仍留在 DOM 且父容器可见**——
 * 不先关就点下一个 select，选项会落到上一个菜单上（实测把「8 金」点成了「预设基础档」，
 * 于是 127 队全选着跑，5 分钟等不到结果）。
 */
const closeMenus = async () => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  // 关键：naive-ui 靠 document 上的 **mousedown** 关菜单，`el.click()` 不派发 mousedown ⇒
  // 必须用 CDP 发真实鼠标事件（点右下角空白页背景，避免误触控件）。
  const { w, h } = await evaluate('({ w: window.innerWidth, h: window.innerHeight })')
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x: w - 12, y: h - 12, button: 'left', clickCount: 1 })
  }
  await sleep(300)
}

/** 页内表达式：当前**真正可见**的下拉菜单里的选项（判定与筛法在 ui-check-runtime.mjs） */
const menuOptionsExpr = () => inPageCall(visibleMenuOptions)
/** 真实鼠标点击（判定在页内完成：禁用/不可见/落点视口外一律 {ok:false}，不发鼠标事件） */
const realClick = (findExpr, extra = []) => realMouseClick(send, findExpr, probeRealClickTarget, extra)

const failures = []
let report = null
let reportPath = null
let shotPath = null
let artifactError = null

/**
 * 统一动作判定入口：**动作类动词的唯一执行路径**——执行 + 记失败。
 * 「没点到」的三种形态（找不到元素 / 目标 disabled / 目标不可见）都由页内判定返回 `{ok:false,reason}`，
 * 这里把 reason 收进 `failures`（与既有 JS 错误 / 重叠 / 溢出同列，最终决定退出码）。
 */
const recordAction = async (label, verb, fn) => {
  const res = await step(label, fn)
  failures.push(...collectFailures(verb, res))
  return res
}

/** 写本轮产物（报告 + 截图）。**在 finally 里调用** ⇒ 任何 throw 也留下本轮证据。 */
const writeArtifacts = async () => {
  try {
    mkdirSync(OUT, { recursive: true })
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, 5000)
    shotPath = artifactNames(OUT, failures.length > 0 ? 'fail' : 'pass').shot
    writeFileSync(shotPath, Buffer.from(shot.data, 'base64'))
  } catch (e) {
    artifactError = '截图写入失败：' + String(e?.message ?? e)
    failures.push(artifactError)
  }
  const status = failures.length > 0 ? 'fail' : 'pass'
  const names = artifactNames(OUT, status)
  try {
    writeFileSync(names.report, JSON.stringify({
      round: ROUND,
      finishedAt: new Date().toISOString(),
      status,
      phase,
      screenshot: shotPath,
      artifactError,
      report,
      jsErrors,
      failures,
      url: URL_APP,
      outDir: OUT,
      argv,
      // 上一轮产物已改名成 *.stale.*（防旧绿冒充本轮）
      staleFrom: staleRenamed,
    }, null, 2))
    reportPath = names.report
  } catch (e) {
    artifactError = (artifactError ? artifactError + '；' : '') + '报告写入失败：' + String(e?.message ?? e)
    failures.push('报告写入失败：' + String(e?.message ?? e))
  }
  console.log(`截图: ${shotPath ?? '(未写出)'} · 报告: ${reportPath ?? '(未写出)'} · 本轮 ${ROUND} · ${status.toUpperCase()}`)
  if (artifactError) console.error('产物写入不完整：' + artifactError)
}

try {
  await startBrowser()
  phase = 'page'
  await send('Page.enable')
  await send('Runtime.enable')
  // 关缓存：python http.server 不发 Cache-Control，浏览器会把 index.html 缓存住 ⇒
  // 改完代码重新 build 后仍跑旧 bundle（实机点通实测踩到：修了却「没生效」）。
  await send('Network.enable')
  await send('Network.setCacheDisabled', { cacheDisabled: true })
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__errs=[];addEventListener('error',e=>window.__errs.push('error:'+e.message));addEventListener('unhandledrejection',e=>window.__errs.push('rej:'+String(e.reason)));`,
  })
  await step('导航', () => send('Page.navigate', { url: URL_APP }))
  await step('等应用就绪（页头页签出现）', () => waitFor(`document.querySelectorAll('.n-tabs-tab').length > 0`, 60000, '页头'))

  const tab = arg('tab')
  if (tab) {
    // expectActivate：点完必须真的变成 active 页签（点了个不存在/不可点的东西不能算通过）
    await recordAction(`点页签「${tab}」`, 'tab', () => evaluate(inPageCall(performClick, '.n-tabs-tab', tab, false, true)))
    // 目标页就绪判据 = active 页签 = 目标 + 主内容区（.calc-content，CalculatorView 的页面容器）
    // 挂出该页的控件（页签切换是 component :is 直挂，没有 .n-tab-pane 包裹——上一版按 n-tab-pane 判永远等不到）。
    // 修前的「图型 文本或 n-card>1」是按队伍对比页写的：自由对比页是单卡工作台（n-card=1 且无「图型」）⇒ 三次实测超时。
    await step('等页面渲染（目标页签内容挂载）', () => waitFor(
      `document.querySelector('.n-tabs-tab--active')?.textContent?.includes(${JSON.stringify(tab)})`
      + ` && document.querySelectorAll('.calc-content .n-card, .calc-content .n-button, .calc-content .n-base-selection').length > 0`,
      30000, '目标页'))
  }
  const radio = arg('radio')
  if (radio) await recordAction(`点选项「${radio}」`, 'radio', () => evaluate(inPageCall(performClick, '.n-radio-button', radio, true)))

  // 通用下拉选择：--select <ctl-label> --option <选项文本片段>
  const selectLabel = arg('select')
  if (selectLabel) {
    const optText = arg('option', '')
    await closeMenus()
    await recordAction(`打开「${selectLabel}」下拉`, 'select', () => realClick(`(() => {
      const field = [...document.querySelectorAll('.ctl-field')].find(f => f.querySelector('.ctl-label')?.textContent?.trim() === ${JSON.stringify(selectLabel)})
      return field?.querySelector('.n-base-selection') ?? null
    })()`))
    // ⚠ naive-ui 把菜单 teleport 到 body，**关掉的菜单仍留在 DOM 里**（父容器还是 visible，
    // 所以 `option.offsetParent` 判不出来）⇒ 必须按「菜单元素自身可见」筛，否则会点到上一个菜单的选项。
    await step('等下拉选项', () => waitFor(`${menuOptionsExpr()}.length > 0`, 10000, '下拉'))
    await recordAction(`选「${optText}」`, 'option', () => realClick(`(() => {
      const opts = ${menuOptionsExpr()}
      return opts.find(e => (e.textContent || '').trim().includes(${JSON.stringify(optText)})) ?? null
    })()`, [visibleMenuOptions]))
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  }

  if (flag('main-c')) {
    await closeMenus()
    await recordAction('打开「按主C快选」', 'main-c', () => realClick(`(() => {
      const field = [...document.querySelectorAll('.ctl-field')].find(f => f.querySelector('.ctl-label')?.textContent?.trim() === '预设队伍')
      const sel = field ? [...field.querySelectorAll('.n-select')].pop() : null
      return sel?.querySelector('.n-base-selection') ?? null
    })()`))
    await step('等下拉选项', () => waitFor(`${menuOptionsExpr()}.length > 0`, 10000, '下拉'))
    await recordAction('选第一个主C', 'main-c', () => realClick(`(() => { const o = ${menuOptionsExpr()}[0]; return o ?? null })()`, [visibleMenuOptions]))
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await step('读已选队数', () => evaluate(`(document.body.textContent.match(/已选\\s*(\\d+)\\s*队/) || [])[1] ?? null`))
  }

  // 弹层 + 数字输入：--popover <按钮文本> --input <行标签> --value <值>
  const popoverText = arg('popover')
  if (popoverText) {
    await closeMenus()
    await recordAction(`打开弹层「${popoverText}」`, 'popover', () => realClick(`(() => {
      const btns = [...document.querySelectorAll('.n-button')]
      return btns.find(b => (b.textContent || '').trim().includes(${JSON.stringify(popoverText)})) ?? null
    })()`))
    await step('等弹层出现', () => waitFor(`[...document.querySelectorAll('.n-popover')].some(p => p.offsetParent !== null)`, 8000, '弹层'))
  }
  const inputLabel = arg('input')
  if (inputLabel) {
    const value = arg('value', '')
    await recordAction(`设置「${inputLabel}」= ${value}`, 'input', () => evaluate(`(() => {
      const pops = [...document.querySelectorAll('.n-popover')].filter(p => p.offsetParent !== null)
      for (const p of pops) {
        const row = [...p.querySelectorAll('.diff-weight-row')].find(r => (r.querySelector('.diff-weight-label')?.textContent || '').includes(${JSON.stringify(inputLabel)}))
        const input = row?.querySelector('input')
        if (!input) continue
        // naive-ui 的 input-number 认原生 input 事件 + Enter/blur 提交；直接改 .value 不会触发 v-model
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
        input.focus()
        setter.call(input, String(${JSON.stringify(value)}))
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new Event('change', { bubbles: true }))
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        input.dispatchEvent(new Event('blur', { bubbles: true }))
        return { ok: true, label: ${JSON.stringify(inputLabel)} }
      }
      return { ok: false, reason: '未命中目标 NO_ROW：可见弹层里没有含「' + ${JSON.stringify(inputLabel)} + '」的 .diff-weight-row' }
    })()`))
    await closeMenus()
  }

  const click = arg('click')
  if (click) {
    await recordAction(`点按钮「${click}」`, 'click', () => evaluate(inPageCall(performClick, '.n-button', click)))
    const t0 = Date.now()
    const tick = setInterval(async () => {
      try {
        const s = await evaluate(`(document.querySelector('.progress-text')?.textContent?.trim() ?? '') + ' | polyline=' + document.querySelectorAll('polyline').length`)
        console.log(`  [${((Date.now() - t0) / 1000).toFixed(0)}s] ${s}`)
      } catch { /* 页面在忙 */ }
    }, 10000)
    try {
      // --wait-for 两种写法：完整 JS 表达式（含括号，如 document.querySelectorAll(...)）或**选择器**
      // （`polyline` / `.curve-seg` / `#id`）。别再拿「含不含点」判——`.curve-seg` 是选择器却被当成表达式（实测报 eval 错）。
      const expr = WAIT_FOR
        ? (WAIT_FOR.includes('(') ? WAIT_FOR : `document.querySelectorAll('${WAIT_FOR}').length > 0`)
        : `document.querySelectorAll('.n-card').length > 1`
      const ms = await waitFor(expr, WAIT_TIMEOUT, `结果出现（${expr}）`)
      console.log(`[${String(ms).padStart(7)}ms] 等结果`)
    } finally { clearInterval(tick) }
  }

  /**
   * 通用脚本步（可重复 `--step <verb>:<参数>`，按出现顺序执行）——给「要跨页/跨控件」的流程用
   * （固定 flags 只够单页单动作：一个 --tab / 一个 --click / 一个 --wait-for）：
   *   `tab:<页签文本>`      点页头页签（并校验真的切过去了）
   *   `open:<控件文本>`     在含该文本的 `.n-base-selection` 上发真实鼠标事件（打开 naive-ui 下拉）
   *   `option:<选项文本>`   点**当前可见**下拉菜单里含该文本的选项
   *   `click:<按钮文本>`    点 `.n-button`
   *   `realclick:<JS 表达式>` 真鼠标点击表达式返回的元素
   *   `type:<文本>`         向当前聚焦元素键入文本（没有聚焦元素 = 失败）
   *   `wait:<选择器|表达式|文本>`  轮询到「选择器命中 / 表达式为真 / 页面文本包含」为止
   *   `eval:<js>`          直接求值并打印结果（诊断用：可读回任意状态/按钮文本/选中数；`false` 是合法结果）
   *   `sleep:<毫秒>`
   * 用途示例（资源池「时间截断」行：需先选预设队伍再切页）：
   *   node scripts/ui-check.mjs --step "tab:队伍配置" --step "open:选择预设队伍" \
   *     --step "option:诺姆·霍洛维尔" --step "tab:资源池" --step "wait:时间截断"
   */
  const stepList = []
  for (let i = 0; i < argv.length; i++) if (argv[i] === '--step') stepList.push(argv[i + 1] ?? '')
  for (const raw of stepList) {
    const cut = raw.indexOf(':')
    const verb = cut >= 0 ? raw.slice(0, cut) : raw
    const value = cut >= 0 ? raw.slice(cut + 1) : ''
    if (verb === 'tab') {
      await recordAction(`[step] 点页签「${value}」`, 'tab', () => evaluate(inPageCall(performClick, '.n-tabs-tab', value, false, true)))
      await sleep(600)
    } else if (verb === 'open') {
      await closeMenus()
      await recordAction(`[step] 打开「${value}」`, 'open', () => realClick(`(() => {
        const els = [...document.querySelectorAll('.n-base-selection')]
        const target = els.find(e => (e.textContent || '').includes(${JSON.stringify(value)}))
        return target ?? null
      })()`))
      await step('[step] 等下拉选项', () => waitFor(`${menuOptionsExpr()}.length > 0`, 10000, '下拉'))
    } else if (verb === 'option') {
      await recordAction(`[step] 选「${value}」`, 'option', () => realClick(`(() => {
        const opts = ${menuOptionsExpr()}
        return opts.find(e => (e.textContent || '').trim().includes(${JSON.stringify(value)})) ?? null
      })()`, [visibleMenuOptions]))
      await closeMenus()
    } else if (verb === 'click') {
      await recordAction(`[step] 点按钮「${value}」`, 'click', () => evaluate(inPageCall(performClick, '.n-button', value)))
      await sleep(400)
    } else if (verb === 'realclick') {
      // 真·鼠标点击（CDP Input.dispatchMouseEvent）：Naive UI 的 collapse 等组件
      // 监听的是真实指针事件，`el.click()`（= --click / eval 里手写 click）**不会**展开
      // —— R65 实测：`h.click()` 与手搓 MouseEvent 序列都不改 item class，只有真指针事件有效。
      // value = 返回「被点元素」的 JS 表达式（可含 scrollIntoView）。
      await recordAction(`[step] realclick ${value.slice(0, 50)}`, 'realclick', () => realClick(value))
      await sleep(600)
    } else if (verb === 'wait') {
      // 选择器（`.cls` / `#id` / `[attr]` / 裸标签名如 `polyline`）→ 命中即真；其余按页面文本包含
      // （`wait:时间截断` 这类「等状态」不判「动作没命中」，失败路径 = 超时抛异常）
      const isSelector = /^[.#[]/.test(value) || /^[a-z][a-z0-9-]*$/.test(value)
      const expr = value.includes('(')
        ? value
        : isSelector
          ? `document.querySelectorAll(${JSON.stringify(value)}).length > 0`
          : `document.body.innerText.includes(${JSON.stringify(value)})`
      const ms = await step(`[step] 等「${value}」`, () => waitFor(expr, WAIT_TIMEOUT, value))
      console.log(`[${String(ms).padStart(7)}ms] 等「${value}」`)
    } else if (verb === 'eval') {
      // 诊断读回：false/null/0 都是合法结果，**不**进失败判定
      await step(`[step] eval ${value.slice(0, 60)}`, async () => JSON.stringify(await evaluate(value)))
    } else if (verb === 'type') {
      // 向当前聚焦元素键入文本（CDP Input.insertText，走真实输入通道 ⇒ Naive UI 的 filterable
      // select / 受控 input 都能收到）。用途：虚拟滚动的下拉只渲染前几项，按文本过滤是唯一
      // 能选中长列表末项的稳定路径（`--option` 只认已渲染项）。
      // 没有聚焦元素时 insertText 无处落字 ⇒ 判失败（此前照样报 ok）。
      await recordAction(`[step] 键入「${value}」`, 'type', async () => {
        const focus = await evaluate(inPageCall(probeFocusTarget))
        if (!focus.ok) return focus
        await send('Input.insertText', { text: value })
        return { ok: true, into: focus.tag }
      })
      await sleep(400)
    } else if (verb === 'sleep') {
      await sleep(Number(value) || 500)
    } else {
      throw new Error(`未知 --step 动词：${raw}（tab/open/option/click/realclick/type/wait/eval/sleep）`)
    }
  }

  await sleep(1200)
  report = await step('DOM 体检', () => evaluate(`(() => {
    const labels = [...document.querySelectorAll('.curve-jump-label')].map(e => {
      const r = e.getBoundingClientRect()
      return { t: e.textContent, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
    })
    const overlaps = []
    for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
      const a = labels[i], b = labels[j]
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) overlaps.push([a.t, b.t])
    }
    return {
      polylines: document.querySelectorAll('polyline').length,
      dots: document.querySelectorAll('circle.scatter-dot').length,
      jumpLabels: labels.map(l => l.t),
      labelOverlaps: overlaps,
      cards: [...document.querySelectorAll('.n-card')].map(c => ({
        title: (c.querySelector('.n-card-header')?.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 30),
        w: Math.round(c.getBoundingClientRect().width), h: Math.round(c.getBoundingClientRect().height),
      })),
      tableOverflow: [...document.querySelectorAll('.detail-table-wrap')].map(w => ({
        card: (w.closest('.n-card')?.querySelector('.n-card-header')?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 24),
        overflowX: w.scrollWidth - w.clientWidth,
        widestCell: Math.max(0, ...[...w.querySelectorAll('th,td')].map(c => c.getBoundingClientRect().width)),
      })),
      tableOverflowX: [...document.querySelectorAll('.detail-table-wrap')].map(w => w.scrollWidth - w.clientWidth),
      // 曲线摘要表头 + 首行前三列（用来确认「金档」这类新列真的渲染了）
      summaryHeader: (() => {
        const s = [...document.querySelectorAll('.detail-card')].find(c => (c.textContent || '').includes('曲线摘要'))
        return s ? [...s.querySelectorAll('thead th')].map(e => e.textContent.trim()) : null
      })(),
      goldSelectText: (() => {
        const f = [...document.querySelectorAll('.ctl-field')].find(x => x.querySelector('.ctl-label')?.textContent?.trim() === '曲线金档')
        return f ? (f.querySelector('.n-base-selection')?.textContent || '').replace(/\\s+/g, ' ').trim() : null
      })(),
      firstSummaryGoldCell: (() => {
        const s = [...document.querySelectorAll('.detail-card')].find(c => (c.textContent || '').includes('曲线摘要'))
        const tr = s?.querySelector('tbody tr')
        return tr ? (tr.querySelectorAll('td')[1]?.innerHTML || '').replace(/\\s+/g, ' ').trim().slice(0, 80) : null
      })(),
      summaryFirstRow: (() => {
        const s = [...document.querySelectorAll('.detail-card')].find(c => (c.textContent || '').includes('曲线摘要'))
        const tr = s?.querySelector('tbody tr')
        return tr ? [...tr.querySelectorAll('td')].map(e => e.textContent.replace(/\\s+/g, ' ').trim()).slice(0, 3) : null
      })(),
      curveNote: (document.querySelector('.curve-note')?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 140) || null,
      costNote: [...document.querySelectorAll('.compare-note')].map(e => e.textContent.replace(/\s+/g, ' ').trim()).find(t => t.includes('代价')) ?? null,
      errs: window.__errs || [],
    }
  })()`))
  console.log(JSON.stringify(report, null, 2))
  const inlineErrs = report?.errs ?? []
  if (jsErrors.length > 0 || inlineErrs.length > 0) {
    failures.push(`JS 错误 ${jsErrors.length + inlineErrs.length} 条`, ...jsErrors, ...inlineErrs)
  }
  if (report?.labelOverlaps?.length > 0) failures.push(`图上标注重叠 ${report.labelOverlaps.length} 对`)
  if ((report?.tableOverflowX ?? []).some(v => v > 0)) failures.push('表格横向溢出')
  const leaks = rawNumberLeaks(String(await evaluate('document.body.innerText') ?? ''))
  if (leaks.length > 0) failures.push(`页面显示未格式化的数值 ${leaks.length} 处（浮点噪声 / NaN / Infinity：展示处漏了 fmt）`, ...leaks)
} catch (e) {
  failures.push(String(e?.message ?? e))
} finally {
  // 产物写在 finally：任何 throw（waitFor 超时 / 未知动词 / 页内异常）也留下本轮证据，
  // 不让上一轮的成功产物原地留存冒充本轮（A1.a negC2a/negC2b）。
  try { await writeArtifacts() } catch (e) { failures.push('产物写入异常：' + String(e?.message ?? e)) }
  try { ws?.close() } catch { /* 未连接或已关闭 */ }
  if (!flag('keep-open') || phase === 'startup') { try { child?.kill() } catch { /* 已退出 */ } }
}

if (failures.length > 0) {
  console.error(failureBlock(failures))
  process.exit(exitCodeFor(failures))
}
console.log('\n实机点通 PASS（零 JS 错误、无标注重叠、无表格溢出、无未格式化数值、动作全部命中目标）')
process.exit(exitCodeFor(failures))

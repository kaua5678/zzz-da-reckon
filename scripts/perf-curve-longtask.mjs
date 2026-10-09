#!/usr/bin/env node
/**
 * 主线程阻塞探针（难度曲线）：CDP 驱动 headless Chromium 打开静态 `dist/`，点「难度曲线 → 计算曲线」，
 * 用 **PerformanceObserver('longtask')** 量「爬一条曲线时主线程最长 task / 总阻塞时长」。
 *
 * 为什么有这个脚本：难度曲线的单队阶梯是**一次同步求值链**（`climbDifficultyLadder` 的 while 里每次试开
 * 一次 `teamTotalDamage.value`），页面上唯一的让出点在**队与队之间**（`TeamComparePage#runCurves` 的
 * `setTimeout(r, 0)`）⇒ 单队 3~4s 内 UI 完全冻结。任务书 §4 步骤 1 要求「先建可复现的 longtask 探针」，
 * 仓内此前只有一次性手法（`.zc/reports/review-performance-baseline.md`，未固化成脚本）。
 *
 * ## 判定口径（照抄那次一次性手法的**修正后**口径，别退回错的那版）
 *
 * 一次性手法踩过的坑（该报告原文）：「最初 PerformanceObserver 筛选仅看 `entry.startTime >= eventCaptureTime`，
 * 漏掉开始早于 capture handler 的整条事件 task。修正为 **task 与测量窗口相交**」。
 * ⇒ 本脚本按 **相交** 计：`e.startTime < windowEnd && e.startTime + e.duration > windowStart`。
 *
 * ## 两个窗口
 *
 * - `pre`: 点「计算曲线」**之前**取 `performance.now()`（窗口起点）。
 * - `post`: 结果 DOM 出现（`--wait-for`）后取 `performance.now()`（窗口终点）。
 * 两者都经 CDP `Runtime.evaluate` 在**页内**取，不用 node 墙钟——node 侧含 IPC/轮询间隔噪声。
 *
 * ## 读数
 *
 * - `maxTaskMs` = 窗口内**最长单条** long task（>50ms 才被 observer 报；单队同步段就是这个数）。
 * - `totalBlockMs` = 窗口内全部 long task 时长之和。
 * - `blockedOver50Ms` = Σ max(0, duration − 50)（Chrome TBT 口径，扣掉每条 50ms 的"免费"额度）。
 * - `timerDelayMs` = 窗口内一次 20ms 周期 timer 的**最大实际间隔 − 20ms**（改前 ≈ 最长同步段）。
 * - `paintDelayMs` = 点按钮后到**下一帧**的延迟（单次采样，噪声大，仅作旁证）。
 *
 * ## 用法
 *
 *   # 前置：先 npm run build（或 npx vite build），再起静态服务
 *   python3 -m http.server 8099 --directory dist &
 *   node scripts/perf-curve-longtask.mjs --url http://127.0.0.1:8099/ --label before
 *   # 输出：/tmp/zzz-perf-curve/<label>.json（读数）+ 控制台读数表
 *
 * 参数：
 *   --url <URL>        默认 http://127.0.0.1:8099/
 *   --label <名字>     读数落盘文件名（默认 `run-<时间戳>`），如 before / after
 *   --teams <n>        选前 n 队（默认 3；n=1 时单队原子段最干净）
 *   --out <目录>       读数输出目录，默认 /tmp/zzz-perf-curve
 *   --port <端口>      CDP 端口，默认 9231（与 ui-check 的 9222 错开，可并行）
 *   --wait-timeout <ms> 等结果上限，默认 300000
 *   --wait-for <选择器|表达式> 结果判据，默认 `.curve-seg`
 *   --keep-open        跑完不关浏览器
 *
 * 退出码：0 = 量到了读数；1 = 起不来 / 动作没命中 / 超时（读数不可信就不冒充成功）。
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const argv = process.argv.slice(2)
const arg = (name, def = undefined) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : def
}
const flag = name => argv.includes(`--${name}`)
const sleep = ms => new Promise(r => setTimeout(r, ms))

const URL_APP = arg('url', 'http://127.0.0.1:8099/')
const PORT = Number(arg('port', '9231'))
const OUT = arg('out', '/tmp/zzz-perf-curve')
const LABEL = arg('label', `run-${Date.now()}`)
const TEAMS = Number(arg('teams', '3'))
const WAIT_TIMEOUT = Number(arg('wait-timeout', '300000'))
const WAIT_FOR = arg('wait-for', '.curve-seg')
const CHROME_LIBS = process.env.CHROME_LIBS || arg('chrome-libs', '') || join(homedir(), '.local', 'chrome-deps')

/** 找 Chromium：优先 chrome-headless-shell（依赖更少），其次完整 chrome（与 ui-check 同口径） */
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

let child = null
let ws = null
let seq = 0
const pending = new Map()
const jsErrors = []

async function startBrowser() {
  mkdirSync(OUT, { recursive: true })
  const chrome = findChrome()
  if (!chrome) throw new Error('找不到 Chromium：设 CHROME_BIN=<path>（见 scripts/ui-check.mjs 文件头前置说明）')
  const libDir = existsSync(CHROME_LIBS) ? CHROME_LIBS : ''
  child = spawn(chrome, [
    '--headless', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
    `--remote-debugging-port=${PORT}`, '--window-size=1600,1400',
    `--user-data-dir=${join(OUT, `chrome-profile-${PORT}`)}`, 'about:blank',
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: libDir ? { ...process.env, LD_LIBRARY_PATH: libDir } : process.env,
  })
  let browserError = null
  child.on('error', e => { browserError = e })
  child.stderr.on('data', d => { if (String(d).includes('error while loading')) console.error('[chrome]', String(d).trim()) })
  const assertRunning = () => {
    if (browserError) throw browserError
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Chromium 提前退出（code=${child.exitCode}, signal=${child.signalCode}）`)
  }
  let ready = false
  for (let i = 0; i < 60; i++) {
    assertRunning()
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(1000) })
      if (r.ok) { ready = true; break }
    } catch { /* 尚未就绪 */ }
    await sleep(300)
  }
  assertRunning()
  if (!ready) throw new Error(`Chromium 起不来（CDP ${PORT} 无响应）`)
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
  ws.onclose = () => { for (const settle of pending.values()) settle({ error: { message: 'CDP 连接已关闭' } }); pending.clear() }
}

const send = (method, params = {}, timeoutMs = 0) => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error('CDP 尚未连接或已关闭'))
  const id = ++seq
  return new Promise((res, rej) => {
    const timer = timeoutMs ? setTimeout(() => { pending.delete(id); rej(new Error(`${method}: 超时(${timeoutMs}ms)`)) }, timeoutMs) : null
    pending.set(id, m => { clearTimeout(timer); m.error ? rej(new Error(`${method}: ${JSON.stringify(m.error)}`)) : res(m.result) })
    try { ws.send(JSON.stringify({ id, method, params })) } catch (e) { clearTimeout(timer); pending.delete(id); rej(e) }
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
 * 页内探针装置：装 PerformanceObserver('longtask') + 20ms 周期 timer，暴露 `window.__perf`。
 * **相交口径**（见文件头）：窗口内的 task = `startTime < end && startTime + duration > start`。
 */
const INSTALL_PROBE = `(() => {
  if (window.__perf) return 'already'
  const P = { entries: [], ticks: [], start: 0, end: 0, maxTimerGap: 0, timerBase: 0 }
  window.__perf = P
  try {
    const obs = new PerformanceObserver(list => {
      for (const e of list.getEntries()) P.entries.push({ start: e.startTime, duration: e.duration, name: e.name })
    })
    obs.observe({ entryTypes: ['longtask'] })
    P.observer = 'longtask'
  } catch (err) {
    // 浏览器不支持 longtask 时退化为「自己用 rAF 量帧间隔」——读数口径不同，报告里必须写明
    P.observer = 'unsupported: ' + String(err && err.message)
  }
  P.begin = () => {
    P.entries.length = 0
    P.ticks.length = 0
    P.maxTimerGap = 0
    P.start = performance.now()
    P.end = 0
    P.timerBase = performance.now()
    P.timer = setInterval(() => {
      const now = performance.now()
      const gap = now - P.timerBase
      if (gap > P.maxTimerGap) P.maxTimerGap = gap
      P.timerBase = now
      P.ticks.push(now)
    }, 20)
    return P.start
  }
  P.finish = () => {
    if (P.timer) { clearInterval(P.timer); P.timer = null }
    P.end = performance.now()
    const inside = P.entries.filter(e => e.start < P.end && e.start + e.duration > P.start)
    const durs = inside.map(e => e.duration)
    return {
      observer: P.observer,
      windowMs: P.end - P.start,
      longTaskCount: inside.length,
      maxTaskMs: durs.length ? Math.max(...durs) : 0,
      totalBlockMs: durs.reduce((a, b) => a + b, 0),
      blockedOver50Ms: durs.reduce((a, b) => a + Math.max(0, b - 50), 0),
      timerDelayMs: Math.max(0, P.maxTimerGap - 20),
      timerTicks: P.ticks.length,
      allTasks: P.entries.map(e => Math.round(e.duration)),
    }
  }
  P.paintDelay = () => new Promise(res => {
    const t0 = performance.now()
    requestAnimationFrame(() => requestAnimationFrame(() => res(performance.now() - t0)))
  })
  return 'installed'
})()`

/** 点一个 `.n-button`（按文本包含）——与 ui-check 的 performClick 同判定：找不到 = 失败，不静默 */
const clickButtonExpr = text => `(() => {
  const btns = [...document.querySelectorAll('.n-button')]
  const b = btns.find(x => (x.textContent || '').includes(${JSON.stringify(text)}))
  if (!b) return { ok: false, reason: 'NOT_FOUND(.n-button 含「' + ${JSON.stringify(text)} + '」)' }
  if (b.disabled || b.classList.contains('n-button--disabled')) return { ok: false, reason: 'DISABLED' }
  b.click()
  return { ok: true }
})()`

const report = { label: LABEL, url: URL_APP, teams: TEAMS, at: new Date().toISOString(), jsErrors }
let failures = []

try {
  await startBrowser()
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Network.enable')
  await send('Network.setCacheDisabled', { cacheDisabled: true })
  await step('导航', () => send('Page.navigate', { url: URL_APP }))
  await step('等应用就绪', () => waitFor(`document.querySelectorAll('.n-tabs-tab').length > 0`, 60000, '页头'))

  // 1) 切到队伍对比页 + 难度曲线图型
  await step('点页签「队伍对比」', () => evaluate(`(() => {
    const t = [...document.querySelectorAll('.n-tabs-tab')].find(x => (x.textContent || '').includes('队伍对比'))
    if (!t) return { ok: false, reason: 'NOT_FOUND(页签)' }
    t.click(); return { ok: true }
  })()`))
  await step('等页面渲染', () => waitFor(
    `document.querySelector('.n-tabs-tab--active')?.textContent?.includes('队伍对比')`
    + ` && document.querySelectorAll('.calc-content .n-card, .calc-content .n-button').length > 0`,
    30000, '目标页'))
  await step('点选项「难度曲线」', () => evaluate(`(() => {
    const r = [...document.querySelectorAll('.n-radio-button')].find(x => (x.textContent || '').includes('难度曲线'))
    if (!r) return { ok: false, reason: 'NOT_FOUND(难度曲线)' }
    const input = r.querySelector('input') || r
    input.click(); return { ok: true }
  })()`))
  await step('等图型切到曲线', () => waitFor(`document.body.innerText.includes('计算曲线')`, 15000, '计算曲线按钮'))

  // 2) 收窄到前 N 队（主C 快选 = 第一个选项）：默认全选 127 队要跑几分钟
  await step('打开「按主C快选」', () => evaluate(`(() => {
    const field = [...document.querySelectorAll('.ctl-field')].find(f => f.querySelector('.ctl-label')?.textContent?.trim() === '预设队伍')
    const sel = field ? [...field.querySelectorAll('.n-select')].pop() : null
    const target = sel?.querySelector('.n-base-selection') ?? null
    if (!target) return { ok: false, reason: 'NOT_FOUND(预设队伍 下拉)' }
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    target.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    return { ok: true }
  })()`))
  await step('等下拉选项', () => waitFor(`document.querySelectorAll('.n-base-select-option').length > 0`, 15000, '下拉'))
  await step('选第一个主C', () => evaluate(`(() => {
    const opts = [...document.querySelectorAll('.n-base-select-option')]
    const o = opts[0]
    if (!o) return { ok: false, reason: 'NOT_FOUND(选项)' }
    o.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    o.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    o.click()
    return { ok: true, text: (o.textContent || '').trim() }
  })()`))
  await sleep(600)
  await step('读已选队数', () => evaluate(`(document.body.textContent.match(/已选\\s*(\\d+)\\s*队/) || [])[1] ?? null`))

  // 3) 装探针 → begin → 点计算 → 等结果 → finish
  await step('装探针', () => evaluate(INSTALL_PROBE))
  const observer = await evaluate(`window.__perf.observer`)
  if (observer !== 'longtask') failures.push(`PerformanceObserver('longtask') 不可用：${observer}`)
  await step('开测量窗口', () => evaluate(`window.__perf.begin()`))
  // 按钮真实点击走页内 click()（与 ui-check 的 --click 同路径），点击本身在同一 task 内同步返回
  const clicked = await step('点「计算曲线」', () => evaluate(clickButtonExpr('计算曲线')))
  if (!clicked?.ok) failures.push('点「计算曲线」未命中：' + (clicked?.reason ?? 'unknown'))
  // paintDelay 与主测量并行采样（不阻塞等待：它自己 rAF 回调）
  const paintPromise = evaluate(`window.__perf.paintDelay()`)
  const waitMs = await step('等结果 DOM', () => waitFor(
    WAIT_FOR.includes('(') ? WAIT_FOR : `document.querySelectorAll('${WAIT_FOR}').length > 0`,
    WAIT_TIMEOUT, `结果（${WAIT_FOR}）`,
  ))
  const reading = await step('读探针', () => evaluate(`window.__perf.finish()`))
  const paintDelayMs = await paintPromise
  const dom = await evaluate(`({
    polylines: document.querySelectorAll('polyline').length,
    curveSegs: document.querySelectorAll('.curve-seg').length,
    progressText: (document.querySelector('.progress-text')?.textContent || '').trim(),
    summaryRows: document.querySelectorAll('.detail-card tbody tr').length,
  })`)

  Object.assign(report, { waitMs, paintDelayMs, reading, dom, observer })
  report.ok = failures.length === 0

  const r = reading
  console.log('\n================ 主线程阻塞读数 ================')
  console.log(`窗口            ${(r.windowMs / 1000).toFixed(2)}s（点按钮 → 结果 DOM 出现）`)
  console.log(`最长单条 task   ${r.maxTaskMs.toFixed(1)}ms      ← 这就是"卡住多久不动"`)
  console.log(`总阻塞时长      ${r.totalBlockMs.toFixed(1)}ms（long task 条数 ${r.longTaskCount}）`)
  console.log(`TBT 口径        ${r.blockedOver50Ms.toFixed(1)}ms（Σ max(0, dur−50)）`)
  console.log(`timer 最大延迟  ${r.timerDelayMs.toFixed(1)}ms`)
  console.log(`首帧延迟        ${Number(paintDelayMs).toFixed(1)}ms（单次采样，旁证）`)
  console.log(`页内全部 task   [${r.allTasks.join(', ')}]`)
  console.log(`结果 DOM        polyline=${dom.polylines} curveSeg=${dom.curveSegs} 摘要行=${dom.summaryRows} · ${dom.progressText}`)
  if (jsErrors.length) console.log(`JS 错误 ${jsErrors.length} 条：${jsErrors.slice(0, 3).join(' | ')}`)
  console.log('===============================================')
  if (failures.length) console.error('失败：\n' + failures.map(f => '  ✗ ' + f).join('\n'))
} catch (e) {
  failures.push(String(e?.message ?? e))
} finally {
  report.failures = failures
  report.ok = failures.length === 0
  try {
    mkdirSync(OUT, { recursive: true })
    const path = join(OUT, `${LABEL}.json`)
    writeFileSync(path, JSON.stringify(report, null, 2))
    console.log(`读数落盘: ${path}`)
  } catch (e) { console.error('读数写入失败：' + String(e?.message ?? e)) }
  try { ws?.close() } catch { /* 未连接 */ }
  if (!flag('keep-open')) { try { child?.kill() } catch { /* 已退出 */ } }
}

process.exit(failures.length > 0 ? 1 : 0)

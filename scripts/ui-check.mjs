#!/usr/bin/env node
/**
 * 实机点通（UI 冒烟）：CDP 驱动 headless Chromium 打开 `dist/` 静态服务，按「页签 → 控件 → 按钮」
 * 走一遍，读回 DOM 体检结果并截图。
 *
 * 为什么有这个脚本：UI 改动的可信度此前只到 `vue-tsc` 模板检查 + 展示层单测，每次收工都要写一句
 * 「实机点通没做」。本脚本把 C9 那条一次性配方固化成一条命令（用户态、不需要 root、不需要装包管理器依赖）。
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
 *   --click <文本>     点按钮（按文本包含匹配）
 *   --wait-for <表达式> 轮询到该 JS 表达式为真（如 `polyline` 或完整表达式）
 *   --wait-timeout <ms> 默认 300000
 *   --out <目录>       截图与体检结果输出目录，默认 /tmp/zzz-ui
 *   --port <端口>      CDP 端口，默认 9222（脚本自己拉起浏览器，退出时关掉）
 *   --keep-open        跑完不关浏览器
 * 退出码：0 = 跑完且**零 JS 错误**；1 = 有错/超时（错误会打印）。
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
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
const PORT = Number(arg('port', '9222'))
const OUT = arg('out', '/tmp/zzz-ui')
const WAIT_TIMEOUT = Number(arg('wait-timeout', '300000'))
const WAIT_FOR = arg('wait-for', null)

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

const chrome = findChrome()
if (!chrome) {
  console.error('找不到 Chromium：设 CHROME_BIN=<path> 或装 playwright 浏览器（见文件头前置说明）')
  process.exit(1)
}
/** 用户态补齐的 Chromium 依赖目录（非 root 解包），缺省探测 ~/.local/chrome-deps */
const defaultLibDir = join(homedir(), '.local', 'chrome-deps')
const libDir = process.env.CHROME_LIBS || arg('chrome-libs', '') || (existsSync(defaultLibDir) ? defaultLibDir : '')
const userDataDir = join(OUT, 'chrome-profile')
mkdirSync(OUT, { recursive: true })

const child = spawn(chrome, [
  '--headless', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
  `--remote-debugging-port=${PORT}`, '--window-size=1600,1400',
  `--user-data-dir=${userDataDir}`, 'about:blank',
], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: libDir ? { ...process.env, LD_LIBRARY_PATH: libDir } : process.env,
})
child.stderr.on('data', d => { if (String(d).includes('error while loading')) console.error('[chrome]', String(d).trim()) })

async function cdpReady() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) return true } catch { /* 还没起来 */ }
    await sleep(300)
  }
  return false
}
if (!await cdpReady()) {
  console.error(`Chromium 起不来（CDP ${PORT} 无响应）。常见原因：缺 libnspr4/libnss3 —— 见文件头用户态补齐说明。`)
  child.kill()
  process.exit(1)
}

let r = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })
if (!r.ok) r = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`)
const page = await r.json()
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws 连接失败')) })

let seq = 0
const pending = new Map()
const jsErrors = []
ws.onmessage = ev => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return }
  if (m.method === 'Runtime.exceptionThrown') jsErrors.push('exception: ' + String(m.params?.exceptionDetails?.exception?.description ?? '').slice(0, 200))
  if (m.method === 'Runtime.consoleAPICalled' && m.params?.type === 'error') {
    jsErrors.push('console.error: ' + (m.params.args ?? []).map(a => a.value ?? a.description ?? '').join(' ').slice(0, 200))
  }
}
const send = (method, params = {}) => {
  const id = ++seq
  ws.send(JSON.stringify({ id, method, params }))
  return new Promise((res, rej) => pending.set(id, m => m.error ? rej(new Error(`${method}: ${JSON.stringify(m.error)}`)) : res(m.result)))
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
const clickText = (sel, text, inner = false) => `(() => {
  const els = [...document.querySelectorAll(${JSON.stringify(sel)})]
  const el = els.find(e => (e.textContent || '').replace(/\\s+/g, '').includes(${JSON.stringify(text)}))
  if (!el) return 'NOT_FOUND(n=' + els.length + ')'
  const target = ${inner} ? (el.querySelector('input') || el) : el
  target.click()
  return 'ok'
})()`
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

/**
 * 真实鼠标点击（CDP Input 事件）——naive-ui 的 select / option 依赖 document 级 mousedown，
 * 纯 `el.click()` 会「找到元素也点了，但值没变」。expr 求值成一个元素。
 */
const realMouseClick = async expr => {
  // 先 scrollIntoView：控件可能在视口外（页面长 / 结果卡插入后布局变化），
  // 直接按 rect 点会点到窗口外 ⇒ 事件落空、菜单打不开（实测 y=3383 > 视口 1400）。
  const pt = await evaluate(`(() => {
    const e = ${expr}; if (!e) return null
    e.scrollIntoView({ block: 'center', inline: 'center' })
    const r = e.getBoundingClientRect()
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), inView: r.top >= 0 && r.bottom <= window.innerHeight }
  })()`)
  if (!pt) return null
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x, y: pt.y })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', clickCount: 1 })
  return pt
}

const failures = []
try {
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__errs=[];addEventListener('error',e=>window.__errs.push('error:'+e.message));addEventListener('unhandledrejection',e=>window.__errs.push('rej:'+String(e.reason)));`,
  })
  await step('导航', () => send('Page.navigate', { url: URL_APP }))
  await step('等应用就绪（页头页签出现）', () => waitFor(`document.querySelectorAll('.n-tabs-tab').length > 0`, 60000, '页头'))

  const tab = arg('tab')
  if (tab) {
    await step(`点页签「${tab}」`, () => evaluate(clickText('.n-tabs-tab', tab)))
    await step('等页面渲染（图型控件）', () => waitFor(`document.body.textContent.includes('图型') || document.querySelectorAll('.n-card').length > 1`, 30000, '目标页'))
  }
  const radio = arg('radio')
  if (radio) await step(`点选项「${radio}」`, () => evaluate(clickText('.n-radio-button', radio, true)))

  // 通用下拉选择：--select <ctl-label> --option <选项文本片段>
  const selectLabel = arg('select')
  if (selectLabel) {
    const optText = arg('option', '')
    await closeMenus()
    await step(`打开「${selectLabel}」下拉`, () => realMouseClick(`(() => {
      const field = [...document.querySelectorAll('.ctl-field')].find(f => f.querySelector('.ctl-label')?.textContent?.trim() === ${JSON.stringify(selectLabel)})
      return field?.querySelector('.n-base-selection') ?? null
    })()`))
    // ⚠ naive-ui 把菜单 teleport 到 body，**关掉的菜单仍留在 DOM 里**（父容器还是 visible，
    // 所以 `option.offsetParent` 判不出来）⇒ 必须按「菜单元素自身可见」筛，否则会点到上一个菜单的选项。
    const visibleOpts = `[...document.querySelectorAll('.n-base-select-menu')].filter(m => m.offsetParent !== null)
      .flatMap(m => [...m.querySelectorAll('.n-base-select-option')])`
    await step('等下拉选项', () => waitFor(`${visibleOpts}.length > 0`, 10000, '下拉'))
    await step(`选「${optText}」`, () => realMouseClick(`(() => {
      const opts = ${visibleOpts}
      return opts.find(e => (e.textContent || '').trim().includes(${JSON.stringify(optText)})) ?? null
    })()`))
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  }

  if (flag('main-c')) {
    await closeMenus()
    await step('打开「按主C快选」', () => realMouseClick(`(() => {
      const field = [...document.querySelectorAll('.ctl-field')].find(f => f.querySelector('.ctl-label')?.textContent?.trim() === '预设队伍')
      const sel = field ? [...field.querySelectorAll('.n-select')].pop() : null
      return sel?.querySelector('.n-base-selection') ?? null
    })()`))
    const visibleMainC = `[...document.querySelectorAll('.n-base-select-menu')].filter(m => m.offsetParent !== null)
      .flatMap(m => [...m.querySelectorAll('.n-base-select-option')])`
    await step('等下拉选项', () => waitFor(`${visibleMainC}.length > 0`, 10000, '下拉'))
    await step('选第一个主C', () => realMouseClick(`(() => { const o = ${visibleMainC}[0]; return o ?? null })()`))
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await step('读已选队数', () => evaluate(`(document.body.textContent.match(/已选\\s*(\\d+)\\s*队/) || [])[1] ?? null`))
  }

  const click = arg('click')
  if (click) {
    await step(`点按钮「${click}」`, () => evaluate(clickText('.n-button', click)))
    const t0 = Date.now()
    const tick = setInterval(async () => {
      try {
        const s = await evaluate(`(document.querySelector('.progress-text')?.textContent?.trim() ?? '') + ' | polyline=' + document.querySelectorAll('polyline').length`)
        console.log(`  [${((Date.now() - t0) / 1000).toFixed(0)}s] ${s}`)
      } catch { /* 页面在忙 */ }
    }, 10000)
    try {
      const expr = WAIT_FOR ? (WAIT_FOR.includes('(') || WAIT_FOR.includes('.') ? WAIT_FOR : `document.querySelectorAll('${WAIT_FOR}').length > 0`) : `document.querySelectorAll('.n-card').length > 1`
      const ms = await waitFor(expr, WAIT_TIMEOUT, `结果出现（${expr}）`)
      console.log(`[${String(ms).padStart(7)}ms] 等结果`)
    } finally { clearInterval(tick) }
  }

  await sleep(1200)
  const report = await step('DOM 体检', () => evaluate(`(() => {
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
      errs: window.__errs || [],
    }
  })()`))
  console.log(JSON.stringify(report, null, 2))
  mkdirSync(OUT, { recursive: true })
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
  writeFileSync(join(OUT, 'ui-check-full.png'), Buffer.from(shot.data, 'base64'))
  writeFileSync(join(OUT, 'ui-check-report.json'), JSON.stringify({ report, jsErrors }, null, 2))
  console.log('截图:', join(OUT, 'ui-check-full.png'), '· 报告:', join(OUT, 'ui-check-report.json'))
  const inlineErrs = report?.errs ?? []
  if (jsErrors.length > 0 || inlineErrs.length > 0) {
    failures.push(`JS 错误 ${jsErrors.length + inlineErrs.length} 条`, ...jsErrors, ...inlineErrs)
  }
  if (report?.labelOverlaps?.length > 0) failures.push(`图上标注重叠 ${report.labelOverlaps.length} 对`)
  if ((report?.tableOverflowX ?? []).some(v => v > 0)) failures.push('表格横向溢出')
} catch (e) {
  failures.push(String(e?.message ?? e))
} finally {
  if (!flag('keep-open')) { try { child.kill() } catch { /* 已退出 */ } }
}

if (failures.length > 0) {
  console.error('\n实机点通 FAIL：')
  for (const f of failures) console.error('  ✗ ' + f)
  process.exit(1)
}
console.log('\n实机点通 PASS（零 JS 错误、无标注重叠、无表格溢出）')
process.exit(0)

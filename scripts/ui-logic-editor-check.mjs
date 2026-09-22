#!/usr/bin/env node
/** Reproducible logic-editor UI regression; run after npm run build.
 * Reuses ui-check.mjs/CDP and an isolated browser profile; never touches the user's browser.
 * Exercises real file-input/save/export handlers, including expected storage failures.
 */
import { spawn } from 'node:child_process'

const evaluate = fn => `eval:(${fn.toString()})()`
const steps = [
  'tab:逻辑编辑',
  'wait:.logic-editor-page',
  evaluate(() => {
    const key = 'zzz-logic-editor:v1'
    window.__mcpLogic = {
      key,
      setItem: Storage.prototype.setItem,
      assert(ok, message) { if (!ok) throw new Error(message) },
      make(value) {
        return { version: 1, attributeConversions: [], objects: [
          { id: 'ui-fixture', name: 'UI fixture', nature: 'custom', enabled: true, properties: { value, stages: [1, 2] } },
        ], rowFusions: [
          { id: 'ui-fusion', name: 'UI fusion', agentId: 'custom', moveId: 'custom-move', rowId: 'damage', multiplier: value, enabled: true, note: '' },
        ] }
      },
      async importState(value) {
        const input = document.querySelector('.logic-editor-page input[type=file]')
        const transfer = new DataTransfer()
        transfer.items.add(new File([JSON.stringify(value)], 'fixture.json', { type: 'application/json' }))
        input.files = transfer.files
        input.dispatchEvent(new Event('change', { bubbles: true }))
        const deadline = Date.now() + 10000
        while (input.value) {
          if (Date.now() > deadline) throw new Error('Import handler did not finish')
          await new Promise(resolve => setTimeout(resolve, 20))
        }
        await new Promise(resolve => setTimeout(resolve, 50))
      },
      properties() {
        const input = [...document.querySelectorAll('.logic-editor-page textarea')].find(el => el.getClientRects().length)
        return JSON.parse(input.value)
      },
    }
    return { chunks: [...document.scripts].map(s => s.src).filter(Boolean), theme: document.documentElement.className }
  }),
  evaluate(async () => {
    const m = window.__mcpLogic
    await m.importState(m.make(2))
    m.assert(JSON.parse(localStorage.getItem(m.key)).rowFusions[0].multiplier === 2, 'Valid file did not persist')
    m.before = localStorage.getItem(m.key)
    return 'valid import and persistence PASS'
  }),
  'tab:对象库',
  evaluate(async () => {
    const m = window.__mcpLogic
    m.assert(m.properties().value === 2, 'Object editor did not show imported properties')
    const bad = m.make(2)
    bad.rowFusions[0].multiplier = 'bad'
    for (const input of [null, [], { ...m.make(2), version: 2 }, bad]) {
      await m.importState(input)
      m.assert(localStorage.getItem(m.key) === m.before, 'Rejected import changed the cache')
      m.assert(m.properties().value === 2, 'Rejected import changed displayed state')
    }
    m.assert(document.body.innerText.includes('rowFusions[0].multiplier'), 'Missing actionable import error')
    Storage.prototype.setItem = function (key, value) {
      if (key === m.key) throw new DOMException('Injected quota failure', 'QuotaExceededError')
      return m.setItem.call(this, key, value)
    }
    return 'four invalid imports rejected atomically PASS'
  }),
  'click:保存',
  evaluate(async () => {
    const m = window.__mcpLogic
    // Naive UI gives the existing information banner role=alert too; inspect the warning, not the first alert.
    m.assert([...document.querySelectorAll('.logic-editor-page [role=alert]')].some(el => el.textContent.includes('导出 JSON')), 'Missing persistent storage warning')
    m.assert(!document.body.innerText.includes('已保存到浏览器'), 'Failed save reported success')
    await m.importState(m.make(4))
    m.assert(m.properties().value === 4, 'Reimport reused stale object-property text')
    m.assert(localStorage.getItem(m.key) === m.before, 'Quota failure overwrote the cache')
    m.createURL = URL.createObjectURL
    m.anchorClick = HTMLAnchorElement.prototype.click
    URL.createObjectURL = blob => { m.exported = blob.text(); return m.createURL.call(URL, blob) }
    HTMLAnchorElement.prototype.click = function () { m.downloadName = this.download }
    return 'quota failure visible; valid in-memory reimport PASS'
  }),
  'click:导出JSON',
  evaluate(async () => {
    const m = window.__mcpLogic
    const exported = JSON.parse(await m.exported)
    m.assert(exported.rowFusions[0].multiplier === 4 && exported.objects[0].properties.value === 4, 'Backup lost in-memory edits')
    m.assert(m.downloadName === 'zzz-logic-editor.json', 'Wrong backup filename')
    URL.createObjectURL = m.createURL
    HTMLAnchorElement.prototype.click = m.anchorClick
    Storage.prototype.setItem = m.setItem
    return 'backup remains available without storage PASS'
  }),
  'click:保存',
  evaluate(() => {
    const m = window.__mcpLogic
    m.assert(![...document.querySelectorAll('.logic-editor-page [role=alert]')].some(el => el.textContent.includes('导出 JSON')), 'Storage warning survived successful retry')
    m.assert(JSON.parse(localStorage.getItem(m.key)).rowFusions[0].multiplier === 4, 'Retry failed to persist')
    m.assert(document.body.innerText.includes('已保存到浏览器'), 'Successful retry lacks confirmation')
    localStorage.setItem(m.key, '{"rowFusions":{}}')
    localStorage.setItem('zzz-theme', 'light')
    setTimeout(() => location.reload(), 20)
    return 'save recovery PASS; testing corrupt-cache startup in light theme'
  }),
  'sleep:500',
  'wait:document.querySelectorAll(".n-tabs-tab").length > 0',
  'tab:逻辑编辑',
  'wait:.logic-editor-page',
  evaluate(() => {
    if (document.querySelectorAll('.logic-editor-page tbody tr').length === 0) throw new Error('Default rules did not recover')
    if (localStorage.getItem('zzz-logic-editor:v1') !== '{"rowFusions":{}}') throw new Error('Recovery overwrote corrupt cache')
    if (!document.documentElement.classList.contains('light')) throw new Error('Light-theme check did not activate')
    localStorage.removeItem('zzz-logic-editor:v1')
    return 'corrupt-cache recovery without destructive rewrite PASS'
  }),
]

// Let the OS choose a free static-server port; keep all test traffic on loopback.
const server = spawn('python3', ['-u', '-m', 'http.server', '0', '--bind', '127.0.0.1', '--directory', 'dist'])
let serverError = ''
server.stderr.on('data', data => { serverError = String(data).slice(-2000) })
try {
  const port = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Static server startup timed out')), 10000)
    let output = ''
    server.stdout.on('data', data => {
      output += data
      const match = output.match(/port (\d+)/)
      if (match) { clearTimeout(timeout); resolve(match[1]) }
    })
    server.once('error', error => { clearTimeout(timeout); reject(error) })
    server.once('exit', code => { clearTimeout(timeout); reject(new Error(`Static server exited ${code}: ${serverError}`)) })
  })
  const args = ['scripts/ui-check.mjs', '--url', `http://127.0.0.1:${port}/`,
    '--port', process.env.LOGIC_UI_CDP_PORT ?? '9337', '--wait-timeout', '15000',
    '--out', process.env.LOGIC_UI_OUT ?? '/tmp/zzz-ui-logic-state',
    ...steps.flatMap(step => ['--step', step])]
  const run = spawn(process.execPath, args, { stdio: 'inherit' })
  process.exitCode = await new Promise((resolve, reject) => {
    run.once('error', reject)
    run.once('exit', code => resolve(code ?? 1))
  })
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  server.kill()
}

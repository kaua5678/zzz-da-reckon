#!/usr/bin/env node
/** Reproducible logic-editor UI regression; run after npm run build.
 * Reuses ui-check.mjs/CDP and an isolated browser profile; never touches the user's browser.
 * Exercises import/save/export/history handlers and shortcut boundaries, including storage failures.
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
          { id: '__proto__', name: 'UI fixture', nature: 'custom', enabled: true, properties: { value, stages: [1, 2] } },
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
      propertyInput() { return [...document.querySelectorAll('.logic-editor-page textarea')].find(el => el.getClientRects().length) },
      properties() { return JSON.parse(this.propertyInput().value) },
      button(text) { return [...document.querySelectorAll('.logic-editor-page button')].find(el => el.textContent.trim() === text) },
      pause() { return new Promise(resolve => setTimeout(resolve, 80)) },
      setInput(input, value) {
        input.focus()
        input.value = value
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.blur()
      },
      shortcut(target, options = {}) {
        const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ctrlKey: true, key: 'z', ...options })
        target.dispatchEvent(event)
        return event.defaultPrevented
      },
    }
    const m = window.__mcpLogic
    m.assert(m.button('撤销').disabled && m.button('重做').disabled, 'History should start empty')
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
  'click:撤销',
  evaluate(() => {
    const m = window.__mcpLogic
    m.assert(m.properties().value === 2, 'Undo did not restore object JSON while storage was blocked')
    m.assert(localStorage.getItem(m.key) === m.before, 'Undo overwrote blocked storage')
    m.assert([...document.querySelectorAll('.logic-editor-page [role=alert]')].some(el => el.textContent.includes('导出 JSON')), 'Undo hid the storage warning')
    return 'undo under storage denial PASS'
  }),
  'click:重做',
  evaluate(() => {
    const m = window.__mcpLogic
    m.assert(m.properties().value === 4, 'Redo left stale object JSON')
    return 'redo under storage denial PASS'
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
    return 'save recovery PASS'
  }),
  evaluate(async () => {
    const m = window.__mcpLogic
    m.setInput(m.propertyInput(), JSON.stringify({ value: 7, stages: [1, 2] }))
    await m.pause()
    m.assert(JSON.parse(localStorage.getItem(m.key)).objects[0].properties.value === 7, 'Textarea edit did not commit')
    m.button('撤销').click()
    await m.pause()
    m.assert(m.properties().value === 4, 'Undo kept the old property-text cache')
    m.button('重做').click()
    await m.pause()
    m.assert(m.properties().value === 7, 'Redo did not restore edited JSON')
    // A failed textarea commit stays editable even when the object's editable id changes.
    m.setInput(m.propertyInput(), '{')
    const idInput = m.propertyInput().closest('tr').querySelector('td:first-child input')
    m.setInput(idInput, 'renamed')
    await m.pause()
    m.assert(m.propertyInput().value === '{', 'Renaming an object lost its uncommitted text')
    await m.importState(m.make(10))
    await m.importState(m.make(11))
    return 'property edits, snapshot restoration and editable-id isolation PASS'
  }),
  evaluate(async () => {
    const m = window.__mcpLogic
    const button = m.button('保存')
    for (const options of [{ ctrlKey: true }, { ctrlKey: false, metaKey: true }]) {
      m.assert(m.shortcut(button, options), 'Undo shortcut was not handled')
      await m.pause()
      m.assert(m.properties().value === 10, 'Undo shortcut restored the wrong snapshot')
      m.assert(m.shortcut(button, { ...options, shiftKey: true }), 'Redo shortcut was not handled')
      await m.pause()
      m.assert(m.properties().value === 11, 'Redo shortcut restored the wrong snapshot')
    }
    m.shortcut(button)
    await m.pause()
    m.assert(m.shortcut(button, { key: 'y' }), 'Ctrl+Y was not handled')
    await m.pause()
    m.assert(m.properties().value === 11, 'Ctrl+Y failed to redo')
    const before = localStorage.getItem(m.key)
    const editor = document.createElement('div')
    editor.contentEditable = 'true'
    editor.innerHTML = '<span>Editable text</span>'
    document.querySelector('.logic-editor-page').append(editor)
    const targets = [m.propertyInput(), m.propertyInput().closest('tr').querySelector('input'), editor.firstChild, document.body]
    for (const target of targets) m.assert(!m.shortcut(target), 'Native/outside-page shortcut was intercepted')
    editor.remove()
    m.assert(!m.shortcut(button, { isComposing: true }), 'IME shortcut was intercepted')
    m.assert(!m.shortcut(button, { altKey: true }), 'Alt-modified shortcut was intercepted')
    const handled = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ctrlKey: true, key: 'z' })
    handled.preventDefault()
    button.dispatchEvent(handled)
    await m.pause()
    m.assert(localStorage.getItem(m.key) === before, 'Protected shortcuts changed history')
    return 'Ctrl/Cmd undo/redo, Ctrl+Y and native-input/IME boundaries PASS'
  }),
  'tab:倍率融合',
  evaluate(async () => {
    const m = window.__mcpLogic
    const number = [...document.querySelectorAll('.logic-editor-page .n-input-number input')].find(el => el.getClientRects().length)
    m.setInput(number, '')
    await m.pause()
    m.assert(document.querySelector('.history-status').textContent.includes('草稿未生效'), 'Incomplete numeric draft was not detected')
    m.assert(JSON.parse(localStorage.getItem(m.key)).rowFusions[0].multiplier === 11, 'Invalid number polluted the cache')
    m.button('撤销').click()
    await m.pause()
    const restored = [...document.querySelectorAll('.logic-editor-page .n-input-number input')].find(el => el.getClientRects().length)
    m.assert(Number(restored.value) === 11, 'Invalid-draft undo stepped back too far')
    m.assert(m.button('重做').disabled, 'Invalid number entered redo history')
    m.confirm = window.confirm
    window.confirm = () => true
    return 'incomplete numeric draft safely discarded PASS'
  }),
  'click:恢复默认',
  evaluate(() => {
    const m = window.__mcpLogic
    m.assert(JSON.parse(localStorage.getItem(m.key)).attributeConversions.length > 0, 'Reset did not restore actual defaults')
    window.confirm = m.confirm
    return 'reset defaults PASS'
  }),
  'click:撤销',
  'tab:对象库',
  evaluate(() => {
    const m = window.__mcpLogic
    m.assert(m.properties().value === 11, 'Reset could not be undone in one step')
    m.assert(JSON.parse(localStorage.getItem(m.key)).rowFusions[0].multiplier === 11, 'Reset undo did not persist')
    return 'reset undone as one complete configuration PASS'
  }),
  evaluate(() => {
    const m = window.__mcpLogic
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
    const buttons = [...document.querySelectorAll('.logic-editor-page button')]
    if (!buttons.find(el => el.textContent.trim() === '撤销')?.disabled || !buttons.find(el => el.textContent.trim() === '重做')?.disabled) throw new Error('Reload must start a fresh session history')
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

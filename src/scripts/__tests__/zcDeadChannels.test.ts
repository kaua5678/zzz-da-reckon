/**
 * T2 按需死通道工作台：参数/空扫描/新增/存量/文本与 JSON 同源，以及真实 CLI 退出码。
 * 扫描口径本身由 deadChannelLs.test.ts 守护；这里只验证入口不假绿、不另造规则。
 */
import { afterAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
// @ts-expect-error -- scripts 纯 JS 模块，沿用 deadChannelLs.test.ts 的无声明文件约定
import * as cliNs from '../../../scripts/zc-dead-channels.mjs'

interface Report { ok: boolean; data: Record<string, any>; next: string | null }
const { buildDeadChannelReport, formatDeadChannelReport } = cliNs as {
  buildDeadChannelReport: (root: string, args?: Record<string, unknown>) => Promise<Report>
  formatDeadChannelReport: (r: Report) => string
}

const roots: string[] = []
function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'zc-dead-'))
  roots.push(root)
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true })
    writeFileSync(join(root, rel), text)
  }
  return root
}
afterAll(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }) })
const REPO = join(dirname(new URL(import.meta.url).pathname), '../../..')

describe('zc dead-channels 按需工作台', () => {
  it('参数错误与帮助不扫描，错误退出信封 ok=false', async () => {
    const bad = await buildDeadChannelReport('/nonexistent', { positional: ['src'] })
    expect(bad.ok).toBe(false)
    expect(bad.data.error.code).toBe('INVALID_ARGUMENT')
    const flag = await buildDeadChannelReport('/nonexistent', { positional: [], fix: true })
    expect(flag.data.error.code).toBe('INVALID_ARGUMENT')
    const help = await buildDeadChannelReport('/nonexistent', { positional: [], help: true })
    expect(help.ok).toBe(true)
    expect(formatDeadChannelReport(help)).toContain('dead-channels')
  })

  it('缺 src 或零候选不能报告为零问题', async () => {
    const missing = await buildDeadChannelReport(fixture({ 'README.md': 'x\n' }), { positional: [] })
    expect(missing).toMatchObject({ ok: false, data: { error: { code: 'SCAN_FAILED' } } })
    const empty = await buildDeadChannelReport(fixture({ 'src/types/a.ts': 'export const a = 1\n' }), { positional: [] })
    expect(empty).toMatchObject({ ok: false, data: { error: { code: 'EMPTY_SCAN' } } })
  })

  it('基线外死字段判新增并失败；有写入的同形字段不误报（负控）', async () => {
    const dead = await buildDeadChannelReport(fixture({
      'src/types/opts.ts': 'export interface Opts { t2NeverPassed?: number }\nexport function run(o: Opts) { return o.t2NeverPassed ?? 1 }\n',
    }), { positional: [] })
    expect(dead.ok).toBe(false)
    expect(dead.data.fresh.map((h: any) => h.prop)).toEqual(['t2NeverPassed'])
    expect(formatDeadChannelReport(dead)).toContain('✗ 新增 src/types/opts.ts:1 t2NeverPassed')
    const root = fixture({
      'src/types/opts.ts': 'export interface Opts { t2Passed?: number }\nexport function run(o: Opts) { return o.t2Passed ?? 1 }\n',
      'src/caller.ts': "import { run } from './types/opts'\nexport const v = run({ t2Passed: 2 })\n",
    })
    const live = await buildDeadChannelReport(root, { positional: [] })
    expect(live.ok).toBe(true)
    expect(live.data.fresh).toEqual([])
    expect(live.data.candidates).toBeGreaterThan(0)
    expect(existsSync(join(root, '.zc'))).toBe(false)
  })

  it('真实 CLI：仓库现状零新增，--json 与文本同一读数，且不写 .zc', () => {
    const node = process.execPath
    const cli = join(REPO, 'scripts/zc.mjs')
    const json = JSON.parse(execFileSync(node, [cli, 'dead-channels', '--json'], { cwd: REPO, encoding: 'utf8' }))
    expect(json).toMatchObject({ ok: true, verb: 'dead-channels' })
    expect(json.data.fresh).toEqual([])
    expect(json.data.candidates).toBeGreaterThan(100)
    for (const k of json.data.known) expect(k.baseline?.why).toBeTruthy()
    const text = execFileSync(node, [cli, 'dead-channels'], { cwd: REPO, encoding: 'utf8' })
    expect(text).toContain(`新增 0 · 基线存量 ${json.data.known.length} · 待核销 ${json.data.resolved.length}`)
    let code = 0
    try { execFileSync(node, [cli, 'dead-channels', 'extra'], { cwd: REPO, stdio: 'pipe' }) } catch (e: any) { code = e.status }
    expect(code).toBe(1)
  }, 120_000)
})

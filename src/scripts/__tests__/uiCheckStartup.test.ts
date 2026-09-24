/** CLI-level regression: startup failures must leave this run's evidence, not just exit nonzero. */
import { afterEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const script = resolve(__dirname, '../../../scripts/ui-check.mjs')
const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function runFailure(mode: 'discovery' | 'spawn' | 'exit') {
  const root = mkdtempSync(join(tmpdir(), 'zzz-ui-startup-'))
  roots.push(root)
  const out = join(root, 'artifacts')
  // Start with real previous success and failure artifacts to catch stale-image reuse.
  // mkdir is intentionally left to the CLI in discovery mode as another startup check.
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: root, USERPROFILE: root }
  delete env.CHROME_BIN
  const args = ['--out', out, '--port', '0']
  if (mode === 'spawn') args.push('--chrome', join(root, 'missing-chromium'))
  if (mode === 'exit') args.push('--chrome', process.execPath) // Node rejects Chromium flags and exits.
  if (mode !== 'discovery') {
    // Use a populated output directory without depending on a browser installation.
    const seeded = mkdtempSync(join(root, 'seed-'))
    args[1] = seeded
    writeFileSync(join(seeded, 'ui-check-report.json'), JSON.stringify({ round: 'OLD', status: 'pass' }))
    writeFileSync(join(seeded, 'ui-check-full.png'), 'old success screenshot')
    writeFileSync(join(seeded, 'ui-check-failure.json'), JSON.stringify({ round: 'OLD-FAIL', status: 'fail' }))
    writeFileSync(join(seeded, 'ui-check-failure.png'), 'old failure screenshot')
  }
  const result = spawnSync(process.execPath, [script, ...args], { env, encoding: 'utf8', timeout: 8000 })
  expect(result.error, result.stderr).toBeUndefined()
  expect(result.signal).toBeNull()
  expect(result.status, result.stderr).toBe(1)
  expect(result.stderr).toContain('实机点通 FAIL')
  expect(result.stderr).not.toContain("Unhandled 'error' event")
  expect(result.stdout).not.toContain('实机点通 PASS')
  const dir = args[1]!
  const failure = JSON.parse(readFileSync(join(dir, 'ui-check-failure.json'), 'utf8'))
  expect(failure.status).toBe('fail')
  expect(failure.phase).toBe('startup')
  expect(failure.round).not.toMatch(/^OLD/)
  expect(Number.isNaN(Date.parse(failure.finishedAt))).toBe(false)
  expect(failure.screenshot).toBeNull()
  expect(failure.report).toBeNull()
  expect(failure.failures.length).toBeGreaterThan(0)
  expect(existsSync(join(dir, 'ui-check-report.json'))).toBe(false)
  expect(existsSync(join(dir, 'ui-check-full.png'))).toBe(false)
  expect(existsSync(join(dir, 'ui-check-failure.png'))).toBe(false)
  if (mode !== 'discovery') {
    expect(failure.staleFrom).toHaveLength(4)
    expect(JSON.parse(readFileSync(join(dir, 'ui-check-report.stale.json'), 'utf8')).round).toBe('OLD')
    expect(readFileSync(join(dir, 'ui-check-failure.stale.png'), 'utf8')).toBe('old failure screenshot')
  }
  return failure
}

describe('ui-check startup lifecycle (real CLI, no Chromium dependency)', () => {
  it('missing browser discovery creates a current failure report', () => {
    expect(runFailure('discovery').failures.join('\n')).toContain('找不到 Chromium')
  })
  it('spawn ENOENT is caught, old artifacts rotated, current failure persisted', () => {
    expect(runFailure('spawn').failures.join('\n')).toContain('ENOENT')
  })
  it('an executable exiting before CDP is detected promptly and reported', () => {
    expect(runFailure('exit').failures.join('\n')).toContain('Chromium 提前退出')
  })
})

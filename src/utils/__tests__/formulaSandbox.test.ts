/**
 * CC-504：公式沙箱只写一份（`utils/formulaSandbox.ts#evalSandboxedFormula`）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { evalSandboxedFormula } from '@/utils/formulaSandbox'

const SRC = join(__dirname, '..', '..')
function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (f === '__tests__' || f === 'node_modules') continue
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|vue)$/.test(f) && !/\.test\.ts$/.test(f)) out.push(p)
  }
  return out
}

describe('evalSandboxedFormula（CC-504）', () => {
  it('变量 + helper 可用；结果原样返回（含非有限，由调用方定）', () => {
    expect(evalSandboxedFormula('c*w + pow(r, k)', { c: 2, w: 3, r: 2, k: 3 })).toEqual({ ok: true, value: 14 })
    expect(evalSandboxedFormula('clamp(x, 0, 10) + floor(s / 5)', { x: 42, s: 12, p: 6 })).toEqual({ ok: true, value: 12 })
    expect(evalSandboxedFormula('x / 0', { x: 1 })).toEqual({ ok: true, value: Infinity })
  })
  it('白名单：反引号 / 赋值 / 方括号 / 分号 / 引号 / 空串 ⇒ 不合法；未知标识符 ⇒ 求值抛错 ⇒ 不合法', () => {
    for (const bad of ['`x`', 'x = 1', 'x[0]', 'x; 1', "'a'", '', '   ']) {
      expect(evalSandboxedFormula(bad, { x: 1 }), bad).toEqual({ ok: false })
    }
    expect(evalSandboxedFormula('foo(x)', { x: 1 })).toEqual({ ok: false })
    expect(evalSandboxedFormula('window', { x: 1 }).ok).toBe(false)
  })
  it('源码锁：src 下（测试除外）`Function(` 只出现在 owner', () => {
    const owner = join(SRC, 'utils', 'formulaSandbox.ts')
    for (const f of walk(SRC)) {
      const code = readFileSync(f, 'utf8').split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
      const hits = (code.match(/\bFunction\(/g) ?? []).length
      expect(hits, f).toBe(f === owner ? 1 : 0)
    }
  })
})

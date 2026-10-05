/**
 * CC-479（r662）：诊断打表设施——关着零副作用、开着推进 globalThis 桶；旗标只认 '1'。
 * 同时锁「src 里的 process.env 读取只经由 probeTrace」：裸 `process.env` 进浏览器包会抛（坑：r657 临时 trace 不能提交的原因）。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { probeKey, probeOn, probePush } from '@/core/probeTrace'

const FLAG = 'PROBE_TRACE_CC479_TEST'
afterEach(() => { delete process.env[FLAG]; delete (globalThis as Record<string, unknown>).__cc479; delete (globalThis as Record<string, unknown>).__probeKey })

describe('CC-479 probeTrace', () => {
  it('关着：不求值 thunk、不建桶', () => {
    let evaluated = 0
    probePush(FLAG, '__cc479', () => { evaluated++; return {} })
    expect(probeOn(FLAG)).toBe(false)
    expect(evaluated).toBe(0)
    expect((globalThis as Record<string, unknown>).__cc479).toBeUndefined()
  })
  it("开着（只认 '1'）：按序推进桶；probeKey 读 __probeKey", () => {
    process.env[FLAG] = 'yes'
    probePush(FLAG, '__cc479', () => 1)
    expect((globalThis as Record<string, unknown>).__cc479).toBeUndefined()
    process.env[FLAG] = '1'
    ;(globalThis as Record<string, unknown>).__probeKey = 'team-x'
    probePush(FLAG, '__cc479', () => ({ k: probeKey(), v: 1 }))
    probePush(FLAG, '__cc479', () => ({ k: probeKey(), v: 2 }))
    expect((globalThis as Record<string, unknown>).__cc479).toEqual([{ k: 'team-x', v: 1 }, { k: 'team-x', v: 2 }])
  })
  it('源码：src/ 下（src/test、测试文件与 probeTrace 本身除外）不再直接读 process.env', () => {
    const root = join(__dirname, '..', '..')
    const hits: string[] = []
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n)
        if (statSync(p).isDirectory()) { if (n !== '__tests__' && n !== 'node_modules' && p !== join(root, 'test')) walk(p); continue }  // src/test = node 侧测试基建，不进浏览器包
        if (!/\.(ts|vue)$/.test(n) || /\.test\.ts$/.test(n) || p.endsWith(join('core', 'probeTrace.ts'))) continue
        const src = readFileSync(p, 'utf8')
        if (/process\.env\b/.test(src)) hits.push(p.slice(root.length + 1))
      }
    }
    walk(root)
    expect(hits, '裸 process.env 读取请改走 @/core/probeTrace').toEqual([])
  })
})

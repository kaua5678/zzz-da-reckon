/**
 * CC-359（D2 类型层）：`CharacterOperationConfig` 公共接口只收**被两处以上引用**的字段。
 * 只有一个角色模块（`mechanics/agents/<x>.ts`）读写的字段，声明放在该模块末尾的
 * `declare module '@/types/resource/config'` 扩充块里（纯类型、零运行时，产物 JS 逐字节不变）。
 * 判据与迁移脚本 `scripts/d2-migrate-private-cfg.py` 同口径：剥注释后按单词边界在非测试源码里找引用。
 * 红了 ⇒ 把报出的字段连同 doc 注释挪进对应模块的扩充块（或跑脚本：`python3 scripts/d2-migrate-private-cfg.py . <模块名>`）。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const SRC = resolve(__dirname, '../..')
const TYPES = join(SRC, 'types/resource/config.ts')

function walk(d: string, out: string[] = []): string[] {
  for (const n of readdirSync(d)) {
    const p = join(d, n)
    if (statSync(p).isDirectory()) { if (n !== '__tests__' && n !== 'test') walk(p, out) }
    else if (/\.(ts|vue)$/.test(n) && !n.endsWith('.d.ts') && p !== TYPES) out.push(p)
  }
  return out
}

/** 注释里提到字段名不算引用（r389：convergence.ts 的迁移沿革注释曾让 12 个私有字段被误判为公共） */
function stripComments(t: string): string {
  return t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(?<![:'"\w])\/\/[^\n]*/g, '')
}

function publicFields(): string[] {
  const lines = readFileSync(TYPES, 'utf-8').split('\n')
  const st = lines.findIndex(l => l.startsWith('export interface CharacterOperationConfig'))
  const en = lines.findIndex((l, i) => i > st && l === '}')
  return lines.slice(st + 1, en).map(l => /^ {2}(\w+)\??:/.exec(l)?.[1]).filter((x): x is string => !!x)
}

describe('CC-359：单模块私有 cfg 字段不进公共接口', () => {
  it('公共接口里没有「只被一个角色模块引用」的字段', () => {
    const files = walk(SRC).map(p => ({ rel: relative(SRC, p).replace(/\\/g, '/'), txt: stripComments(readFileSync(p, 'utf-8')) }))
    const fields = publicFields()
    expect(fields.length).toBeGreaterThan(50) // 解析器自检：接口没被改成别的形状
    const offenders = fields.filter(f => {
      const rx = new RegExp(`\\b${f}\\b`)
      const hits = files.filter(x => rx.test(x.txt))
      return hits.length === 1 && hits[0]!.rel.startsWith('mechanics/agents/')
    })
    expect(offenders).toEqual([])
  })
})

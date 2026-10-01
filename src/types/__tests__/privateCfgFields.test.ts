/**
 * CC-359 / CC-360（D2 类型层）：公共接口只收**被两处以上引用**的成员。
 * 只有一个角色模块（`mechanics/agents/<x>.ts`）读写的成员，声明放在该模块末尾的
 * `declare module '<spec>'` 扩充块里（纯类型、零运行时，产物 JS 逐字节不变）。
 * 判据与 `scripts/d2-migrate-private-cfg.py` 同口径：剥注释；`name?:` 可选声明行（别的接口里的同名字段）不算引用；
 * 声明文件里接口体之外的引用算。
 * 红了 ⇒ 把报出的成员连同 doc 注释挪进对应模块的扩充块（或跑 `python3 scripts/d2-migrate-private-cfg.py . --target <cfg|feedback|result> <模块名>`）。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const SRC = resolve(__dirname, '../..')
const TARGETS = [
  { file: 'types/resource/config.ts', iface: 'CharacterOperationConfig', min: 50 },
  { file: 'mechanics/types.ts', iface: 'ModuleFeedback', min: 1 },
  { file: 'types/resource/agentResources.ts', iface: 'CharacterResourceResult', min: 10 },
] as const

/** 注释里提到成员名不算引用（r389：convergence.ts 的迁移沿革注释曾让 36 个私有字段被误判为公共） */
function stripComments(t: string): string {
  return t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(?<![:'"\w])\/\/[^\n]*/g, '')
}

function walk(d: string, out: string[] = []): string[] {
  for (const n of readdirSync(d)) {
    const p = join(d, n)
    if (statSync(p).isDirectory()) { if (n !== '__tests__' && n !== 'test') walk(p, out) }
    else if (/\.(ts|vue)$/.test(n) && !n.endsWith('.d.ts')) out.push(p)
  }
  return out
}

const ALL = walk(SRC).map(p => ({ rel: relative(SRC, p).replace(/\\/g, '/'), raw: readFileSync(p, 'utf-8') }))

describe('CC-359/360：单模块私有成员不进公共接口', () => {
  for (const { file, iface, min } of TARGETS) {
    it(`${iface}（${file}）里没有「只被一个角色模块引用」的成员`, () => {
      const lines = readFileSync(join(SRC, file), 'utf-8').split('\n')
      const st = lines.findIndex(l => l.startsWith(`export interface ${iface}`))
      const en = lines.findIndex((l, i) => i > st && l === '}')
      const members = lines.slice(st + 1, en).map(l => /^ {2}(\w+)\??:/.exec(l)?.[1]).filter((x): x is string => !!x)
      expect(members.length).toBeGreaterThanOrEqual(min) // 解析器自检
      const files = ALL.map(x => ({
        rel: x.rel,
        txt: stripComments(x.rel === file ? [...lines.slice(0, st), ...lines.slice(en + 1)].join('\n') : x.raw),
      }))
      const offenders = members.filter(m => {
        const rx = new RegExp(`\\b${m}\\b(?!\\?:)`)
        const hits = files.filter(x => rx.test(x.txt))
        return hits.length === 1 && hits[0]!.rel.startsWith('mechanics/agents/')
      })
      expect(offenders).toEqual([])
    })
  }
})

describe('CC-360：角色专属结果类型随模块走', () => {
  it('types/resource/agentResources.ts 里没有「只被一个角色模块引用」的整份 interface', () => {
    const file = 'types/resource/agentResources.ts'
    const self = stripComments(readFileSync(join(SRC, file), 'utf-8'))
    const names = [...self.matchAll(/^export interface (\w+)/gm)].map(m => m[1]!)
    expect(names.length).toBeGreaterThanOrEqual(3)
    const others = ALL.filter(x => x.rel !== file && x.rel !== 'types/resource/index.ts')
      .map(x => ({ rel: x.rel, txt: stripComments(x.raw) }))
    const offenders = names.filter(n => {
      const rx = new RegExp(`\\b${n}\\b`)
      const selfRefs = (self.match(new RegExp(`\\b${n}\\b`, 'g')) ?? []).length // 1 = 只有声明本身
      const hits = others.filter(x => rx.test(x.txt))
      return selfRefs === 1 && hits.length === 1 && hits[0]!.rel.startsWith('mechanics/agents/')
    })
    expect(offenders).toEqual([]) // 红了 ⇒ python3 scripts/d2-migrate-agent-types.py .
  })
})


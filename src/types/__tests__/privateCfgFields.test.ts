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

/**
 * D2 §5（r391 起）：模块内 `cfg as unknown as Record<string, unknown>` 绕开类型读写**未声明**的键，
 * 拼错键名 = 静默读到 undefined。逐模块补声明（本模块扩充块）并改回 `cfg.<键>` 后，把模块名加进下表，锁住不回退。
 * 判据是「这个模块的 cfg 状态键全有类型」，不是 cast 计数；按动态键（`record[field]`）的通用逻辑可保留，但该模块就别进表。
 */
const TYPED_CFG_MODULES = ['yixuan', 'yeshuguang', 'banyue', 'starlightBilly', 'orphie', 'caesar', 'anton', 'remielle', 'xide', 'xixifu', 'zhuYuan', 'ben', 'grace', 'specPanelBuffs', 'nicole', 'panYinhu', 'sigrid', 'zhao', 'nangong', 'severian', 'lucy', 'promia', 'vivian'] as const

describe('D2 §5：已完成模块不再经 Record 强转 / as any 读写 cfg', () => {
  for (const m of TYPED_CFG_MODULES) {
    it(`mechanics/agents/${m}.ts`, () => {
      const src = stripComments(readFileSync(join(SRC, `mechanics/agents/${m}.ts`), 'utf-8'))
      expect(src).not.toMatch(/as unknown as Record<string,\s*unknown>/)
      // CC-363：`(cfg as any).k` 与 Record 强转同病（键无类型、拼错静默），r392 漏判了 yeshuguang 一处
      expect(src).not.toMatch(/\b(?:input\.)?cfg as any\b/)
    })
  }
})

/**
 * CC-369（r395）：全仓不变式——非测试源码不得用 `(cfg as any).<键>` 静态访问 cfg。
 * 这是 D2 §5 的「病」本身（键无类型、拼错静默），对所有文件成立，不再逐模块列名单：新模块写了就红。
 * 只锁**静态键**；`(cfg as any)[decl.field]` 这类按声明字段名的动态访问是通用逻辑（convergence.ts），放行。
 */
describe('D2 §5：全仓不得 (cfg as any).键', () => {
  it('src 非测试源码零命中', () => {
    const hits: string[] = []
    for (const p of walk(SRC)) {
      const t = stripComments(readFileSync(p, 'utf-8'))
      t.split('\n').forEach((l, i) => { if (/\((?:input\.)?cfg as any\)\.\w/.test(l)) hits.push(`${relative(SRC, p)}:${i + 1}`) })
    }
    expect(hits).toEqual([])
  })
})

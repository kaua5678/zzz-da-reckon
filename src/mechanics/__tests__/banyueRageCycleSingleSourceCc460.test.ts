/**
 * CC-460 锁：般岳怒相循环契约单源 + 页面读模块口径。
 *
 * 此前 `BanyueRageCycle` 在 `types/resource/agentResources.ts` 与 `mechanics/agents/banyue.ts` 各有一份同名同字段接口
 * （初始提交起），靠结构兼容静默对接，doc 已漂移（outStunComboCount 的轴模式口径两边不一致）；
 * `StunAxisPage.vue` 两处手写 `rageCount * 2` 复制模块常数「每怒相 2 组免费连段」。
 * 现：接口只在公共类型里定义一次；模块把配额作为 `rageComboQuota` 给出；页面只读。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { computeBanyueRageCycle } from '@/mechanics/agents/banyue'

const SRC = resolve(__dirname, '../..')
const read = (p: string) => readFileSync(resolve(SRC, p), 'utf-8')

describe('CC-460 BanyueRageCycle 单源 + rageComboQuota', () => {
  it('rageComboQuota = 怒相次数 × 2，且 = 怒相内论道组 + 地动组', () => {
    for (const didong of [0, 1, 99]) {
      const c = computeBanyueRageCycle(10, 6, 20, 0, 0, 0, 0, didong, 180)
      expect(c.rageCount).toBeGreaterThan(0)
      expect(c.rageComboQuota).toBe(c.rageCount * 2)
      expect(c.lunDaoRageCount + c.rageDiDongComboCount).toBe(c.rageComboQuota)
    }
    const z = computeBanyueRageCycle(0, 0, 0, 0, 0, 0, 0, 0, 180) // 零交互：开局嗔火仍可进怒相
    expect(z.rageComboQuota).toBe(z.rageCount * 2)
  })

  it('源锁：接口只在 types/resource/agentResources.ts 定义；页面不再 rageCount * 2', () => {
    const types = read('types/resource/agentResources.ts')
    const mod = read('mechanics/agents/banyue.ts')
    const view = read('views/StunAxisPage.vue')
    expect(types.match(/^export interface BanyueRageCycle \{/gm)?.length).toBe(1)
    expect(types).toMatch(/^  rageComboQuota: number$/m)
    expect(mod).not.toMatch(/interface BanyueRageCycle/)
    expect(mod).toMatch(/import type \{[^}]*\bBanyueRageCycle\b[^}]*\} from '@\/types\/resource'/)
    expect(view).not.toMatch(/rageCount\s*\*\s*2/)
    expect(view.match(/\.rageComboQuota\b/g)?.length).toBe(2)
  })

  it('防复发：src 非测试文件里 `export interface <Name>` 全局唯一（同名两份定义靠结构兼容静默对接 = 契约漂移温床）', () => {
    const files: string[] = []
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n)
        if (statSync(p).isDirectory()) { if (n !== '__tests__' && n !== 'test') walk(p) }
        else if (/\.(ts|vue)$/.test(n) && !n.endsWith('.d.ts')) files.push(p)
      }
    }
    walk(SRC)
    expect(files.length).toBeGreaterThan(300)
    const byName = new Map<string, string[]>()
    for (const f of files) {
      for (const m of readFileSync(f, 'utf-8').matchAll(/^export interface (\w+)\b/gm)) {
        const rel = relative(SRC, f).replace(/\\/g, '/')
        byName.set(m[1]!, [...(byName.get(m[1]!) ?? []), rel])
      }
    }
    expect(byName.size).toBeGreaterThan(200)
    const dups = [...byName.entries()].filter(([, fs]) => fs.length > 1).map(([n, fs]) => `${n}: ${fs.join(', ')}`)
    expect(dups).toEqual([])
  })
})

/**
 * R5 D22（`buffModifiers`）数据前提钉。
 *
 * 1. catalog.json 里 85 处 `buffModifiers` 全是空数组。引擎只从**角色队友拐**
 *    （`core/inCombatBuffs.ts` `enabledAgentBuffs`）收集修饰器；音擎 / 驱动盘 teamBuff 的
 *    `buffModifiers` 只被原样搬进 buff 对象，没有任何读取方。若日后 catalog 出现非空修饰器，
 *    必须先给它接读取方，否则会静默失效。
 * 2. teammate-buffs.json 的修饰器：operation 只允许 `multiplyResolvedValue`（引擎唯一支持的一种，
 *    其余 operation 会被 `continue` 静默跳过）；`targetBuffIds` / `targetEffectIds` 必须能解析到
 *    存在的 buff / effect（悬空 id 同样静默无效）；目标 effect 的 type 必须是引擎分支覆盖的四种。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (f: string) => JSON.parse(readFileSync(new URL(`../../../public/static/${f}`, import.meta.url), 'utf8')) as any
const cat = read('catalog.json')
const tb = read('teammate-buffs.json') as any[]

function collect(o: any, path: string, out: Array<[string, unknown[]]>): void {
  if (Array.isArray(o)) { o.forEach((v, i) => collect(v, `${path}/${v?.id ?? i}`, out)); return }
  if (!o || typeof o !== 'object') return
  if ('buffModifiers' in o) out.push([path, o.buffModifiers ?? []])
  for (const [k, v] of Object.entries(o)) collect(v, `${path}/${k}`, out)
}

describe('R5 D22 buffModifiers 数据前提', () => {
  it('catalog.json 的 buffModifiers 全为空（音擎 / 驱动盘修饰器无读取方）', () => {
    const out: Array<[string, unknown[]]> = []
    collect(cat, '', out)
    expect(out.length).toBeGreaterThan(50)
    expect(out.filter(([, m]) => m.length > 0).map(([p]) => p)).toEqual([])
  })

  it('teammate-buffs.json 修饰器：operation 受支持、目标 id 全部可解析、目标 type 有分支', () => {
    const buffs = new Map<string, any>()
    for (const g of tb) for (const b of g.buffs ?? []) buffs.set(b.id, b)
    const bad: string[] = []
    let n = 0
    for (const b of buffs.values()) {
      for (const m of b.buffModifiers ?? []) {
        n++
        if (m.operation !== 'multiplyResolvedValue') bad.push(`${m.id}: operation=${m.operation}`)
        if (!Number.isFinite(Number(m.factor))) bad.push(`${m.id}: factor=${m.factor}`)
        for (const t of m.targetBuffIds ?? []) {
          const target = buffs.get(t)
          if (!target) { bad.push(`${m.id}: 缺 buff ${t}`); continue }
          const effs = new Map<string, any>((target.effects ?? []).map((e: any) => [e.id, e]))
          for (const eid of m.targetEffectIds ?? []) {
            const e = effs.get(eid)
            if (!e) bad.push(`${m.id}: 缺 effect ${eid}`)
            else if (!['fixed', 'formula', 'derived', 'stacked'].includes(e.type ?? 'fixed')) bad.push(`${m.id}: type=${e.type}`)
          }
        }
      }
    }
    expect(n).toBeGreaterThan(5)
    expect(bad).toEqual([])
  })
})

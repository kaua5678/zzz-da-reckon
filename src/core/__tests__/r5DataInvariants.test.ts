/**
 * CC-111（R5 第 4 刀，D2 / D4 数据前提钉，零差）。
 *
 * - D2：`statRules.calculation.outOfCombatEffectFilter = { scope: 'outOfCombat', condition: null }`，
 *   引擎（`core/buff.ts` collectAgentBuffs 等）只判 scope、不看 condition。当前数据里「局外 + 带条件」为 0 ⇒ 等价。
 *   出现第一条时本测试变红：先让局外判定读 condition（R6 候选 C4），再改这里。
 * - D4：`basis` 零读取，引擎靠「局内同批次、基底 = 局外面板」隐式实现。只认 outOfCombatAtk / outOfCombatHp；
 *   出现新取值（如 CC-96 之前的 baseAtk）会被静默忽略 ⇒ 本测试变红，先让引擎支持。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const cat = JSON.parse(readFileSync(new URL('../../../public/static/catalog.json', import.meta.url), 'utf8')) as any

function walk(v: any, visit: (o: any, path: string) => void, path = '') {
  if (Array.isArray(v)) { v.forEach((x, i) => walk(x, visit, `${path}[${i}]`)); return }
  if (v && typeof v === 'object') {
    visit(v, path)
    for (const [k, x] of Object.entries(v)) walk(x, visit, `${path}.${k}`)
  }
}
const hasCond = (c: unknown) => typeof c === 'string' ? c.trim() !== '' : c != null

describe('R5 数据前提（CC-111）', () => {
  it('D2：规则本身仍是 { scope: outOfCombat, condition: null }', () => {
    expect(cat.statRules.calculation.outOfCombatEffectFilter).toEqual({ scope: 'outOfCombat', condition: null })
  })

  it('D2：scope=outOfCombat 的对象及其 effects 都不带 condition', () => {
    const bad: string[] = []
    walk(cat, (o, path) => {
      if (o.scope !== 'outOfCombat' || path.startsWith('.statRules')) return
      if (hasCond(o.condition)) bad.push(path)
      for (const [i, e] of (Array.isArray(o.effects) ? o.effects : []).entries()) if (hasCond(e?.condition)) bad.push(`${path}.effects[${i}]`)
    })
    expect(bad).toEqual([])
  })

  it('D4：basis 取值 ⊆ { outOfCombatAtk, outOfCombatHp }，且出现过（非空前提）', () => {
    const seen: string[] = []
    walk(cat, o => { if (typeof o.basis === 'string') seen.push(o.basis) })
    expect(seen.length).toBeGreaterThan(0)
    expect([...new Set(seen)].filter(b => b !== 'outOfCombatAtk' && b !== 'outOfCombatHp')).toEqual([])
  })
})

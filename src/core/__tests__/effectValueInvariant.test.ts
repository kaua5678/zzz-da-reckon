/**
 * R5 D24（效果数值核心字段 type / value / valuePerStack / maxStacks / defaultStacks /
 * modificationValues）数据前提钉。当前数据与 `core/buff.ts#applyEffect` /
 * `applyWEngineModLevel` 的读法逐条一致；这些断言防止录入出引擎会静默读错的形态：
 * - type 只能是引擎有分支的四种（未知 type 在 applyEffect 里 value 恒为 0）；
 * - stacked 必须有 valuePerStack 与 maxStacks；若同时写 value，只能等于 valuePerStack
 *   （引擎取 `valuePerStack ?? value` 作每层值，value 写成总值会被忽略，易误导）；
 *   defaultStacks ≤ maxStacks；
 * - fixed 必须有有限 value；
 * - modificationValues 每个数组长 5，第 1 项等于基础字段（精 1 = 基础值）。
 * 范围：wEngines / driveDiscSets / agents（bosses 无消费方，D10）。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const cat = JSON.parse(readFileSync(new URL('../../../public/static/catalog.json', import.meta.url), 'utf8')) as any

function effectsOf(o: any, out: any[]): void {
  if (Array.isArray(o)) { o.forEach(v => effectsOf(v, out)); return }
  if (!o || typeof o !== 'object') return
  if (Array.isArray(o.effects)) for (const e of o.effects) if (e?.stat) out.push(e)
  for (const [k, v] of Object.entries(o)) if (k !== 'effects') effectsOf(v, out)
}
const effects: any[] = []
effectsOf({ w: cat.wEngines, d: cat.driveDiscSets, a: cat.agents }, effects)

describe('R5 D24 效果数值字段形态', () => {
  it('type / stacked / fixed 形态都在引擎读法之内', () => {
    expect(effects.length).toBeGreaterThan(250)
    const bad: string[] = []
    for (const e of effects) {
      const t = e.type
      if (!['fixed', 'stacked', 'derived', 'formula'].includes(t)) bad.push(`${e.id}: type=${t}`)
      if (t === 'fixed' && !Number.isFinite(e.value)) bad.push(`${e.id}: fixed 无 value`)
      if (t === 'stacked') {
        if (!Number.isFinite(e.valuePerStack)) bad.push(`${e.id}: stacked 无 valuePerStack`)
        if (!Number.isFinite(e.maxStacks)) bad.push(`${e.id}: stacked 无 maxStacks`)
        if (e.value != null && e.value !== e.valuePerStack) bad.push(`${e.id}: value=${e.value} ≠ valuePerStack=${e.valuePerStack}`)
        if (e.defaultStacks != null && e.defaultStacks > e.maxStacks) bad.push(`${e.id}: defaultStacks > maxStacks`)
      }
    }
    expect(bad).toEqual([])
  })

  it('modificationValues：长度 5，第 1 项等于基础字段', () => {
    const bad: string[] = []
    let n = 0
    for (const e of effects) {
      for (const [k, arr] of Object.entries<any>(e.modificationValues ?? {})) {
        n++
        if (!Array.isArray(arr) || arr.length !== 5) bad.push(`${e.id}.${k}: len=${arr?.length}`)
        else if (e[k] != null && arr[0] !== e[k]) bad.push(`${e.id}.${k}: [0]=${arr[0]} ≠ ${e[k]}`)
      }
    }
    expect(n).toBeGreaterThan(150)
    expect(bad).toEqual([])
  })
})

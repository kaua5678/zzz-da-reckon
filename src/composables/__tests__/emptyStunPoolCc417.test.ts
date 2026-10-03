import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'

/**
 * CC-417（T12）：没有任何失衡贡献行 ≠ 没有结果。
 *
 * 原 `convergence.ts` 在 `baseStun.length === 0` 时 `return null`（2026-08-18 初始提交遗留），生产里
 * 单人支援/防护默认 `basicAttackTimeWeight = 0` ⇒ 无平A行 ⇒ 只剩终结技（无失衡贡献）⇒ 整个
 * resourceResult / 伤害池 / 能量账消失。现在：失衡池给 stunCount 0，伤害池照常出行。
 * 反空洞：① 终结技行真实出现且次数 > 0；② 伤害池非空；③ 失衡池存在且 stunCount === 0（证明走的是空池路径）；
 * ④ 结果里没有 NaN（递归找，不用 JSON.stringify——它把 NaN 变 null，和合法 null 字段分不开）。
 */
function nanPaths(v: unknown, path = '$', out: string[] = [], seen = new Set<unknown>()): string[] {
  if (typeof v === 'number') { if (Number.isNaN(v)) out.push(path); return out }
  if (!v || typeof v !== 'object' || seen.has(v)) return out
  seen.add(v)
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) nanPaths(x, `${path}.${k}`, out, seen)
  return out
}

describe('CC-417 空失衡池不吞掉整轮结果', () => {
  it('单人耀嘉音（支援，生产口径 weight 0）：有 resourceResult / 伤害池，失衡池 stunCount 0，无 NaN', async () => {
    const { config } = await setupHarness([{ agentId: '1311' }, '', ''], { productionBasicWeights: true })
    expect(config.team[0]!.basicAttackTimeWeight, '前提：生产口径下支援 weight 0').toBe(0)
    const calc = useResourceCalc()
    const r = calc.resourceResult.value
    expect(r, 'resourceResult 不应为 null').toBeTruthy()
    const ch = r!.characters.find(c => c.agentId === '1311')!
    expect(ch.timeAllocation.basicAttackTime ?? 0, '无平A池（空失衡池的成因）').toBe(0)
    const ult = ch.executions.find(e => e.moveId === '1311008')
    expect(ult && ult.count, '终结技行真实出现').toBeGreaterThan(0)
    expect(calc.damagePoolRows.value.length, '伤害池非空').toBeGreaterThan(0)
    expect(calc.stunPoolResult.value, '失衡池存在').toBeTruthy()
    expect(calc.stunPoolResult.value!.stunCount, '空失衡池 ⇒ stunCount 0').toBe(0)
    expect(nanPaths([r, calc.damagePoolRows.value, calc.stunPoolResult.value]), '结果里不得有 NaN').toEqual([])
  })
})

/**
 * CC-418（arena-F r445）形状锁：「null 轮」概念退役。
 *
 * 背景：CC-417 删掉 `convergence#runCalcRound` 的空失衡池 `return null` 后，剩余唯一 null 出口
 * `if (!base || !catalogStore.ready) return null` 与 `useResourceCalc#calcOutput` 的前置守卫同条件、
 * 同一次同步求值内不可达 ⇒ `runCalcRound` 恒非 null。于是 solveTeam 的 null 轮分支
 * （`threadsAfterNullRound` 回退 + 签名清空 + continue）与 ~15 处 `CalcRoundResult | null` 防御全是死代码。
 * 本锁防止它们被"顺手"加回来（加回来 = 类型层重新承认一个不存在的状态）。
 *
 * 反空洞：三个断言都针对真实源码片段；若将来确实需要 null 轮（新的合法 null 出口），
 * 应先在 docs/mcp-architecture-r5-design-cards.md 开新 CC 卡再改本锁。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as roundThreads from '@/composables/resourceCalc/roundThreads'

const read = (rel: string) => readFileSync(resolve(__dirname, '..', 'resourceCalc', rel), 'utf-8')

describe('CC-418 runCalcRound 非 null 化 / null 轮退役', () => {
  it('roundThreads 不再导出 threadsAfterNullRound（线程只经 initialCalcRoundThreads 起始、threadsNext 推进）', () => {
    expect((roundThreads as Record<string, unknown>).threadsAfterNullRound).toBeUndefined()
    expect(typeof roundThreads.initialCalcRoundThreads).toBe('function')
  })

  it('convergence#runCalcRound 签名返回 CalcRoundResult（非 `| null`）', () => {
    const src = read('convergence.ts')
    expect(src).toMatch(/function runCalcRound\([^)]*\): CalcRoundResult \{/)
    expect(src).not.toMatch(/function runCalcRound\([^)]*\): CalcRoundResult \| null/)
  })

  it('solveTeam：SolveTeamResult.out 非 null，且源码无 null 轮分支', () => {
    const src = read('solveTeam.ts')
    expect(src).toMatch(/export interface SolveTeamResult \{[\s\S]*?\n  out: CalcRoundResult\n/)
    expect(src).not.toContain('out: CalcRoundResult | null')
    expect(src).not.toMatch(/\bthreadsAfterNullRound\s*\(/)
    expect(src).not.toMatch(/\bout\?\./)
  })

  it('CC-419：SolveTeamInput.resourceConfig 非 null（calcOutput 守卫后显式下传），函数体无 `resourceConfig?.`', () => {
    const src = read('solveTeam.ts')
    expect(src).toMatch(/export interface SolveTeamInput \{[\s\S]*?\n  resourceConfig: ResourceCalcConfig\n/)
    expect(src).not.toContain('resourceConfig: ResourceCalcConfig | null')
    // 只看代码行（头注释里保留着 CC-10 的搬迁史，提到过 `resourceConfig?.`）
    const codeLines = src.split('\n').filter(l => !/^\s*(\*|\/\/|\/\*)/.test(l))
    expect(codeLines.filter(l => l.includes('resourceConfig?.'))).toEqual([])
    const orch = readFileSync(resolve(__dirname, '..', 'useResourceCalc.ts'), 'utf-8')
    expect(orch).toMatch(/function computeCalcOutput\(base: ResourceCalcConfig\)/)
  })

  it('CC-421：失衡池恒非 null——PromoteFixpointResult.pool 与 CalcRoundResult.stunPool 都不带 `| null`', () => {
    const up = read('ultimatePromote.ts')
    expect(up).toMatch(/export interface PromoteFixpointResult \{[\s\S]*?\n  pool: StunPoolResult\n/)
    expect(up).not.toContain('pool: StunPoolResult | null')
    const rr = read('roundResult.ts')
    expect(rr).toMatch(/export interface CalcRoundResult \{[\s\S]*?\n    stunPool: StunPoolResult\n/)
    expect(rr).not.toContain('stunPool: StunPoolResult | null')
    // 消费端不再对池做可选链（prev 为 null 的 `prev?.stunPool` 是对 prev 的判空，不在此列）
    for (const f of ['convergence.ts', 'solveTeam.ts', 'ultimatePromote.ts']) {
      const src = read(f)
      expect(src.split('\n').filter(l => !/^\s*(\*|\/\/|\/\*)/.test(l) && /\bstunPool\?\.|\bpool\?\./.test(l)), f).toEqual([])
    }
  })
})

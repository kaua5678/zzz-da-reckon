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

  it('CC-422：adjustedResourceResult 恒非 null——applyUltimatePromote / applyChainGift 入参与返回都不带 `| null`，convergence 无 `adj1 ?? rr` 兜底', () => {
    const up = read('ultimatePromote.ts')
    expect(up).toMatch(/export function applyUltimatePromote\(\n  base: TeamResourceResult,\n/)
    expect(up).toMatch(/\): TeamResourceResult \{\n/)
    expect(up).not.toContain('): TeamResourceResult | null {')
    const cg = read('chainGift.ts')
    expect(cg).toMatch(/export function applyChainGift\(\n  base: TeamResourceResult,\n/)
    expect(cg).not.toContain('): TeamResourceResult | null {')
    const rr = read('roundResult.ts')
    expect(rr).toMatch(/export interface CalcRoundResult \{[\s\S]*?\n    adjustedResourceResult: TeamResourceResult\n/)
    expect(rr).not.toContain('adjustedResourceResult: TeamResourceResult | null')
    const cv = read('convergence.ts')
    for (const dead of ['adj1 ?? rr', 'adj2 ?? adj1', 'adj0 ? extractAnomalyExecsFrom', 'adj2 ? extractAnomalyExecsFrom']) {
      expect(cv, dead).not.toContain(dead)
    }
  })

  it('CC-423：异常池恒非 null——calcAnomalyPoolInput 无空集 null 出口，CalcRoundResult.anomalyPool 不带 `| null`，流水线消费端无 `anomalyPool?.`', () => {
    const ri = read('roundInputs.ts')
    expect(ri).toMatch(/function calcAnomalyPoolInput\([^)]*\): AnomalyPoolResult \{\n/)
    expect(ri.split('\n').filter(l => !/^\s*(\*|\/\/|\/\*)/.test(l) && l.includes('execs.length === 0'))).toEqual([])
    const rr = read('roundResult.ts')
    expect(rr).toMatch(/export interface CalcRoundResult \{[\s\S]*?\n    anomalyPool: AnomalyPoolResult\n/)
    expect(rr).not.toContain('anomalyPool: AnomalyPoolResult | null')
    for (const f of ['convergence.ts', 'solveTeam.ts', 'outerCycle.ts']) {
      const src = read(f)
      expect(src.split('\n').filter(l => !/^\s*(\*|\/\/|\/\*)/.test(l) && /\banomalyPool\?\.|\bap[01]\?\./.test(l)), f).toEqual([])
    }
  })

  it('CC-434（T13-b′）：模块钩子契约 AgentNextRoundFeedbackInput.anomalyPool 不带 `| null`，反馈钩子无 `anomalyPool?.`，夹具不再传 null', () => {
    const hooks = readFileSync(resolve(__dirname, '../../mechanics/typesHooks.ts'), 'utf-8')
    expect(hooks).toMatch(/\n  anomalyPool: DeepReadonly<AnomalyPoolResult>\n/)
    expect(hooks).not.toContain('anomalyPool: DeepReadonly<AnomalyPoolResult> | null')
    // 反馈钩子函数体（`function <x>NextRoundFeedback(` 到下一个顶层 `}`）内不得再出现 `anomalyPool?.`；
    // remielle / alice 在**行上下文**（typesRows DamagePoolContext.anomalyPoolResult，另一层、仍可 null）里的 `anomalyPool?.` 不在本锁范围。
    for (const m of ['promia', 'remielle', 'yixuan', 'vivian', 'ellen']) {
      const src = readFileSync(resolve(__dirname, `../../mechanics/agents/${m}.ts`), 'utf-8')
      const body = src.match(/\nfunction \w+NextRoundFeedback\([\s\S]*?\n\}\n/g) ?? []
      expect(body.length, m).toBeGreaterThan(0)
      expect(body.join('').includes('anomalyPool?.'), m).toBe(false)
    }
    for (const t of ['remielle', 'burnice', 'jane', 'nextRoundFeedback', 'nextRoundFeedbackR19', 'nextRoundFeedbackR20']) {
      const src = readFileSync(resolve(__dirname, `../../mechanics/__tests__/${t}.test.ts`), 'utf-8')
      expect(src.includes('anomalyPool: null'), t).toBe(false)
    }
  })

  it('CC-435（T13-d）：AgentNextRoundFeedbackInput.adjustedResult 必填非 null；typesHooks.ts 整文件无 `| null`；yeshuguang / anbyZero 无 `adjustedResult ?? teamResult`', () => {
    // typesHooks 的钩子入参全部来自流水线；流水线自 CC-418~423 起无 null 轮 / null 池 / null 调整结果。
    // 新增合法 null 入参前先开 CC 卡再改本锁。
    const hooks = readFileSync(resolve(__dirname, '../../mechanics/typesHooks.ts'), 'utf-8')
    expect(hooks).toMatch(/\n  adjustedResult: DeepReadonly<TeamResourceResult>\n/)
    expect(hooks.split('\n').filter(l => !/^\s*(\*|\/\/|\/\*)/.test(l) && l.includes('| null'))).toEqual([])
    for (const m of ['yeshuguang', 'anbyZero']) {
      const src = readFileSync(resolve(__dirname, `../../mechanics/agents/${m}.ts`), 'utf-8')
      expect(src.includes('adjustedResult ?? teamResult'), m).toBe(false)
    }
    const pp = read('panelPhases.ts')
    expect(pp).toMatch(/\n  adjustedResult: AgentNextRoundFeedbackInput\['adjustedResult'\]\n/)
  })

  it('CC-436（T13-e）：displayResult 必填（反馈入参再无结果类可选字段）；promia 无 `displayResult ?? teamResult`', () => {
    const hooks = readFileSync(resolve(__dirname, '../../mechanics/typesHooks.ts'), 'utf-8')
    expect(hooks).toMatch(/\n  displayResult: DeepReadonly<TeamResourceResult>\n/)
    // 反馈入参接口体内三份结果都必填：teamResult / displayResult / adjustedResult 均无 `?:`
    const iface = hooks.match(/export interface AgentNextRoundFeedbackInput \{[\s\S]*?\n\}\n/)?.[0] ?? ''
    expect(iface.length).toBeGreaterThan(0)
    expect(iface.split('\n').filter(l => /^\s+(teamResult|displayResult|adjustedResult)\?:/.test(l))).toEqual([])
    const promia = readFileSync(resolve(__dirname, '../../mechanics/agents/promia.ts'), 'utf-8')
    expect(promia.includes('displayResult ?? teamResult')).toBe(false)
    expect(read('panelPhases.ts')).toMatch(/\n  displayResult: AgentNextRoundFeedbackInput\['displayResult'\]\n/)
  })
})

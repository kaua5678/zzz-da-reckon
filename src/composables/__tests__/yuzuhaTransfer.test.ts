/**
 * 十人十色转积蓄（yuzuha.ts + applyTeamMechanics 派发器 anomalyBuildupElementBySlot）护栏。
 *
 * 口径（2026-09-02，探针实证）：星见雅 agent.damageElement=ice 但招式级元素=frostfire——
 * 转积蓄必须落「队友招式的异常积储主元素」池（此前按 agent.damageElement 转进元素名
 * 不匹配的空池，雅队霜火池完全没收到转积蓄）；柚叶单发 17.6 积蓄 vs 异常角色数百/发，
 * 占比恒小 → 施加者判定不翻转（「转积蓄不参与施加者判定」的近似可成立，销债）。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'

describe('十人十色转积蓄：目标元素 = 队友招式级积储主元素', () => {
  it('雅(1091)+南宫羽(1511)+柚叶(1411)：花火行 element=frostfire，霜火池收到柚叶贡献且雅占比主导', async () => {
    await setupHarness([{ agentId: '1091' }, { agentId: '1511' }, { agentId: '1411' }])
    const calc = useResourceCalc()
    const chars = calc.resourceResult.value?.characters ?? []
    const yuzuha = chars.find(c => c.agentId === '1411')
    const firework = yuzuha?.executions.find(e => e.moveId === '1411020')
    expect(firework).toBeTruthy()
    // 转积蓄行 element = 雅招式级元素（frostfire），不是 agent 级 ice
    expect(firework?.element).toBe('frostfire')

    const frost = calc.anomalyPoolResult.value?.perElement.find(p => p.element === 'frostfire')
    expect(frost).toBeTruthy()
    const bySlot: Record<number, number> = {}
    for (const c of frost?.contributions ?? []) bySlot[c.slot] = (bySlot[c.slot] ?? 0) + c.totalBuildUp
    // 池收到柚叶(slot2)的转积蓄，且雅(slot0) 占比主导（施加者仍为雅，不翻转）
    expect(bySlot[2] ?? 0).toBeGreaterThan(0)
    expect(bySlot[0] ?? 0).toBeGreaterThan(bySlot[2] ?? 0)
  })
})

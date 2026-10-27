/**
 * 诺姆转连携 = **主C 的连携块**（用户口径 2026-10-27，逐字）：
 * > 「诺姆转连携其本体是主c的连携块，**不应该和普通连携有差别**。」
 *
 * 修前：`norma-hat-chain` 是 **0 时长纯标记块**——只给赠送连携行（`chainGift`）记轴内次数，
 * 自己不占窗口时间 ⇒ 同一件事两套读法：普通连携块吃掉窗口尾巴，标记块白嫖。
 * 修后：建块时按**受赠队友**连携技的 `actionTime` 收时间、落点也是该队友（与赠送行同源）。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { createConvergenceRoundInputs } from '@/composables/resourceCalc/roundInputs'
import { findChainAttack } from '@/core/resource/moveLookup'
import { fusedRowReader } from '@/data/moveTableQueries'
import { calcStunAxisStack, type StackAxisInput } from '@/core/stunAxisStack'

/** 单窗栈遍历：只关心「同族门」是否咬合 */
function calcStack(axes: StackAxisInput[], _catalog: unknown) {
  return calcStunAxisStack({ axes, stunCount: 1, windowDuration: 16 })
}

async function inputsOf(team: Array<{ agentId: string }>) {
  const { config, catalog } = await setupHarness(team)
  const calc = useResourceCalc()
  return {
    config,
    catalog,
    inputs: createConvergenceRoundInputs({ configStore: config, catalogStore: catalog, panels: calc.panels, resourceConfig: calc.resourceConfig }),
  }
}

describe('赠品连携同族每窗 ≤ 1（诺姆资源转化，和失衡独立）', () => {
  it('同一窗放两条赠品块 ⇒ 只执行 1 条，另一条记 skipped.family（不占时间、不扣资源）', async () => {
    const { catalog, inputs } = await inputsOf([{ agentId: '1571' }, { agentId: '1011' }, { agentId: '1211' }])
    const axes = [{
      name: 'gift',
      count: 1,
      actions: [
        { slot: 0, moveId: 'norma-hat-chain', count: 1 },
        { slot: 1, moveId: '1011010', count: 1, sourceTag: 'gift' },
      ],
      basicFillerSlot: 0,
    }] as never
    const built = inputs.buildStackAxes(axes)
    // 两种形态（旧标记块 / '·赠' 块）打的是**同一个族**，否则下面的引擎门禁形同虚设
    expect(built[0].actions.map(a => a.fillFamily)).toEqual(['gift-chain', 'gift-chain'])
    expect(built[0].actions.every(a => a.maxPerWindow === 1)).toBe(true)
    expect(built[0].actions.every(a => a.actionTime > 0)).toBe(true)

    const stack = calcStack(built, catalog)
    expect(stack.skipped.filter(s => s.reason === 'family')).toHaveLength(1)
    // 只执行一次 ⇒ 赠品连携在轴内至多 1 次（「一个轴内总量不大于 1」）
    const executedGift = Object.entries(stack.executed).filter(([k]) => k.includes('gift') || k.includes('norma-hat-chain'))
    expect(executedGift.reduce((s, [, v]) => s + v.count, 0)).toBe(1)
  })
})

describe('诺姆转连携 = 主C 的连携块（不是 0 时长标记）', () => {
  it('建块时按受赠队友连携技收时间，落点也是该队友', async () => {
    const { config, catalog, inputs } = await inputsOf([{ agentId: '1571' }, { agentId: '1011' }, { agentId: '1211' }])
    const axes = [{ name: 'hat', count: 1, actions: [{ slot: 0, moveId: 'norma-hat-chain', count: 1 }], basicFillerSlot: 0 }] as never
    const built = inputs.buildStackAxes(axes)
    const act = built[0].actions[0]
    expect(act.moveId).toBe('norma-hat-chain')
    // ① 不再白嫖时间：真实连携时长 > 0
    expect(act.actionTime).toBeGreaterThan(0)
    // ② 落点 = 受赠队友（不是诺姆自己）
    expect(act.slot).not.toBe(0)
    const recipient = config.team[act.slot]?.agentId ?? ''
    const skills = catalog.agentSkillsByAgentMap.get(recipient)
    expect(skills, '受赠队友必须有技能表').toBeTruthy()
    const chain = findChainAttack(skills!, fusedRowReader)
    expect(chain, '受赠队友必须有连携技').toBeTruthy()
    // ③ 与赠送行同源：时长 == 该队友连携技 actionTime（`chainGift.secondsPerUnit` 同口径）
    expect(act.actionTime).toBeCloseTo(chain!.actionTime, 6)
  })
})

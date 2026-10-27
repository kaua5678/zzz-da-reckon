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

async function inputsOf(team: Array<{ agentId: string }>) {
  const { config, catalog } = await setupHarness(team)
  const calc = useResourceCalc()
  return {
    config,
    catalog,
    inputs: createConvergenceRoundInputs({ configStore: config, catalogStore: catalog, panels: calc.panels, resourceConfig: calc.resourceConfig }),
  }
}

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

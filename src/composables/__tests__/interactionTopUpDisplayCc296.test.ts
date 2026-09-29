/**
 * CC-296：交互栏「弹刀 +N / 双反 +M」显示与模块补齐门控一致。
 * 修前两处问题叠加：
 * ① useResourceCalc#interactionTopUp 另要求轴模式 ⇒ 非轴 + 保底4喧响时交互栏不显示；
 * ② 弹刀补齐按「已含补齐喧响的 decibelHave」算缺口 ⇒ 13→0→13 的 2-环，外层停在「装了 13、下一轮算 0」的成员上，
 *    显示读的是下一轮量（0）而资源卡读的是已装量（13）。修法：显示改读已装量（CC-297 起为 calcOutput.threadsApplied.interactionTopUp）。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'

async function run(ultimate: number) {
  const { config } = await setupHarness([{ agentId: '1471' }, { agentId: '1481' }, { agentId: '1211' }] as any)
  config.useStunAxis = false
  config.setMechanicSetting('guarantee.ultimate', ultimate)
  const calc = useResourceCalc()
  const banyue = calc.resourceResult.value!.characters.find(c => c.agentId === '1471')!
  return { shown: calc.interactionTopUp.value, applied: banyue.banyueInteractionTopUp }
}

describe('CC-296 自动补齐显示门控与模块门控同源', () => {
  it('非轴 + 保底4喧响：补齐生效 ⇒ 交互栏显示同一数量', async () => {
    const { shown, applied } = await run(1)
    expect(applied?.parry ?? 0).toBeGreaterThan(0)
    expect(shown).toEqual({ slot: 0, parry: applied!.parry, dual: applied!.dual })
  })
  it('非轴 + 保底全关：模块不补 ⇒ 交互栏不显示', async () => {
    const { shown, applied } = await run(0)
    expect((applied?.parry ?? 0) + (applied?.dual ?? 0)).toBe(0)
    expect(shown).toBeNull()
  })
})

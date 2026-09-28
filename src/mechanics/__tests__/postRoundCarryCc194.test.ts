/**
 * CC-194：`applyTeamConfig({phase:'postRound'})` 的写入必须在下一轮生效。
 *
 * 旧实现在本轮末尾对本轮 `characters` 克隆派发 postRound，而 `runCalcRound` 每轮都从
 * `base.characters` 重新克隆 ⇒ 写入全部丢失：扳机冥狱（队友强特/终结/支援突击触发）在全部
 * 414 个普查上下文里恒为 0 行、安比影画4 电荷传导回能从未注入、千夏两个字段只写不读。
 * 修法（通用）：轮末只记录次数入参进 `threads.postRoundInput`，下一轮 converge 前对新克隆派发。
 * 单测直调钩子看不见这个接线断点，故用 harness 真队伍钉住。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'

describe('CC-194 postRound 写入跨轮生效', () => {
  it('扳机冥狱：队友有强特/终结 ⇒ 冥狱行存在，且连射 = 3 × 终结一击', async () => {
    await setupHarness(['1461', '1521', '1361'].map(agentId => ({ agentId })), { recommendedBuild: true })
    const rr = useResourceCalc().resourceResult.value
    const trigger = rr?.characters.find(c => c.agentId === '1361')
    const countOf = (id: string) => (trigger?.executions ?? [])
      .filter(e => e.moveId === id).reduce((s, e) => s + (e.count ?? 0), 0)
    const finisher = countOf('1361022')
    expect(finisher).toBeGreaterThan(0)
    expect(countOf('1361020')).toBe(finisher * 3)
  }, 120000)
})

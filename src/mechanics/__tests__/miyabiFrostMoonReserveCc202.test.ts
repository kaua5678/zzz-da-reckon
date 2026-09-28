/**
 * CC-202：雅霜月时间经 `extraNecessaryAction` 只预留（无 moveId、含合轴率），行仍由 buildMiyabiExecutions 产出。
 * 断言：① 用引擎最后一次 buildExecutions 的 cfg/state 调预留函数，与实际霜月行逐项一致（次数 / 单次时长 / 合轴率）；
 * ② 预留不带 moveId（带上会被引擎再补一遍行 ⇒ 双计）；③ 每个霜月 moveId 恰好一行。
 */
import { describe, expect, it, vi } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { useConfigStore } from '@/stores/config'
import { miyabiMechanic, miyabiFrostMoonReserve } from '@/mechanics/agents/miyabi'

async function run(cinemaLevel: number) {
  await setupHarness(['', '', ''])
  const config = useConfigStore()
  ;['1091', '1131', '1211'].forEach((id, i) => config.setAgent(i, id))
  config.team[0].cinemaLevel = cinemaLevel
  const spy = vi.spyOn(miyabiMechanic, 'buildExecutions')
  const rr = useResourceCalc().resourceResult.value!
  const last = spy.mock.calls.at(-1)?.[0]
  spy.mockRestore()
  return { ch: rr.characters.find(c => c.agentId === '1091')!, last }
}

describe('CC-202 雅霜月时间预留', () => {
  it('能力已登记；无 state 返回 null', () => {
    expect(miyabiMechanic.extraNecessaryAction).toBe(miyabiFrostMoonReserve)
    expect(miyabiFrostMoonReserve({} as never, undefined)).toBeNull()
  })

  for (const cin of [0, 6]) {
    it(`c${cin}：预留与霜月行逐项一致，且不带 moveId、行不重复`, async () => {
      const { ch, last } = await run(cin)
      expect(last, 'spy 未捕获 buildExecutions 调用').toBeTruthy()
      const reserve = miyabiFrostMoonReserve(last!.cfg, last!.state) ?? []
      const ids = cin >= 6 ? ['1091029', '1091027', '1091028'] : ['1091029']
      expect(reserve.length).toBe(ids.length)
      ids.forEach((id, k) => {
        const rows = ch.executions.filter(e => e.moveId === id)
        expect(rows.length, id).toBe(1)
        expect(reserve[k].moveId, `${id} 预留不得带 moveId`).toBeUndefined()
        expect(reserve[k].count, id).toBe(rows[0].count)
        expect(reserve[k].actionTime, id).toBeCloseTo(rows[0].actionTime, 9)
        expect(reserve[k].comboAlignRatio, id).toBeCloseTo(rows[0].comboAlignRatio ?? 0, 9)
      })
    })
  }
})

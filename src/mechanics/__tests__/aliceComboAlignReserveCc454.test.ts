/**
 * CC-454 锁（2026-10-04 合轴归属审计 §2.2）：**爱丽丝星芒圆舞曲 #3 的合轴率必须进账本**。
 *
 * 修前的缺陷：模块把「合轴率使前台时间 = 1s」只写在**执行行**上（`exec.comboAlignRatio`），
 * 而引擎**不读行上的 comboAlignRatio** 去抵扣预算——`comboAlignCredit` 只由
 * `extraNecessaryAction`（雅 CC-202）或 `estimateExSpecialTime`（苍角）产出。
 * ⇒ 该比例是死数据：账本按全额 `次数 × 3.983s` 计必要时间，实测每队多占 18~21s 前台
 * （6 次队：模块 footer 自述前台 6.00s，引擎账本 92.65s）。
 *
 * 本文件钉死四件事：
 *  ① 能力已登记 + 无 state / 无剑意 ⇒ null（不产幽灵预留）；
 *  ② 预留与执行行**逐项一致**（次数 / 单次时长 / 合轴率同源，规则 11）；
 *  ③ 预留**不带 moveId**（带上会被引擎再补一遍行 ⇒ 双计）；
 *  ④ **端到端**：`comboAlignCredit` 真的等于 `次数 × actionTime × ratio`（这才是「进了账本」的判据，
 *     ①②③ 都可能在「预留函数写对了但没接线」时全绿）。
 *
 * 反证（已实测）：删掉 `aliceMechanic.extraNecessaryAction` 一行 ⇒ ④ 红（credit 回 0）。
 */
import { describe, expect, it, vi } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { useConfigStore } from '@/stores/config'
import { aliceMechanic, aliceSwordWillReserve } from '@/mechanics/agents/alice'

const SW3 = '1401012'
/** 爱丽丝 + 琉音 + 卢西娅：保证剑意有外部来源（强特/紊乱），次数 > 0 */
const TEAM = ['1401', '1481', '1451']

async function run(cinemaLevel = 0) {
  await setupHarness(['', '', ''])
  const config = useConfigStore()
  TEAM.forEach((id, i) => config.setAgent(i, id))
  config.team[0]!.cinemaLevel = cinemaLevel
  const spy = vi.spyOn(aliceMechanic, 'buildExecutions')
  const rr = useResourceCalc().resourceResult.value!
  const last = spy.mock.calls.at(-1)?.[0]
  spy.mockRestore()
  return { ch: rr.characters.find(c => c.agentId === '1401')!, last }
}

describe('CC-454 爱丽丝星芒圆舞曲 #3 合轴进账本', () => {
  it('能力已登记；无 state 返回 null', () => {
    expect(aliceMechanic.extraNecessaryAction).toBe(aliceSwordWillReserve)
    expect(aliceSwordWillReserve({} as never, undefined)).toBeNull()
  })

  for (const cin of [0, 6]) {
    it(`c${cin}：预留与执行行逐项一致，且不带 moveId`, async () => {
      const { ch, last } = await run(cin)
      expect(last, 'spy 未捕获 buildExecutions 调用').toBeTruthy()
      const reserve = aliceSwordWillReserve(last!.cfg, last!.state)
      const rows = ch.executions.filter(e => e.moveId === SW3)
      // 反空洞：本夹具必须真的产出了星芒圆舞曲行（否则下面的断言恒真）
      expect(rows.length, `${SW3} 执行行缺失，夹具前提失效`).toBe(1)
      expect(rows[0]!.count).toBeGreaterThan(0)
      expect(reserve, '剑意 > 0 时必须给账本预留').toBeTruthy()
      expect(reserve!.moveId, '预留不得带 moveId（带上会被引擎再补一遍行 ⇒ 双计）').toBeUndefined()
      expect(reserve!.count).toBe(rows[0]!.count)
      expect(reserve!.actionTime).toBeCloseTo(rows[0]!.actionTime, 9)
      expect(reserve!.comboAlignRatio).toBeCloseTo(rows[0]!.comboAlignRatio ?? 0, 9)
      // 比例必须与模块自述「前台 = 1s」一致（1 − 1/actionTime），且严格 > 0
      expect(reserve!.comboAlignRatio).toBeGreaterThan(0.5)
    })
  }

  it('端到端：comboAlignCredit 含星芒圆舞曲的合轴秒数（≈ 次数 × actionTime × ratio）', async () => {
    const { ch } = await run(0)
    const sw3 = ch.executions.find(e => e.moveId === SW3)
    expect(sw3, `${SW3} 执行行缺失`).toBeTruthy()
    const expected = sw3!.count * sw3!.actionTime * (sw3!.comboAlignRatio ?? 0)
    expect(expected, '星芒圆舞曲的合轴秒数必须 > 0（否则本锁恒真）').toBeGreaterThan(1)
    const credit = ch.timeAllocation.comboAlignCredit ?? 0
    // credit 还含通用项（终结技/连携等，本队为 0），故断言「≥ 本项」且「≈ 本项」
    expect(credit, '爱丽丝 credit 未含星芒圆舞曲的合轴（CC-454 回归：行上比例是死数据）')
      .toBeGreaterThanOrEqual(expected - 1e-6)
    expect(credit).toBeCloseTo(expected, 6)
  })
})

/**
 * CC-200：苍角强特子动作的账本估时与产行同源。
 * 原先账本只按通用强特时长预留，模块补的扇子第 2 击 / 风团 / 下砸 / 霜染冲刺 / 打年糕#3 全靠
 * timeBudgetExcess 事后折叠（雅-苍角-丽娜 实测 47.9s）。这里断言：真队伍里模块补行的时长合计
 * = 强特次数 × soukakuPerExExtraTime（缺省设置），且单测覆盖劈斩 / 小体型 / 1 击三个分支。
 *
 * CC-409：六段 actionTime 来自 cfg.moveActionTimes（引擎由 catalog 预填）；测试从 catalog 取真值构造。
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { mockStaticFetch, newPinia, setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { useConfigStore } from '@/stores/config'
import { useCatalogStore } from '@/stores/catalog'
import { moveActionTimesOf } from '@/data/moveTableQueries'
import {
  soukakuMechanic, soukakuPerExExtraTime,
} from '@/mechanics/agents/soukaku'

const MODULE_ROW_IDS = new Set(['1131010', '1131012', '1131013', '1131016', '1131006'])

// CC-409：从 catalog 取苍角全部招式 actionTime（= 引擎预填 cfg.moveActionTimes 的来源）
let T: Record<string, number> = {}
beforeAll(async () => {
  newPinia()
  mockStaticFetch()
  const catalog = useCatalogStore()
  await catalog.load()
  T = moveActionTimesOf(catalog.getAgentSkills('1131'))
})

describe('CC-200 苍角强特估时与产行同源', () => {
  it('真队伍（雅-苍角-丽娜）：模块补行 Σ时长 = 强特次数 × 每次补行秒数', async () => {
    await setupHarness(['', '', ''])
    const config = useConfigStore()
    ;['1091', '1131', '1211'].forEach((id, i) => config.setAgent(i, id))
    const rr = useResourceCalc().resourceResult.value!
    const ch = rr.characters.find(c => c.agentId === '1131')!
    // enrich 会按倍率表改写 moveName（两行扇子都叫「扇走蚊虫 #1」）⇒ 按顺序认：第 1 行 1131011 = 通用强特行，其后 = 模块第 2 击
    const fanRows = ch.executions.filter(e => e.moveId === '1131011')
    expect(fanRows.length).toBe(2)
    const rows = [...ch.executions.filter(e => MODULE_ROW_IDS.has(e.moveId ?? '')), ...fanRows.slice(1)]
    const slam = ch.executions.find(e => e.moveId === '1131012' || e.moveId === '1131013')!
    expect(slam.count).toBeGreaterThan(0)
    const sum = rows.reduce((s, e) => s + (e.totalTime ?? 0), 0)
    expect(sum).toBeCloseTo(slam.count * soukakuPerExExtraTime({ moveActionTimes: T }).necessaryTime, 6)
  })

  it('分支：缺省 / 劈斩 / 小体型 / 1 击', () => {
    const tail = T['1131016'] + T['1131006']
    expect(soukakuPerExExtraTime({ moveActionTimes: T }).necessaryTime)
      .toBeCloseTo(T['1131011'] + 2 * T['1131010'] + T['1131012'] + tail, 9)
    expect(soukakuPerExExtraTime({ moveActionTimes: T, 'setting:soukaku.chopSlam': 1 }).necessaryTime)
      .toBeCloseTo(T['1131011'] + 2 * T['1131010'] + T['1131013'] + tail, 9)
    expect(soukakuPerExExtraTime({ moveActionTimes: T, bodySize: 'small' }).necessaryTime)
      .toBeCloseTo(T['1131011'] + T['1131012'] + tail, 9)
    expect(soukakuPerExExtraTime({ moveActionTimes: T, 'setting:soukaku.exPressCount': 1 }).necessaryTime)
      .toBeCloseTo(T['1131010'] + T['1131012'] + tail, 9)
    expect(soukakuPerExExtraTime({ moveActionTimes: T }).comboAlignTime).toBeCloseTo(T['1131006'], 9)
  })

  it('estimateExSpecialTime = 通用强特 + floor(次数) × 补行', () => {
    const cfg = { exSpecialActionTime: 1.5, exSpecialComboAlignRatio: 0.2, moveActionTimes: T } as any
    const est = soukakuMechanic.estimateExSpecialTime!({ cfg, exSpecialCount: 8.4, ultimateCount: 0 })!
    const extra = soukakuPerExExtraTime(cfg)
    expect(est.necessaryTime).toBeCloseTo(8.4 * 1.5 + 8 * extra.necessaryTime, 9)
    expect(est.comboAlignTime).toBeCloseTo(8.4 * 1.5 * 0.2 + 8 * extra.comboAlignTime, 9)
  })
})

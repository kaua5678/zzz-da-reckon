/**
 * CC-200：苍角强特子动作的账本估时与产行同源。
 * 原先账本只按通用强特时长预留，模块补的扇子第 2 击 / 风团 / 下砸 / 霜染冲刺 / 打年糕#3 全靠
 * timeBudgetExcess 事后折叠（雅-苍角-丽娜 实测 47.9s）。这里断言：真队伍里模块补行的时长合计
 * = 强特次数 × soukakuPerExExtraTime（缺省设置），且单测覆盖劈斩 / 小体型 / 1 击三个分支。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { useConfigStore } from '@/stores/config'
import {
  soukakuMechanic, soukakuPerExExtraTime,
  SOUKAKU_FAN_ACTION_TIME, SOUKAKU_WIND_BALL_ACTION_TIME, SOUKAKU_SLAM_ACTION_TIME,
  SOUKAKU_CHOP_SLAM_ACTION_TIME, SOUKAKU_FROST_DASH_ACTION_TIME, SOUKAKU_FROST_BASIC3_ACTION_TIME,
} from '@/mechanics/agents/soukaku'

const MODULE_ROW_IDS = new Set(['1131010', '1131012', '1131013', '1131016', '1131006'])

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
    expect(sum).toBeCloseTo(slam.count * soukakuPerExExtraTime({}).necessaryTime, 6)
  })

  it('分支：缺省 / 劈斩 / 小体型 / 1 击', () => {
    const tail = SOUKAKU_FROST_DASH_ACTION_TIME + SOUKAKU_FROST_BASIC3_ACTION_TIME
    expect(soukakuPerExExtraTime({}).necessaryTime)
      .toBeCloseTo(SOUKAKU_FAN_ACTION_TIME + 2 * SOUKAKU_WIND_BALL_ACTION_TIME + SOUKAKU_SLAM_ACTION_TIME + tail, 9)
    expect(soukakuPerExExtraTime({ 'setting:soukaku.chopSlam': 1 }).necessaryTime)
      .toBeCloseTo(SOUKAKU_FAN_ACTION_TIME + 2 * SOUKAKU_WIND_BALL_ACTION_TIME + SOUKAKU_CHOP_SLAM_ACTION_TIME + tail, 9)
    expect(soukakuPerExExtraTime({ bodySize: 'small' }).necessaryTime)
      .toBeCloseTo(SOUKAKU_FAN_ACTION_TIME + SOUKAKU_SLAM_ACTION_TIME + tail, 9)
    expect(soukakuPerExExtraTime({ 'setting:soukaku.exPressCount': 1 }).necessaryTime)
      .toBeCloseTo(SOUKAKU_WIND_BALL_ACTION_TIME + SOUKAKU_SLAM_ACTION_TIME + tail, 9)
    expect(soukakuPerExExtraTime({}).comboAlignTime).toBeCloseTo(SOUKAKU_FROST_BASIC3_ACTION_TIME, 9)
  })

  it('estimateExSpecialTime = 通用强特 + floor(次数) × 补行', () => {
    const cfg = { exSpecialActionTime: 1.5, exSpecialComboAlignRatio: 0.2 } as any
    const est = soukakuMechanic.estimateExSpecialTime!({ cfg, exSpecialCount: 8.4, ultimateCount: 0 })!
    const extra = soukakuPerExExtraTime(cfg)
    expect(est.necessaryTime).toBeCloseTo(8.4 * 1.5 + 8 * extra.necessaryTime, 9)
    expect(est.comboAlignTime).toBeCloseTo(8.4 * 1.5 * 0.2 + 8 * extra.comboAlignTime, 9)
  })
})

/**
 * 赠送招式的时间账（诺姆「膛温换连携」赠链 / 琉音「好评转大」赠大）—— 2026-09-08 用户实测修复。
 *
 * 用户报告：诺姆入队后主C的时间 = 180s + 诺姆连携秒数。根因：赠送行由 `applyNormaHatChain` /
 * `applyLiuyinPromote` 在装配**之后**追加到目标槽执行计划，其时间已由 iterate 计入目标槽必要时间
 * （helpers.ts Step4 两处预留），但 `buildResourceResult` 的 ① 时间线截断上限 ② 前台展示
 * 都没算这份时间——于是其它行按「含赠送时间的账本」截断、再叠加赠送行（物化行超账本），
 * 资源卡「总计」= 战斗时间 + 赠送秒数（实测 猫又/诺姆/千夏 191.8s、希格莉德/诺姆/丽娜 188.8s、
 * 猫又/琉音/耀嘉音 183.8s，各多出赠送行秒数）。
 *
 * 口径：赠送招式是**真实耗时的招式**，占目标槽前台、进目标槽必要时间（与连携/终结技同口径）；
 * 前台展示 = Σ前台执行行 + 本槽赠送行时间，后台 = 战斗时间 − 前台。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { teamPresets } from '@/data/teamPresets'

/** 复现资源卡「总计」：Σ(前台行) + 后台 = 战斗时间（修复前 = 战斗时间 + 赠送秒数） */
async function cardTotals(presetId: string) {
  const preset = teamPresets.find(p => p.id === presetId)
  expect(preset, `预设 ${presetId} 存在`).toBeTruthy()
  const { catalog } = await setupHarness(['', '', ''])
  await catalog.loadBuildRecommendations()
  const config = useConfigStore()
  for (let i = 0; i < 3; i++) config.setAgent(i, preset!.team[i])
  config.applyTeamPreset(preset!.team as [string, string, string])
  const calc = useResourceCalc()
  const rr = calc.resourceResult.value!
  return {
    totalTime: rr.totalTime,
    /** 引擎账本侧预留的琉音赠大时间（轴模式按口径为 0，见 ENGINE_PIPELINE_GUIDE 坑19①） */
    reserved: rr.liuyinGiftTimeReserved ?? 0,
    axis: calc.stackTraversalResult.value != null,
    slots: rr.characters.map(c => {
      const rows = (c.executions ?? []).filter(e => (e.totalTime ?? 0) > 0)
      const sumFront = rows.reduce((s, e) => s + (e.totalTime ?? 0), 0)
      const gift = rows.filter(e => e.normaGiftChain || e.source === 'gift')
        .reduce((s, e) => s + (e.totalTime ?? 0), 0)
      return {
        agentId: c.agentId,
        cardTotal: sumFront + (c.timeAllocation.backstageTime ?? 0),
        allocFront: c.timeAllocation.frontlineTime ?? 0,
        backstage: c.timeAllocation.backstageTime ?? 0,
        sumFront,
        gift,
        ledger: (c.timeAllocation.necessaryTime ?? 0) + (c.timeAllocation.basicAttackTime ?? 0),
      }
    }),
  }
}

describe('赠送招式时间账（诺姆赠链 / 琉音赠大）', () => {
  it('诺姆入队：主C 资源卡总计 = 战斗时间（不再 = 180 + 赠链秒数），且赠送行时间在账本内', async () => {
    const r = await cardTotals('auto-1021-1571-1491') // 猫又 / 诺姆 / 千夏
    const main = r.slots[0]
    expect(main.gift, '主C 有诺姆赠链行').toBeGreaterThan(0)
    expect(main.cardTotal, `主C 资源卡总计 ${main.cardTotal.toFixed(1)}s`).toBeCloseTo(r.totalTime, 6)
    // 赠送行是真实耗时招式：前台展示含它、账本容得下它
    expect(main.allocFront).toBeCloseTo(main.sumFront, 6)
    expect(main.sumFront).toBeLessThanOrEqual(main.ledger + 1e-6)
    // 全队每槽自洽
    for (const s of r.slots) expect(s.cardTotal).toBeCloseTo(r.totalTime, 6)
  }, 180000)

  it('希格莉德/诺姆/丽娜：同一不变量（赠链 8.75s 不再叠加在 180s 上）', async () => {
    const r = await cardTotals('auto-1591-1571-1211')
    const main = r.slots[0]
    expect(main.gift).toBeGreaterThan(0)
    expect(main.cardTotal).toBeCloseTo(r.totalTime, 6)
    expect(main.sumFront).toBeLessThanOrEqual(main.ledger + 1e-6)
  }, 180000)

  it('琉音赠大（非诺姆）走同一时间账：猫又/琉音/耀嘉音 总计 = 180s', async () => {
    const r = await cardTotals('auto-1021-1481-1311')
    const main = r.slots[0]
    expect(main.gift, '主C 有琉音赠大行').toBeGreaterThan(0)
    expect(main.cardTotal).toBeCloseTo(r.totalTime, 6)
    expect(main.sumFront).toBeLessThanOrEqual(main.ledger + 1e-6)
  }, 180000)

  /**
   * 单一口径不变量（2026-09-10，时间系统重构·阶段1）：**账本侧预留 == 装配侧赠行**。
   * 这是「试探/折叠/装配同一套行测量」在赠行上的机器判据——两边各算一次就会漂
   * （轴模式正是漂了才需要 `probeExcludedTeam` 排除，见 ENGINE_PIPELINE_GUIDE 坑19①）。
   * 轴模式按口径不预留（`reserved=0`，赠行时间由轴窗口/carve 承担），故只断言非轴队。
   */
  it('账本预留 == 装配赠行时间（非轴琉音队，逐位相等）', async () => {
    for (const id of ['auto-1021-1481-1311', 'auto-1201-1481-1311', 'auto-1321-1481-1311', 'auto-1431-1481-1311']) {
      const r = await cardTotals(id)
      if (r.axis) continue // 轴模式不预留，见口径
      const gift = r.slots.reduce((s, x) => s + x.gift, 0)
      expect(gift, `${id} 有赠行`).toBeGreaterThan(0)
      expect(r.reserved, `${id}：账本预留 ${r.reserved} ≠ 装配赠行 ${gift}`).toBeCloseTo(gift, 6)
    }
  }, 180000)
})

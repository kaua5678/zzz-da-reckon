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
 *
 * ⚠ **`sumFront ≤ ledger` 的容差 = 引擎自己声明的收敛判据**（`TIME_FOLD_CONVERGENCE_SECONDS`，
 * 2026-09-20 R67）：该不变量**不是**精确恒等式，而是折叠环的收敛目标——环按 `maxExcess ≤ 1e-3`
 * 判「账本与物化行已自洽」停轮（见 `core/resource.ts:536` 与其 `@fact engine:折叠环上限`），
 * 即**引擎自己只保证到这个量级**。此处原写死 `1e-6`，比上游契约严 1000 倍 ⇒ 上游按契约停轮时
 * 本断言把「已收敛」读成「越界」（实测 `auto-1591-1571-1211` 差值 `9.968668e-4` 与引擎上报的
 * `convergence.timeBudgetResidualSeconds` `9.968668232716027e-04` **逐位相同** ⇒ 就是那个残差本身，
 * 不是赠送行被双计：双计的缺口会是赠链量级 8.75s，不会恰好等于环残差）。
 *
 * **修法 = 两级容差同源，不是「放宽到看不见」**（沿用坑 22 / 债 2 分诊 R32 刀 1 的先例：
 * 「上游放行的残差下游不得再当溢出；两级容差不一致曾把 ≤1.3ms 超出放大成砍 0.43~0.91s 整次动作」）：
 * 容差从常量引用（规则 11），并加**反空洞下限**——真缺口（≫1e-3，如赠送行整体双计）照旧红。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { teamPresets } from '@/data/teamPresets'
import { TIME_FOLD_CONVERGENCE_SECONDS } from '@/core/resource/timeTruncation'

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
    /** 诺姆赠链预留时间（对称字段，2026-09-10 加） */
    normaReserved: rr.normaGiftTimeReserved ?? 0,
    axis: calc.stackTraversalResult.value != null,
    slots: rr.characters.map(c => {
      const rows = (c.executions ?? []).filter(e => (e.totalTime ?? 0) > 0)
      const sumFront = rows.reduce((s, e) => s + (e.totalTime ?? 0), 0)
      const gift = rows.filter(e => e.normaGiftChain || e.source === 'gift')
        .reduce((s, e) => s + (e.totalTime ?? 0), 0)
      const normaGift = rows.filter(e => e.normaGiftChain).reduce((s, e) => s + (e.totalTime ?? 0), 0)
      return {
        agentId: c.agentId,
        cardTotal: sumFront + (c.timeAllocation.backstageTime ?? 0),
        allocFront: c.timeAllocation.frontlineTime ?? 0,
        backstage: c.timeAllocation.backstageTime ?? 0,
        sumFront,
        gift,
        normaGift,
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
    expect(main.sumFront).toBeLessThanOrEqual(main.ledger + TIME_FOLD_CONVERGENCE_SECONDS)
    // 全队每槽自洽
    for (const s of r.slots) expect(s.cardTotal).toBeCloseTo(r.totalTime, 6)
  }, 180000)

  it('希格莉德/诺姆/丽娜：同一不变量（赠链 8.75s 不再叠加在 180s 上）', async () => {
    const r = await cardTotals('auto-1591-1571-1211')
    const main = r.slots[0]
    expect(main.gift).toBeGreaterThan(0)
    expect(main.cardTotal).toBeCloseTo(r.totalTime, 6)
    expect(main.sumFront).toBeLessThanOrEqual(main.ledger + TIME_FOLD_CONVERGENCE_SECONDS)
    /**
     * ★ **反空洞下限**（必须与上一行成对）：容差取引擎常量后仍须能看见**真缺口**。
     * 本用例治的病是「赠链 8.75s 被叠加在 180s 上」⇒ 真缺口 ≥ 赠链量级（实测 8.75s）；
     * 而 `1e-3` 是环的**量化地板**（见文件头）。这里断言「实际差值 = 0 或落在量化地板内」，
     * 即：**任何达得到赠链量级的越界都会被上面那行抓住**——若不写这一条，将来把容差改成
     * `main.ledger * 2` 之类也不会红（容差断言对「放多大」是盲的）。
     */
    const gap = main.sumFront - main.ledger
    expect(gap, `实际缺口 ${gap.toExponential(3)} 必须 ≤ 量化地板 ${TIME_FOLD_CONVERGENCE_SECONDS}（真缺口 = 赠链量级 ${main.gift.toFixed(2)}s）`)
      .toBeLessThanOrEqual(TIME_FOLD_CONVERGENCE_SECONDS)
    expect(main.gift, '真缺口必须远大于量化地板，否则本用例的判别力退化').toBeGreaterThan(100 * TIME_FOLD_CONVERGENCE_SECONDS)
  }, 180000)

  it('琉音赠大（非诺姆）走同一时间账：猫又/琉音/耀嘉音 总计 = 180s', async () => {
    const r = await cardTotals('auto-1021-1481-1311')
    const main = r.slots[0]
    expect(main.gift, '主C 有琉音赠大行').toBeGreaterThan(0)
    expect(main.cardTotal).toBeCloseTo(r.totalTime, 6)
    expect(main.sumFront).toBeLessThanOrEqual(main.ledger + TIME_FOLD_CONVERGENCE_SECONDS)
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

  it('诺姆赠链：账本预留 == 装配赠行时间（对称判据）', async () => {
    for (const id of ['auto-1021-1571-1491', 'auto-1591-1571-1211']) {
      const r = await cardTotals(id)
      const gift = r.slots.reduce((s, x) => s + x.normaGift, 0)
      expect(gift, `${id} 有诺姆赠行`).toBeGreaterThan(0)
      expect(r.normaReserved, `${id}：账本预留 ${r.normaReserved} ≠ 装配赠行 ${gift}`).toBeCloseTo(gift, 6)
    }
  }, 180000)

  /**
   * 赠行由**引擎**物化（阶段1 ②，2026-09-10）后的两条保真判据。
   * 搬行时实测出三条分歧（池行提取不筛 gift / enrich 补空字段 / 目标槽推导），这里把
   * 后两条钉住——它们是「行为保真」的机器面，不是风格问题。
   */
  it('退化配置不产赠行：单角色扫描下「上一位队友」是空槽 → 行口径按编排层队长解析', async () => {
    for (const solo of ['1481', '1571']) {
      const { catalog } = await setupHarness(['', '', ''])
      await catalog.loadBuildRecommendations()
      const config = useConfigStore()
      config.setAgent(0, solo)
      const rr = useResourceCalc().resourceResult.value!
      const gifts = rr.characters.flatMap(c => (c.executions ?? [])
        .filter(e => e.source === 'gift' || e.normaGiftChain))
      expect(gifts, `${solo} 单角色不应物化赠行（否则 front 顶到 180，实测 golden 8 条 delta）`).toEqual([])
    }
  }, 180000)

  it('enrich 跳过赠行：琉音赠行不带 daze、诺姆赠行不带 skillDamageTarget（保真）', async () => {
    const giftRowsOf = async (id: string, pick: (e: { source?: string; normaGiftChain?: boolean }) => boolean) => {
      const { catalog } = await setupHarness(['', '', ''])
      await catalog.loadBuildRecommendations()
      const config = useConfigStore()
      const preset = teamPresets.find(p => p.id === id)!
      for (let i = 0; i < 3; i++) config.setAgent(i, preset.team[i])
      config.applyTeamPreset(preset.team as [string, string, string])
      const rr = useResourceCalc().resourceResult.value!
      return rr.characters.flatMap(c => (c.executions ?? []).filter(e => pick(e)))
    }
    const liuyinGift = await giftRowsOf('auto-1591-1481-1311', e => e.source === 'gift')
    expect(liuyinGift.length).toBeGreaterThan(0)
    for (const g of liuyinGift) {
      expect('dazeMultiplier' in g, '琉音赠行的 daze 由失衡池侧单独结算，行上刻意留空').toBe(false)
    }

    const normaGift = await giftRowsOf('auto-1021-1571-1491', e => e.normaGiftChain === true)
    expect(normaGift.length).toBeGreaterThan(0)
    for (const g of normaGift) {
      expect('skillDamageTarget' in g, '诺姆赠连携行刻意不写定向键（写了会吃连携定向增伤）').toBe(false)
    }
  }, 180000)
})

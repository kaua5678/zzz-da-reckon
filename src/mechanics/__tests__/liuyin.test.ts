import { describe, expect, it } from 'vitest'
import { computeLiuyinSource, computeLiuyinHugCounts, liuyinMechanic } from '@/mechanics/agents/liuyin'

describe('琉音好评/等效规则（用户确认）', () => {
  it('好评 = 60 + 0.6×接战秒 + 7.5×强特数（无命座）', () => {
    const s = computeLiuyinSource({
      exSpecialCount: 10,
      ultimateCount: 3,
      combatTime: 100,
      cinemaLevel: 0,
      extraAbilityActive: true,
      previousTeammateSlot: 1,
    })
    expect(s.goodReviewInitial).toBe(60)
    expect(s.goodReviewGainTotal).toBeCloseTo(100 * 0.6 + 10 * 7.5, 6)
    expect(s.goodReviewTotal).toBeCloseTo(60 + 60 + 75, 6)
    expect(s.goodReviewC1Multiplier).toBe(1)
  })

  it('1命好评回复 ×1.16（乘算到每秒与强特重击）', () => {
    const s = computeLiuyinSource({
      exSpecialCount: 10,
      ultimateCount: 0,
      combatTime: 100,
      cinemaLevel: 1,
      extraAbilityActive: true,
      previousTeammateSlot: 1,
    })
    expect(s.goodReviewPerSec).toBeCloseTo(0.6 * 1.16, 6)
    expect(s.goodReviewPerEx).toBeCloseTo(7.5 * 1.16, 6)
    expect(s.goodReviewTotal).toBeCloseTo(60 + (100 * 0.6 + 10 * 7.5) * 1.16, 6)
  })

  it('等效规则：转大次数（阈值结转），抱拳次数=转大+终结技次数', () => {
    const s = computeLiuyinSource({
      exSpecialCount: 10,
      ultimateCount: 4,
      combatTime: 120,
      cinemaLevel: 0,
      extraAbilityActive: true,
      previousTeammateSlot: 1,
    })
    // 好评 = 60 + 72 + 75 = 207 → 转大 2 次
    expect(s.promoteWindows).toBe(2)
    // 抱拳 = 2 + 4 = 6
    expect(s.farewellCount).toBe(6)
  })

  it('60/90 分配：60 受开窗次数与连携窗口夹紧，剩余走 90', () => {
    // 好评 207 → 开窗 2 次
    const h1 = computeLiuyinHugCounts(207, 5, -1, 8)
    expect(h1.hug60).toBe(2) // min(开窗2, 失衡5, 连携8)
    expect(h1.hug90).toBe(0)

    // 好评 207、无连携窗口 → 全走 90
    const h2 = computeLiuyinHugCounts(207, 5, -1, 0)
    expect(h2.hug60).toBe(0)
    expect(h2.hug90).toBe(2)

    // 好评 87（不满 90）→ 开窗 0 次，无法转大
    const h3 = computeLiuyinHugCounts(87, 5, -1, 8)
    expect(h3.hug60).toBe(0)
    expect(h3.hug90).toBe(0)

    // 好评 450、连携窗口 3 → 结转口径（2026-09-15 修）：60×3（余 270）→ 90×3（余 0）⇒ 共 6 窗
    // ⚠ 旧断言是 5（= floor(450/90) 预算上限模型）；两者差在「60 档省下的 30 点是否结转」，
    // 原文是「当[好评]**满90点**且…」逐次判定 ⇒ 结转，故 6。详见 computeLiuyinHugCounts 头注释。
    const h4 = computeLiuyinHugCounts(450, 2, -1, 3)
    expect(h4.hug60).toBe(3)
    expect(h4.hug90).toBe(3)

    // 上限：每次失衡最多 2 次 60 转大（用户口径 2026-09）——连携 10、失衡 2 → 60 转大被 2×2 封顶到 4
    // 结转口径下剩余 450−4×60=210 → 90×2=180，余 30 ⇒ 共 6 窗（旧断言 hug90=1/共 5）
    const h5 = computeLiuyinHugCounts(450, 2, -1, 10)
    expect(h5.hug60).toBe(4)
    expect(h5.hug90).toBe(2)
    expect(h5.remainingGoodReview).toBe(30)
  })
})

describe('琉音强特计划估时（2026-09-06 补）', () => {
  it('必要时间 = 三强特轮转 × 各自时长 + 送客（转大+终结技）× 送客时长；轴模式回落通用公式', () => {
    const cfg = {
      agentId: '1481',
      exSpecialActionTime: 0.617,
      exSpecialComboAlignRatio: 0,
      battleTime: 180,
      liuyinCinemaLevel: 0,
      liuyinExtraAbilityActive: false,
      liuyinPreviousTeammateSlot: 0,
      liuyinFarewellActionTime: 1.6,
    } as any
    // ex 20 → 轮转 (7,7,6)；好评 = 60 + 180×0.6 + 20×7.5 = 318 → 开窗 3；送客 = 3 + 2 = 5
    const est = liuyinMechanic.estimateExSpecialTime!({ cfg, exSpecialCount: 20, ultimateCount: 2 })!
    const exTime = 7 * 0.617 + 7 * 0.867 + 6 * 1.383
    expect(est.necessaryTime).toBeCloseTo(exTime + 5 * 1.6, 9)
    // 与物化同口径：buildExecutions 的 石头/剪刀/布/送客 行时间总和 == 估时
    const executions: any[] = []
    liuyinMechanic.buildExecutions!({
      cfg,
      state: { exSpecialCount: 20, ultimateCount: 2, basicAttackTime: 0 },
      executions,
    } as any)
    const rows = executions.filter((e: any) => ['1481011', '1481012', '1481013', '1481009'].includes(e.moveId))
    const rowTime = rows.reduce((a: number, e: any) => a + (e.totalTime ?? 0), 0)
    expect(rowTime).toBeCloseTo(est.necessaryTime, 9)
    // 轴模式（chainCountTotalOverride 注入）回落通用公式 = exSpecialCount × 单段
    const axisEst = liuyinMechanic.estimateExSpecialTime!({
      cfg: { ...cfg, chainCountTotalOverride: 4.2 },
      exSpecialCount: 20,
      ultimateCount: 2,
    })!
    expect(axisEst.necessaryTime).toBeCloseTo(20 * 0.617, 9)
  })
})

/**
 * 阈值结转口径（2026-09-15 修）—— 用户需求链③「好评≥390 = 90+60×5 ⇒ 6 窗」。
 *
 * 原文（`data/raw/nanoka_missing/full/1481.json` 核心被动）逐字：
 *   「当[好评]**满90点**且琉音…打开[连携技]窗口时…琉音消耗**60**点」
 *   「当[好评]**满90点**且…命中未打开[连携技]窗口的敌人时，将消耗**90**点」
 * ⇒ 每次开窗都要求**当刻** ≥90，扣 60/90 后**余额结转**，故计数是贪心推进而非
 *   `floor(总量/90)`（后者是「预算上限」，把预算当了次数）。
 *
 * 三条断言各盯一个失败模式：
 *  ① 有连携窗口时 390 ⇒ **6**（旧模型 4；这是本修正的唯一目的）；
 *  ② **无**连携窗口时两者**必须一致**（全走 90 ⇒ floor(G/90)）——防「顺手改成一律 +N」；
 *  ③ 任何输入都不超支（余额 = G − 花费 ≥ 0）——防贪心把好评花成负数。
 */
describe('琉音阈值结转口径（好评 → 开窗次数）', () => {
  it('★ 好评 390 + 连携窗口 ⇒ 6 窗（= 90 + 60×5，需求链③的算式）', () => {
    const r = computeLiuyinHugCounts(390, 4, -1, 6)
    expect(r.hug60 + r.hug90, '390 应开 6 窗').toBe(6)
    expect(r.hug60).toBe(6)          // 6×60 = 360 ≤ 390，余 30
    expect(r.hug90).toBe(0)
    expect(r.remainingGoodReview).toBe(30)
  })

  it('★ 无连携窗口时与旧口径一致（全走 90 ⇒ floor(G/90)）——防一律放大', () => {
    for (const G of [90, 180, 270, 390, 450, 540]) {
      const r = computeLiuyinHugCounts(G, 4, -1, 0)
      expect(r.hug60 + r.hug90, `G=${G} 无窗口`).toBe(Math.floor(G / 90))
    }
  })

  it('★ 预算安全：任意 (好评, 连携, 失衡) 组合都不超支', () => {
    for (const G of [90, 150, 207, 330, 390, 450, 540, 1000]) {
      for (const chain of [0, 1, 3, 6, 10]) {
        for (const stun of [1, 2, 4]) {
          const r = computeLiuyinHugCounts(G, stun, -1, chain)
          const spend = r.hug60 * 60 + r.hug90 * 90
          expect(spend, `G=${G} chain=${chain} stun=${stun} 超支`).toBeLessThanOrEqual(G)
          expect(r.remainingGoodReview).toBe(G - spend)
        }
      }
    }
  })
})

/**
 * ★ 跨层一致性：通用公式（非轴）与**轴预设声明**必须给出同一个开窗数。
 *
 * 这是 `core/resource.ts:222-224` 点名的「真收口 = 把轴 promote 计数线程化进 core」那条缺口的
 * **可观测判据**：原文「轴模式 promote 次数由轴预设决定、`liuyinGiftChainInfo` 回落通用公式
 * **会算错**」。阈值结转修正前实测分歧：10大轴声明 `60×4+90×1=5`，通用公式算 `60×4+90×0=4`
 * （floor 丢掉结转的 30 点）⇒ 同一队两条路径给出不同的转大次数。
 *
 * 本用例把「两口径一致」钉成机器判据 —— 将来谁改任一侧而不同步，这里立刻红。
 */
describe('★ 琉音跨层一致性：通用公式 vs 轴预设声明', () => {
  it('10大轴声明的 60/90 次数 = 通用公式（好评 390、连携 = 声明 60 档数）', async () => {
    const { stunAxisPresets } = await import('@/data/stunAxisPresets')
    const big10 = stunAxisPresets.find((x: { id: string }) => x.id === 'preset-1471-1481-*-fury5-ult10') as
      { axes?: Array<{ actions: Array<{ promoteVariant?: string; count: number }> }> } | undefined
    expect(big10, '10大轴预设应当存在（般琉卢的高难段）').toBeTruthy()
    let declared60 = 0
    let declared90 = 0
    for (const ax of big10!.axes ?? []) {
      for (const a of ax.actions) {
        if (a.promoteVariant === '60') declared60 += a.count
        else if (a.promoteVariant === '90') declared90 += a.count
      }
    }
    expect(declared60 + declared90, '轴预设应当声明转大次数').toBeGreaterThan(0)
    // 预设的 note 写着「好评≥390」，即该轴档的前提好评量
    const g = computeLiuyinHugCounts(390, 4, -1, declared60)
    expect(
      g.hug60 + g.hug90,
      `通用公式算 ${g.hug60 + g.hug90} 窗，轴预设声明 ${declared60 + declared90} 窗 —— 两口径必须一致（原缺口见本用例头注释）`,
    ).toBe(declared60 + declared90)
  })
})

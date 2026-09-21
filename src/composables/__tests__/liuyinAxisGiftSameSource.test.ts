/**
 * 琉音赠大的**轴模式四处同源**（R67，2026-09-20 用户口径落地）。
 *
 * ## 治的病（实测）
 *
 * `gift-chain:ultimate` 在轴模式下由编排层算好（`axisLiuyinPromote` = 轴声明的 `promoteVariant`
 * 块 + **剩余好评默认 90**），但模块供给带 `axisSuppressed` ⇒ 轴模式下 `crossAgentSupplyAt`
 * 恒返回 0。该量有**四处**消费点，旧实现里它们**各自决定**轴模式怎么办 ⇒ 漂成两派：
 *
 * | 消费点 | 位置 | 轴分支 |
 * |---|---|---|
 * | ① 账本必要时间预留 | `helpers.ts#iterate` | 旧：**漏计** |
 * | ② S2 折叠环 `rowTime` 测量 | `core/resource.ts` 折叠环 | 旧：**漏计** |
 * | ③ `frontlineRowsOf` 试探测量 | `core/resource.ts` | 已计入 |
 * | ④ `giftTimeOfSlot` 截断上限 | `core/resource.ts` | 已计入 |
 *
 * ④ 扣了而 ①② 不补 ⇒ **双重计费**：雨果 0 命轴 slot0 截断额度被扣 8.732s 而账本/折叠都没涨，
 * 决算行被整数装包砍掉一整次（5→4）。**只补①不补②也不行**——折叠环会把刚补的预留读成 idle，
 * 经 `timeBudgetRefund` 原样退回（净额仍 0，实测）。
 *
 * ## 判据设计（为什么断言这四个量而不是「跑一遍看绿」）
 *
 * 直接断言「决算行 = 5」只能覆盖雨果那一队的表象；本文件钉**不变量本身**：
 * 对全库含琉音的轴预设，`账本预留 == 装配赠行`（单一口径；`timeLedgerInvariants` 的 TOL=0.05
 * 是宽松版，这里是零容差版），并钉住**闸门**——「轴没声明 promoteVariant 块时不许发明转大次数」。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { teamPresets } from '@/data/teamPresets'
import { stunAxisPresets, cloneStunAxes } from '@/data/stunAxisPresets'

/** 装配侧赠行（琉音赠大）时间合计 —— 与「账本预留」对账的单一来源 */
function giftRowsOf(rr: NonNullable<ReturnType<typeof useResourceCalc>['resourceResult']['value']>) {
  return rr.characters.flatMap(c => (c.executions ?? [])
    .filter(e => e.source === 'gift' && !e.normaGiftChain)
    .map(e => ({ slot: c.slot, moveId: e.moveId, count: e.count ?? 0, time: e.totalTime ?? 0 })))
}

async function loadPreset(id: string) {
  const preset = teamPresets.find(p => p.id === id)
  expect(preset, `预设 ${id} 存在`).toBeTruthy()
  const { catalog } = await setupHarness(['', '', ''])
  await catalog.loadBuildRecommendations()
  const config = useConfigStore()
  for (let i = 0; i < 3; i++) config.setAgent(i, preset!.team[i])
  config.applyTeamPreset(preset!.team as [string, string, string])
  return useResourceCalc()
}

describe('R67 琉音赠大：轴模式四处同源', () => {
  /**
   * 轴模式队（含琉音）的**零容差**不变量：`liuyinGiftTimeReserved` == 装配赠行时间合计。
   *
   * 为什么零容差而 `timeLedgerInvariants` 是 0.05：那个测的是**三本账**（前台/行/账本）的
   * 跨路径一致，容差要吸收折叠环的量化地板（`TIME_FOLD_CONVERGENCE_SECONDS` = 1e-3，且
   * 水填分配会放大到 1e-2 量级）；而**预留 vs 赠行**是同一个量在两处的两次求值，只要同源
   * 就该逐位相等（非轴队的既有判据已用 `toBeCloseTo(..., 6)`，本条是它在轴侧的对称补全）。
   */
  it('轴模式：账本预留 == 装配赠行（零容差，全库含琉音预设）', async () => {
    const ids = teamPresets.filter(p => p.team?.includes('1481')).map(p => p.id)
    expect(ids.length, '含琉音的预设数（反空洞：扫不到队 = 探针坏）').toBeGreaterThanOrEqual(10)
    const checked: string[] = []
    for (const id of ids) {
      const calc = await loadPreset(id)
      const rr = calc.resourceResult.value
      if (!rr || calc.stackTraversalResult.value == null) continue // 只看轴模式队
      const reserved = rr.liuyinGiftTimeReserved ?? 0
      const gifts = giftRowsOf(rr)
      const giftTime = gifts.reduce((s, g) => s + g.time, 0)
      expect(reserved, `${id}：账本预留 ${reserved} ≠ 装配赠行 ${giftTime}（轴赠大没同源）`)
        .toBeCloseTo(giftTime, 9)
      // 赠行存在时预留必须非零（否则说明走了「不预留」旧路径 ⇒ post-hoc carve 兜底）
      if (gifts.length > 0) expect(reserved, `${id} 有赠行却没预留`).toBeGreaterThan(0)
      checked.push(id)
    }
    // 反空洞：必须真的覆盖到轴模式队（否则循环全 continue ⇒ 空绿）
    expect(checked.length, `实际检到轴模式队：${checked.join(', ')}`).toBeGreaterThanOrEqual(3)
  }, 600_000)

  /**
   * ★★ **闸门**：轴**没有**声明 `promoteVariant` 块时，不许用「剩余好评默认 90」发明转大次数。
   *
   * 用户口径的两句是**条件式**的：「轴模式下**显示制定了部分好评值的用途**，**剩余**好评应该默认 90」
   * ——「制定了部分用途」与「剩余」都预设了**轴里有声明**。轴一块都没声明时没有「剩余」可言。
   *
   * 实测反例（本闸门拦的形态）：雨果 0 命轴（`hugo-c0-e` 只有连携块 + 雨果自己的决算块
   * `1291_ex_verdict_final`，**零** promoteVariant）在无闸门时会被算法补出 4 次 90 抱拳
   * ⇒ 决算行从 5 砍到 4、`stunVulnSummary` 案例 B/D 红；R17c 甚至凭空多出一条赠行。
   */
  it('★ 闸门：轴未声明 promoteVariant 块 ⇒ 不补「剩余好评 90」（雨果 0 命轴）', async () => {
    const preset = stunAxisPresets.find(p => p.id === 'hugo-c0-e')
    expect(preset, 'hugo-c0-e 预设存在').toBeTruthy()
    // 前提：该预设确实零声明（若将来补了声明，本用例的前提失效，应改成声明版）
    const declared = (preset!.axes ?? []).flatMap(a => a.actions).filter(a => a.promoteVariant)
    expect(declared, '前提：hugo-c0-e 不含 promoteVariant 块').toEqual([])

    const { config } = await setupHarness(
      [{ agentId: '1291' }, { agentId: '1481' }, { agentId: '1161' }],
      { recommendedBuild: true },
    )
    config.autoYidhariAxis = false
    config.stunAxisPlans.splice(0)
    config.stunAxes.splice(0)
    config.useStunAxis = false
    config.setCinemaLevel(0, 0)
    config.stunAxes.push(...cloneStunAxes(preset!.axes!))
    config.useStunAxis = true
    const calc = useResourceCalc()
    const rr = calc.resourceResult.value
    expect(rr, '资源结果存在').toBeTruthy()
    // 闸门生效 ⇒ 无赠行、无预留（旧行为：凭空 4 次 90 抱拳 ⇒ 赠行 4 次 / 预留 8.732s）
    const gifts = giftRowsOf(rr!)
    expect(gifts, `轴零声明却产出赠行：${JSON.stringify(gifts)}`).toEqual([])
    expect(rr!.liuyinGiftTimeReserved ?? 0, '轴零声明却预留了赠大时间').toBe(0)
    // 决算行不被赠行挤出（坑36：轴栈说 5 就必须落地 5）
    const verdict = rr!.characters
      .flatMap(c => c.executions ?? [])
      .find(e => e.moveId === '1291_ex_verdict_final')
    expect(verdict?.count, '决算行被赠行挤出 ⇒ 截断额度被凭空扣除').toBe(5)
  }, 120_000)

  /**
   * 正控（与上面那条构成本用例的**成对判据**）：轴**有**声明时，剩余好评必须补 90。
   *
   * 只写「零声明 ⇒ 不补」会退化成「什么都不做也绿」；本条证明闸门开着的那一侧照常工作。
   * 夹具 = 希格莉德/琉音/耀嘉音（`希格莉德琉音.json` 声明 `1591016` promoteVariant 60×1）：
   * 好评 370.5 ⇒ 轴声明 60×3（3 窗加权）+ 余额 → 补 90 抱拳（`computeLiuyinHugCounts` 口径）。
   */
  it('正控：轴声明了 promoteVariant ⇒ 剩余好评补 90（希格莉德/琉音/耀嘉音）', async () => {
    const calc = await loadPreset('auto-1591-1481-1311')
    const rr = calc.resourceResult.value
    expect(rr, '资源结果存在').toBeTruthy()
    const gifts = giftRowsOf(rr!)
    expect(gifts.length, '声明了 promoteVariant 却无赠行').toBeGreaterThan(0)
    const reserved = rr!.liuyinGiftTimeReserved ?? 0
    expect(reserved, '声明了 promoteVariant 却没预留').toBeGreaterThan(0)
    // 同源（本条是上面全库扫描的单点复现，失败时给出更易读的读数）
    expect(reserved).toBeCloseTo(gifts.reduce((s, g) => s + g.time, 0), 9)
    // 「剩余好评默认 90」真的生效：转大次数 > 轴里字面声明的 1 次（否则 90 那一档没补上）
    const declared60 = (calc.effectiveStunAxes.value ?? [])
      .flatMap(a => a.actions).filter(a => a.promoteVariant === '60').reduce((s, a) => s + a.count, 0)
    expect(gifts.reduce((s, g) => s + g.count, 0), `转大次数应 > 轴声明 60 块数 ${declared60}（余额补了 90）`)
      .toBeGreaterThan(declared60)
  }, 200_000)
})

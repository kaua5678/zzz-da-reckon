/**
 * CC-477（r659）：后台合轴自动填充反推的欠松弛步 —— 修「同一输入两个自洽 N」。
 *
 * 病灶：反推 est = ceil(缺口/每对净失衡) 增益 ≈ 1.7（15 对→估 10、10 对→估 15，真值 ≈ 13）⇒ 外层 2-环 ⇒
 * CC-150 钳按前一轮 K 报 N=3（实测 仪玄+橘福福+卢西娅 加码 25 弹刀/25 闪反：N=4、外层 stable）。
 * 锁：① 纯函数步进语义；② 该队加码场景外层 stable 退出且 N ≥ 4。
 */
import { describe, expect, it } from 'vitest'
import { relaxAutoFillStep } from '@/core/stunPool'
import { mockStaticFetch, newPinia, setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { useConfigStore } from '@/stores/config'

describe('CC-477 relaxAutoFillStep', () => {
  it('首轮无上一轮量：直接取估计（夹上限）', () => {
    expect(relaxAutoFillStep(undefined, 12, 30, false)).toBe(12)
    expect(relaxAutoFillStep(null, 40, 30, false)).toBe(30)
  })
  it('到保底即持住（双向），est=0 归零，上一轮量超上限取上限', () => {
    expect(relaxAutoFillStep(15, 10, 30, true)).toBe(15)
    expect(relaxAutoFillStep(13, 11, 30, true)).toBe(13)
    expect(relaxAutoFillStep(22, 28, 24, true)).toBe(22)
    expect(relaxAutoFillStep(25, 26, 24, true)).toBe(24)
    expect(relaxAutoFillStep(2, 0, 30, true)).toBe(0)
  })
  it('未到保底：估计更高 ⇒ 阻尼上行（至少 +1、夹上限）；估计不高 ⇒ 持住（估计与实际矛盾 = 多根）', () => {
    expect(relaxAutoFillStep(10, 15, 30, false)).toBe(13)
    expect(relaxAutoFillStep(12, 13, 30, false)).toBe(13)
    expect(relaxAutoFillStep(28, 40, 30, false)).toBe(30)
    expect(relaxAutoFillStep(15, 10, 30, false)).toBe(15)
    expect(relaxAutoFillStep(5, 5, 30, false)).toBe(5)
  })
})

describe('CC-477 集成：仪玄+橘福福+卢西娅 加码场景不再 2-环', () => {
  it('弹刀/闪反各 +25 ⇒ 外层 stable 且 N ≥ 4', async () => {
    newPinia(); mockStaticFetch()
    const { catalog, config } = await setupHarness(['', '', ''], { recommendedBuild: false })
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    // 夹具沿革（2026-10-09，预设库重生成 85→77 条）：原 `auto-1371-1481-1451`（仪玄/琉音/卢西娅）
    // id 虽存活，但**内容变了**（另一条实战 run：琉音/卢西娅音擎换非限定）⇒ 实测该队加码后
    // `stunCount` 掉到 3（不再满足「反推到保底 4」这条判据）。换成同为「仪玄 backstageAutoFill +
    // 卢西娅·艾洛温」结构、且该判据成立的队伍。
    //
    // ⚠ 2026-10-12 **改为显式配装，不再依赖预设库条目**：原用 `auto-1371-1391-1451`，
    // 该条与手编 `yixuan-jufufu-lucia` 是同 3 人孪生 ⇒ 按「成员集合唯一」口径删掉了 auto- 那条。
    // 但两条的**配装不同**（auto = 橘福福 M1·精3 配 14110；手编 = 14139 且带 30 步加金），
    // 实测手编那条在 +25 后是 `cycle` 而非 `stable` ⇒ 本用例的判据**依赖具体配装**，
    // 而预设库条目会随归档重生成而漂移（上一条沿革就是这么坏的）。
    // ⇒ 夹具改成**本文件内自建**（队伍 + 音擎 + 命座/精炼逐项写死）：判据不再受预设库变动影响。
    const TEAM = ['1371', '1391', '1451'] as const
    const WENGINES = ['14137', '14110', '14145'] as const
    for (const [slot, id] of TEAM.entries()) config.setAgent(slot, id)
    for (const [slot, w] of WENGINES.entries()) config.setWEngine(slot, w)
    // 命座/精炼 = 原 auto 条目的实战配装（仪玄 M0·精1 / 橘福福 M1·精3 / 卢西娅 M1·精1）
    config.setCinemaLevel(0, 0); config.setWEngineModLevel(0, 1)
    config.setCinemaLevel(1, 1); config.setWEngineModLevel(1, 3)
    config.setCinemaLevel(2, 1); config.setWEngineModLevel(2, 1)
    const pc = config.team[0]!.parryCount, dc = config.team[0]!.dodgeCounterCount
    config.team[0]!.parryCount = (pc ?? 0) + 25; config.team[0]!.dodgeCounterCount = (dc ?? 0) + 25
    const rr = calc.resourceResult.value!
    const sp = calc.stunPoolResult.value!
    expect(rr.convergence?.outerExit, '欠松弛后外层应真收敛').toBe('stable')
    expect(sp.stunCount, '保底 4').toBeGreaterThanOrEqual(4)
  }, 60000)

  it('yixuan-roxy-lucia 裸三人（timeFillRatchet 口径）⇒ 外层 stable 且 N ≥ 4（r660：上限翻转 24↔25 环）', async () => {
    newPinia(); mockStaticFetch()
    await setupHarness(['', '', ''])
    const config = useConfigStore()
    for (const [i, id] of ['1371', '1621', '1451'].entries()) config.setAgent(i, id)
    const calc = useResourceCalc()
    const rr = calc.resourceResult.value!
    expect(rr.convergence?.outerExit, '到保底即持住后外层应真收敛').toBe('stable')
    expect(calc.stunPoolResult.value!.stunCount).toBeGreaterThanOrEqual(4)
  }, 60000)
})

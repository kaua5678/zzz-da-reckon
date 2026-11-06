import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { applyTeamToStore } from '@/composables/teamCompare'
import { teamPresets } from '@/data/teamPresets'
import { clearDifficultyLevers } from '@/composables/difficultyLadder'
import { bossAttackBudget, bossAttackPerSlotBudget } from '@/core/bossAttackBudget'
import { effectiveBattleTime } from '@/core/effectiveTime'

/**
 * **引擎自主推导**（交接验收 §6-2）：闪反填 81 时，交付的兑现量必须 ≤ boss 出手预算。
 *
 * 用户口径（逐字）：「我不希望判据决定错误，我希望**计算引擎用时间限制自主推导**出失衡的上限和溢出性。」
 * 「本质还是**前台闪反的产出太多了**」——修前 `dodgeCounterCount` 的界只有 UI 常量 `{0,99}`，
 * 零物理来源，于是 81 次闪反 = 63.4s 动作塞进 84s 非失衡（必要动作合计 133s，1.58×）。
 *
 * ⚠ 这里断言的是**引擎兑现量**（执行行 count），不是「有没有报错」——
 * 推导的语义就是「算出来装不下 ⇒ 只交付装得下的量」，而不是判红。
 */
describe('引擎按时间账推导交互上限（不是判据）', () => {
  async function measure(slot0Dodge: number) {
    const { config } = await setupHarness(['', '', ''], { productionBasicWeights: true } as any)
    const calc = useResourceCalc()
    const preset = teamPresets.find(x => x.id === 'auto-1611-1141-1211')!
    clearDifficultyLevers({ config, calc })
    applyTeamToStore(config, preset)
    config.team[0]!.parryCount = slot0Dodge > 0 ? 1 : 0
    config.team[0]!.dodgeCounterCount = slot0Dodge
    config.team[1]!.parryCount = 2
    await new Promise(r => setTimeout(r, 150))
    const rr = calc.resourceResult.value!
    const pool = calc.stunPoolResult.value!
    const eff = effectiveBattleTime(config.enemy as any)
    const W = calc.windowDuration?.value ?? 0
    /**
     * 预算分母 = **本轮引擎实际排布的窗数**（`rr.plannedStunCount`）—— 与引擎内部
     * `convergence` 的 `budgetWindows` **同一个数**。
     *
     * ⚠ 不要用池次数 `pool.stunCount`：池回答「攒出了几次」，它可远大于本轮真排的窗数
     * （雨果 `hugo-c0-e` 轴：池 11 vs 计划 3.93），拿它算会得到一个**引擎从没用过**的预算。
     */
    const plannedStunCount = rr.plannedStunCount
    const stunSeconds = Math.min(eff, plannedStunCount * W)
    const nonStun = eff - stunSeconds
    /**
     * ⚠ 2026-11-06 起有**两条尺**：全队池 floor(非失衡/3) 与单人 floor(非失衡/4)。
     * 本队只压槽0一个槽 ⇒ 生效的是 **min(两者)**。读同一个 `core/bossAttackBudget`，不另造尺。
     */
    const teamBudget = bossAttackBudget(nonStun)
    const slotBudget = bossAttackPerSlotBudget(nonStun)
    const budget = Math.min(teamBudget, slotBudget)
    const s0 = rr.characters.find(c => c.slot === 0)!
    const dodgeRow = s0.executions.find(e => e.category === 'dodge')
    return { config, calc, rr, pool, eff, W, stunSeconds, budget, teamBudget, slotBudget, nonStun,
      delivered: dodgeRow?.count ?? 0 }
  }

  it('★ 闪反填 81 ⇒ 引擎只兑现 ≤ 预算（不再打出 63.4s 的闪反）', async () => {
    const m = await measure(81)
    expect(m.budget, '前置：本夹具的预算必须真的小于 81（否则测不到夹取）').toBeLessThan(81)
    expect(m.delivered, '引擎兑现的闪反次数不得超过 boss 出手预算').toBeLessThanOrEqual(m.budget + 1e-9)
    expect(m.delivered).toBeLessThan(81)
    // 2026-11-06 口径：单槽场景下生效的是「单人 /4」（它恒 ≤ 全队 /3）
    expect(m.slotBudget).toBeLessThanOrEqual(m.teamBudget)
    // 推导而非判据：计算照常完成、不抛错、不返回非法值
    expect(Number.isFinite(m.calc.teamTotalDamage.value)).toBe(true)
    expect(m.rr.convergence.timeTruncatedSeconds ?? 0).toBeLessThanOrEqual(1)
  }, 900000)

  it('小数量（20 次，未超预算）⇒ 逐位保留用户输入（推导只在算不过来时才生效）', async () => {
    const m = await measure(20)
    expect(m.budget).toBeGreaterThanOrEqual(20)
    expect(m.delivered).toBe(20)
  }, 900000)

  it('★ 博弈论意义上的「装得下」：兑现的闪反 × 单次耗时 ≤ 非失衡时间', async () => {
    const m = await measure(81)
    const perDodge = 0.6
    expect(m.delivered * perDodge).toBeLessThanOrEqual(m.eff - m.stunSeconds + 1e-6)
  }, 900000)

  it('反空洞：不改 store（用户输入原样保留，推导只在引擎内部兑现）', async () => {
    const m = await measure(81)
    expect(m.config.team[0]!.dodgeCounterCount, '用户填的值不许被引擎写改').toBe(81)
  }, 900000)
})
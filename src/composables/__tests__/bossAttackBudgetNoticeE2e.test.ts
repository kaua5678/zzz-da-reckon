import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { applyTeamToStore } from '@/composables/teamCompare'
import { teamPresets } from '@/data/teamPresets'
import { clearDifficultyLevers } from '@/composables/difficultyLadder'
import { resourcePoolSnapshotFromCalc } from '@/composables/resourcePoolView'
import { bossAttackBudgetNoticeOfSnapshot } from '@/composables/bossAttackBudgetNotice'

/**
 * **「计算失真」提示 · 端到端**（交接验收 §6-4）：用户硬填极端值 ⇒ **只提示不拦**。
 *
 * 走**真实快照构造入口**（`resourcePoolSnapshotFromCalc`，与 `ResourcePoolView` 同一个函数）而不是手搓输入，
 * 这样快照字段缺失/口径漂移会在本用例里就红——页面只看渲染，判据在这里。
 *
 * 用户逐字：「关于用户硬填怎么算这个无所谓，**提醒了计算失真就行了，不用管错误计算的逻辑**。」
 */
describe('计算失真提示 · 端到端（只提示不拦）', () => {
  async function snapshotWith(dodge: number) {
    const { config } = await setupHarness(['', '', ''], { productionBasicWeights: true } as any)
    const calc = useResourceCalc()
    const preset = teamPresets.find(x => x.id === 'auto-1611-1141-1211')!
    clearDifficultyLevers({ config, calc })
    applyTeamToStore(config, preset)
    config.team[0]!.parryCount = 1
    config.team[0]!.dodgeCounterCount = dodge
    config.team[1]!.parryCount = 2
    await new Promise(r => setTimeout(r, 150))
    const snap = resourcePoolSnapshotFromCalc(calc, config)
    return { config, calc, snap }
  }

  it('★ 填 99 ⇒ 快照上出现提示，且点名「填了 99 / 预算 N / 兑现 M」', async () => {
    const { calc, snap } = await snapshotWith(99)
    expect(snap, '前置：快照必须构造成功').not.toBeNull()
    const notice = bossAttackBudgetNoticeOfSnapshot(snap!)
    expect(notice.show, '填 99 应触发计算失真提示').toBe(true)
    const m0 = notice.misses.find(x => x.slot === 0)!
    expect(m0).toBeDefined()
    // 该槽还有 parryCount = 1 ⇒ 两字段**合并计数** 99 + 1 = 100（2026-11-06 新口径）
    expect(m0.requestedTotal).toBe(100)
    expect(m0.requested.dodgeCounterCount).toBe(99)
    expect(m0.requested.parryCount).toBe(1)
    expect(m0.deliveredTotal, '被削到单人上限（非失衡/4）').toBe(m0.perSlotBudget)
    expect(m0.deliveredTotal).toBeLessThan(99)
    expect(notice.detail).toContain('99')
    /**
     * ★ **提示与引擎同源**（2026-11-05 缺陷的端到端锁）：引擎实际打出的闪反行次数必须等于
     * 提示里报的「实际兑现 N 次」。修前提示按覆盖率算 58、引擎按计划 K 兑现 66 ⇒ 页面自相矛盾。
     */
    const rr = calc.resourceResult.value!
    // 该槽的闪反兑现（逐 dodge 行相加；槽位号 ≠ 下标 ⇒ 用 find(slot)，见 AGENTS §2）
    const slot0 = rr.characters.find(c => c.slot === 0)!
    const engineDodge = slot0.executions.filter(e => e.category === 'dodge').reduce((a, e) => a + e.count, 0)
    expect(engineDodge, '前置：引擎真的兑现了（否则本条测不到）').toBeGreaterThan(0)
    expect(m0.delivered.dodgeCounterCount, '提示的「实际兑现」必须等于结果页那一行的次数').toBe(engineDodge)
  }, 900000)

  it('★ 只提示不拦：计算照常完成（有结果、伤害有限、无截断爆炸）', async () => {
    const { calc, snap } = await snapshotWith(99)
    expect(snap).not.toBeNull()
    expect(Number.isFinite(calc.teamTotalDamage.value)).toBe(true)
    expect(calc.teamTotalDamage.value).toBeGreaterThan(0)
    // 不锁死：结果照常给，只是交互兑现量按预算夹过
    expect(calc.resourceResult.value!.characters.length).toBeGreaterThan(0)
  }, 900000)

  it('反空洞：正常数量（20）⇒ 不提示（不给自交互路径加噪音）', async () => {
    const { snap } = await snapshotWith(20)
    const n = bossAttackBudgetNoticeOfSnapshot(snap!)
    expect(n.show).toBe(false)
  }, 900000)
})
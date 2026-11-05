import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { applyTeamToStore } from '@/composables/teamCompare'
import { teamPresets } from '@/data/teamPresets'
import { clearDifficultyLevers } from '@/composables/difficultyLadder'
import { getAgentMechanic } from '@/mechanics/registry'
import { capabilityGateMissesOf } from '@/composables/capabilityGateNotice'
import { lycaonHuntWindowSeconds, LYCAON_HUNT_FULL_SECONDS } from '@/mechanics/agents/lycaon'
import type { ActionCountField } from '@/stores/config'

/**
 * 莱卡恩（1141）围猎的**两条口径判据**（2026-11-04）：
 *
 * 1. **入场券**：`huntCount = min(失衡次数, 弹刀次数)` ⇒ 界面必须能报「围猎未启用 + 需要几次弹刀」
 *    （`capabilityGates` 声明，用户原话「没弹刀就没围猎……误认为莱卡恩弱就不透明了」）；
 * 2. **镜像闪反的时长预算**：镜像次数逐次跟着队友闪反走，但**受围猎窗口（8s × 次数）约束**——
 *    旧式只从平A预算里扣、闪反自身无上限，实测 81 次闪反 = 48.6s 动作塞进 2 次 16s 的围猎，
 *    后台闪反单独产 5.92 条失衡、总失衡 11 次 × 16s ≈ 176s/180s（交接 §二 E 判为**过建模**）。
 */

const FLAGSHIP = 'auto-1611-1141-1211'

/** 该队 + 指定槽0 闪反 / 槽1（莱卡恩）弹刀 */
async function setup(slot0Dodge: number, lycaonParry: number) {
  const { config } = await setupHarness(['', '', ''], { productionBasicWeights: true })
  const calc = useResourceCalc()
  const p = teamPresets.find(x => x.id === FLAGSHIP)!
  clearDifficultyLevers({ config, calc })
  applyTeamToStore(config, p)
  config.team[0]!.parryCount = slot0Dodge > 0 ? 1 : 0
  config.team[0]!.dodgeCounterCount = slot0Dodge
  config.team[1]!.parryCount = lycaonParry
  await new Promise(r => setTimeout(r, 90))
  const lycaon = calc.resourceResult.value!.characters.find(c => c.agentId === '1141')!
  const row = (moveId: string) => lycaon.executions.find(e => e.moveId === moveId)
  return { config, calc, lycaon, row, counts: (slot: number, field: ActionCountField) => Number(config.team[slot]?.[field] ?? 0) }
}

describe('1141 围猎 · 镜像闪反时长预算（2026-11-04）', () => {
  it('★ 极端闪反（槽0 = 81）：镜像次数被围猎窗口封顶，且窗口按连携/大招提前终止', async () => {
    const { config, lycaon, row, calc } = await setup(81, 2)
    const ice = row('1141027')
    const mirror = row('1141019')
    expect(ice, '弹刀 2 ⇒ 围猎应有冰舞行').toBeDefined()
    const huntCount = ice!.count / 2
    expect(huntCount).toBeCloseTo(2, 6)
    /**
     * 窗口 = `lycaonHuntWindowSeconds`（单一事实源）——**不是**裸 `8 × huntCount`：
     * 原文 1141508 说连携/终结技会**提前结束**围猎（用户 2026-11-04「进入失衡放连携或者大招就终止了」）。
     * 本队每窗连携/大招合计 `perWindow` 次 ⇒ 窗口 = `huntCount × 8 / (1 + perWindow)`。
     */
    const perWindow = config.team.reduce((s, c) => s + c.chainCountPerStun, 0)
    const windowSeconds = lycaonHuntWindowSeconds(huntCount, perWindow)
    expect(windowSeconds).toBeLessThan(huntCount * LYCAON_HUNT_FULL_SECONDS)
    /**
     * 窗口容量上界 = `floor(窗口 / 0.6s)`（镜像单次 0.6s）。
     *
     * ⚠ 测试侧只能算出「**只算连携**」的窗口，而引擎那份还要加**终结技**那一半
     * （`lycaonWindowUltimates`，由 `nextRoundFeedback` 上一轮产出）⇒ 引擎窗口 ≤ 本值。
     * 因此这里断言的是**上界**关系（可观测、不依赖测试复刻私有量）；
     * 「窗口 = 8/(1+n)、随 n 单调不增」由 `lycaonHuntWindow` 的纯函数单测精确锁。
     */
    const capUpper = Math.floor(windowSeconds / 0.6 + 1e-9)
    expect(capUpper, '前置：本夹具的窗口必须真的夹住镜像（否则本用例测不到封顶）').toBeLessThan(81)
    expect(mirror!.count, '镜像次数必须 ≤ 围猎窗口能装下的次数').toBeLessThanOrEqual(capUpper)
    expect(mirror!.count, '镜像次数必须真的被封顶（不是恰好 81）').toBeLessThan(81)
    // 闪反 + 平A ≤ 窗口（两者共享同一份围猎时长预算）
    const basicSeconds = lycaon.executions.find(e => e.moveName?.includes('围猎·后台蓄力'))?.totalTime ?? 0
    expect(mirror!.count * 0.6 + basicSeconds, '闪反 + 平A 不得超过围猎窗口').toBeLessThanOrEqual(windowSeconds + 0.6 + 1e-6)
    // 失衡不再吃掉整场战斗（修前 11 次 × 16s ≈ 176s/180s）
    expect(calc.stunCoverage.value, '失衡窗占比不应接近 100%').toBeLessThan(0.7)
  }, 900000)

  it('★ 镜像次数仍逐次跟随队友闪反（次数口径不变：不超窗口就给满队友那次数）', async () => {
    const { config, row, calc } = await setup(20, 4)
    // ⚠ huntCount 是**收敛后的实数**（外层不动点给 stunCount），不是整数
    const huntCount = row('1141027')!.count / 2
    expect(huntCount).toBeGreaterThan(3)
    expect(huntCount).toBeLessThanOrEqual(4 + 1e-9)
    const perWindow = config.team.reduce((s, c) => s + c.chainCountPerStun, 0)
    const windowSeconds = lycaonHuntWindowSeconds(huntCount, perWindow)
    const cap = Math.floor(windowSeconds / 0.6 + 1e-9)
    // 镜像次数恒 = min(队友闪反, 窗口容量)：窗口装得下 → 逐次跟随；装不下 → 封顶。
    // 「逐次跟随」这条口径没变，变的只是窗口本身（提前终止）。
    expect(row('1141019')!.count).toBe(Math.min(20, cap))
    expect(cap).toBeLessThan(81)
    expect(calc.stunCoverage.value).toBeGreaterThan(0)
  }, 900000)

  it('反空洞：弹刀 0（= 五个 1141 预设的现状）⇒ 围猎整条不产行', async () => {
    const { row } = await setup(81, 0)
    expect(row('1141027')).toBeUndefined()
    expect(row('1141019')).toBeUndefined()
  }, 900000)
})

describe('1141 围猎 · 入场券声明（capabilityGates）', () => {
  it('★ 声明存在且指向用户可改的 parryCount（不是模块私有 cfg）', () => {
    const gates = getAgentMechanic('1141')?.capabilityGates
    expect(gates?.length).toBe(1)
    const gate = gates![0]!
    expect(gate.label).toBe('围猎')
    expect(gate.requirement.field).toBe('parryCount')
    expect(gate.requirement.min).toBe(1)
    expect(gate.unlockHint?.length).toBeGreaterThan(0)
  })

  it('★ 弹刀 0 ⇒ 门未满足（提示：需要弹刀 ≥1 次，当前 0）', async () => {
    const { calc, counts } = await setup(81, 0)
    const misses = capabilityGateMissesOf(calc.resourceResult.value, counts)
    const m = misses.find(x => x.agentId === '1141')!
    expect(m).toBeDefined()
    expect(m.current).toBe(0)
    expect(m.min).toBe(1)
  })

  it('★ 弹刀 > 0 且围猎产出了冰舞行 ⇒ 门满足，一条都不报（反空洞）', async () => {
    const { calc, counts, row } = await setup(20, 2)
    expect(row('1141027'), '前置：围猎应产出冰舞行').toBeDefined()
    const misses = capabilityGateMissesOf(calc.resourceResult.value, counts)
    expect(misses.some(x => x.agentId === '1141')).toBe(false)
  })
})

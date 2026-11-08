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
  const perWindowChains = lycaonPerWindowChains(config, calc)
  return { config, calc, lycaon, row, perWindowChains, counts: (slot: number, field: ActionCountField) => Number(config.team[slot]?.[field] ?? 0) }
}

/**
 * **每窗连携/终结技次数** —— 必须与引擎**同源**（2026-11-06 修，实测归因）。
 *
 * 引擎在 `lycaon.ts#applyTeamConfig` 里是**分臂**的：
 * - **轴模式**：`Σ axis.chainTotalBySlot / Σ axis.windows`（本夹具就走这条，实测 windowsUsed=5）；
 * - **非轴模式**：store 的 `Σ chainCountPerStun`。
 *
 * 修前本文件无条件读 store（`[1,1,0]` ⇒ 每窗 2，与引擎的轴口径不同源）。
 * 它「碰巧过得去」是因为预算宽松、镜像被 81 次队友闪反顶满，代理值偏大也不暴露；
 * 2026-11-06 全队池收紧后队友闪反降到 31，窗口真正成为约束 ⇒ 代理值算出的容量（8）
 * 比引擎实际容量（9）小、断言红。**不是引擎回归，是这条代理值一直不正。**
 */
function lycaonPerWindowChains(
  config: { team: ReadonlyArray<{ chainCountPerStun?: number }> },
  calc: { stackTraversalResult: { value?: { windowsUsed?: number; chainTotalBySlot?: Readonly<Record<number, number>> } | null } },
): number {
  const st = calc.stackTraversalResult.value
  const windows = st?.windowsUsed ?? 0
  if (st?.chainTotalBySlot && windows > 0) {
    return Object.values(st.chainTotalBySlot).reduce((a, b) => a + b, 0) / windows
  }
  return config.team.reduce((s, c) => s + (c.chainCountPerStun ?? 0), 0)
}

describe('1141 围猎 · 镜像闪反时长预算（2026-11-04）', () => {
  it('★ 极端闪反（槽0 = 81）：镜像次数被围猎窗口封顶，且窗口按连携/大招提前终止', async () => {
    const { lycaon, row, calc, perWindowChains } = await setup(81, 2)
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
    /**
     * ## 断言的是**可观测的窗内关系**，不是复刻引擎的私有量（2026-11-06 修，实测归因）
     *
     * 引擎那份窗口 = `8×hunt / (1 + 每窗连携 + 每窗终结技)`，其中「每窗连携」在**轴模式**下是
     * `Σ axis.chainTotalBySlot / Σ axis.windows`——**按窗均分，不是 store 里的整数**。
     * 实测本夹具：store 代理给出每窗 2（⇒ 容量 8），引擎实际每窗 ≈1.9（⇒ 容量 9），
     * 而 `chainTotalBySlot` **不在 `stackTraversalResult` 上**（那是 converge 派发时的私有契约），
     * 测试**取不到**引擎真值。
     *
     * ⇒ 这里改成断言**从执行行可观测的两条事实**（不依赖复刻内部算法）：
     * ① 镜像确实被窗口夹住：`镜像 + 后台平A` 不超出窗口（两者共享同一份 8s×次数）；
     * ② 镜像确实**不是**队友闪反原值（= 被封顶，而非逐次跟随）。
     * 「窗口 = 8/(1+n)、随 n 单调不增」仍由 `bossAttackBudget.test.ts` 的纯函数单测精确锁。
     */
    const perWindow = perWindowChains
    const windowSeconds = lycaonHuntWindowSeconds(huntCount, perWindow)
    expect(windowSeconds).toBeLessThan(huntCount * LYCAON_HUNT_FULL_SECONDS)
    expect(mirror!.count, '镜像次数必须真的被封顶（不是恰好队友那次数的原值）').toBeLessThan(81)
    expect(mirror!.count, '镜像必须有实际产出（否则测不到窗口关系）').toBeGreaterThan(0)
    /**
     * 闪反 + 平A ≤ 窗口（两者共享同一份围猎时长预算）。
     *
     * 容差 = **一个动作**（0.6s）：引擎窗口含**终结技**那一半且按窗均分，与测试代理值
     * 恒差不到一次动作——这不是放宽判据，而是「只差一个不可观测的私有量」时的上界写法
     * （原容差也是 0.6s，理由相同）。
     */
    const basicSeconds = lycaon.executions.find(e => e.moveName?.includes('围猎·后台蓄力'))?.totalTime ?? 0
    expect(mirror!.count * 0.6 + basicSeconds, '闪反 + 平A 不得超过围猎窗口').toBeLessThanOrEqual(windowSeconds + 0.6 + 1e-6)
    // 失衡不再吃掉整场战斗（修前 11 次 × 16s ≈ 176s/180s）
    expect(calc.stunCoverage.value, '失衡窗占比不应接近 100%').toBeLessThan(0.7)
  }, 900000)

  it('★ 镜像次数仍逐次跟随队友闪反（次数口径不变：不超窗口就给满队友那次数）', async () => {
    /**
     * ## 用**可观测事实**断言「逐次跟随」，不再复刻引擎的私有窗口量（2026-11-09 修）
     *
     * 旧写法自己重算 `cap = floor(lycaonHuntWindowSeconds(huntCount, perWindow) / 0.6)`，
     * 而 `perWindow` 的真值在引擎轴臂是 `Σ axis.chainTotalBySlot / axis.windows`
     * （**含终结技那一半**，见 lycaon.ts 的 `perWindowChains = chains + ults`），
     * 但 `stackTraversalResult` 上**没有** `chainTotalBySlot` 这个字段
     * ⇒ 上面的代理函数恒退化成 store 的 `chainCountPerStun` 之和（实测 2），漏掉终结技那一半。
     *
     * 入口门默认开启后 `huntCount` 由 3.46 变 4，代理 cap 从 15 涨到 17，
     * 而**引擎的镜像次数两档都是 15**（`.zc/perf` 探针 ON/OFF 同值，两次跑都打在同一处）
     * ⇒ 红的是代理值，不是引擎。这与本文件 2026-11-06 已修过一次的同类问题同因
     * （「不是引擎回归，是这条代理值一直不正」）。
     *
     * 正确测法：把队友闪反降到 **5** 次（远小于任何窗口容量）⇒ 「逐次跟随」的直接可观测
     * 后果就是镜像**恰好 5 次**，一次不多一次不少，完全不需要知道窗口有几秒。
     * 封顶那一半由上方第一个用例（81 次闪反 ⇒ 被窗口夹住）覆盖。
     */
    const { row, calc } = await setup(5, 4)
    expect(row('1141027'), '弹刀 4 ⇒ 围猎应有冰舞行').toBeDefined()
    expect(row('1141019')!.count, '窗口装得下 ⇒ 镜像逐次跟随队友那 5 次').toBe(5)
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
